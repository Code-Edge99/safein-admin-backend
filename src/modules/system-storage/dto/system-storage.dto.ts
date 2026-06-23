import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class TableUsageDto {
  @ApiProperty({ description: '테이블(논리) 이름. 파티션은 부모 기준으로 합산' })
  table!: string;

  @ApiProperty({ description: '총 크기(바이트, 인덱스 포함)' })
  totalBytes!: number;

  @ApiProperty({ description: '데이터 크기(바이트)' })
  tableBytes!: number;

  @ApiProperty({ description: '인덱스 크기(바이트)' })
  indexBytes!: number;

  @ApiProperty({ description: '행 수 추정(reltuples)' })
  rowEstimate!: number;

  @ApiProperty({ description: '파티션 개수(파티션 테이블만 >0)' })
  partitionCount!: number;
}

export class DiskUsageDto {
  @ApiProperty({ description: 'Target path used for disk measurement' })
  path!: string;

  @ApiPropertyOptional({ description: 'Existing path actually probed', nullable: true })
  probePath?: string | null;

  @ApiPropertyOptional({ description: 'Total disk bytes', nullable: true })
  totalBytes!: number | null;

  @ApiPropertyOptional({ description: 'Free disk bytes', nullable: true })
  freeBytes!: number | null;

  @ApiPropertyOptional({ description: 'Available disk bytes for the current user', nullable: true })
  availableBytes!: number | null;

  @ApiPropertyOptional({ description: 'Used disk bytes', nullable: true })
  usedBytes!: number | null;

  @ApiPropertyOptional({ description: 'Used disk percent', nullable: true })
  usedPercent!: number | null;

  @ApiProperty({ description: 'Measurement method: statfs, df, powershell, or unavailable' })
  method!: string;

  @ApiPropertyOptional({ description: 'Measurement error if unavailable', nullable: true })
  error?: string | null;
}

export class MemoryUsageDto {
  @ApiProperty({ description: 'Total memory bytes' })
  totalBytes!: number;

  @ApiProperty({ description: 'Free memory bytes' })
  freeBytes!: number;

  @ApiProperty({ description: 'Used memory bytes' })
  usedBytes!: number;

  @ApiProperty({ description: 'Used memory percent' })
  usedPercent!: number;
}

export class CpuUsageDto {
  @ApiProperty({ description: 'OS platform' })
  platform!: string;

  @ApiProperty({ description: 'Host name' })
  hostname!: string;

  @ApiProperty({ description: 'CPU core count' })
  cpuCount!: number;

  @ApiPropertyOptional({ description: '1 minute load average. Null on Windows.', nullable: true })
  loadAverage1m!: number | null;

  @ApiPropertyOptional({ description: '5 minute load average. Null on Windows.', nullable: true })
  loadAverage5m!: number | null;

  @ApiPropertyOptional({ description: '15 minute load average. Null on Windows.', nullable: true })
  loadAverage15m!: number | null;

  @ApiProperty({ description: 'Node process uptime in seconds' })
  processUptimeSeconds!: number;

  @ApiProperty({ description: 'System uptime in seconds' })
  systemUptimeSeconds!: number;
}

export class SystemResourceOverviewDto {
  @ApiProperty({ description: 'Archive file storage path' })
  archivePath!: string;

  @ApiProperty({ type: () => DiskUsageDto })
  disk!: DiskUsageDto;

  @ApiProperty({ type: () => MemoryUsageDto })
  memory!: MemoryUsageDto;

  @ApiProperty({ type: () => CpuUsageDto })
  cpu!: CpuUsageDto;
}

export class ManagedStorageTargetDto {
  @ApiProperty({ description: '관리 대상 식별자' })
  key!: string;

  @ApiProperty({ description: '관리 대상 표시명' })
  title!: string;

  @ApiProperty({ description: '관리 분류' })
  category!: string;

  @ApiProperty({ type: [String], description: '집계에 포함된 실제 테이블' })
  tables!: string[];

  @ApiProperty({ type: [String], description: '현재 스키마에서 찾지 못한 테이블' })
  missingTables!: string[];

  @ApiProperty({ description: '관리 관점' })
  management!: string;

