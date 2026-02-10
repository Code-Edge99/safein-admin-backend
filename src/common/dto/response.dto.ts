import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PaginationMeta {
  @ApiProperty({ description: '현재 페이지' })
  page: number;

  @ApiProperty({ description: '페이지당 항목 수' })
  limit: number;

  @ApiProperty({ description: '총 항목 수' })
  total: number;

  @ApiProperty({ description: '총 페이지 수' })
  totalPages: number;

  @ApiProperty({ description: '다음 페이지 존재 여부' })
  hasNext: boolean;

  @ApiProperty({ description: '이전 페이지 존재 여부' })
  hasPrev: boolean;
}

export class PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;

  constructor(data: T[], total: number, page: number, limit: number) {
    const totalPages = Math.ceil(total / limit);
    
    this.data = data;
    this.total = total;
    this.page = page;
    this.limit = limit;
    this.totalPages = totalPages;
  }
}

export class ApiResponse<T> {
  @ApiProperty({ description: '성공 여부' })
  success: boolean;

  @ApiPropertyOptional({ description: '응답 데이터' })
  data?: T;

  @ApiPropertyOptional({ description: '에러 메시지' })
  message?: string;

  @ApiPropertyOptional({ description: '에러 코드' })
  errorCode?: string;

  @ApiPropertyOptional({ description: '타임스탬프' })
  timestamp: string;

  static success<T>(data: T): ApiResponse<T> {
    return {
      success: true,
      data,
      timestamp: new Date().toISOString(),
    };
  }

  static error(message: string, errorCode?: string): ApiResponse<null> {
    return {
      success: false,
      message,
      errorCode,
      timestamp: new Date().toISOString(),
    };
  }
}
