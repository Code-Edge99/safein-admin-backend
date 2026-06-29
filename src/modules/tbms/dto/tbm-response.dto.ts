import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AppLanguage, EmployeeStatus, TbmParticipantState, TbmStatus } from '@prisma/client';

export type TbmTranslationStatus = 'NONE' | 'PENDING' | 'PARTIAL' | 'DONE';

export class TbmAdminContentDto {
  @ApiProperty({ description: 'TBM 제목', example: '고소작업 안전교육' })
  title!: string;

  @ApiProperty({ description: '작업 장소', example: 'A동 3층 외벽' })
  location!: string;

  @ApiProperty({ description: '작업 내용', example: '외벽 보수 작업 전 안전수칙을 공유합니다.' })
  workContent!: string;

  @ApiProperty({ description: '위험요소 목록', type: [String], example: ['추락', '낙하물'] })
  hazards!: string[];

  @ApiProperty({ description: '안전수칙 목록', type: [String], example: ['안전대 착용', '작업 전 발판 확인'] })
  safetyRules!: string[];

  @ApiPropertyOptional({ description: '스크립트 텍스트', nullable: true, example: '오늘 작업 전 안전대 착용 상태를 확인합니다.' })
  transcriptText!: string | null;
}

export class TbmAdminAudioDto {
  @ApiProperty({ description: '원본 음성 파일 존재 여부', example: true })
  hasOriginalAudio!: boolean;

  @ApiPropertyOptional({ description: '원본 음성 재생/다운로드 URL', nullable: true })
  originalAudioUrl!: string | null;

  @ApiPropertyOptional({ description: '저장된 음성 MIME', nullable: true, example: 'audio/mp4' })
  mimeType!: string | null;

  @ApiPropertyOptional({ description: '음성 파일 크기(byte)', nullable: true, example: 1345024 })
  size!: number | null;

  @ApiPropertyOptional({ description: '음성 길이(초)', nullable: true, example: 82 })
  durationSec!: number | null;
}

export class TbmAdminAttachmentDto {
  @ApiProperty({ description: '첨부파일 ID', example: 'att-001' })
  id!: string;

  @ApiProperty({ description: '원본 파일명', example: '작업구간.jpg' })
  originalName!: string;

  @ApiProperty({ description: '첨부 MIME', example: 'image/jpeg' })
  mimeType!: string;

  @ApiProperty({ description: '첨부 파일 크기(byte)', example: 482011 })
  size!: number;

  @ApiProperty({ description: '이미지 여부', example: true })
  isImage!: boolean;

  @ApiProperty({ description: '다운로드 URL' })
  downloadUrl!: string;

  @ApiProperty({ description: '첨부 생성 시각' })
  createdAt!: Date;
}

export class TbmAdminAuthorDto {
  @ApiPropertyOptional({ description: '현재 연결된 작성자 직원 ID. 직원 삭제 시 null', nullable: true, example: '01011112222' })
  id!: string | null;

  @ApiProperty({ description: '작성자 이름(생성 당시 snapshot 우선)', example: '박관리' })
  name!: string;

  @ApiPropertyOptional({ description: '생성 당시 작성자 조직명 snapshot', nullable: true, example: 'A현장 안전관리팀' })
  organizationNameAtCreate!: string | null;

  @ApiPropertyOptional({ description: '현재 작성자 직원 상태', enum: EmployeeStatus, nullable: true })
  currentEmployeeStatus!: EmployeeStatus | null;

  @ApiProperty({ description: '작성자 직원 relation이 삭제/소실되었는지 여부', example: false })
  isDeleted!: boolean;
}

export class TbmAdminAttendeeSummaryDto {
  @ApiProperty({ description: '전체 참석자 수', example: 10 })
  total!: number;

  @ApiProperty({ description: '이수(확인 완료) 참석자 수', example: 7 })
  confirmed!: number;

