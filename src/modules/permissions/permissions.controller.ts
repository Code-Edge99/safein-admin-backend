import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PermissionsService } from './permissions.service';
import { AuthenticatedAdminRequest } from '../../common/types/authenticated-request.type';
import {
  BulkUpdateCompanyPermissionsDto,
  BulkUpdateCompanyPermissionsResultDto,
  CompanyRoleDto,
  CompanyRoleListResponseDto,
  CreateCompanyRoleDto,
  EffectivePermissionsResponseDto,
  PermissionMatrixResponseDto,
  PermissionTargetRoleEnum,
  UpdateCompanyPermissionDto,
  UpdateCompanyPermissionResultDto,
  UpdateCompanyRoleDto,
} from './dto/permissions.dto';

@ApiTags('권한 관리')
@Controller('permissions')
@UseGuards(JwtAuthGuard, RolesGuard, OrganizationScopeGuard)
@ApiBearerAuth()
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  private getActorContext(req: AuthenticatedAdminRequest) {
    return {
      id: req.user?.id,
      role: req.user?.role,
      organizationId: req.user?.organizationId,
      scopeOrganizationIds: req.organizationScopeIds ?? undefined,
    };
  }

  @Get('me')
  @Roles('SUPER_ADMIN', 'SITE_ADMIN')
  @ApiOperation({ summary: '현재 로그인 계정의 실효 권한 조회' })
  @ApiResponse({ status: 200, type: EffectivePermissionsResponseDto })
  findMine(@Req() req: AuthenticatedAdminRequest): Promise<EffectivePermissionsResponseDto> {
    return this.permissionsService.findMine(this.getActorContext(req));
  }

  @Get('roles')
  @Roles('SUPER_ADMIN', 'SITE_ADMIN')
  @ApiOperation({ summary: '커스텀 역할 목록 + 부여 가능 권한 카탈로그 조회' })
  @ApiResponse({ status: 200, type: CompanyRoleListResponseDto })
  listRoles(
    @Req() req: AuthenticatedAdminRequest,
    @Query('organizationId') organizationId?: string,
  ): Promise<CompanyRoleListResponseDto> {
    return this.permissionsService.listRoles(this.getActorContext(req), organizationId);
  }

  @Post('roles')
  @Roles('SUPER_ADMIN', 'SITE_ADMIN')
  @ApiOperation({ summary: '커스텀 역할 생성(회사 관리자/슈퍼관리자)' })
  @ApiResponse({ status: 201, type: CompanyRoleDto })
  createRole(
    @Req() req: AuthenticatedAdminRequest,
    @Body() data: CreateCompanyRoleDto,
  ): Promise<CompanyRoleDto> {
    return this.permissionsService.createRole(this.getActorContext(req), data);
  }

  @Put('roles/:id')
  @Roles('SUPER_ADMIN', 'SITE_ADMIN')
  @ApiOperation({ summary: '커스텀 역할 수정' })
  @ApiResponse({ status: 200, type: CompanyRoleDto })
  updateRole(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() data: UpdateCompanyRoleDto,
  ): Promise<CompanyRoleDto> {
    return this.permissionsService.updateRole(this.getActorContext(req), id, data);
  }

  @Delete('roles/:id')
  @Roles('SUPER_ADMIN', 'SITE_ADMIN')
  @ApiOperation({ summary: '커스텀 역할 삭제' })
  @ApiResponse({ status: 200 })
  deleteRole(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    return this.permissionsService.deleteRole(this.getActorContext(req), id);
  }

  @Get()
  @Roles('SUPER_ADMIN', 'SITE_ADMIN')
  @ApiOperation({ summary: '슈퍼관리자: 회사 관리자 / 회사관리자: 그룹담당자 권한 목록 조회' })
  @ApiResponse({ status: 200, type: PermissionMatrixResponseDto })
  findAll(
    @Req() req: AuthenticatedAdminRequest,
    @Query('organizationId') organizationId?: string,
    @Query('targetRole') targetRole?: PermissionTargetRoleEnum,
  ): Promise<PermissionMatrixResponseDto> {
    return this.permissionsService.findAll(this.getActorContext(req), organizationId, targetRole);
  }

  @Put(':id')
  @Roles('SUPER_ADMIN', 'SITE_ADMIN')
  @ApiOperation({ summary: '슈퍼관리자: 회사 관리자 / 회사관리자: 그룹담당자 권한 수정' })
  @ApiResponse({ status: 200, type: UpdateCompanyPermissionResultDto })
  update(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() data: UpdateCompanyPermissionDto,
  ): Promise<UpdateCompanyPermissionResultDto> {
    return this.permissionsService.update(id, data, this.getActorContext(req));
  }

  @Put()
  @Roles('SUPER_ADMIN', 'SITE_ADMIN')
  @ApiOperation({ summary: '슈퍼관리자: 회사 관리자 / 회사관리자: 그룹담당자 권한 일괄 수정' })
  @ApiResponse({ status: 200, type: BulkUpdateCompanyPermissionsResultDto })
  bulkUpdate(
    @Req() req: AuthenticatedAdminRequest,
    @Body() data: BulkUpdateCompanyPermissionsDto,
  ): Promise<BulkUpdateCompanyPermissionsResultDto> {
    return this.permissionsService.bulkUpdate(data.updates, this.getActorContext(req));
  }
}
