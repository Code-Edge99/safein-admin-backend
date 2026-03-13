import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsEnum,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { BaseFilterDto } from '../../../common/dto';

export enum DeviceOSEnum {
  Android = 'Android',
  iOS = 'iOS',
}

export enum DeviceStatusEnum {
  NORMAL = 'NORMAL',
  INACTIVE = 'INACTIVE',
  SUSPICIOUS = 'SUSPICIOUS',
  NO_COMM = 'NO_COMM',
}

export enum DeviceOperationStatusEnum {
  IN_USE = 'IN_USE',
  LOGGED_OUT = 'LOGGED_OUT',
  LOST = 'LOST',
  REPLACING = 'REPLACING',
  UNASSIGNED = 'UNASSIGNED',
  PREVIOUS = 'PREVIOUS',
}

export class CreateDeviceDto {
  @ApiProperty({ description: '장치 식별자' })
  @IsString()
  @IsNotEmpty()
  deviceId: string;

  @ApiPropertyOptional({ description: '직원 ID' })
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional({ description: '조직 ID' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiProperty({ description: 'OS 타입', enum: DeviceOSEnum })
  @IsEnum(DeviceOSEnum)
  os: DeviceOSEnum;

  @ApiPropertyOptional({ description: 'OS 버전' })
  @IsOptional()
  @IsString()
  osVersion?: string;

  @ApiPropertyOptional({ description: '장치 모델' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ description: '제조사' })
  @IsOptional()
  @IsString()
  manufacturer?: string;

  @ApiPropertyOptional({ description: '앱 버전' })
  @IsOptional()
  @IsString()
  appVersion?: string;
}

export class UpdateDeviceDto extends PartialType(CreateDeviceDto) {
  @ApiPropertyOptional({ description: '장치 상태', enum: DeviceStatusEnum })
  @IsOptional()
  @IsEnum(DeviceStatusEnum)
  status?: DeviceStatusEnum;

  @ApiPropertyOptional({ description: '운영 상태', enum: DeviceOperationStatusEnum })
  @IsOptional()
  @IsEnum(DeviceOperationStatusEnum)
  deviceStatus?: DeviceOperationStatusEnum;

  @ApiPropertyOptional({ description: '비활성화 사유' })
  @IsOptional()
  @IsString()
  deactivatedReason?: string;
}

export class DeviceResponseDto {
  @ApiProperty({ description: '장치 ID (UUID)' })
  id: string;

  @ApiProperty({ description: '장치 식별자' })
  deviceId: string;

  @ApiPropertyOptional({ description: '직원 ID' })
  employeeId?: string;

  @ApiPropertyOptional({ description: '직원명' })
  employeeName?: string;

  @ApiPropertyOptional({ description: '조직 ID' })
  organizationId?: string;

  @ApiPropertyOptional({ description: '조직명' })
  organizationName?: string;

  @ApiProperty({ description: 'OS 타입' })
  os: string;

  @ApiPropertyOptional({ description: 'OS 버전' })
  osVersion?: string;

  @ApiPropertyOptional({ description: '장치 모델' })
  model?: string;

  @ApiPropertyOptional({ description: '제조사' })
  manufacturer?: string;

  @ApiPropertyOptional({ description: '앱 버전' })
  appVersion?: string;

  @ApiProperty({ description: '장치 상태' })
  status: string;

  @ApiProperty({ description: '운영 상태' })
  deviceStatus: string;

  @ApiPropertyOptional({ description: '마지막 통신 시간' })
  lastCommunication?: Date;

  @ApiPropertyOptional({ description: '등록 시간' })
  registeredAt?: Date;

  @ApiPropertyOptional({ description: '비활성화 시간' })
  deactivatedAt?: Date;

  @ApiPropertyOptional({ description: '비활성화 사유' })
  deactivatedReason?: string;

  @ApiPropertyOptional({ description: '토큰 정보' })
  tokenInfo?: {
    isValid: boolean;
    lastLogin?: Date;
    expiresAt?: Date;
  };

  @ApiPropertyOptional({ description: '푸시 토큰 원문' })
  pushToken?: string;

  @ApiPropertyOptional({ description: '푸시 토큰 마지막 확인/갱신 시각' })
  pushTokenCheckedAt?: Date;

  @ApiPropertyOptional({ description: '푸시 토큰 상태' })
  pushTokenStatus?: string;

  @ApiPropertyOptional({ description: 'MDM 등록 상태' })
  mdmEnrollmentStatus?: string;

  @ApiPropertyOptional({ description: 'MDM 검증 시각' })
  mdmVerifiedAt?: Date;

  @ApiPropertyOptional({ description: '마지막 MDM 체크인 시각' })
  lastMdmCheckinAt?: Date;

  @ApiPropertyOptional({ description: '마지막 설치앱 동기화 시각' })
  lastInstalledAppsSyncAt?: Date;

  @ApiPropertyOptional({ description: '수동 해제 설정 여부' })
  mdmManualUnblockUntilLogin?: boolean;

  @ApiPropertyOptional({ description: '수동 해제 설정 사유' })
  mdmManualUnblockReason?: string;

  @ApiPropertyOptional({ description: '수동 해제 설정 시각' })
  mdmManualUnblockSetAt?: Date;

  @ApiProperty({ description: '생성일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정일시' })
  updatedAt: Date;
}

export class DeviceDetailDto extends DeviceResponseDto {
  @ApiPropertyOptional({ description: '최근 위치' })
  lastLocation?: {
    latitude: number;
    longitude: number;
    timestamp: string;
  };
}

export class DeviceFilterDto extends BaseFilterDto {
  @ApiPropertyOptional({ description: 'OS 타입', enum: DeviceOSEnum })
  @IsOptional()
  @IsEnum(DeviceOSEnum)
  os?: DeviceOSEnum;

  @ApiPropertyOptional({ description: '장치 상태', enum: DeviceStatusEnum })
  @IsOptional()
  @IsEnum(DeviceStatusEnum)
  status?: DeviceStatusEnum;

  @ApiPropertyOptional({ description: '운영 상태', enum: DeviceOperationStatusEnum })
  @IsOptional()
  @IsEnum(DeviceOperationStatusEnum)
  deviceStatus?: DeviceOperationStatusEnum;

  @ApiPropertyOptional({ description: '직원 ID' })
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional({ description: '미할당 장치만' })
  @IsOptional()
  unassignedOnly?: boolean;
}

export class AssignDeviceDto {
  @ApiProperty({ description: '직원 ID' })
  @IsString()
  @IsNotEmpty()
  employeeId: string;
}

export class DeviceLocationDto {
  @ApiProperty({ description: '위도' })
  latitude: number;

  @ApiProperty({ description: '경도' })
  longitude: number;

  @ApiPropertyOptional({ description: '정확도' })
  accuracy?: number;
}
