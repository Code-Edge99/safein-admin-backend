import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthenticatedAdminRequest } from '../../common/types/authenticated-request.type';
import { SystemStorageService, DEFAULT_ARCHIVE_RETAIN_YEARS } from './system-storage.service';
import { PartitionArchiveRunner } from './partition-archive.runner';
import { RetentionCleanupRunner } from './retention-cleanup.runner';
import { ArchiveCatalogService } from './archive-catalog.service';
import { HttpLogFilesService } from './http-log-files.service';
import {
  ArchiveAllJobDto,
  ArchiveFileDto,
  ArchiveJobDto,
  DeleteHttpLogFileDto,
  DeleteHttpLogFileResultDto,
  HttpLogFileDto,
  PartitionOverviewDto,
  RetentionJobDto,
  StartArchiveAllDto,
  StorageOverviewDto,
} from './dto/system-storage.dto';

const ARCHIVE_ALL_CONFIRM_VALUE = 'archive-expired';

@ApiTags('시스템 용량 관리')
@Controller('system-storage')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
@ApiBearerAuth()
export class SystemStorageController {
  constructor(
    private readonly storage: SystemStorageService,
    private readonly archiveRunner: PartitionArchiveRunner,
    private readonly retentionRunner: RetentionCleanupRunner,
    private readonly archiveCatalog: ArchiveCatalogService,
    private readonly httpLogFiles: HttpLogFilesService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'DB/테이블 용량 개요 (슈퍼관리자)' })
  getOverview(): Promise<StorageOverviewDto> {
    return this.storage.getOverview();
  }

  @Get('partitions')
  @ApiOperation({ summary: 'device_locations 파티션 용량·보존 상태 (슈퍼관리자)' })
  getPartitions(): Promise<PartitionOverviewDto> {
    return this.storage.getPartitionOverview(DEFAULT_ARCHIVE_RETAIN_YEARS);
  }

  @Get('archive/status')
  @ApiOperation({ summary: '최근 아카이브 작업 상태 (슈퍼관리자)' })
  getArchiveStatus(): ArchiveJobDto {
    return this.archiveRunner.getState();
  }

  @Get('retention/status')
  @ApiOperation({ summary: '최근 보존 정리 작업 상태 (슈퍼관리자)' })
  getRetentionStatus(): RetentionJobDto {
    return this.retentionRunner.getState();
  }

  @Post('archive-all')
  @ApiOperation({ summary: '2년 기준 파티션/로그 아카이브 정리 동시 시작 (미리보기 기본, 실제 실행은 confirm 필요)' })
  startArchiveAll(
    @Body() dto: StartArchiveAllDto,
    @Req() req: AuthenticatedAdminRequest,
  ): ArchiveAllJobDto {
    const dryRun = dto.dryRun !== false;
    if (!dryRun && dto.confirm !== ARCHIVE_ALL_CONFIRM_VALUE) {
      throw new BadRequestException(
        `전체 아카이브 정리를 실행하려면 confirm="${ARCHIVE_ALL_CONFIRM_VALUE}" 을 함께 보내야 합니다.`,
      );
    }

    const archiveStatus = this.archiveRunner.getState().status;
    const retentionStatus = this.retentionRunner.getState().status;
    if (archiveStatus === 'running' || retentionStatus === 'running') {
      throw new ConflictException('이미 진행 중인 저장소 정리 작업이 있습니다.');
    }

    const actorId = req.user?.id;
    return {
      partition: this.archiveRunner.start({
        retainYears: DEFAULT_ARCHIVE_RETAIN_YEARS,
        dryRun,
        actorId,
      }),
      retention: this.retentionRunner.start({ dryRun, actorId }),
    };
  }

  @Get('archives')
  @ApiOperation({ summary: '아카이브(manifest) 목록 (슈퍼관리자)' })
  listArchives(): Promise<ArchiveFileDto[]> {
    return this.archiveCatalog.listArchives();
  }

  @Get('http-logs')
  @ApiOperation({ summary: 'HTTP 파일 로그 목록/용량 (슈퍼관리자)' })
  listHttpLogFiles(): Promise<HttpLogFileDto[]> {
    return this.httpLogFiles.listFiles();
  }

  @Delete('http-logs')
  @ApiOperation({ summary: 'HTTP 파일 로그 수동 삭제 (슈퍼관리자)' })
  deleteHttpLogFile(@Body() dto: DeleteHttpLogFileDto): Promise<DeleteHttpLogFileResultDto> {
    return this.httpLogFiles.deleteFile(dto.source, dto.fileName);
  }
}