  @ApiProperty({ description: '미이수(미확인) 참석자 수', example: 3 })
  pending!: number;

  @ApiProperty({ description: '이수율(0~100 정수)', example: 70 })
  confirmationRate!: number;
}

export class TbmAdminLanguageSummaryDto {
  @ApiProperty({ description: '참석자 지정 당시 언어', enum: AppLanguage, example: AppLanguage.vi })
  language!: AppLanguage;

  @ApiProperty({ description: '해당 언어 참석자 수', example: 2 })
  count!: number;
}

export class TbmAdminAttendeeDto {
  @ApiProperty({ description: '참석자 row ID', example: 'p-001' })
  id!: string;

  @ApiPropertyOptional({ description: '현재 연결된 직원 ID. 직원 삭제 시 null', nullable: true, example: '01012345678' })
  employeeId!: string | null;

  @ApiProperty({ description: '참석자 지정 당시 직원 ID snapshot', example: '01012345678' })
  employeeIdAtAssign!: string;

  @ApiProperty({ description: '참석자 이름', example: '김철수' })
  name!: string;

  @ApiPropertyOptional({ description: '지정 당시 조직명 snapshot', nullable: true, example: 'A현장 고소작업반' })
  organizationNameAtAssign!: string | null;

  @ApiPropertyOptional({ description: '지정 당시 그룹명 snapshot', nullable: true, example: '토목팀' })
  groupNameAtAssign!: string | null;

  @ApiPropertyOptional({ description: '지정 당시 팀명 snapshot', nullable: true, example: '고소작업반' })
  teamNameAtAssign!: string | null;

  @ApiPropertyOptional({ description: '현재 조직명', nullable: true, example: 'A현장 고소작업반' })
  currentOrganizationName!: string | null;

  @ApiPropertyOptional({ description: '현재 직원 상태', enum: EmployeeStatus, nullable: true })
  currentEmployeeStatus!: EmployeeStatus | null;

  @ApiProperty({ description: '직원 relation 삭제/소실 여부', example: false })
  isDeleted!: boolean;

  @ApiProperty({ description: '지정 당시 선호 언어 snapshot', enum: AppLanguage, example: AppLanguage.vi })
  languageAtAssigned!: AppLanguage;

  @ApiProperty({ description: '이수 상태. CONFIRMED=이수, PENDING=미이수', enum: TbmParticipantState, example: TbmParticipantState.PENDING })
  state!: TbmParticipantState;

  @ApiPropertyOptional({ description: '이수(확인) 시각. 미이수면 null', nullable: true })
  confirmedAt!: Date | null;

  @ApiPropertyOptional({ description: '이수 시점 언어', enum: AppLanguage, nullable: true })
  confirmedLanguage!: AppLanguage | null;
}

export class TbmAdminTranslationTargetDto {
  @ApiProperty({ description: '원문/번역 대상 언어', enum: AppLanguage })
  language!: AppLanguage;

  @ApiProperty({ description: '번역 준비 상태', enum: ['NONE', 'PENDING', 'PARTIAL', 'DONE'] })
  status!: TbmTranslationStatus;
}

export class TbmAdminListItemDto {
  @ApiProperty({ description: 'TBM ID' })
  id!: string;

  @ApiProperty({ description: 'TBM 제목(원문)', example: '고소작업 안전교육' })
  title!: string;

  @ApiProperty({ description: '작업 장소', example: 'A동 3층 외벽' })
  location!: string;

  @ApiProperty({ description: 'TBM 진행 상태', enum: TbmStatus })
  status!: TbmStatus;

  @ApiProperty({ description: '원문 언어', enum: AppLanguage })
  sourceLanguage!: AppLanguage;

  @ApiPropertyOptional({ description: '작성자 직원 ID', nullable: true })
  authorEmployeeId!: string | null;

  @ApiProperty({ description: '작성자 이름 snapshot', example: '박관리' })
  authorName!: string;

