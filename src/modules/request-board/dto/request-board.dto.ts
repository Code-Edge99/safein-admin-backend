import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class RequestBoardItemDto {
  @ApiProperty({ description: '요청사항 항목 ID', example: 'req-1' })
  @IsString()
  @MaxLength(100)
  id: string;

  @ApiProperty({ description: '요청사항 문구', example: '[260520]APP 버전 API추가(IOS와 AOS 구분 필요 +)' })
  @IsString()
  @MaxLength(500)
  text: string;

  @ApiProperty({ description: '완료 체크 여부', example: false })
  @IsBoolean()
  checked: boolean;
}

export class RequestBoardDevRowDto {
  @ApiProperty({ description: '업데이트 행 ID', example: 'dev-row-1' })
  @IsString()
  @MaxLength(100)
  id: string;

  @ApiProperty({ description: '정렬 기준 날짜 문자열', example: '26.05.20' })
  @IsString()
  @MaxLength(30)
  date: string;

  @ApiProperty({ description: 'DEV 업데이트 여부', example: true })
  @IsBoolean()
  devUpdated: boolean;

  @ApiProperty({ description: 'DEV 테스트 여부', example: false })
  @IsBoolean()
  devTested: boolean;

  @ApiProperty({ description: 'PROD 업데이트 여부', example: false })
  @IsBoolean()
  prodUpdated: boolean;

  @ApiProperty({ description: 'PROD 테스트 여부', example: false })
  @IsBoolean()
  prodTested: boolean;
}

export class RequestBoardUpdateDto {
  @ApiProperty({ type: [RequestBoardItemDto], description: '요청사항 목록' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RequestBoardItemDto)
  requests: RequestBoardItemDto[];

  @ApiProperty({ type: [RequestBoardDevRowDto], description: 'DEV/PROD 업데이트 행 목록' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RequestBoardDevRowDto)
  devRows: RequestBoardDevRowDto[];
}

export class RequestBoardResponseDto extends RequestBoardUpdateDto {
  @ApiPropertyOptional({ description: '마지막 저장 시각' })
  updatedAt?: Date | null;
}