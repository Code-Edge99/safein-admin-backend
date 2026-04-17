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
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionCodes } from '../auth/decorators/permission-codes.decorator';
import { EffectivePermissionsGuard } from '../auth/guards/effective-permissions.guard';
import { AllowedAppPresetsService } from './allowed-app-presets.service';
import {
  CreateAllowedAppPresetDto,
  UpdateAllowedAppPresetDto,
  AllowedAppPresetResponseDto,
  AllowedAppPresetDetailDto,
  AllowedAppPresetFilterDto,
  AllowedAppPresetListResponseDto,
  AssignAppsToPresetDto,
  AllowedAppStatsDto,
} from './dto';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { AuthenticatedAdminRequest } from '../../common/types/authenticated-request.type';

@ApiTags('허용앱 프리셋')
@Controller('allowed-app-presets')
@UseGuards(JwtAuthGuard, OrganizationScopeGuard, EffectivePermissionsGuard)
@PermissionCodes('ALLOWED_APP_READ')
@ApiBearerAuth()
export class AllowedAppPresetsController {
  constructor(private readonly presetsService: AllowedAppPresetsService) {}

  @Post()
  @PermissionCodes('ALLOWED_APP_WRITE')
  @ApiOperation({ summary: '허용앱 프리셋 생성' })
  @ApiResponse({ status: 201, type: AllowedAppPresetDetailDto })
  create(@Req() req: AuthenticatedAdminRequest, @Body() dto: CreateAllowedAppPresetDto): Promise<AllowedAppPresetDetailDto> {
    return this.presetsService.create(dto, req.organizationScopeIds ?? undefined, req.user?.id);
  }

  @Get()
  @ApiOperation({ summary: '허용앱 프리셋 목록 조회' })
  @ApiResponse({ status: 200, type: AllowedAppPresetListResponseDto })
  findAll(@Req() req: AuthenticatedAdminRequest, @Query() filter: AllowedAppPresetFilterDto): Promise<AllowedAppPresetListResponseDto> {
    return this.presetsService.findAll(filter, req.organizationScopeIds ?? undefined);
  }

  @Get('stats')
  @ApiOperation({ summary: '허용앱 통계' })
  @ApiResponse({ status: 200, type: AllowedAppStatsDto })
  getStats(@Req() req: AuthenticatedAdminRequest): Promise<AllowedAppStatsDto> {
    return this.presetsService.getStats(req.organizationScopeIds ?? undefined);
  }

  @Get('organization/:organizationId')
  @ApiOperation({ summary: '현장별 프리셋 목록' })
  @ApiResponse({ status: 200, type: [AllowedAppPresetResponseDto] })
  findByOrganization(
    @Req() req: AuthenticatedAdminRequest,
    @Param('organizationId') organizationId: string,
  ): Promise<AllowedAppPresetResponseDto[]> {
    return this.presetsService.findByOrganization(organizationId, req.organizationScopeIds ?? undefined);
  }

  @Get(':id')
  @ApiOperation({ summary: '허용앱 프리셋 상세 조회' })
  @ApiResponse({ status: 200, type: AllowedAppPresetDetailDto })
  findOne(@Req() req: AuthenticatedAdminRequest, @Param('id') id: string): Promise<AllowedAppPresetDetailDto> {
    return this.presetsService.findOne(id, req.organizationScopeIds ?? undefined);
  }

  @Put(':id')
  @PermissionCodes('ALLOWED_APP_WRITE')
  @ApiOperation({ summary: '허용앱 프리셋 수정' })
  @ApiResponse({ status: 200, type: AllowedAppPresetDetailDto })
  update(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() dto: UpdateAllowedAppPresetDto,
  ): Promise<AllowedAppPresetDetailDto> {
    return this.presetsService.update(id, dto, req.organizationScopeIds ?? undefined, req.user?.id);
  }

  @Post(':id/apps')
  @PermissionCodes('ALLOWED_APP_WRITE')
  @ApiOperation({ summary: '프리셋에 앱 추가' })
  @ApiResponse({ status: 200, type: AllowedAppPresetDetailDto })
  addApps(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() dto: AssignAppsToPresetDto,
  ): Promise<AllowedAppPresetDetailDto> {
    return this.presetsService.addApps(id, dto.appIds, req.organizationScopeIds ?? undefined, req.user?.id);
  }

  @Delete(':id/apps')
  @PermissionCodes('ALLOWED_APP_WRITE')
  @ApiOperation({ summary: '프리셋에서 앱 제거' })
  @ApiResponse({ status: 200, type: AllowedAppPresetDetailDto })
  removeApps(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() dto: AssignAppsToPresetDto,
  ): Promise<AllowedAppPresetDetailDto> {
    return this.presetsService.removeApps(id, dto.appIds, req.organizationScopeIds ?? undefined, req.user?.id);
  }

  @Delete(':id')
  @PermissionCodes('ALLOWED_APP_WRITE')
  @ApiOperation({ summary: '허용앱 프리셋 삭제' })
  @ApiResponse({ status: 204 })
  remove(@Req() req: AuthenticatedAdminRequest, @Param('id') id: string): Promise<void> {
    return this.presetsService.remove(id, req.organizationScopeIds ?? undefined);
  }
}
