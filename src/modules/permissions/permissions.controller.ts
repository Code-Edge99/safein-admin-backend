import {
  Controller,
  Get,
  Put,
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
  EffectivePermissionsResponseDto,
  PermissionMatrixResponseDto,
  UpdateCompanyPermissionDto,
  UpdateCompanyPermissionResultDto,
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

  @Get()
  @Roles('SUPER_ADMIN', 'SITE_ADMIN')
  @ApiOperation({ summary: '회사별 그룹담당자 권한 목록 조회' })
  @ApiResponse({ status: 200, type: PermissionMatrixResponseDto })
  findAll(
    @Req() req: AuthenticatedAdminRequest,
    @Query('organizationId') organizationId?: string,
  ): Promise<PermissionMatrixResponseDto> {
    return this.permissionsService.findAll(this.getActorContext(req), organizationId);
  }

  @Put(':id')
  @Roles('SUPER_ADMIN', 'SITE_ADMIN')
  @ApiOperation({ summary: '회사별 그룹담당자 권한 수정' })
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
  @ApiOperation({ summary: '회사별 그룹담당자 권한 일괄 수정' })
  @ApiResponse({ status: 200, type: BulkUpdateCompanyPermissionsResultDto })
  bulkUpdate(
    @Req() req: AuthenticatedAdminRequest,
    @Body() data: BulkUpdateCompanyPermissionsDto,
  ): Promise<BulkUpdateCompanyPermissionsResultDto> {
    return this.permissionsService.bulkUpdate(data.updates, this.getActorContext(req));
  }
}
