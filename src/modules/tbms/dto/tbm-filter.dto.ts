import { ApiPropertyOptional } from '@nestjs/swagger';
import { TbmStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { normalizeOptionalString } from './create-tbm.dto';

export enum TbmAttendeeConfirmFilter {
  /** 미이수자가 1명 이상 남아 있는 TBM */
  HAS_PENDING = 'hasPending',
  /** 모든 참석자가 이수 완료한 TBM */
  ALL_CONFIRMED = 'allConfirmed',
}

export class TbmListFilterDto extends PaginationDto {
  @ApiPropertyOptional({ description: '현장 ID. 해당 현장 및 하위 현장 소속 작성자/참석자 TBM만 조회합니다.' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional({ description: '제목/장소/작성자명 검색어' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'TBM 진행 상태 필터', enum: TbmStatus })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsEnum(TbmStatus)
  status?: TbmStatus;

  @ApiPropertyOptional({ description: '교육 예정일 필터(UTC ISO). 서버가 KST 날짜로 환산해 해당 날짜의 TBM만 조회합니다.' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsDateString()
  scheduledDate?: string;

  @ApiPropertyOptional({
    description: '이수 현황 필터. `hasPending`이면 미이수자가 남은 TBM, `allConfirmed`이면 전원 이수 완료 TBM만 조회합니다.',
    enum: TbmAttendeeConfirmFilter,
  })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsEnum(TbmAttendeeConfirmFilter)
  confirmFilter?: TbmAttendeeConfirmFilter;
}
