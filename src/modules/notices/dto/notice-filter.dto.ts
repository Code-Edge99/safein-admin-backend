import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto';

export class NoticeFilterDto extends PaginationDto {
  @ApiPropertyOptional({ description: '검색어(제목/본문)' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: '회사/그룹 ID 필터(하위 조직 포함)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  organizationId?: string;
}
