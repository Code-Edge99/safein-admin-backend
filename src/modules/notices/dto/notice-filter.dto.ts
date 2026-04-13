import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto';

export class NoticeFilterDto extends PaginationDto {
  @ApiPropertyOptional({ description: '검색어(제목/본문)' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: '현장 ID 필터' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  organizationId?: string;
}
