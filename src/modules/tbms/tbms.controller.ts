import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { createReadStream, statSync } from 'fs';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { AuthenticatedAdminRequest } from '../../common/types/authenticated-request.type';
import { TbmsService } from './tbms.service';
import {
  ChangeTbmStatusDto,
  CreateTbmDto,
  SendTbmPushMessageDto,
  TbmAdminDetailDto,
  TbmAdminListItemDto,
  TbmCandidateFilterDto,
  TbmCandidateResponseDto,
  TbmListFilterDto,
  TbmPushMessageResultDto,
  UpdateTbmDto,
} from './dto';
import {
  createTbmStoredFileName,
  ensureTbmUploadDir,
  getTbmUploadDir,
  isAllowedTbmAttachmentFile,
  isAllowedTbmAudioFile,
  TbmUploadedFile,
} from './tbms.storage';

ensureTbmUploadDir();

const AUDIO_UPLOAD_LIMIT = 200 * 1024 * 1024;
const ATTACHMENT_UPLOAD_LIMIT = 20 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 10;

const tbmUploadStorage = diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, getTbmUploadDir());
  },
  filename: (_req, file, callback) => {
    callback(null, createTbmStoredFileName(file.originalname || 'file'));
  },
});

const tbmFileFields = FileFieldsInterceptor(
  [
    { name: 'audioFile', maxCount: 1 },
    { name: 'files', maxCount: MAX_ATTACHMENT_COUNT },
  ],
  {
    storage: tbmUploadStorage,
    limits: { fileSize: AUDIO_UPLOAD_LIMIT },
    fileFilter: (_req, file, callback) => {
      if (file.fieldname === 'audioFile' && !isAllowedTbmAudioFile(file)) {
        callback(new BadRequestException('허용되지 않는 음성 파일 형식입니다.'), false);
        return;
      }

      if (file.fieldname === 'files' && !isAllowedTbmAttachmentFile(file)) {
        callback(new BadRequestException('첨부파일은 이미지 또는 PDF만 업로드할 수 있습니다.'), false);
        return;
      }

      callback(null, true);
    },
  },
);

type UploadedTbmFiles = {
  audioFile?: TbmUploadedFile[];
  files?: TbmUploadedFile[];
};

function extractFiles(uploaded: UploadedTbmFiles | undefined): {
  audioFile: TbmUploadedFile | undefined;
  files: TbmUploadedFile[];
} {
  const audioFile = uploaded?.audioFile?.[0];
  const files = uploaded?.files ?? [];

  const oversizedAttachment = files.find((file) => file.size > ATTACHMENT_UPLOAD_LIMIT);
  if (oversizedAttachment) {
    throw new BadRequestException('첨부파일은 개별 20MB를 초과할 수 없습니다.');
  }
  const unsupportedAttachment = files.find((file) => !isAllowedTbmAttachmentFile(file));
  if (unsupportedAttachment) {
    throw new BadRequestException('첨부파일은 이미지 또는 PDF만 업로드할 수 있습니다.');
  }

  return { audioFile, files };
}

@ApiTags('TBM')
@ApiBearerAuth()
@Controller('tbms')
@UseGuards(JwtAuthGuard, OrganizationScopeGuard)
export class TbmsController {
  constructor(private readonly tbmsService: TbmsService) {}

  @Get('attendee-candidates')
  @ApiOperation({ summary: 'TBM 작성자/참석자 후보 직원 조회' })
  @ApiResponse({ status: 200, type: TbmCandidateResponseDto })
  findCandidates(
    @Req() req: AuthenticatedAdminRequest,
    @Query() filter: TbmCandidateFilterDto,
  ): Promise<TbmCandidateResponseDto> {
    return this.tbmsService.findCandidates(filter, req.organizationScopeIds ?? undefined);
  }

  @Get()
  @ApiOperation({ summary: 'TBM 목록 조회' })
  findAll(
    @Req() req: AuthenticatedAdminRequest,
    @Query() filter: TbmListFilterDto,
  ) {
    return this.tbmsService.findAll(filter, req.organizationScopeIds ?? undefined);
  }

