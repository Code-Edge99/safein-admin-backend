import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { execFile } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { stat, statfs } from 'node:fs/promises';
import { promisify } from 'node:util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CpuUsageDto,
  DiskUsageDto,
  ManagedStorageTargetDto,
  MemoryUsageDto,
  PartitionInfoDto,
  PartitionOverviewDto,
  StorageOverviewDto,
  SystemResourceOverviewDto,
  TableUsageDto,
} from './dto/system-storage.dto';

export const DEVICE_LOCATION_PARENT_TABLE = 'device_locations';
export const DEFAULT_ARCHIVE_RETAIN_YEARS = 2;

type RawTableUsage = {
  table: string;
  total_bytes: number;
  table_bytes: number;
  index_bytes: number;
  row_estimate: number;
  partition_count: number;
};

type RawPartition = {
  name: string;
  bound: string | null;
  total_bytes: number;
  row_estimate: number;
};

type ManagedStorageTargetDefinition = {
  key: string;
  title: string;
  category: string;
  tables: string[];
  management: string;
  status: 'active' | 'monitoring' | 'review' | 'candidate' | 'required';
};

const MANAGED_STORAGE_TARGETS: ManagedStorageTargetDefinition[] = [
  {
    key: 'device_locations',
    title: '위치 이력',
    category: '파티션 정리',
    tables: ['device_locations', 'device_current_locations'],
    management: '월별 파티션 아카이브, manifest 보관, 장기 보관 파일 점검',
    status: 'active',
  },
  {
    key: 'audit_logs',
    title: '감사 이력',
    category: '감사 로그',
    tables: ['audit_logs'],
    management: '조직별 증가량, 장기 보존 기준, 정리 작업 감사 이력',
    status: 'monitoring',
  },
  {
    key: 'control_logs',
    title: '제어 이력',
    category: '운영 로그',
    tables: ['control_logs'],
    management: '조회 기간 제한, 장기 보존 범위, 파티션 적용 가능성',
    status: 'review',
  },
  {
    key: 'login_history',
    title: '로그인 이력',
    category: '보안 감사',
    tables: ['admin_login_history', 'employee_login_history'],
    management: '보안 감사 기간, 계정/직원별 증가량, 실패 이력 보존 범위',
    status: 'candidate',
  },
  {
    key: 'session_history',
    title: '세션 이력',
    category: '사용 이력',
    tables: ['zone_visit_sessions', 'app_usage_sessions', 'work_sessions'],
    management: '종료된 세션 보존 기간, 미종료 세션 점검, 통계 전환 가능성',
    status: 'candidate',
  },
  {
    key: 'ephemeral_operations',
    title: '단기 운영 데이터',
    category: '운영성 데이터',
    tables: ['sms_verifications', 'mdm_commands', 'translation_jobs', 'installed_apps'],
    management: '짧은 보존 기간, 실패/미처리 항목 점검, 재시도 이력 범위',
    status: 'candidate',
  },
  {
    key: 'attachments',
    title: '첨부 파일 메타데이터',
    category: '파일 저장소',
    tables: ['tbm_attachments', 'incident_report_attachments', 'notice_attachments', 'tbm_original_audios'],
    management: '원본 파일 존재 여부, 백업 위치, 고아 파일 점검',
    status: 'candidate',
  },
  {
    key: 'daily_statistics',
    title: '집계 통계',
    category: '통계 데이터',
    tables: ['employee_daily_stats', 'organization_daily_stats', 'hourly_block_stats', 'zone_violation_stats'],
    management: '원천 로그 정리 후에도 남길 통계 범위, 재집계 가능성',
    status: 'candidate',
  },
  {
    key: 'issued_documents',
    title: '발행 문서',
    category: '문서 근거',
    tables: ['document_issues', 'document_issue_sequences'],
    management: '문서번호 발급 근거, 발행자/발행 시각, 문서 유형별 증가량',
    status: 'required',
  },
  {
    key: 'archive_files',
    title: '아카이브 파일',
    category: '보관 근거',
    tables: [],
    management: '파티션/행 아카이브 파일, manifest 파일, 덤프 파일 존재 여부',
    status: 'required',
  },
];

const execFileAsync = promisify(execFile);

