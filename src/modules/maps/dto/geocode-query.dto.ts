import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class GeocodeQueryDto {
  @ApiProperty({ description: '검색할 주소', example: '서울특별시 중구 세종대로 110' })
  @IsString()
  @MinLength(2)
  query!: string;
}
