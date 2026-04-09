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
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { DevicesService } from './devices.service';
import {
  CreateDeviceDto,
  UpdateDeviceDto,
  DeviceResponseDto,
  DeviceDetailDto,
  DeviceFilterDto,
  AssignDeviceDto,
  DeviceLocationDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { PaginatedResponse } from '../../common/dto';
import { AuthenticatedAdminRequest } from '../../common/types/authenticated-request.type';

@ApiTags('장치')
@Controller('devices')
@UseGuards(JwtAuthGuard, OrganizationScopeGuard)
@ApiBearerAuth()
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post()
  @ApiOperation({ summary: '장치 등록' })
  @ApiResponse({ status: 201, description: '장치 등록 성공', type: DeviceResponseDto })
  @ApiResponse({ status: 409, description: '이미 등록된 장치' })
  create(@Req() req: AuthenticatedAdminRequest, @Body() createDeviceDto: CreateDeviceDto): Promise<DeviceResponseDto> {
    return this.devicesService.create(createDeviceDto, req.organizationScopeIds ?? undefined);
  }

  @Get()
  @ApiOperation({ summary: '장치 목록 조회' })
  @ApiResponse({ status: 200, description: '장치 목록' })
  findAll(@Req() req: AuthenticatedAdminRequest, @Query() filter: DeviceFilterDto): Promise<PaginatedResponse<DeviceResponseDto>> {
    return this.devicesService.findAll(filter, req.organizationScopeIds ?? undefined);
  }

  @Get('stats')
  @ApiOperation({ summary: '장치 통계 조회' })
  @ApiQuery({ name: 'organizationId', required: false, description: '현장 ID' })
  @ApiResponse({ status: 200, description: '장치 통계' })
  getStats(@Req() req: AuthenticatedAdminRequest, @Query('organizationId') organizationId?: string) {
    return this.devicesService.getDeviceStats(organizationId, req.organizationScopeIds ?? undefined);
  }

  @Get(':id')
  @ApiOperation({ summary: '장치 상세 조회' })
  @ApiParam({ name: 'id', description: '장치 ID (UUID)' })
  @ApiResponse({ status: 200, description: '장치 상세', type: DeviceDetailDto })
  @ApiResponse({ status: 404, description: '장치를 찾을 수 없음' })
  findOne(@Req() req: AuthenticatedAdminRequest, @Param('id', ParseUUIDPipe) id: string): Promise<DeviceDetailDto> {
    return this.devicesService.findOne(id, req.organizationScopeIds ?? undefined);
  }

  @Get('by-device-id/:deviceId')
  @ApiOperation({ summary: '장치 식별자로 조회' })
  @ApiParam({ name: 'deviceId', description: '장치 식별자' })
  @ApiResponse({ status: 200, description: '장치 정보', type: DeviceResponseDto })
  findByDeviceId(@Req() req: AuthenticatedAdminRequest, @Param('deviceId') deviceId: string): Promise<DeviceResponseDto> {
    return this.devicesService.findByDeviceId(deviceId, req.organizationScopeIds ?? undefined);
  }

  @Patch(':id')
  @ApiOperation({ summary: '장치 수정' })
  @ApiParam({ name: 'id', description: '장치 ID (UUID)' })
  @ApiResponse({ status: 200, description: '장치 수정 성공', type: DeviceResponseDto })
  update(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDeviceDto: UpdateDeviceDto,
  ): Promise<DeviceResponseDto> {
    return this.devicesService.update(id, updateDeviceDto, req.organizationScopeIds ?? undefined);
  }

  @Post(':id/assign')
  @ApiOperation({ summary: '장치 할당' })
  @ApiParam({ name: 'id', description: '장치 ID (UUID)' })
  @ApiResponse({ status: 200, description: '장치 할당 성공', type: DeviceResponseDto })
  assign(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignDeviceDto,
  ): Promise<DeviceResponseDto> {
    return this.devicesService.assignToEmployee(id, dto, req.organizationScopeIds ?? undefined);
  }

  @Post(':id/unassign')
  @ApiOperation({ summary: '장치 할당 해제' })
  @ApiParam({ name: 'id', description: '장치 ID (UUID)' })
  @ApiResponse({ status: 200, description: '장치 할당 해제 성공', type: DeviceResponseDto })
  unassign(@Req() req: AuthenticatedAdminRequest, @Param('id', ParseUUIDPipe) id: string): Promise<DeviceResponseDto> {
    return this.devicesService.unassign(id, req.organizationScopeIds ?? undefined);
  }

  @Post(':id/location')
  @ApiOperation({ summary: '장치 위치 업데이트' })
  @ApiParam({ name: 'id', description: '장치 ID (UUID)' })
  @ApiResponse({ status: 200, description: '위치 업데이트 성공' })
  updateLocation(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeviceLocationDto,
  ): Promise<void> {
    return this.devicesService.updateLocation(id, dto, req.organizationScopeIds ?? undefined);
  }

  @Post(':id/lost')
  @ApiOperation({ summary: '장치 분실 처리' })
  @ApiParam({ name: 'id', description: '장치 ID (UUID)' })
  @ApiResponse({ status: 200, description: '분실 처리 성공', type: DeviceResponseDto })
  markAsLost(@Req() req: AuthenticatedAdminRequest, @Param('id', ParseUUIDPipe) id: string): Promise<DeviceResponseDto> {
    return this.devicesService.markAsLost(id, req.organizationScopeIds ?? undefined);
  }

  @Delete(':id')
  @ApiOperation({ summary: '장치 삭제' })
  @ApiParam({ name: 'id', description: '장치 ID (UUID)' })
  @ApiResponse({ status: 200, description: '장치 삭제 성공' })
  remove(@Req() req: AuthenticatedAdminRequest, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.devicesService.remove(id, req.organizationScopeIds ?? undefined);
  }
}