  @ApiPropertyOptional({ description: '작성자 조직명 snapshot', nullable: true })
  authorOrganizationName!: string | null;

  @ApiProperty({ description: '교육 예정일시 UTC ISO 문자열. 등록된 날짜와 시간을 포함합니다.', example: '2026-06-17T00:30:00.000Z' })
  scheduledDate!: string;

  @ApiPropertyOptional({ description: '교육 시작 시각', nullable: true })
  startedAt!: Date | null;

  @ApiPropertyOptional({ description: '교육 종료 시각', nullable: true })
  endedAt!: Date | null;

  @ApiProperty({ type: TbmAdminAttendeeSummaryDto })
  attendeeSummary!: TbmAdminAttendeeSummaryDto;

  @ApiProperty({ type: [TbmAdminLanguageSummaryDto] })
  languageSummary!: TbmAdminLanguageSummaryDto[];

  @ApiProperty({ description: '원본 음성 존재 여부', example: true })
  hasOriginalAudio!: boolean;

  @ApiProperty({ description: '첨부파일 개수', example: 2 })
  attachmentCount!: number;

  @ApiProperty({ description: '생성 시각' })
  createdAt!: Date;

  @ApiProperty({ description: '수정 시각' })
  updatedAt!: Date;
}

export class TbmDateRangeDto {
  @ApiPropertyOptional({ description: '가장 이른 교육일', nullable: true, example: '2026-06-01' })
  dateFrom!: string | null;

  @ApiPropertyOptional({ description: '가장 늦은 교육일', nullable: true, example: '2026-06-30' })
  dateTo!: string | null;
}

export class TbmAdminDetailDto {
  @ApiProperty({ description: 'TBM ID' })
  id!: string;

  @ApiProperty({ description: 'TBM 진행 상태', enum: TbmStatus })
  status!: TbmStatus;

  @ApiProperty({ description: '원문 언어', enum: AppLanguage })
  sourceLanguage!: AppLanguage;

  @ApiProperty({ description: '작성자 정보', type: TbmAdminAuthorDto })
  author!: TbmAdminAuthorDto;

  @ApiProperty({ description: 'TBM 내용(원문)', type: TbmAdminContentDto })
  content!: TbmAdminContentDto;

  @ApiProperty({ description: '원본 음성 정보', type: TbmAdminAudioDto })
  audio!: TbmAdminAudioDto;

  @ApiProperty({ description: '첨부파일 목록', type: [TbmAdminAttachmentDto] })
  attachments!: TbmAdminAttachmentDto[];

  @ApiProperty({ description: '전체 이수 현황 요약', type: TbmAdminAttendeeSummaryDto })
  attendeeSummary!: TbmAdminAttendeeSummaryDto;

  @ApiProperty({ type: [TbmAdminLanguageSummaryDto] })
  languageSummary!: TbmAdminLanguageSummaryDto[];

  @ApiProperty({ description: '참석자(교육 대상) 전체 명단. state로 이수/미이수를 구분합니다.', type: [TbmAdminAttendeeDto] })
  attendees!: TbmAdminAttendeeDto[];

  @ApiProperty({ description: '언어별 번역 준비 상태', type: [TbmAdminTranslationTargetDto] })
  translationTargets!: TbmAdminTranslationTargetDto[];

  @ApiProperty({ description: '교육 예정일시 UTC ISO 문자열. 등록된 날짜와 시간을 포함합니다.', example: '2026-06-17T00:30:00.000Z' })
  scheduledDate!: string;

  @ApiPropertyOptional({ description: '교육 시작 시각', nullable: true })
  startedAt!: Date | null;

  @ApiPropertyOptional({ description: '교육 종료 시각', nullable: true })
  endedAt!: Date | null;

  @ApiProperty({ description: '생성 시각' })
  createdAt!: Date;

  @ApiProperty({ description: '수정 시각' })
  updatedAt!: Date;
}
