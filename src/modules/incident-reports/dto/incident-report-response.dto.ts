import { ApiProperty } from '@nestjs/swagger';
import {
  IncidentReportActionType,
  IncidentReportActorType,
  IncidentReportCategory,
  IncidentReportResolutionType,
  IncidentReportSeverity,
  IncidentReportStatus,
} from '@prisma/client';

export class IncidentReportLocationDto {
  @ApiProperty({ description: '위도', nullable: true })
  lat: number | null;

  @ApiProperty({ description: '경도', nullable: true })
  lng: number | null;

  @ApiProperty({ description: '현장/주소 텍스트', nullable: true })
  text: string | null;
}

export class IncidentReportAttachmentDto {
  @ApiProperty({ description: '첨부 ID' })
  id: string;

  @ApiProperty({ description: '원본 파일명' })
  originalName: string;

  @ApiProperty({ description: 'MIME 타입' })
  mimeType: string;

  @ApiProperty({ description: '파일 크기(byte)' })
  size: number;

  @ApiProperty({ description: '다운로드 URL' })
  downloadUrl: string;

  @ApiProperty({ description: '생성 시각' })
  createdAt: Date;
}

export class IncidentReportActionDto {
  @ApiProperty({ description: '이력 ID' })
  id: string;

  @ApiProperty({ description: '액션 타입', enum: IncidentReportActionType })
  actionType: IncidentReportActionType;

  @ApiProperty({ description: '행위자 타입', enum: IncidentReportActorType })
  actorType: IncidentReportActorType;

  @ApiProperty({ description: '행위자명', nullable: true })
  actorName: string | null;

  @ApiProperty({ description: '변경 전 상태', enum: IncidentReportStatus, nullable: true })
  fromStatus: IncidentReportStatus | null;

  @ApiProperty({ description: '변경 후 상태', enum: IncidentReportStatus, nullable: true })
  toStatus: IncidentReportStatus | null;

  @ApiProperty({ description: '코멘트', nullable: true })
  comment: string | null;

  @ApiProperty({ description: '생성 시각' })
  createdAt: Date;
}

export class IncidentReportListItemDto {
  @ApiProperty({ description: '신고 ID' })
  id: string;

  @ApiProperty({ description: '조직 ID' })
  organizationId: string;

  @ApiProperty({ description: '조직명' })
  organizationName: string;

  @ApiProperty({ description: '직원 ID' })
  employeeId: string;

  @ApiProperty({ description: '직원명' })
  employeeName: string;

  @ApiProperty({ description: '제목' })
  title: string;

  @ApiProperty({ description: '카테고리', enum: IncidentReportCategory })
  category: IncidentReportCategory;

  @ApiProperty({ description: '심각도', enum: IncidentReportSeverity })
  severity: IncidentReportSeverity;

  @ApiProperty({ description: '상태', enum: IncidentReportStatus })
  status: IncidentReportStatus;

  @ApiProperty({ description: '긴급 여부' })
  isEmergency: boolean;

  @ApiProperty({ description: '담당 관리자 ID', nullable: true })
  assignedAdminId: string | null;

  @ApiProperty({ description: '담당 관리자명', nullable: true })
  assignedAdminName: string | null;

  @ApiProperty({ description: '첨부 개수' })
  attachmentCount: number;

  @ApiProperty({ description: '신고 시각' })
  reportedAt: Date;

  @ApiProperty({ description: '수정 시각' })
  updatedAt: Date;
}

export class IncidentReportListResponseDto {
  @ApiProperty({ type: [IncidentReportListItemDto] })
  data: IncidentReportListItemDto[];

  @ApiProperty({ description: '전체 개수' })
  total: number;

  @ApiProperty({ description: '현재 페이지' })
  page: number;

  @ApiProperty({ description: '페이지 크기' })
  limit: number;

  @ApiProperty({ description: '전체 페이지 수' })
  totalPages: number;
}

export class IncidentReportDetailDto {
  @ApiProperty({ description: '신고 ID' })
  id: string;

  @ApiProperty({ description: '조직 ID' })
  organizationId: string;

  @ApiProperty({ description: '조직명' })
  organizationName: string;

  @ApiProperty({ description: '직원 ID' })
  employeeId: string;

  @ApiProperty({ description: '직원명' })
  employeeName: string;

  @ApiProperty({ description: '직원 연락처', nullable: true })
  employeePhone: string | null;

  @ApiProperty({ description: '제목' })
  title: string;

  @ApiProperty({ description: '상세 설명' })
  description: string;

  @ApiProperty({ description: '카테고리', enum: IncidentReportCategory })
  category: IncidentReportCategory;

  @ApiProperty({ description: '심각도', enum: IncidentReportSeverity })
  severity: IncidentReportSeverity;

  @ApiProperty({ description: '상태', enum: IncidentReportStatus })
  status: IncidentReportStatus;

  @ApiProperty({ description: '긴급 여부' })
  isEmergency: boolean;

  @ApiProperty({ description: '구역 ID', nullable: true })
  zoneId: string | null;

  @ApiProperty({ description: '구역명', nullable: true })
  zoneName: string | null;

  @ApiProperty({ type: IncidentReportLocationDto, nullable: true })
  location: IncidentReportLocationDto | null;

  @ApiProperty({ description: '담당 관리자 ID', nullable: true })
  assignedAdminId: string | null;

  @ApiProperty({ description: '담당 관리자명', nullable: true })
  assignedAdminName: string | null;

  @ApiProperty({ description: '실제 발생 시각', nullable: true })
  occurredAt: Date | null;

  @ApiProperty({ description: '신고 시각' })
  reportedAt: Date;

  @ApiProperty({ description: '해결 유형', enum: IncidentReportResolutionType, nullable: true })
  resolutionType: IncidentReportResolutionType | null;

  @ApiProperty({ description: '해결 요약', nullable: true })
  resolutionSummary: string | null;

  @ApiProperty({ description: '해결 시각', nullable: true })
  resolvedAt: Date | null;

  @ApiProperty({ type: [IncidentReportAttachmentDto] })
  attachments: IncidentReportAttachmentDto[];

  @ApiProperty({ type: [IncidentReportActionDto] })
  actions: IncidentReportActionDto[];

  @ApiProperty({ description: '생성 시각' })
  createdAt: Date;

  @ApiProperty({ description: '수정 시각' })
  updatedAt: Date;
}