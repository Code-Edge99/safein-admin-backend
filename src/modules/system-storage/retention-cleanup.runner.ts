import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { PrismaService } from '../../prisma/prisma.service';
import { RetentionJobDto, RetentionStepDto } from './dto/system-storage.dto';

type JobStatus = 'idle' | 'running' | 'completed' | 'failed';

interface RetentionPolicy {
  table: string;
  column: string;
  extraWhereSql?: string;
}

/**
 * 보존 정책 통일안 (2026-06 협의) — 이 모듈이 정책의 단일 출처다.
 *  - 모든 로그/세션/집계/운영성 데이터의 정리 기준은 동일하게 2년(730일)이다.
 *  - device_locations 는 월별 파티션 백업+DROP(아카이브) 로 처리하므로 이 DELETE 기반 정리에서 제외한다.
 */
const RETENTION_POLICIES: RetentionPolicy[] = [
  { table: 'control_logs', column: 'timestamp' },
  { table: 'audit_logs', column: 'timestamp' },
  { table: 'zone_visit_sessions', column: 'enteredAt' },
  { table: 'app_usage_sessions', column: 'startedAt' },
  { table: 'work_sessions', column: 'startedAt' },
  { table: 'admin_login_history', column: 'loginTime' },
  { table: 'employee_login_history', column: 'loginTime' },
  { table: 'sms_verifications', column: 'createdAt' },
  { table: 'mdm_commands', column: 'createdAt' },
  { table: 'translation_jobs', column: 'processedAt' },
  {
    table: 'installed_apps',
    column: 'lastDetectedAt',
    extraWhereSql: 'AND "isInstalled" = false',
  },
  { table: 'employee_daily_stats', column: 'date' },
  { table: 'organization_daily_stats', column: 'date' },
  { table: 'hourly_block_stats', column: 'date' },
  { table: 'zone_violation_stats', column: 'date' },
];

const DEFAULT_BATCH_SIZE = 5000;
const RETENTION_DAYS = 730;
const RETENTION_ARCHIVE_KIND = 'retention_row_archive';

interface RetentionJobState {
  id: string;
  status: JobStatus;
  dryRun: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  mode: string | null;
  steps: RetentionStepDto[];
  logTail: string[];
  error: string | null;
}

interface RowArchiveResult {
  dumpFile: string;
  manifestFile: string;
  dumpSize: number;
  checksumSha256: string;
}

/**
 * 로그 보존 정리를 페이지에서 수동 실행하는 잡 러너(단일 동시 실행, in-process).
 *
 * 보존 기간 초과(컷오프 이전) 행을 CSV gzip 으로 아카이브한 뒤 배치 DELETE 한다.
 * 기본은 미리보기(만료 건수만 산출), 실제 삭제는 컨트롤러에서 confirm 검증 후 dryRun=false 로 호출된다.
 * device_locations 는 파티션 아카이브가 담당하므로 여기서 제외한다.
 */
@Injectable()
export class RetentionCleanupRunner {
  private readonly logger = new Logger(RetentionCleanupRunner.name);
  private current: RetentionJobState = this.idleState();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  getState(): RetentionJobDto {
    return { ...this.current, steps: [...this.current.steps], logTail: [...this.current.logTail] };
  }

  start(params: { dryRun: boolean; actorId?: string }): RetentionJobDto {
    if (this.current.status === 'running') {
      throw new ConflictException('이미 진행 중인 보존 정리 작업이 있습니다.');
    }

    this.current = {
      id: randomUUID(),
      status: 'running',
      dryRun: params.dryRun,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      mode: params.dryRun ? 'preview' : 'execute',
      steps: [],
      logTail: [],
      error: null,
    };

    this.logger.warn(
      `로그 보존 정리 작업 시작 (jobId=${this.current.id}, dryRun=${params.dryRun}, actor=${params.actorId ?? 'unknown'})`,
    );

    void this.run(this.current.id, params.dryRun);
    return this.getState();
  }