@Injectable()
export class SystemStorageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getOverview(limit?: number): Promise<StorageOverviewDto> {
    const dbRows = await this.prisma.$queryRaw<Array<{ bytes: number }>>(
      Prisma.sql`SELECT pg_database_size(current_database())::float8 AS bytes`,
    );
    const allTables = await this.getLogicalTableUsages();
    const tables = limit === undefined ? allTables : allTables.slice(0, this.normalizeLimit(limit));

    return {
      databaseBytes: Math.round(dbRows[0]?.bytes ?? 0),
      measuredAt: new Date().toISOString(),
      tables,
      managedTargets: this.buildManagedTargets(allTables),
      systemResources: await this.getSystemResources(),
    };
  }

  async getPartitionOverview(
    retainYears = DEFAULT_ARCHIVE_RETAIN_YEARS,
    parentTable = DEVICE_LOCATION_PARENT_TABLE,
  ): Promise<PartitionOverviewDto> {
    const cutoff = this.resolveCutoff(retainYears);

    const partitions = await this.listPartitions(parentTable);
    const infos: PartitionInfoDto[] = partitions.map((p) => {
      const upper = this.parseUpperBound(p.bound);
      const isDefault = !p.bound || /DEFAULT/i.test(p.bound);
      const expired = !isDefault && upper !== null && upper.getTime() <= cutoff.getTime();
      return {
        name: p.name,
        rangeUpper: upper ? upper.toISOString() : null,
        totalBytes: Math.round(p.total_bytes ?? 0),
        rowEstimate: Math.round(p.row_estimate ?? 0),
        isDefault,
        expired,
      };
    });

    return {
      parentTable,
      retainYears,
      cutoff: cutoff.toISOString(),
      expiredCount: infos.filter((i) => i.expired).length,
      partitions: infos,
    };
  }

  async listPartitions(parentTable = DEVICE_LOCATION_PARENT_TABLE): Promise<RawPartition[]> {
    return this.prisma.$queryRaw<RawPartition[]>(
      Prisma.sql`
      SELECT
        c.relname AS name,
        pg_get_expr(c.relpartbound, c.oid) AS bound,
        pg_total_relation_size(c.oid)::float8 AS total_bytes,
        c.reltuples::float8 AS row_estimate
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relname = ${parentTable}
      ORDER BY c.relname
      `,
    );
  }

  private async getLogicalTableUsages(): Promise<TableUsageDto[]> {
    // 파티션은 루트(부모) 테이블 기준으로 합산하여 "논리 테이블" 단위로 보여준다.
    const rows = await this.prisma.$queryRaw<RawTableUsage[]>(
      Prisma.sql`
      SELECT
        COALESCE(root.relname, c.relname) AS table,
        SUM(pg_total_relation_size(c.oid))::float8 AS total_bytes,
        SUM(pg_table_size(c.oid))::float8 AS table_bytes,
        SUM(pg_indexes_size(c.oid))::float8 AS index_bytes,
        SUM(c.reltuples)::float8 AS row_estimate,
        COUNT(*) FILTER (WHERE c.oid <> COALESCE(root.oid, c.oid))::int AS partition_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      LEFT JOIN pg_class root ON root.oid = pg_partition_root(c.oid)
      WHERE c.relkind = 'r'
      GROUP BY COALESCE(root.relname, c.relname)
      ORDER BY total_bytes DESC
      `,
    );

    return rows.map((row) => ({
      table: row.table,
      totalBytes: Math.max(0, Math.round(row.total_bytes ?? 0)),
      tableBytes: Math.max(0, Math.round(row.table_bytes ?? 0)),
      indexBytes: Math.max(0, Math.round(row.index_bytes ?? 0)),
      rowEstimate: Math.max(0, Math.round(row.row_estimate ?? 0)),
      partitionCount: Math.max(0, row.partition_count ?? 0),
    }));
  }

  private buildManagedTargets(tables: TableUsageDto[]): ManagedStorageTargetDto[] {
    const byName = new Map(tables.map((table) => [table.table, table]));

    return MANAGED_STORAGE_TARGETS.map((target) => {
      const presentTables = target.tables
        .map((tableName) => byName.get(tableName))
        .filter((table): table is TableUsageDto => Boolean(table));

      const includedTables = presentTables.map((table) => table.table);
      const missingTables = target.tables.filter((tableName) => !byName.has(tableName));

      return {
        key: target.key,
        title: target.title,
        category: target.category,
        tables: includedTables,
        missingTables,
        management: target.management,
        status: target.status,
        totalBytes: presentTables.reduce((total, table) => total + table.totalBytes, 0),
        tableBytes: presentTables.reduce((total, table) => total + table.tableBytes, 0),
        indexBytes: presentTables.reduce((total, table) => total + table.indexBytes, 0),
        rowEstimate: presentTables.reduce((total, table) => total + table.rowEstimate, 0),
        partitionCount: presentTables.reduce((total, table) => total + table.partitionCount, 0),
      };
    });
  }

  private normalizeLimit(limit: number): number {
    if (!Number.isFinite(limit)) {
      return 30;
    }

    return Math.min(100, Math.max(1, Math.trunc(limit)));
  }

  resolveCutoff(retainYears: number, now: Date = new Date()): Date {
    const retentionDays = retainYears * 365;
    return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  }

  /** RANGE 파티션 bound 표현식에서 상한(TO) 타임스탬프 파싱. DEFAULT/MAXVALUE는 null. */
  parseUpperBound(boundExpr: string | null): Date | null {
    if (!boundExpr || /DEFAULT/i.test(boundExpr)) {
      return null;
    }
    const toMatch = boundExpr.match(/TO\s*\(([^)]*)\)/i);
    if (!toMatch) {
      return null;
    }
    const rawTo = toMatch[1].trim();
    if (/MAXVALUE/i.test(rawTo)) {
      return null;
    }
    const literal = rawTo.replace(/^'|'$/g, '').trim();
    const parsed = new Date(literal);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private async getSystemResources(): Promise<SystemResourceOverviewDto> {
    const archivePath = this.resolveArchiveDir();

    return {
      archivePath,
      disk: await this.getDiskUsage(archivePath),
      memory: this.getMemoryUsage(),
      cpu: this.getCpuUsage(),
    };
  }

  private getMemoryUsage(): MemoryUsageDto {
    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const usedBytes = Math.max(0, totalBytes - freeBytes);

    return {
      totalBytes,
      freeBytes,
      usedBytes,
      usedPercent: this.percent(usedBytes, totalBytes),
    };
  }

  private getCpuUsage(): CpuUsageDto {
    const platform = os.platform();
    const loads = platform === 'win32' ? [null, null, null] : os.loadavg();

    return {
      platform,
      hostname: os.hostname(),
      cpuCount: os.cpus().length,
      loadAverage1m: loads[0],
      loadAverage5m: loads[1],
      loadAverage15m: loads[2],
      processUptimeSeconds: Math.round(process.uptime()),
      systemUptimeSeconds: Math.round(os.uptime()),
    };
  }

  private async getDiskUsage(targetPath: string): Promise<DiskUsageDto> {
    const probePath = await this.resolveExistingPath(targetPath);
    const methods = [
      () => this.getDiskUsageWithStatfs(targetPath, probePath),
      () => this.getDiskUsageWithPlatformCommand(targetPath, probePath),
    ];
    let lastError: string | null = null;

    for (const method of methods) {
      try {
        return await method();
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    return {
      path: targetPath,
      probePath,
      totalBytes: null,
      freeBytes: null,
      availableBytes: null,
      usedBytes: null,
      usedPercent: null,
      method: 'unavailable',
      error: lastError,
    };
  }

  private async getDiskUsageWithStatfs(targetPath: string, probePath: string): Promise<DiskUsageDto> {
    const usage = await statfs(probePath);
    const blockSize = Number(usage.bsize);
    const totalBytes = Number(usage.blocks) * blockSize;
    const freeBytes = Number(usage.bfree) * blockSize;
    const availableBytes = Number(usage.bavail) * blockSize;

    return this.toDiskUsageDto({
      path: targetPath,
      probePath,
      totalBytes,
      freeBytes,
      availableBytes,
      method: 'statfs',
    });
  }

  private async getDiskUsageWithPlatformCommand(targetPath: string, probePath: string): Promise<DiskUsageDto> {
    if (os.platform() === 'win32') {
      return this.getDiskUsageWithPowerShell(targetPath, probePath);
    }

    return this.getDiskUsageWithDf(targetPath, probePath);
  }

  private async getDiskUsageWithDf(targetPath: string, probePath: string): Promise<DiskUsageDto> {
    const { stdout } = await execFileAsync('df', ['-Pk', probePath], {
      timeout: 3000,
      windowsHide: true,
    });
    const lines = String(stdout).trim().split(/\r?\n/).filter(Boolean);
    const dataLine = lines[lines.length - 1];
    if (!dataLine) {
      throw new Error('df returned no output.');
    }

    const parts = dataLine.trim().split(/\s+/);
    if (parts.length < 6) {
      throw new Error(`df returned an unexpected format: ${dataLine}`);
    }

    const totalBytes = Number(parts[1]) * 1024;
    const usedBytes = Number(parts[2]) * 1024;
    const availableBytes = Number(parts[3]) * 1024;
    if (![totalBytes, usedBytes, availableBytes].every(Number.isFinite)) {
      throw new Error(`df returned non-numeric values: ${dataLine}`);
    }

    return this.toDiskUsageDto({
      path: targetPath,
      probePath,
      totalBytes,
      freeBytes: availableBytes,
      availableBytes,
      method: 'df',
    });
  }

  private async getDiskUsageWithPowerShell(targetPath: string, probePath: string): Promise<DiskUsageDto> {
    const script = [
      '$item = Get-Item -LiteralPath $env:SAFEIN_DISK_PATH -ErrorAction Stop',
      '$root = [System.IO.Path]::GetPathRoot($item.FullName)',
      '$driveName = $root.TrimEnd("\\").TrimEnd(":")',
      '$drive = Get-PSDrive -Name $driveName -ErrorAction Stop',
      '[pscustomobject]@{ totalBytes = [double]($drive.Used + $drive.Free); freeBytes = [double]$drive.Free } | ConvertTo-Json -Compress',
    ].join('; ');

    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        timeout: 3000,
        windowsHide: true,
        env: { ...process.env, SAFEIN_DISK_PATH: probePath },
      },
    );

    const parsed = JSON.parse(String(stdout).trim()) as { totalBytes?: unknown; freeBytes?: unknown };
    const totalBytes = Number(parsed.totalBytes);
    const freeBytes = Number(parsed.freeBytes);
    if (!Number.isFinite(totalBytes) || !Number.isFinite(freeBytes)) {
      throw new Error(`PowerShell returned non-numeric disk values: ${String(stdout).trim()}`);
    }

    return this.toDiskUsageDto({
      path: targetPath,
      probePath,
      totalBytes,
      freeBytes,
      availableBytes: freeBytes,
      method: 'powershell',
    });
  }

  private toDiskUsageDto(input: {
    path: string;
    probePath: string;
    totalBytes: number;
    freeBytes: number;
    availableBytes: number;
    method: string;
  }): DiskUsageDto {
    const totalBytes = Math.max(0, Math.round(input.totalBytes));
    const freeBytes = Math.max(0, Math.round(input.freeBytes));
    const availableBytes = Math.max(0, Math.round(input.availableBytes));
    const usedBytes = Math.max(0, totalBytes - freeBytes);

    return {
      path: input.path,
      probePath: input.probePath,
      totalBytes,
      freeBytes,
      availableBytes,
      usedBytes,
      usedPercent: this.percent(usedBytes, totalBytes),
      method: input.method,
      error: null,
    };
  }

  private async resolveExistingPath(targetPath: string): Promise<string> {
    let current = path.resolve(targetPath);

    while (true) {
      try {
        await stat(current);
        return current;
      } catch {
        const parent = path.dirname(current);
        if (parent === current) {
          return process.cwd();
        }
        current = parent;
      }
    }
  }

  private resolveArchiveDir(): string {
    const configured = this.config.get<string>('SAFEIN_ARCHIVE_DIR') ?? process.env.SAFEIN_ARCHIVE_DIR;
    return path.resolve(configured || path.join(process.cwd(), 'archive'));
  }

  private percent(used: number, total: number): number {
    if (!Number.isFinite(total) || total <= 0) {
      return 0;
    }
    return Math.min(100, Math.max(0, Number(((used / total) * 100).toFixed(2))));
  }
}
