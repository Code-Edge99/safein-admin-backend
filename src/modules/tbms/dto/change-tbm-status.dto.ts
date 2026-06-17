import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TbmStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

export class ChangeTbmStatusDto {
  @ApiProperty({
    description: '변경할 TBM 상태. CREATED(시작 전), ACTIVE(진행 중), ENDED(종료) 중 하나.',
    enum: TbmStatus,
    example: TbmStatus.CREATED,
  })
  @IsEnum(TbmStatus)
  status!: TbmStatus;

  @ApiPropertyOptional({
    description: '시작 전(CREATED)으로 되돌릴 때 참석자 이수 기록도 함께 초기화할지 여부. 기본값 false.',
    example: false,
  })
  @Transform(({ value }) => {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    return String(value).trim().toLowerCase() === 'true';
  })
  @IsOptional()
  @IsBoolean()
  resetConfirmations?: boolean;
}
