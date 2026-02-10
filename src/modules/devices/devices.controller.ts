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
import { PaginatedResponse } from '../../common/dto';

@ApiTags('장치')
@Controller('devices')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post()
  @ApiOperation({ summary: '장치 등록' })
  @ApiResponse({ status: 201, description: '장치 등록 성공', type: DeviceResponseDto })
  @ApiResponse({ status: 409, description: '이미 등록된 장치' })
  create(@Body() createDeviceDto: CreateDeviceDto): Promise<DeviceResponseDto> {
    return this.devicesService.create(createDeviceDto);
  }

  @Get()
  @ApiOperation({ summary: '장치 목록 조회' })
  @ApiResponse({ status: 200, description: '장치 목록' })
  findAll(@Query() filter: DeviceFilterDto): Promise<PaginatedResponse<DeviceResponseDto>> {
    return this.devicesService.findAll(filter);
  }

  @Get('stats')
  @ApiOperation({ summary: '장치 통계 조회' })
  @ApiQuery({ name: 'organizationId', required: false, description: '조직 ID' })
  @ApiResponse({ status: 200, description: '장치 통계' })
  getStats(@Query('organizationId') organizationId?: string) {
    return this.devicesService.getDeviceStats(organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: '장치 상세 조회' })
  @ApiParam({ name: 'id', description: '장치 ID (UUID)' })
  @ApiResponse({ status: 200, description: '장치 상세', type: DeviceDetailDto })
  @ApiResponse({ status: 404, description: '장치를 찾을 수 없음' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<DeviceDetailDto> {
    return this.devicesService.findOne(id);
  }

  @Get('by-device-id/:deviceId')
  @ApiOperation({ summary: '장치 식별자로 조회' })
  @ApiParam({ name: 'deviceId', description: '장치 식별자' })
  @ApiResponse({ status: 200, description: '장치 정보', type: DeviceResponseDto })
  findByDeviceId(@Param('deviceId') deviceId: string): Promise<DeviceResponseDto> {
    return this.devicesService.findByDeviceId(deviceId);
  }

  @Patch(':id')
  @ApiOperation({ summary: '장치 수정' })
  @ApiParam({ name: 'id', description: '장치 ID (UUID)' })
  @ApiResponse({ status: 200, description: '장치 수정 성공', type: DeviceResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDeviceDto: UpdateDeviceDto,
  ): Promise<DeviceResponseDto> {
    return this.devicesService.update(id, updateDeviceDto);
  }

  @Post(':id/assign')
  @ApiOperation({ summary: '장치 할당' })
  @ApiParam({ name: 'id', description: '장치 ID (UUID)' })
  @ApiResponse({ status: 200, description: '장치 할당 성공', type: DeviceResponseDto })
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignDeviceDto,
  ): Promise<DeviceResponseDto> {
    return this.devicesService.assignToEmployee(id, dto);
  }

  @Post(':id/unassign')
  @ApiOperation({ summary: '장치 할당 해제' })
  @ApiParam({ name: 'id', description: '장치 ID (UUID)' })
  @ApiResponse({ status: 200, description: '장치 할당 해제 성공', type: DeviceResponseDto })
  unassign(@Param('id', ParseUUIDPipe) id: string): Promise<DeviceResponseDto> {
    return this.devicesService.unassign(id);
  }

  @Post(':id/location')
  @ApiOperation({ summary: '장치 위치 업데이트' })
  @ApiParam({ name: 'id', description: '장치 ID (UUID)' })
  @ApiResponse({ status: 200, description: '위치 업데이트 성공' })
  updateLocation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeviceLocationDto,
  ): Promise<void> {
    return this.devicesService.updateLocation(id, dto);
  }

  @Post(':id/lost')
  @ApiOperation({ summary: '장치 분실 처리' })
  @ApiParam({ name: 'id', description: '장치 ID (UUID)' })
  @ApiResponse({ status: 200, description: '분실 처리 성공', type: DeviceResponseDto })
  markAsLost(@Param('id', ParseUUIDPipe) id: string): Promise<DeviceResponseDto> {
    return this.devicesService.markAsLost(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: '장치 삭제' })
  @ApiParam({ name: 'id', description: '장치 ID (UUID)' })
  @ApiResponse({ status: 200, description: '장치 삭제 성공' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.devicesService.remove(id);
  }
}
