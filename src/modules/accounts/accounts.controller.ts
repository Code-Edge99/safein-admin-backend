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
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AccountsService } from './accounts.service';
import { AuthenticatedAdminRequest } from '../../common/types/authenticated-request.type';
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
@UseGuards(JwtAuthGuard, RolesGuard, OrganizationScopeGuard)
@Roles('SUPER_ADMIN', 'SITE_ADMIN')
@ApiBearerAuth()
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  private getActorContext(req: AuthenticatedAdminRequest) {
    return {
      id: req.user?.id,
      role: req.user?.role,
      organizationId: req.user?.organizationId,
      scopeOrganizationIds: req.organizationScopeIds ?? undefined,
    };
  }

  @Post()
  @ApiOperation({ summary: '계정 생성' })
  @ApiResponse({ status: 201, type: AccountResponseDto })
  create(
    @Req() req: AuthenticatedAdminRequest,
    @Body() dto: CreateAccountDto,
  ): Promise<AccountResponseDto> {
    return this.accountsService.create(dto, this.getActorContext(req));
  }

  @Get()
  @ApiOperation({ summary: '계정 목록 조회' })
  @ApiResponse({ status: 200, type: AccountListResponseDto })
  findAll(
    @Req() req: AuthenticatedAdminRequest,
    @Query() filter: AccountFilterDto,
  ): Promise<AccountListResponseDto> {
    return this.accountsService.findAll(filter, this.getActorContext(req));
  }

  @Get('stats')
  @ApiOperation({ summary: '계정 통계' })
  @ApiResponse({ status: 200, type: AccountStatsDto })
  getStats(@Req() req: AuthenticatedAdminRequest): Promise<AccountStatsDto> {
    return this.accountsService.getStats(this.getActorContext(req));
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
  findOne(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
  ): Promise<AccountResponseDto> {
    return this.accountsService.findOne(id, this.getActorContext(req));
  }

  @Put(':id')
  @ApiOperation({ summary: '계정 수정' })
  @ApiResponse({ status: 200, type: AccountResponseDto })
  update(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
  ): Promise<AccountResponseDto> {
    return this.accountsService.update(id, dto, this.getActorContext(req));
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
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
  ): Promise<void> {
    return this.accountsService.resetPassword(id, dto, this.getActorContext(req));
  }

  @Patch(':id/toggle-status')
  @ApiOperation({ summary: '계정 상태 토글' })
  @ApiResponse({ status: 200, type: AccountResponseDto })
  toggleStatus(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
  ): Promise<AccountResponseDto> {
    return this.accountsService.toggleStatus(id, this.getActorContext(req));
  }

  @Delete(':id')
  @ApiOperation({ summary: '계정 삭제' })
  @ApiResponse({ status: 204 })
  remove(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
  ): Promise<void> {
    return this.accountsService.remove(id, this.getActorContext(req));
  }
}