  @ApiProperty({ description: 'active | monitoring | review | candidate | required' })
  status!: string;

  @ApiProperty({ description: '총 크기(바이트, 인덱스 포함)' })
  totalBytes!: number;

  @ApiProperty({ description: '데이터 크기(바이트)' })
  tableBytes!: number;

  @ApiProperty({ description: '인덱스 크기(바이트)' })
  indexBytes!: number;

  @ApiProperty({ description: '행 수 추정(reltuples)' })
  rowEstimate!: number;

  @ApiProperty({ description: '파티션 개수 합계' })
  partitionCount!: number;
}

export class StorageOverviewDto {
  @ApiProperty({ description: 'DB 전체 크기(바이트)' })
  databaseBytes!: number;

  @ApiProperty({ description: '조회 시각(ISO)' })
  measuredAt!: string;

  @ApiProperty({ type: [TableUsageDto], description: '크기 상위 테이블' })
  tables!: TableUsageDto[];

  @ApiProperty({ type: [ManagedStorageTargetDto], description: '장기 저장소 관리 대상 현황' })
  managedTargets!: ManagedStorageTargetDto[];

  @ApiProperty({ type: () => SystemResourceOverviewDto, description: 'Server resource overview' })
  systemResources!: SystemResourceOverviewDto;
}

export class PartitionInfoDto {
  @ApiProperty({ description: '파티션 테이블 이름' })
  name!: string;

  @ApiPropertyOptional({ description: '범위 상한(ISO). DEFAULT/무한은 null' })
  rangeUpper?: string | null;

  @ApiProperty({ description: '총 크기(바이트)' })
  totalBytes!: number;

  @ApiProperty({ description: '행 수 추정' })
  rowEstimate!: number;

  @ApiProperty({ description: 'DEFAULT 파티션 여부' })
  isDefault!: boolean;

  @ApiProperty({ description: '보존기간 초과(백업+드롭 대상) 여부' })
  expired!: boolean;
}

export class PartitionOverviewDto {
  @ApiProperty({ description: '대상 테이블' })
  parentTable!: string;

  @ApiProperty({ description: '보존 연수' })
  retainYears!: number;

  @ApiProperty({ description: '보존 컷오프(ISO). 이보다 오래된 파티션이 정리 대상' })
  cutoff!: string;

  @ApiProperty({ description: '보존기간 초과 파티션 개수(경고용)' })
  expiredCount!: number;

  @ApiProperty({ type: [PartitionInfoDto] })
  partitions!: PartitionInfoDto[];
}

export class ArchiveStepDto {
  @ApiProperty()
  partition!: string;

  @ApiProperty({ description: 'archived-dropped | dry-run | skipped | failed' })
  action!: string;

  @ApiProperty()
  rowCount!: number;

  @ApiPropertyOptional()
  archiveFile?: string | null;

  @ApiPropertyOptional()
  manifestFile?: string | null;

  @ApiPropertyOptional()
  message?: string | null;
}

export class ArchiveJobDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'idle | running | completed | failed' })
  status!: string;

  @ApiProperty()
  dryRun!: boolean;

  @ApiProperty()
  retainYears!: number;

  @ApiPropertyOptional()
  startedAt?: string | null;

  @ApiPropertyOptional()
  finishedAt?: string | null;

  @ApiProperty({ type: [ArchiveStepDto] })
  steps!: ArchiveStepDto[];

  @ApiPropertyOptional()
  error?: string | null;
}

