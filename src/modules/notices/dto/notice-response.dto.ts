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
