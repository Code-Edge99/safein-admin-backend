import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreateWorkTypeDto {
  @ApiProperty({ description: '근무 유형명' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: '설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: '조직 ID' })
  @IsUUID()
  @IsNotEmpty()
  organizationId: string;

  @ApiPropertyOptional({ description: '활성 상태', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateWorkTypeDto extends PartialType(CreateWorkTypeDto) {}

export class WorkTypeResponseDto {
  @ApiProperty({ description: '근무 유형 ID' })
  id: string;

  @ApiProperty({ description: '근무 유형명' })
  name: string;

  @ApiPropertyOptional({ description: '설명' })
  description?: string;

  @ApiProperty({ description: '조직 ID' })
  organizationId: string;

  @ApiPropertyOptional({ description: '조직명' })
  organizationName?: string;

  @ApiProperty({ description: '활성 상태' })
  isActive: boolean;

  @ApiProperty({ description: '생성일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정일시' })
  updatedAt: Date;

  @ApiPropertyOptional({ description: '사용 직원 수' })
  employeeCount?: number;

  @ApiPropertyOptional({ description: '적용 정책 여부' })
  hasPolicy?: boolean;
}

export class WorkTypeDetailDto extends WorkTypeResponseDto {
  @ApiPropertyOptional({ description: '연결된 제어 정책 ID' })
  controlPolicyId?: string;

  @ApiPropertyOptional({ description: '연결된 제어 정책명' })
  controlPolicyName?: string;
}
