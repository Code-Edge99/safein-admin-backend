import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { Response } from 'express';
import { PermissionCodes } from '../auth/decorators/permission-codes.decorator';
import { EffectivePermissionsGuard } from '../auth/guards/effective-permissions.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { AuthenticatedAdminRequest } from '../../common/types/authenticated-request.type';
import {
  createStoredFileName,
  ensureIncidentReportUploadDir,
  getIncidentReportUploadDir,
  normalizeUploadOriginalName,
} from './incident-reports.storage';
import { IncidentReportsService } from './incident-reports.service';
import {
  CreateIncidentReportCommentDto,
  IncidentReportDetailDto,
  IncidentReportFilterDto,
  IncidentReportListResponseDto,
  ResolveIncidentReportDto,
  UpdateIncidentReportAssigneeDto,
  UpdateIncidentReportSeverityDto,
  UpdateIncidentReportStatusDto,
} from './dto';

ensureIncidentReportUploadDir();

const ATTACHMENT_UPLOAD_LIMIT = 20 * 1024 * 1024;

function buildContentDisposition(fileName: string): string {
  const encodedFileName = encodeURIComponent(fileName);
  const normalizedFileName = (() => {
    try {
      return fileName.normalize('NFC');
    } catch {
      return fileName;
    }
  })();
  const asciiFallback = normalizedFileName
    .replace(/[\r\n"]/g, ' ')
    .replace(/\\/g, '_')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || 'download';

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFileName}`;
}

@ApiTags('위험 신고')
@Controller('incident-reports')
@UseGuards(JwtAuthGuard, OrganizationScopeGuard, EffectivePermissionsGuard)
@PermissionCodes('INCIDENT_REPORT_READ')
@ApiBearerAuth()
export class IncidentReportsController {
  constructor(private readonly incidentReportsService: IncidentReportsService) {}

  @Get()
  @ApiOperation({ summary: '위험 신고 목록 조회' })
  @ApiResponse({ status: 200, type: IncidentReportListResponseDto })
  findAll(
    @Req() req: AuthenticatedAdminRequest,
    @Query() filter: IncidentReportFilterDto,
  ): Promise<IncidentReportListResponseDto> {
    return this.incidentReportsService.findAll(filter, req.organizationScopeIds ?? undefined);
  }

  @Get(':id')
  @ApiOperation({ summary: '위험 신고 상세 조회' })
  @ApiResponse({ status: 200, type: IncidentReportDetailDto })
  findOne(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
  ): Promise<IncidentReportDetailDto> {
    return this.incidentReportsService.findOne(id, req.organizationScopeIds ?? undefined);
  }

  @Patch(':id/severity')
  @PermissionCodes('INCIDENT_REPORT_WRITE')
  @ApiOperation({ summary: '위험 신고 심각도 변경' })
  @ApiResponse({ status: 200, type: IncidentReportDetailDto })
  updateSeverity(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() dto: UpdateIncidentReportSeverityDto,
  ): Promise<IncidentReportDetailDto> {
    return this.incidentReportsService.updateSeverity(id, dto, req.organizationScopeIds ?? undefined, req.user?.id);
  }

  @Patch(':id/status')
  @PermissionCodes('INCIDENT_REPORT_WRITE')
  @ApiOperation({ summary: '위험 신고 상태 변경' })
  @ApiResponse({ status: 200, type: IncidentReportDetailDto })
  updateStatus(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() dto: UpdateIncidentReportStatusDto,
  ): Promise<IncidentReportDetailDto> {
    return this.incidentReportsService.updateStatus(id, dto, req.organizationScopeIds ?? undefined, req.user?.id);
  }

  @Patch(':id/assignee')
  @PermissionCodes('INCIDENT_REPORT_WRITE')
  @ApiOperation({ summary: '위험 신고 담당자 지정/해제' })
  @ApiResponse({ status: 200, type: IncidentReportDetailDto })
  updateAssignee(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() dto: UpdateIncidentReportAssigneeDto,
  ): Promise<IncidentReportDetailDto> {
    return this.incidentReportsService.updateAssignee(id, dto, req.organizationScopeIds ?? undefined, req.user?.id);
  }

  @Post(':id/comments')
  @PermissionCodes('INCIDENT_REPORT_WRITE')
  @ApiOperation({ summary: '위험 신고 내부 코멘트 추가' })
  @ApiResponse({ status: 201, type: IncidentReportDetailDto })
  addComment(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() dto: CreateIncidentReportCommentDto,
  ): Promise<IncidentReportDetailDto> {
    return this.incidentReportsService.addComment(id, dto, req.organizationScopeIds ?? undefined, req.user?.id);
  }

  @Post(':id/resolve')
  @PermissionCodes('INCIDENT_REPORT_WRITE')
  @ApiOperation({ summary: '위험 신고 해결 처리' })
  @ApiResponse({ status: 201, type: IncidentReportDetailDto })
  resolve(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() dto: ResolveIncidentReportDto,
  ): Promise<IncidentReportDetailDto> {
    return this.incidentReportsService.resolve(id, dto, req.organizationScopeIds ?? undefined, req.user?.id);
  }

  @Post(':id/attachments')
  @PermissionCodes('INCIDENT_REPORT_WRITE')
  @ApiOperation({ summary: '위험 신고 첨부 추가' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 201, type: IncidentReportDetailDto })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, callback) => {
          callback(null, getIncidentReportUploadDir());
        },
        filename: (_req, file, callback) => {
          callback(null, createStoredFileName(file.originalname || 'image.jpg'));
        },
      }),
      limits: { fileSize: ATTACHMENT_UPLOAD_LIMIT },
      fileFilter: (_req, file, callback) => {
        if (!String(file.mimetype || '').toLowerCase().startsWith('image/')) {
          callback(new BadRequestException('이미지 파일만 업로드할 수 있습니다.'), false);
          return;
        }

        callback(null, true);
      },
    }),
  )
  addAttachment(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @UploadedFile() file: { filename: string; originalname: string; mimetype: string; size: number },
  ): Promise<IncidentReportDetailDto> {
    if (!file) {
      throw new BadRequestException('업로드할 파일이 없습니다.');
    }

    return this.incidentReportsService.addAttachment(
      id,
      {
        ...file,
        originalname: normalizeUploadOriginalName(file.originalname),
      },
      req.organizationScopeIds ?? undefined,
      req.user?.id,
    );
  }

  @Get(':reportId/attachments/:attachmentId/download')
  @ApiOperation({ summary: '위험 신고 첨부 다운로드' })
  async downloadAttachment(
    @Req() req: AuthenticatedAdminRequest,
    @Param('reportId') reportId: string,
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.incidentReportsService.resolveAttachmentDownloadTarget(
      reportId,
      attachmentId,
      req.organizationScopeIds ?? undefined,
    );

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', buildContentDisposition(file.originalName));
    res.sendFile(file.absolutePath);
  }
}