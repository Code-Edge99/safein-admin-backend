import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CommonCodeFilterDto {
  @ApiPropertyOptional({
    description: 'Comma-separated code group keys. Example: employee_status,incident_report_status',
  })
  @IsOptional()
  @IsString()
  groupKeys?: string;
}

export class CommonCodeItemDto {
  @ApiProperty()
  groupKey: string;

  @ApiProperty()
  code: string;

  @ApiProperty()
  label: string;

  @ApiPropertyOptional()
  description?: string | null;

  @ApiProperty()
  sortOrder: number;

  @ApiProperty()
  isActive: boolean;

  @ApiPropertyOptional()
  metadata?: unknown;
}

export class CommonCodeGroupDto {
  @ApiProperty()
  key: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  description?: string | null;

  @ApiProperty()
  sortOrder: number;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ type: [CommonCodeItemDto] })
  items: CommonCodeItemDto[];
}
