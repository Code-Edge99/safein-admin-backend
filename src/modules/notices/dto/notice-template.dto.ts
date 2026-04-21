import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class NoticeTemplateFilterDto {
  @ApiPropertyOptional({ description: '현장 ID 필터' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  organizationId?: string;

  @ApiPropertyOptional({ description: '양식명/기본 제목 검색어' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class CreateNoticeTemplateDto {
  @ApiProperty({ description: '양식 소속 현장 ID' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  organizationId: string;

  @ApiProperty({ description: '양식명', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: '기본 제목', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty({ description: '양식 HTML 본문' })
  @IsString()
  @IsNotEmpty()
  contentHtml: string;

  @ApiPropertyOptional({ description: '양식 텍스트 본문' })
  @IsOptional()
  @IsString()
  contentText?: string;
}

export class UpdateNoticeTemplateDto extends PartialType(CreateNoticeTemplateDto) {}