import { IsString, IsNotEmpty, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ description: '사용자 아이디', example: 'admin' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ description: '비밀번호', example: 'password123' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;
}

export class ChangePasswordDto {
  @ApiProperty({ description: '현재 비밀번호' })
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({ description: '새 비밀번호' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  newPassword: string;

  @ApiProperty({ description: '새 비밀번호 확인' })
  @IsString()
  @IsNotEmpty()
  confirmPassword: string;
}

export class TokenResponseUserOrganizationDto {
  @ApiProperty({ description: '조직 ID' })
  id: string;

  @ApiProperty({ description: '조직명' })
  name: string;
}

export class TokenResponseUserDto {
  @ApiProperty({ description: '사용자 ID' })
  id: string;

  @ApiProperty({ description: '사용자 아이디' })
  username: string;

  @ApiProperty({ description: '사용자 이름' })
  name: string;

  @ApiProperty({ description: '이메일' })
  email: string;

  @ApiProperty({ description: '역할' })
  role: string;

  @ApiProperty({ description: '소속 조직', required: false, type: TokenResponseUserOrganizationDto })
  organization?: TokenResponseUserOrganizationDto;
}

export class TokenResponseDto {
  @ApiProperty({ description: 'JWT 액세스 토큰' })
  accessToken: string;

  @ApiProperty({ description: '토큰 타입' })
  tokenType: string;

  @ApiProperty({ description: '만료 시간 (초)' })
  expiresIn: number;

  @ApiProperty({ description: '사용자 정보', type: TokenResponseUserDto })
  user: TokenResponseUserDto;
}

export class AuthUserDto {
  @ApiProperty({ description: '사용자 ID' })
  id: string;

  @ApiProperty({ description: '사용자 아이디' })
  username: string;

  @ApiProperty({ description: '사용자 이름' })
  name: string;

  @ApiProperty({ description: '이메일', required: false })
  email?: string;

  @ApiProperty({ description: '역할' })
  role: string;

  @ApiProperty({
    description: '소속 조직',
    required: false,
    type: TokenResponseUserOrganizationDto,
  })
  organization?: TokenResponseUserOrganizationDto;

  @ApiProperty({ description: '조직 ID' })
  organizationId: string;

  @ApiProperty({ description: '조직 유형', required: false })
  organizationType?: string;
}
