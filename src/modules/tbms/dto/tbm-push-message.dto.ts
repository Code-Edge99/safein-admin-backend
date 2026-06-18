import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

function normalizeString(value: unknown): string {
  return String(value ?? '').trim();
}

export class SendTbmPushMessageDto {
  @ApiProperty({
    description: '참석자에게 보낼 푸시 메시지 본문',
    example: '교육 시작 전 안전모와 안전대를 다시 확인해주세요.',
    maxLength: 500,
  })
  @Transform(({ value }) => normalizeString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  message!: string;
}

export class TbmPushMessageResultDto {
  @ApiProperty({ description: '발송 요청 대상 참석자 수', example: 1 })
  targetEmployeeCount!: number;

  @ApiProperty({ description: '발송 가능한 푸시 토큰/기기 수', example: 1 })
  targetDeviceCount!: number;

  @ApiProperty({ description: 'FCM 발송 성공 기기 수', example: 1 })
  successCount!: number;

  @ApiProperty({ description: 'FCM 발송 실패 기기 수', example: 0 })
  failedCount!: number;
}