  @Post()
  @ApiOperation({ summary: 'TBM 등록 (작성자 직원 직접 지정)' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, type: TbmAdminDetailDto })
  @UseInterceptors(tbmFileFields)
  create(
    @Req() req: AuthenticatedAdminRequest,
    @Body() dto: CreateTbmDto,
    @UploadedFiles() uploaded: UploadedTbmFiles,
  ): Promise<TbmAdminDetailDto> {
    const { audioFile, files } = extractFiles(uploaded);
    return this.tbmsService.create(dto, req.organizationScopeIds ?? undefined, audioFile, files, req);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'TBM 수정' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 200, type: TbmAdminDetailDto })
  @UseInterceptors(tbmFileFields)
  update(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() dto: UpdateTbmDto,
    @UploadedFiles() uploaded: UploadedTbmFiles,
  ): Promise<TbmAdminDetailDto> {
    const { audioFile, files } = extractFiles(uploaded);
    return this.tbmsService.update(id, dto, req.organizationScopeIds ?? undefined, audioFile, files, req);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'TBM 삭제' })
  async remove(@Req() req: AuthenticatedAdminRequest, @Param('id') id: string) {
    await this.tbmsService.remove(id, req.organizationScopeIds ?? undefined);
    return { success: true };
  }

  @Post(':id/start')
  @ApiOperation({ summary: 'TBM 교육 시작' })
  @ApiResponse({ status: 200, type: TbmAdminDetailDto })
  start(@Req() req: AuthenticatedAdminRequest, @Param('id') id: string): Promise<TbmAdminDetailDto> {
    return this.tbmsService.start(id, req.organizationScopeIds ?? undefined, req);
  }

  @Post(':id/end')
  @ApiOperation({ summary: 'TBM 교육 종료' })
  @ApiResponse({ status: 200, type: TbmAdminDetailDto })
  end(@Req() req: AuthenticatedAdminRequest, @Param('id') id: string): Promise<TbmAdminDetailDto> {
    return this.tbmsService.end(id, req.organizationScopeIds ?? undefined, req);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'TBM 상태 수동 변경 (시작 전으로 되돌리기 포함)' })
  @ApiResponse({ status: 200, type: TbmAdminDetailDto })
  changeStatus(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() dto: ChangeTbmStatusDto,
  ): Promise<TbmAdminDetailDto> {
    return this.tbmsService.changeStatus(
      id,
      dto.status,
      req.organizationScopeIds ?? undefined,
      { resetConfirmations: dto.resetConfirmations },
      req,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'TBM 상세 조회 (이수/미이수 참석자 명단 포함)' })
  @ApiResponse({ status: 200, type: TbmAdminDetailDto })
  findOne(@Req() req: AuthenticatedAdminRequest, @Param('id') id: string): Promise<TbmAdminDetailDto> {
    return this.tbmsService.findOne(id, req.organizationScopeIds ?? undefined, req);
  }

  @Post(':id/attendees/:attendeeId/push-message')
  @ApiOperation({ summary: 'TBM 참석자 개별 푸시 메시지 발송' })
  @ApiResponse({ status: 201, type: TbmPushMessageResultDto })
  sendAttendeePushMessage(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Param('attendeeId') attendeeId: string,
    @Body() dto: SendTbmPushMessageDto,
  ): Promise<TbmPushMessageResultDto> {
    return this.tbmsService.sendAttendeePushMessage(
      id,
      attendeeId,
      dto,
      req.organizationScopeIds ?? undefined,
      req.user?.id,
    );
  }

  @Get(':id/audio/original')
  @ApiOperation({ summary: 'TBM 원본 음성 스트리밍' })
  async streamOriginalAudio(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const target = await this.tbmsService.resolveOriginalAudioFileTarget(id, req.organizationScopeIds ?? undefined);
    const stat = statSync(target.absolutePath);
    const range = (req as Request).headers.range;

    res.setHeader('Content-Type', target.mimeType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', this.tbmsService.buildContentDisposition(target.originalName, true));

    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match && match[1] ? parseInt(match[1], 10) : 0;
      const end = match && match[2] ? parseInt(match[2], 10) : stat.size - 1;
      const safeEnd = Math.min(end, stat.size - 1);
      const chunkSize = safeEnd - start + 1;

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${safeEnd}/${stat.size}`);
      res.setHeader('Content-Length', chunkSize);
      createReadStream(target.absolutePath, { start, end: safeEnd }).pipe(res);
      return;
    }

    res.setHeader('Content-Length', stat.size);
    createReadStream(target.absolutePath).pipe(res);
  }

  @Get(':id/attachments/:attachmentId/download')
  @ApiOperation({ summary: 'TBM 첨부파일 다운로드' })
  async downloadAttachment(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const target = await this.tbmsService.resolveAttachmentFileTarget(
      id,
      attachmentId,
      req.organizationScopeIds ?? undefined,
    );

    res.setHeader('Content-Type', target.mimeType);
    res.setHeader('Content-Disposition', this.tbmsService.buildContentDisposition(target.originalName, target.isImage));
    res.sendFile(target.absolutePath);
  }
}
