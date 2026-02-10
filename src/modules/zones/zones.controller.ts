import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
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
  CheckPointInZoneDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Zones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('zones')
export class ZonesController {
  constructor(private readonly zonesService: ZonesService) {}

  @Post()
  @ApiOperation({ summary: '구역 생성' })
  @ApiResponse({ status: 201, description: '구역 생성 성공', type: ZoneResponseDto })
  async create(@Body() createZoneDto: CreateZoneDto): Promise<ZoneResponseDto> {
    return this.zonesService.create(createZoneDto);
  }

  @Get()
  @ApiOperation({ summary: '구역 목록 조회' })
  @ApiResponse({ status: 200, description: '구역 목록', type: ZoneListResponseDto })
  async findAll(@Query() filter: ZoneFilterDto): Promise<ZoneListResponseDto> {
    return this.zonesService.findAll(filter);
  }

  @Get('stats')
  @ApiOperation({ summary: '구역 통계 조회' })
  @ApiResponse({ status: 200, description: '구역 통계', type: ZoneStatsDto })
  async getStats(): Promise<ZoneStatsDto> {
    return this.zonesService.getZoneStats();
  }

  @Get('organization/:organizationId')
  @ApiOperation({ summary: '조직별 구역 목록 조회' })
  @ApiParam({ name: 'organizationId', description: '조직 ID' })
  @ApiResponse({ status: 200, description: '조직별 구역 목록', type: [ZoneResponseDto] })
  async findByOrganization(
    @Param('organizationId') organizationId: string,
  ): Promise<ZoneResponseDto[]> {
    return this.zonesService.findByOrganization(organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: '구역 상세 조회' })
  @ApiParam({ name: 'id', description: '구역 ID' })
  @ApiResponse({ status: 200, description: '구역 상세 정보', type: ZoneResponseDto })
  @ApiResponse({ status: 404, description: '구역을 찾을 수 없음' })
  async findOne(@Param('id') id: string): Promise<ZoneResponseDto> {
    return this.zonesService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '구역 수정' })
  @ApiParam({ name: 'id', description: '구역 ID' })
  @ApiResponse({ status: 200, description: '구역 수정 성공', type: ZoneResponseDto })
  @ApiResponse({ status: 404, description: '구역을 찾을 수 없음' })
  async update(
    @Param('id') id: string,
    @Body() updateZoneDto: UpdateZoneDto,
  ): Promise<ZoneResponseDto> {
    return this.zonesService.update(id, updateZoneDto);
  }

  @Patch(':id/toggle-active')
  @ApiOperation({ summary: '구역 활성/비활성 토글' })
  @ApiParam({ name: 'id', description: '구역 ID' })
  @ApiResponse({ status: 200, description: '상태 변경 성공', type: ZoneResponseDto })
  async toggleActive(@Param('id') id: string): Promise<ZoneResponseDto> {
    return this.zonesService.toggleActive(id);
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
    @Param('id') id: string,
    @Body() point: CheckPointInZoneDto,
  ): Promise<{ isInside: boolean }> {
    const isInside = await this.zonesService.checkPointInZone(id, point);
    return { isInside };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '구역 삭제' })
  @ApiParam({ name: 'id', description: '구역 ID' })
  @ApiResponse({ status: 204, description: '구역 삭제 성공' })
  @ApiResponse({ status: 404, description: '구역을 찾을 수 없음' })
  async remove(@Param('id') id: string): Promise<void> {
    return this.zonesService.remove(id);
  }
}
