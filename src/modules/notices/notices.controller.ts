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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { AuthenticatedAdminRequest } from '../../common/types/authenticated-request.type';
import { NoticesService } from './notices.service';
import {
  CleanupNoticeUploadsDto,
  CleanupNoticeUploadsResponseDto,
  CreateNoticeDto,
  NoticeFilterDto,
  NoticeResponseDto,
  NoticeUploadResponseDto,
  UpdateNoticeDto,
} from './dto';
import {
  createStoredFileName,
  ensureNoticeUploadDirs,
  getNoticeUploadDir,
} from './notices.storage';

ensureNoticeUploadDirs();

const ATTACHMENT_UPLOAD_LIMIT = 20 * 1024 * 1024;
const IMAGE_UPLOAD_LIMIT = 10 * 1024 * 1024;

function attachmentStorage(isInlineImage: boolean) {
  return diskStorage({
    destination: (_req, _file, callback) => {
      callback(null, getNoticeUploadDir(isInlineImage));
    },
    filename: (_req, file, callback) => {
      const extension = extname(file.originalname || '');
      const generated = createStoredFileName(extension ? `file${extension}` : file.originalname || 'file');
      callback(null, generated);
    },
  });
}

@ApiTags('공지사항')
@Controller('notices')
export class NoticesController {
  constructor(private readonly noticesService: NoticesService) {}

  @Get()
  @UseGuards(JwtAuthGuard, OrganizationScopeGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '공지사항 목록 조회' })
  findAll(@Req() req: AuthenticatedAdminRequest, @Query() filter: NoticeFilterDto) {
    return this.noticesService.findAll(
      filter,
      req.organizationScopeIds ?? undefined,
      req.user?.id,
      req.user?.role,
    );
  }

  @Post()
  @UseGuards(JwtAuthGuard, OrganizationScopeGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '공지사항 등록' })
  @ApiResponse({ status: 201, description: '등록 성공', type: NoticeResponseDto })
  create(@Req() req: AuthenticatedAdminRequest, @Body() dto: CreateNoticeDto) {
    return this.noticesService.create(dto, req.organizationScopeIds ?? undefined, req.user?.id, req.user?.role);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, OrganizationScopeGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '공지사항 수정 (작성자 본인 또는 슈퍼관리자 가능)' })
  @ApiResponse({ status: 200, description: '수정 성공', type: NoticeResponseDto })
  update(@Req() req: AuthenticatedAdminRequest, @Param('id') id: string, @Body() dto: UpdateNoticeDto) {
    return this.noticesService.update(id, dto, req.organizationScopeIds ?? undefined, req.user?.id, req.user?.role);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, OrganizationScopeGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '공지사항 삭제 (작성자 본인 또는 슈퍼관리자 가능)' })
  async remove(@Req() req: AuthenticatedAdminRequest, @Param('id') id: string) {
    await this.noticesService.remove(id, req.organizationScopeIds ?? undefined, req.user?.id, req.user?.role);
    return { success: true };
  }

  @Post('uploads/attachments')
  @UseGuards(JwtAuthGuard, OrganizationScopeGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '공지 첨부파일 업로드' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: attachmentStorage(false),
      limits: { fileSize: ATTACHMENT_UPLOAD_LIMIT },
    }),
  )
  uploadAttachment(@UploadedFile() file: { filename: string; originalname: string; mimetype: string; size: number }) {
    if (!file) {
      throw new BadRequestException('업로드할 파일이 없습니다.');
    }

    return this.noticesService.buildUploadResponse(file, false);
  }

  @Post('uploads/images')
  @UseGuards(JwtAuthGuard, OrganizationScopeGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Quill 본문 이미지 업로드' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: attachmentStorage(true),
      limits: { fileSize: IMAGE_UPLOAD_LIMIT },
      fileFilter: (_req, file, callback) => {
        if (!String(file.mimetype || '').toLowerCase().startsWith('image/')) {
          callback(new BadRequestException('이미지 파일만 업로드할 수 있습니다.'), false);
          return;
        }

        callback(null, true);
      },
    }),
  )
  uploadInlineImage(
    @UploadedFile() file: { filename: string; originalname: string; mimetype: string; size: number },
  ): NoticeUploadResponseDto {
    if (!file) {
      throw new BadRequestException('업로드할 파일이 없습니다.');
    }

    return this.noticesService.buildUploadResponse(file, true);
  }

  @Post('uploads/cleanup')
  @UseGuards(JwtAuthGuard, OrganizationScopeGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '저장되지 않은 공지 업로드 파일 정리' })
  @ApiResponse({ status: 200, description: '정리 결과', type: CleanupNoticeUploadsResponseDto })
  cleanupUploads(@Body() dto: CleanupNoticeUploadsDto): Promise<CleanupNoticeUploadsResponseDto> {
    return this.noticesService.cleanupUnreferencedUploads(dto.files);
  }

  @Get('files/:fileName')
  @ApiOperation({ summary: '공지 첨부/이미지 파일 조회' })
  async serveFile(@Param('fileName') fileName: string, @Res() res: Response): Promise<void> {
    const file = await this.noticesService.resolveDownloadFile(fileName);
    const encodedFileName = encodeURIComponent(file.originalName);

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      file.isInlineImage
        ? `inline; filename*=UTF-8''${encodedFileName}`
        : `attachment; filename*=UTF-8''${encodedFileName}`,
    );

    res.sendFile(file.absolutePath);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, OrganizationScopeGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '공지사항 상세 조회' })
  findOne(@Req() req: AuthenticatedAdminRequest, @Param('id') id: string) {
    return this.noticesService.findOne(id, req.organizationScopeIds ?? undefined, req.user?.id, req.user?.role);
  }
}
