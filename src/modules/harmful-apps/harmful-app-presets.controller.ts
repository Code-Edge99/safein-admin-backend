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
import { AllowedAppPresetsService } from './harmful-app-presets.service';
import {
  CreateHarmfulAppPresetDto,
  UpdateHarmfulAppPresetDto,
  HarmfulAppPresetResponseDto,
  HarmfulAppPresetDetailDto,
  HarmfulAppPresetFilterDto,
  HarmfulAppPresetListResponseDto,
  AssignAppsToPresetDto,
  HarmfulAppStatsDto,
} from './dto';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';

@ApiTags('유해 앱 프리셋')
@Controller('harmful-app-presets')
@UseGuards(JwtAuthGuard, OrganizationScopeGuard)
@ApiBearerAuth()
export class AllowedAppPresetsController {
  constructor(private readonly presetsService: AllowedAppPresetsService) {}

  @Post()
  @ApiOperation({ summary: '유해 앱 프리셋 생성' })
  @ApiResponse({ status: 201, type: HarmfulAppPresetDetailDto })
  create(@Req() req: any, @Body() dto: CreateHarmfulAppPresetDto): Promise<HarmfulAppPresetDetailDto> {
    return this.presetsService.create(dto, req.organizationScopeIds ?? undefined);
  }

  @Get()
  @ApiOperation({ summary: '유해 앱 프리셋 목록 조회' })
  @ApiResponse({ status: 200, type: HarmfulAppPresetListResponseDto })
  findAll(@Req() req: any, @Query() filter: HarmfulAppPresetFilterDto): Promise<HarmfulAppPresetListResponseDto> {
    return this.presetsService.findAll(filter, req.organizationScopeIds ?? undefined);
  }

  @Get('stats')
  @ApiOperation({ summary: '유해 앱 통계' })
  @ApiResponse({ status: 200, type: HarmfulAppStatsDto })
  getStats(@Req() req: any): Promise<HarmfulAppStatsDto> {
    return this.presetsService.getStats(req.organizationScopeIds ?? undefined);
  }

  @Get('organization/:organizationId')
  @ApiOperation({ summary: '조직별 프리셋 목록' })
  @ApiResponse({ status: 200, type: [HarmfulAppPresetResponseDto] })
  findByOrganization(
    @Req() req: any,
    @Param('organizationId') organizationId: string,
  ): Promise<HarmfulAppPresetResponseDto[]> {
    return this.presetsService.findByOrganization(organizationId, req.organizationScopeIds ?? undefined);
  }

  @Get(':id')
  @ApiOperation({ summary: '유해 앱 프리셋 상세 조회' })
  @ApiResponse({ status: 200, type: HarmfulAppPresetDetailDto })
  findOne(@Req() req: any, @Param('id') id: string): Promise<HarmfulAppPresetDetailDto> {
    return this.presetsService.findOne(id, req.organizationScopeIds ?? undefined);
  }

  @Put(':id')
  @ApiOperation({ summary: '유해 앱 프리셋 수정' })
  @ApiResponse({ status: 200, type: HarmfulAppPresetDetailDto })
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateHarmfulAppPresetDto,
  ): Promise<HarmfulAppPresetDetailDto> {
    return this.presetsService.update(id, dto, req.organizationScopeIds ?? undefined);
  }

  @Post(':id/apps')
  @ApiOperation({ summary: '프리셋에 앱 추가' })
  @ApiResponse({ status: 200, type: HarmfulAppPresetDetailDto })
  addApps(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: AssignAppsToPresetDto,
  ): Promise<HarmfulAppPresetDetailDto> {
    return this.presetsService.addApps(id, dto.appIds, req.organizationScopeIds ?? undefined);
  }

  @Delete(':id/apps')
  @ApiOperation({ summary: '프리셋에서 앱 제거' })
  @ApiResponse({ status: 200, type: HarmfulAppPresetDetailDto })
  removeApps(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: AssignAppsToPresetDto,
  ): Promise<HarmfulAppPresetDetailDto> {
    return this.presetsService.removeApps(id, dto.appIds, req.organizationScopeIds ?? undefined);
  }

  @Delete(':id')
  @ApiOperation({ summary: '유해 앱 프리셋 삭제' })
  @ApiResponse({ status: 204 })
  remove(@Req() req: any, @Param('id') id: string): Promise<void> {
    return this.presetsService.remove(id, req.organizationScopeIds ?? undefined);
  }
}
