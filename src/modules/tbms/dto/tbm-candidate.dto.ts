import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AppLanguage, EmployeeStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';
import { normalizeOptionalString } from './create-tbm.dto';

export class TbmCandidateFilterDto {
  @ApiPropertyOptional({ description: '현장 ID. 지정하면 해당 현장 및 하위 현장 직원만 반환합니다. 생략하면 접근 범위 전체를 반환합니다.' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional({ description: '직원명 검색어' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  search?: string;
}

export class TbmCandidateUserDto {
  @ApiProperty({ description: '직원 ID. 작성자/참석자 지정에 사용합니다.', example: '01012345678' })
  id!: string;

  @ApiProperty({ description: '직원 이름', example: '김철수' })
  name!: string;

  @ApiPropertyOptional({ description: '직책', nullable: true, example: '반장' })
  position!: string | null;

  @ApiProperty({ description: '현재 소속 조직 ID', example: 'org-height' })
  organizationId!: string;

  @ApiProperty({ description: '직원 선호 언어', enum: AppLanguage, example: AppLanguage.vi })
  language!: AppLanguage;

  @ApiProperty({ description: '직원 상태', enum: EmployeeStatus, example: EmployeeStatus.ACTIVE })
  status!: EmployeeStatus;
}

export class TbmCandidateTeamDto {
  @ApiProperty({ description: '팀/단위 조직 ID' })
  id!: string;

  @ApiProperty({ description: '팀/단위 조직명' })
  name!: string;

  @ApiProperty({ type: [TbmCandidateUserDto] })
  users!: TbmCandidateUserDto[];
}

export class TbmCandidateGroupDto {
  @ApiProperty({ description: '그룹 조직 ID' })
  id!: string;

  @ApiProperty({ description: '그룹 조직명' })
  name!: string;

  @ApiProperty({ type: [TbmCandidateTeamDto] })
  teams!: TbmCandidateTeamDto[];
}

export class TbmCandidateResponseDto {
  @ApiProperty({ description: '그룹/팀/직원 후보 트리', type: [TbmCandidateGroupDto] })
  groups!: TbmCandidateGroupDto[];

  @ApiProperty({ description: '후보 직원 총 수', example: 12 })
  total!: number;
}
