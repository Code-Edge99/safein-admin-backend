import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DEFAULT_ARCHIVE_RETAIN_YEARS,
  DEVICE_LOCATION_PARENT_TABLE,
  SystemStorageService,
} from './system-storage.service';
import { ArchiveJobDto, ArchiveStepDto } from './dto/system-storage.dto';

type JobStatus = 'idle' | 'running' | 'completed' | 'failed';

interface ArchiveJobState {
  id: string;
  status: JobStatus;
  dryRun: boolean;
  retainYears: number;
  startedAt: string | null;
  finishedAt: string | null;
  steps: ArchiveStepDto[];
  error: string | null;
}

interface ArchiveDumpResult {
  dumpFile: string;
  manifestFile: string;
  dumpSize: number;
}

/**
 * device_locations 파티션 백업+드롭을 백그라운드로 수행하는 잡 러너(단일 동시 실행).
 *
 * 슈퍼관리자가 페이지에서 트리거하면 pg_dump 백업 → 검증 → DROP 을 비동기로 진행하고,
 * 상태를 폴링 API 로 노출한다. 백업이 정상 검증되지 않으면 해당 파티션은 DROP 하지 않는다.
 */
@Injectable()
export class PartitionArchiveRunner {
  private readonly logger = new Logger(PartitionArchiveRunner.name);
  private current: ArchiveJobState = this.idleState();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SystemStorageService,
    private readonly config: ConfigService,
  ) {}

  getState(): ArchiveJobDto {
    return { ...this.current, steps: [...this.current.steps] };
  }

  start(params: { retainYears?: number; dryRun: boolean; actorId?: string }): ArchiveJobDto {
    if (this.current.status === 'running') {
      throw new ConflictException('이미 진행 중인 아카이브 작업이 있습니다.');
    }

    const retainYears = params.retainYears ?? DEFAULT_ARCHIVE_RETAIN_YEARS;
    this.current = {
      id: randomUUID(),
      status: 'running',
      dryRun: params.dryRun,
      retainYears,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      steps: [],
      error: null,
    };

    this.logger.warn(
      `파티션 아카이브 작업 시작 (jobId=${this.current.id}, dryRun=${params.dryRun}, retainYears=${retainYears}, actor=${params.actorId ?? 'unknown'})`,
    );

    void this.run(this.current.id, retainYears, params.dryRun);
    return this.getState();
  }

  private async run(jobId: string, retainYears: number, dryRun: boolean): Promise<void> {
    try {
      const cutoff = this.storage.resolveCutoff(retainYears);
      const partitions = await this.storage.listPartitions(DEVICE_LOCATION_PARENT_TABLE);

      const expired = partitions.filter((p) => {
        if (!p.bound || /DEFAULT/i.test(p.bound)) {
          return false;
        }
        const upper = this.storage.parseUpperBound(p.bound);
        return upper !== null && upper.getTime() <= cutoff.getTime();
      });

      if (expired.length === 0) {
        this.finish(jobId, 'completed');
        return;
      }

      const archiveDir = this.resolveArchiveDir();
      if (!dryRun) {
        fs.mkdirSync(archiveDir, { recursive: true });
      }

      for (const partition of expired) {
        if (this.current.id !== jobId) {
          return; // 다른 잡으로 교체된 경우 중단
        }

        const rowCount = await this.countRows(partition.name);

        if (dryRun) {
          this.pushStep({ partition: partition.name, action: 'dry-run', rowCount });
          continue;
        }

        try {
          const archive = await this.dumpPartition(partition, rowCount, archiveDir);
          const filePath = archive.dumpFile;
          const size = archive.dumpSize;
          if (rowCount > 0 && archive.dumpSize < 40) {
            throw new Error(`백업 파일이 비어있는 것으로 보임(size=${size}). DROP 중단`);
          }

          await this.prisma.$executeRawUnsafe(`DROP TABLE ${this.quoteIdentifier(partition.name)}`);
          this.pushStep({
            partition: partition.name,
            action: 'archived-dropped',
            rowCount,
            archiveFile: filePath,
            manifestFile: archive.manifestFile,
          });
          this.logger.warn(`파티션 백업+드롭 완료: ${partition.name} (rows=${rowCount}, file=${filePath})`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.pushStep({ partition: partition.name, action: 'failed', rowCount, message });
          this.logger.error(`파티션 백업/드롭 실패: ${partition.name} - ${message}`);
        }
      }

      this.finish(jobId, 'completed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`파티션 아카이브 작업 실패(jobId=${jobId}): ${message}`);
      this.finish(jobId, 'failed', message);
    }
  }

  private async countRows(partitionName: string): Promise<number> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::float8 AS "count" FROM ${this.quoteIdentifier(partitionName)}`,
    );
    return Math.round(rows[0]?.count ?? 0);
  }

  /** 작성된 gz 파일을 끝까지 풀어보며 손상/절단 여부와 압축해제 바이트 수를 검증한다. */
  private verifyGzipIntegrity(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      let decompressedBytes = 0;
      const source = fs.createReadStream(filePath);
      const gunzip = zlib.createGunzip();
      source.on('error', reject);
      gunzip.on('error', (error) => reject(new Error(`gzip 무결성 검증 실패(손상/절단 의심): ${error.message}`)));
      gunzip.on('data', (chunk) => {
        decompressedBytes += chunk.length;
      });
      gunzip.on('end', () => resolve(decompressedBytes));
      source.pipe(gunzip);
    });
  }

  private async dumpPartition(
    partition: { name: string; bound: string | null },
    rowCount: number,
    archiveDir: string,
  ): Promise<ArchiveDumpResult> {
    const databaseUrl = this.config.get<string>('DATABASE_URL') ?? process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL 이 설정되어 있지 않습니다.');
    }

    const pgDumpDatabaseUrl = this.toPgDumpDatabaseUrl(databaseUrl);
    const pgDump = this.config.get<string>('PG_DUMP_PATH') ?? process.env.PG_DUMP_PATH ?? 'pg_dump';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(archiveDir, `${partition.name}_${stamp}.sql.gz`);

    const child = spawn(
      pgDump,
      ['-d', pgDumpDatabaseUrl, '--data-only', '--no-owner', '--no-privileges', '-t', `public.${partition.name}`],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    // pg_dump 종료코드와 파일 쓰기 완료를 모두 기다린다(둘 중 하나만 끝나는 레이스 제거).
    const writeDone = pipeline(child.stdout, zlib.createGzip(), fs.createWriteStream(filePath));
    const exitDone = new Promise<void>((resolve, reject) => {
      child.on('error', (error) => reject(new Error(`pg_dump 실행 실패: ${error.message}`)));
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`pg_dump 비정상 종료(code=${code}): ${stderr.trim()}`));
        }
      });
    });

    await Promise.all([writeDone, exitDone]);

    // 백업 파일이 정상적으로 끝까지 압축됐는지(절단되지 않았는지) 검증한다.
    const decompressedBytes = await this.verifyGzipIntegrity(filePath);
    if (rowCount > 0 && decompressedBytes === 0) {
      throw new Error(`백업 파일 압축해제 결과가 비어있음(rows=${rowCount}). DROP 중단.`);
    }

    return this.finalizeArchiveDump(partition, rowCount, filePath, archiveDir, stamp, databaseUrl);
  }

  private finalizeArchiveDump(
    partition: { name: string; bound: string | null },
    rowCount: number,
    dumpFile: string,
    archiveDir: string,
    stamp: string,
    databaseUrl: string,
  ): ArchiveDumpResult {
    const dumpSize = fs.statSync(dumpFile).size;
    const manifestFile = path.join(archiveDir, `${partition.name}_${stamp}.manifest.json`);
    const manifest = {
      version: 1,
      kind: 'device_locations_partition_archive',
      parentTable: DEVICE_LOCATION_PARENT_TABLE,
      partitionName: partition.name,
      partitionBound: partition.bound,
      rowCount,
      dumpFormat: 'plain-sql-gzip-data-only',
      dumpFile: path.basename(dumpFile),
      dumpFilePath: dumpFile,
      dumpSize,
      sourceDatabase: this.getDatabaseTargetSummary(databaseUrl),
      archivedAt: new Date().toISOString(),
      retentionPolicy: 'archive-only',
    };
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return { dumpFile, manifestFile, dumpSize };
  }

  private quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  private getDatabaseTargetSummary(databaseUrl: string): string {
    try {
      const parsed = new URL(databaseUrl);
      const databaseName = parsed.pathname.replace(/^\//, '') || '(unknown-db)';
      return `${parsed.hostname}:${parsed.port || '5432'}/${databaseName}`;
    } catch {
      return '(unparsed DATABASE_URL)';
    }
  }

  private toPgDumpDatabaseUrl(databaseUrl: string): string {
    try {
      const parsed = new URL(databaseUrl);
      parsed.searchParams.delete('schema');
      return parsed.toString();
    } catch {
      return databaseUrl;
    }
  }

  private resolveArchiveDir(): string {
    const configured = this.config.get<string>('SAFEIN_ARCHIVE_DIR') ?? process.env.SAFEIN_ARCHIVE_DIR;
    return path.resolve(configured || path.join(process.cwd(), 'archive'));
  }

  private pushStep(step: ArchiveStepDto): void {
    this.current.steps.push({ archiveFile: null, manifestFile: null, message: null, ...step });
  }

  private finish(jobId: string, status: JobStatus, error: string | null = null): void {
    if (this.current.id !== jobId) {
      return;
    }
    this.current.status = status;
    this.current.error = error;
    this.current.finishedAt = new Date().toISOString();
  }

  private idleState(): ArchiveJobState {
    return {
      id: '',
      status: 'idle',
      dryRun: true,
      retainYears: DEFAULT_ARCHIVE_RETAIN_YEARS,
      startedAt: null,
      finishedAt: null,
      steps: [],
      error: null,
    };
  }
}