  private async run(jobId: string, dryRun: boolean): Promise<void> {
    try {
      const batchSize = Math.max(1, this.readPositiveInteger('SAFEIN_RETENTION_BATCH_SIZE', DEFAULT_BATCH_SIZE));
      const archiveDir = this.resolveArchiveDir();
      if (!dryRun) {
        fs.mkdirSync(archiveDir, { recursive: true });
      }

      for (const policy of RETENTION_POLICIES) {
        if (this.current.id !== jobId) {
          return; // 다른 잡으로 교체된 경우 중단
        }

        const days = RETENTION_DAYS;
        if (days <= 0) {
          this.pushStep({ table: policy.table, action: 'disabled', retentionDays: days, cutoff: null, expired: null, deleted: null });
          this.log(`${policy.table}: disabled (retentionDays=${days})`);
          continue;
        }

        const cutoff = this.cutoffFromDays(days);
        const expired = await this.countExpired(policy, cutoff);
        this.pushStep({
          table: policy.table,
          action: 'preview',
          retentionDays: days,
          cutoff: cutoff.toISOString(),
          expired,
          deleted: null,
        });
        this.log(`${policy.table}: cutoff=${cutoff.toISOString()} expired=${expired}`);

        if (dryRun || expired === 0) {
          continue;
        }

        const archive = await this.archiveExpiredRows(policy, cutoff, expired, archiveDir);
        this.patchStep(policy.table, {
          action: 'archived',
          archiveFile: archive.dumpFile,
          manifestFile: archive.manifestFile,
        });
        this.log(`${policy.table}: archived=${expired} file=${path.basename(archive.dumpFile)}`);

        let totalDeleted = 0;
        while (true) {
          if (this.current.id !== jobId) {
            return;
          }
          const deleted = await this.deleteExpiredBatch(policy, cutoff, batchSize);
          totalDeleted += deleted;
          if (deleted < batchSize) {
            break;
          }
        }

        this.patchStep(policy.table, { deleted: totalDeleted, action: 'archived-deleted' });
        this.log(`${policy.table}: deleted=${totalDeleted}`);
      }

      this.finish(jobId, 'completed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`로그 보존 정리 작업 실패(jobId=${jobId}): ${message}`);
      this.finish(jobId, 'failed', message);
    }
  }

  private async countExpired(policy: RetentionPolicy, cutoff: Date): Promise<number> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS "count" FROM "${policy.table}" WHERE "${policy.column}" < $1 ${policy.extraWhereSql ?? ''}`,
      cutoff,
    );
    return Number(rows[0]?.count ?? 0);
  }

  private async deleteExpiredBatch(policy: RetentionPolicy, cutoff: Date, batchSize: number): Promise<number> {
    // 큰 테이블에서 락/부하를 줄이기 위해 id 서브셀렉트 + LIMIT 배치로 삭제한다.
    const deleted = await this.prisma.$executeRawUnsafe(
      `DELETE FROM "${policy.table}"
       WHERE "id" IN (
         SELECT "id" FROM "${policy.table}"
         WHERE "${policy.column}" < $1 ${policy.extraWhereSql ?? ''}
         ORDER BY "${policy.column}" ASC
         LIMIT ${Math.trunc(batchSize)}
       )`,
      cutoff,
    );
    return Number(deleted ?? 0);
  }

  private async archiveExpiredRows(
    policy: RetentionPolicy,
    cutoff: Date,
    rowCount: number,
    archiveDir: string,
  ): Promise<RowArchiveResult> {
    const databaseUrl = this.config.get<string>('DATABASE_URL') ?? process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL 이 설정되어 있지 않습니다.');
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dumpFile = path.join(archiveDir, `${policy.table}_${stamp}.rows.csv.gz`);
    const copySql = this.buildCopySql(policy, cutoff);
    const psql = this.config.get<string>('PSQL_PATH') ?? process.env.PSQL_PATH ?? 'psql';
    const child = spawn(
      psql,
      ['-d', this.toCliDatabaseUrl(databaseUrl), '-v', 'ON_ERROR_STOP=1', '-c', copySql],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    const writeDone = pipeline(child.stdout, zlib.createGzip(), fs.createWriteStream(dumpFile));
    const exitDone = new Promise<void>((resolve, reject) => {
      child.on('error', (error) => reject(new Error(`psql 실행 실패: ${error.message}`)));
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`psql 비정상 종료(code=${code}): ${stderr.trim()}`));
        }
      });
    });

    await Promise.all([writeDone, exitDone]);
    const decompressedBytes = await this.verifyGzipIntegrity(dumpFile);
    if (rowCount > 0 && decompressedBytes === 0) {
      throw new Error(`아카이브 파일 압축해제 결과가 비어있음(rows=${rowCount}). DELETE 중단.`);
    }

    const dumpSize = fs.statSync(dumpFile).size;
    const checksumSha256 = await this.sha256(dumpFile);
    const manifestFile = path.join(archiveDir, `${policy.table}_${stamp}.rows.manifest.json`);
    const manifest = {
      version: 1,
      kind: RETENTION_ARCHIVE_KIND,
      table: policy.table,
      cutoffColumn: policy.column,
      cutoff: cutoff.toISOString(),
      extraWhereSql: policy.extraWhereSql ?? null,
      retentionDays: RETENTION_DAYS,
      rowCount,
      dumpFormat: 'copy-csv-gzip',
      dumpFile: path.basename(dumpFile),
      dumpFilePath: dumpFile,
      dumpSize,
      checksumSha256,
      sourceDatabase: this.getDatabaseTargetSummary(databaseUrl),
      archivedAt: new Date().toISOString(),
      retentionPolicy: 'archive-only',
    };
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return { dumpFile, manifestFile, dumpSize, checksumSha256 };
  }

  private buildCopySql(policy: RetentionPolicy, cutoff: Date): string {
    return [
      'COPY (',
      `SELECT * FROM ${this.quoteIdentifier(policy.table)}`,
      `WHERE ${this.quoteIdentifier(policy.column)} < ${this.quoteLiteral(cutoff.toISOString())}`,
      policy.extraWhereSql ?? '',
      `ORDER BY ${this.quoteIdentifier(policy.column)} ASC, "id" ASC`,
      ') TO STDOUT WITH (FORMAT csv, HEADER true, FORCE_QUOTE *);',
    ].filter(Boolean).join(' ');
  }

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

  private sha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('error', reject);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  private cutoffFromDays(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  private readPositiveInteger(key: string, fallback: number): number {
    const raw = this.config.get<string>(key) ?? process.env[key];
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.trunc(parsed);
  }

  private quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  private quoteLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
  }

  private toCliDatabaseUrl(databaseUrl: string): string {
    try {
      const parsed = new URL(databaseUrl);
      parsed.searchParams.delete('schema');
      return parsed.toString();
    } catch {
      return databaseUrl;
    }
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

  private resolveArchiveDir(): string {
    const configured = this.config.get<string>('SAFEIN_ARCHIVE_DIR') ?? process.env.SAFEIN_ARCHIVE_DIR;
    return path.resolve(configured || path.join(process.cwd(), 'archive'));
  }

  private pushStep(step: RetentionStepDto): void {
    if (this.current.id) {
      this.current.steps.push({ expired: null, deleted: null, ...step });
    }
  }

  private patchStep(table: string, patch: Partial<RetentionStepDto>): void {
    const existing = this.current.steps.find((s) => s.table === table);
    if (existing) {
      Object.assign(existing, patch);
    }
  }

  private log(line: string): void {
    this.current.logTail.push(`[retention] ${line}`);
    if (this.current.logTail.length > 200) {
      this.current.logTail.shift();
    }
  }

  private finish(jobId: string, status: JobStatus, error: string | null = null): void {
    if (this.current.id !== jobId) {
      return;
    }
    this.current.status = status;
    this.current.error = error;
    this.current.finishedAt = new Date().toISOString();
  }

  private idleState(): RetentionJobState {
    return {
      id: '',
      status: 'idle',
      dryRun: true,
      startedAt: null,
      finishedAt: null,
      mode: null,
      steps: [],
      logTail: [],
      error: null,
    };
  }
}
