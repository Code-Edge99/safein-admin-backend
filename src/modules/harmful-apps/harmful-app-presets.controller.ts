import {
  Controller,
  Get,
  Post,
  Put,
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
import { HarmfulAppPresetsService } from './harmful-app-presets.service';
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

@ApiTags('유해 앱 프리셋')
@Controller('harmful-app-presets')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class HarmfulAppPresetsController {
  constructor(private readonly presetsService: HarmfulAppPresetsService) {}

  @Post()
  @ApiOperation({ summary: '유해 앱 프리셋 생성' })
  @ApiResponse({ status: 201, type: HarmfulAppPresetDetailDto })
  create(@Body() dto: CreateHarmfulAppPresetDto): Promise<HarmfulAppPresetDetailDto> {
    return this.presetsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: '유해 앱 프리셋 목록 조회' })
  @ApiResponse({ status: 200, type: HarmfulAppPresetListResponseDto })
  findAll(@Query() filter: HarmfulAppPresetFilterDto): Promise<HarmfulAppPresetListResponseDto> {
    return this.presetsService.findAll(filter);
  }

  @Get('stats')
  @ApiOperation({ summary: '유해 앱 통계' })
  @ApiResponse({ status: 200, type: HarmfulAppStatsDto })
  getStats(): Promise<HarmfulAppStatsDto> {
    return this.presetsService.getStats();
  }

  @Get('organization/:organizationId')
  @ApiOperation({ summary: '조직별 프리셋 목록' })
  @ApiResponse({ status: 200, type: [HarmfulAppPresetResponseDto] })
  findByOrganization(
    @Param('organizationId') organizationId: string,
  ): Promise<HarmfulAppPresetResponseDto[]> {
    return this.presetsService.findByOrganization(organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: '유해 앱 프리셋 상세 조회' })
  @ApiResponse({ status: 200, type: HarmfulAppPresetDetailDto })
  findOne(@Param('id') id: string): Promise<HarmfulAppPresetDetailDto> {
    return this.presetsService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: '유해 앱 프리셋 수정' })
  @ApiResponse({ status: 200, type: HarmfulAppPresetDetailDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateHarmfulAppPresetDto,
  ): Promise<HarmfulAppPresetDetailDto> {
    return this.presetsService.update(id, dto);
  }

  @Post(':id/apps')
  @ApiOperation({ summary: '프리셋에 앱 추가' })
  @ApiResponse({ status: 200, type: HarmfulAppPresetDetailDto })
  addApps(
    @Param('id') id: string,
    @Body() dto: AssignAppsToPresetDto,
  ): Promise<HarmfulAppPresetDetailDto> {
    return this.presetsService.addApps(id, dto.appIds);
  }

  @Delete(':id/apps')
  @ApiOperation({ summary: '프리셋에서 앱 제거' })
  @ApiResponse({ status: 200, type: HarmfulAppPresetDetailDto })
  removeApps(
    @Param('id') id: string,
    @Body() dto: AssignAppsToPresetDto,
  ): Promise<HarmfulAppPresetDetailDto> {
    return this.presetsService.removeApps(id, dto.appIds);
  }

  @Delete(':id')
  @ApiOperation({ summary: '유해 앱 프리셋 삭제' })
  @ApiResponse({ status: 204 })
  remove(@Param('id') id: string): Promise<void> {
    return this.presetsService.remove(id);
  }
}
