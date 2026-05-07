import { ApiProperty } from '@nestjs/swagger';

export class PolicyChangeNoticeDto {
  @ApiProperty({ description: '조건 변경으로 비활성화된 통제 정책 수' })
  deactivatedPolicyCount: number;
}