import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentIssueType } from '@prisma/client';

export class DocumentIssueResponseDto {
  @ApiProperty({ description: '발행 이력 ID', example: 'document-issue-id' })
  id!: string;

  @ApiProperty({ description: '문서번호', example: 'SAFEIN-TBM-20260622-000001' })
  documentNumber!: string;

  @ApiProperty({ description: '발행 문서 종류', enum: DocumentIssueType, example: DocumentIssueType.TBM_REPORT })
  documentType!: DocumentIssueType;

  @ApiProperty({ description: '원본 리소스 ID', example: 'tbm-session-id' })
  sourceId!: string;

  @ApiPropertyOptional({ description: '발행 당시 문서 제목 snapshot', nullable: true, example: '고소작업 안전교육' })
  sourceTitle!: string | null;

  @ApiProperty({ description: '발행자 표시명 snapshot', example: '김관리' })
  issuerName!: string;

  @ApiProperty({ description: '발행일시', example: '2026-06-22T02:30:00.000Z' })
  issuedAt!: Date;
}
