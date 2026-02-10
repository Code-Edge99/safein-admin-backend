import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccountsService } from './accounts.service';
import {
  CreateAccountDto,
  UpdateAccountDto,
  ChangePasswordDto,
  ResetPasswordDto,
  AccountResponseDto,
  AccountFilterDto,
  AccountListResponseDto,
  AccountStatsDto,
} from './dto';

@ApiTags('계정 관리')
@Controller('accounts')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post()
  @ApiOperation({ summary: '계정 생성' })
  @ApiResponse({ status: 201, type: AccountResponseDto })
  create(@Body() dto: CreateAccountDto): Promise<AccountResponseDto> {
    return this.accountsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: '계정 목록 조회' })
  @ApiResponse({ status: 200, type: AccountListResponseDto })
  findAll(@Query() filter: AccountFilterDto): Promise<AccountListResponseDto> {
    return this.accountsService.findAll(filter);
  }

  @Get('stats')
  @ApiOperation({ summary: '계정 통계' })
  @ApiResponse({ status: 200, type: AccountStatsDto })
  getStats(): Promise<AccountStatsDto> {
    return this.accountsService.getStats();
  }

  @Get('username/:username')
  @ApiOperation({ summary: '사용자명으로 계정 조회' })
  @ApiResponse({ status: 200, type: AccountResponseDto })
  findByUsername(@Param('username') username: string): Promise<AccountResponseDto> {
    return this.accountsService.findByUsername(username);
  }

  @Get(':id')
  @ApiOperation({ summary: '계정 상세 조회' })
  @ApiResponse({ status: 200, type: AccountResponseDto })
  findOne(@Param('id') id: string): Promise<AccountResponseDto> {
    return this.accountsService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: '계정 수정' })
  @ApiResponse({ status: 200, type: AccountResponseDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
  ): Promise<AccountResponseDto> {
    return this.accountsService.update(id, dto);
  }

  @Patch(':id/password')
  @ApiOperation({ summary: '비밀번호 변경' })
  @ApiResponse({ status: 204 })
  changePassword(
    @Param('id') id: string,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    return this.accountsService.changePassword(id, dto);
  }

  @Patch(':id/reset-password')
  @ApiOperation({ summary: '비밀번호 초기화 (관리자)' })
  @ApiResponse({ status: 204 })
  resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
  ): Promise<void> {
    return this.accountsService.resetPassword(id, dto);
  }

  @Patch(':id/toggle-status')
  @ApiOperation({ summary: '계정 상태 토글' })
  @ApiResponse({ status: 200, type: AccountResponseDto })
  toggleStatus(@Param('id') id: string): Promise<AccountResponseDto> {
    return this.accountsService.toggleStatus(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: '계정 삭제' })
  @ApiResponse({ status: 204 })
  remove(@Param('id') id: string): Promise<void> {
    return this.accountsService.remove(id);
  }
}
