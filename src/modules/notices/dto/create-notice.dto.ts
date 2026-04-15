import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class NoticeAttachmentPayloadDto {
  @ApiPropertyOptional({ description: '기존 첨부파일 ID(수정 시 유지 대상)' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiPropertyOptional({ description: '업로드된 저장 파일명' })
  @IsOptional()
  @IsString()
  @MaxLength(260)
  fileName?: string;

  @ApiPropertyOptional({ description: '원본 파일명' })
  @IsOptional()
  @IsString()
  @MaxLength(260)
  originalName?: string;

  @ApiPropertyOptional({ description: 'MIME 타입' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  mimeType?: string;

  @ApiPropertyOptional({ description: '파일 크기(byte)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  size?: number;

  @ApiPropertyOptional({ description: '본문 인라인 이미지 여부' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isInlineImage?: boolean;
}

export class CreateNoticeDto {
  @ApiProperty({ description: '게시 대상 현장 ID' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  organizationId: string;

  @ApiPropertyOptional({ description: '상단 고정 여부', default: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isPinned?: boolean;

  @ApiProperty({ description: '제목', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty({ description: 'Quill HTML 본문' })
  @IsString()
  @IsNotEmpty()
  contentHtml: string;

  @ApiPropertyOptional({ description: '검색용 본문 텍스트' })
  @IsOptional()
  @IsString()
  contentText?: string;

  @ApiPropertyOptional({ type: [NoticeAttachmentPayloadDto], description: '첨부파일 목록' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NoticeAttachmentPayloadDto)
  attachments?: NoticeAttachmentPayloadDto[];
}
