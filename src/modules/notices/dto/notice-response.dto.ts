import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class NoticeAttachmentResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  fileName: string;

  @ApiProperty()
  originalName: string;

  @ApiProperty()
  mimeType: string;

  @ApiProperty()
  size: number;

  @ApiProperty()
  isInlineImage: boolean;

  @ApiProperty()
  url: string;

  @ApiProperty()
  createdAt: Date;
}

export class NoticeResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  organizationId: string;

  @ApiPropertyOptional({ description: '적용 공지 양식 ID' })
  noticeTemplateId?: string;

  @ApiPropertyOptional({ description: '적용 공지 양식명' })
  noticeTemplateName?: string;

  @ApiProperty({ description: '상단 고정 여부' })
  isPinned: boolean;

  @ApiPropertyOptional()
  organizationName?: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  contentHtml: string;

  @ApiPropertyOptional()
  contentText?: string;

  @ApiPropertyOptional()
  createdById?: string;

  @ApiPropertyOptional()
  createdByName?: string;

  @ApiPropertyOptional({ description: '작성자 역할' })
  createdByRole?: string;

  @ApiProperty()
  isEditableByMe: boolean;

  @ApiProperty({ type: [NoticeAttachmentResponseDto] })
  attachments: NoticeAttachmentResponseDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class NoticeUploadResponseDto {
  @ApiProperty()
  fileName: string;

  @ApiProperty()
  originalName: string;

  @ApiProperty()
  mimeType: string;

  @ApiProperty()
  size: number;

  @ApiProperty()
  isInlineImage: boolean;

  @ApiProperty()
  url: string;
}

export class NoticeTemplateResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  organizationId: string;

  @ApiPropertyOptional()
  organizationName?: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  contentHtml: string;

  @ApiPropertyOptional()
  contentText?: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
