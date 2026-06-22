import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentIssueType } from '@prisma/client';
import { IsEnum, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDocumentIssueDto {
  @ApiProperty({
    description: '발행 문서 종류',
    enum: DocumentIssueType,
    example: DocumentIssueType.TBM_REPORT,
  })
  @IsEnum(DocumentIssueType)
  documentType!: DocumentIssueType;

  @ApiProperty({ description: '문서의 원본 리소스 ID', example: 'tbm-session-id' })
  @IsString()
  @MaxLength(100)
  sourceId!: string;

  @ApiPropertyOptional({ description: '발행 당시 문서 제목 snapshot', example: '고소작업 안전교육' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sourceTitle?: string;

  @ApiPropertyOptional({ description: '출력자 표시명 snapshot', example: '김관리' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  issuerName?: string;

  @ApiPropertyOptional({
    description: '문서 종류별 추가 발행 메타데이터',
    example: { format: 'pdf' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
