import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class NoticeCleanupUploadFileDto {
  @ApiProperty({ description: '업로드된 저장 파일명' })
  @IsString()
  @MaxLength(260)
  fileName: string;

  @ApiPropertyOptional({ description: '본문 인라인 이미지 여부(생략 시 양쪽 경로 모두 검사)' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isInlineImage?: boolean;
}

export class CleanupNoticeUploadsDto {
  @ApiProperty({ type: [NoticeCleanupUploadFileDto], description: '정리할 업로드 파일 목록' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NoticeCleanupUploadFileDto)
  files: NoticeCleanupUploadFileDto[];
}

export class CleanupNoticeUploadsResponseDto {
  @ApiProperty({ description: '요청된 파일 수' })
  requested: number;

  @ApiProperty({ description: '실제로 삭제된 파일 수' })
  deleted: number;

  @ApiProperty({ description: 'DB 참조가 있어 삭제하지 않은 파일 수' })
  skippedReferenced: number;

  @ApiProperty({ description: '이미 없어서 삭제할 파일이 없던 수' })
  skippedMissing: number;
}