export class StartArchiveAllDto {
  @ApiPropertyOptional({ description: 'true면 실제 아카이브/삭제 없이 대상만 산출(미리보기)', default: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({ description: "실제 실행 시 'archive-expired' 확인 문자열 필요" })
  @IsOptional()
  @IsString()
  confirm?: string;
}

export class RetentionStepDto {
  @ApiProperty({ description: '대상 테이블' })
  table!: string;

  @ApiPropertyOptional({ description: '보존일수(이 일수보다 오래된 행이 만료)', nullable: true })
  retentionDays?: number | null;

  @ApiPropertyOptional({ description: '컷오프 시각(ISO). 이 시각 이전 행이 만료 대상', nullable: true })
  cutoff?: string | null;

  @ApiPropertyOptional({ description: '만료(컷오프 이전) 행 수', nullable: true })
  expired?: number | null;

  @ApiPropertyOptional({ description: '실제 삭제된 행 수(execute 시)', nullable: true })
  deleted?: number | null;

  @ApiPropertyOptional({ description: '아카이브 파일 경로(execute 시)', nullable: true })
  archiveFile?: string | null;

  @ApiPropertyOptional({ description: 'manifest 파일 경로(execute 시)', nullable: true })
  manifestFile?: string | null;

  @ApiProperty({ description: 'preview | archived | archived-deleted | disabled | failed' })
  action!: string;
}

export class RetentionJobDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'idle | running | completed | failed' })
  status!: string;

  @ApiProperty()
  dryRun!: boolean;

  @ApiPropertyOptional({ description: 'preview | execute', nullable: true })
  mode?: string | null;

  @ApiPropertyOptional()
  startedAt?: string | null;

  @ApiPropertyOptional()
  finishedAt?: string | null;

  @ApiProperty({ type: [RetentionStepDto] })
  steps!: RetentionStepDto[];

  @ApiProperty({ type: [String], description: '스크립트 출력 로그 꼬리(최근 N줄)' })
  logTail!: string[];

  @ApiPropertyOptional()
  error?: string | null;
}

export class ArchiveAllJobDto {
  @ApiProperty({ type: () => ArchiveJobDto })
  partition!: ArchiveJobDto;

  @ApiProperty({ type: () => RetentionJobDto })
  retention!: RetentionJobDto;
}

export class ArchiveFileDto {
  @ApiProperty({ description: 'manifest 파일명(아카이브 디렉터리 기준)' })
  manifestFile!: string;

  @ApiProperty({ description: 'partition | rows' })
  archiveKind!: string;

  @ApiProperty({ description: '아카이브 대상 표시명' })
  targetName!: string;

  @ApiPropertyOptional({ description: '아카이브 대상 테이블명(row archive)', nullable: true })
  table?: string | null;

  @ApiPropertyOptional({ description: '아카이브 대상 파티션 이름(partition archive)', nullable: true })
  partitionName?: string | null;

  @ApiPropertyOptional({ description: '파티션 범위(FOR VALUES ...)', nullable: true })
  partitionBound?: string | null;

  @ApiPropertyOptional({ description: '아카이브 당시 행 수', nullable: true })
  rowCount?: number | null;

  @ApiPropertyOptional({ description: '아카이브 시각(ISO)', nullable: true })
  archivedAt?: string | null;

  @ApiPropertyOptional({ description: '덤프 파일명', nullable: true })
  dumpFile?: string | null;

  @ApiProperty({ description: '덤프 파일 존재 여부' })
  dumpExists!: boolean;

  @ApiProperty({ description: '해당 파티션이 현재 DB에 존재하는지(partition archive 에서만 의미 있음)' })
  partitionExists!: boolean;
}

export class HttpLogFileDto {
  @ApiProperty({ description: '로그 생성 백엔드', enum: ['admin-backend', 'app-backend'] })
  source!: string;

  @ApiProperty({ description: '로그 파일명' })
  fileName!: string;

  @ApiProperty({ description: '로그 파일이 위치한 디렉터리' })
  directory!: string;

  @ApiProperty({ description: '파일 크기(바이트)' })
  sizeBytes!: number;

  @ApiPropertyOptional({ description: '파일명에서 추출한 로그 일자(YYYY-MM-DD)', nullable: true })
  logDate?: string | null;

  @ApiProperty({ description: '파일 최종 수정 시각(ISO)' })
  modifiedAt!: string;
}

export class DeleteHttpLogFileDto {
  @ApiProperty({ description: '로그 생성 백엔드', enum: ['admin-backend', 'app-backend'] })
  @IsIn(['admin-backend', 'app-backend'])
  source!: 'admin-backend' | 'app-backend';

  @ApiProperty({ description: '삭제할 로그 파일명' })
  @IsString()
  fileName!: string;
}

export class DeleteHttpLogFileResultDto {
  @ApiProperty()
  deleted!: boolean;

  @ApiProperty()
  source!: string;

  @ApiProperty()
  fileName!: string;
}
