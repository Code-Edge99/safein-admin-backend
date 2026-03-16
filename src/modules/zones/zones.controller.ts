import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { ZonesService } from './zones.service';
import {
  CreateZoneDto,
  UpdateZoneDto,
  ZoneFilterDto,
  ZoneResponseDto,
  ZoneListResponseDto,
  ZoneStatsDto,
  ZoneDetailStatsDto,
  CheckPointInZoneDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { AuthenticatedAdminRequest } from '../../common/types/authenticated-request.type';

@ApiTags('Zones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationScopeGuard)
@Controller('zones')
export class ZonesController {
  constructor(private readonly zonesService: ZonesService) {}

  @Post()
  @ApiOperation({ summary: '구역 생성' })
  @ApiResponse({ status: 201, description: '구역 생성 성공', type: ZoneResponseDto })
  async create(@Req() req: AuthenticatedAdminRequest, @Body() createZoneDto: CreateZoneDto): Promise<ZoneResponseDto> {
    return this.zonesService.create(createZoneDto, req.organizationScopeIds ?? undefined);
  }

  @Get()
  @ApiOperation({ summary: '구역 목록 조회' })
  @ApiResponse({ status: 200, description: '구역 목록', type: ZoneListResponseDto })
  async findAll(@Req() req: AuthenticatedAdminRequest, @Query() filter: ZoneFilterDto): Promise<ZoneListResponseDto> {
    return this.zonesService.findAll(filter, req.organizationScopeIds ?? undefined);
  }

  @Get('stats')
  @ApiOperation({ summary: '구역 통계 조회' })
  @ApiResponse({ status: 200, description: '구역 통계', type: ZoneStatsDto })
  async getStats(@Req() req: AuthenticatedAdminRequest): Promise<ZoneStatsDto> {
    return this.zonesService.getZoneStats(req.organizationScopeIds ?? undefined);
  }

  @Get(':id/detail-stats')
  @ApiOperation({ summary: '구역 상세 통계 조회' })
  @ApiParam({ name: 'id', description: '구역 ID' })
  @ApiResponse({ status: 200, description: '구역 상세 통계', type: ZoneDetailStatsDto })
  async getDetailStats(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
  ): Promise<ZoneDetailStatsDto> {
    return this.zonesService.getZoneDetailStats(id, req.organizationScopeIds ?? undefined);
  }

  @Get('organization/:organizationId')
  @ApiOperation({ summary: '조직별 구역 목록 조회' })
  @ApiParam({ name: 'organizationId', description: '조직 ID' })
  @ApiResponse({ status: 200, description: '조직별 구역 목록', type: [ZoneResponseDto] })
  async findByOrganization(
    @Req() req: AuthenticatedAdminRequest,
    @Param('organizationId') organizationId: string,
  ): Promise<ZoneResponseDto[]> {
    return this.zonesService.findByOrganization(organizationId, req.organizationScopeIds ?? undefined);
  }

  @Get(':id')
  @ApiOperation({ summary: '구역 상세 조회' })
  @ApiParam({ name: 'id', description: '구역 ID' })
  @ApiResponse({ status: 200, description: '구역 상세 정보', type: ZoneResponseDto })
  @ApiResponse({ status: 404, description: '구역을 찾을 수 없음' })
  async findOne(@Req() req: AuthenticatedAdminRequest, @Param('id') id: string): Promise<ZoneResponseDto> {
    return this.zonesService.findOne(id, req.organizationScopeIds ?? undefined);
  }

  @Patch(':id')
  @ApiOperation({ summary: '구역 수정' })
  @ApiParam({ name: 'id', description: '구역 ID' })
  @ApiResponse({ status: 200, description: '구역 수정 성공', type: ZoneResponseDto })
  @ApiResponse({ status: 404, description: '구역을 찾을 수 없음' })
  async update(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() updateZoneDto: UpdateZoneDto,
  ): Promise<ZoneResponseDto> {
    return this.zonesService.update(id, updateZoneDto, req.organizationScopeIds ?? undefined);
  }

  @Post(':id/check-point')
  @ApiOperation({ summary: '좌표가 구역 내 포함 여부 확인' })
  @ApiParam({ name: 'id', description: '구역 ID' })
  @ApiResponse({
    status: 200,
    description: '좌표 포함 여부',
    schema: { type: 'object', properties: { isInside: { type: 'boolean' } } },
  })
  async checkPointInZone(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() point: CheckPointInZoneDto,
  ): Promise<{ isInside: boolean }> {
    const isInside = await this.zonesService.checkPointInZone(id, point, req.organizationScopeIds ?? undefined);
    return { isInside };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '구역 삭제' })
  @ApiParam({ name: 'id', description: '구역 ID' })
  @ApiResponse({ status: 204, description: '구역 삭제 성공' })
  @ApiResponse({ status: 404, description: '구역을 찾을 수 없음' })
  async remove(@Req() req: AuthenticatedAdminRequest, @Param('id') id: string): Promise<void> {
    return this.zonesService.remove(id, req.organizationScopeIds ?? undefined);
  }
}
