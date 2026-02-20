import {
  Controller,
  Get,
  Post,
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
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { ControlLogsService } from './control-logs.service';
import {
  CreateControlLogDto,
  ControlLogFilterDto,
  ControlLogResponseDto,
  ControlLogListResponseDto,
  ControlLogStatsDto,
  EmployeeLogStatsDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';

@ApiTags('Control Logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationScopeGuard)
@Controller('control-logs')
export class ControlLogsController {
  constructor(private readonly controlLogsService: ControlLogsService) {}

  @Post()
  @ApiOperation({ summary: '제어 로그 생성' })
  @ApiResponse({ status: 201, description: '로그 생성 성공', type: ControlLogResponseDto })
  async create(@Body() createDto: CreateControlLogDto): Promise<ControlLogResponseDto> {
    return this.controlLogsService.create(createDto);
  }

  @Get()
  @ApiOperation({ summary: '제어 로그 목록 조회' })
  @ApiResponse({ status: 200, description: '로그 목록', type: ControlLogListResponseDto })
  async findAll(@Req() req: any, @Query() filter: ControlLogFilterDto): Promise<ControlLogListResponseDto> {
    return this.controlLogsService.findAll(filter, req.organizationScopeIds ?? undefined);
  }

  @Get('stats')
  @ApiOperation({ summary: '제어 로그 통계 조회' })
  @ApiQuery({ name: 'startDate', required: false, description: '시작 날짜' })
  @ApiQuery({ name: 'endDate', required: false, description: '종료 날짜' })
  @ApiResponse({ status: 200, description: '로그 통계', type: ControlLogStatsDto })
  async getStats(
    @Req() req: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<ControlLogStatsDto> {
    return this.controlLogsService.getStats(startDate, endDate, req.organizationScopeIds ?? undefined);
  }

  @Get('employee-stats')
  @ApiOperation({ summary: '직원별 로그 통계 조회' })
  @ApiQuery({ name: 'organizationId', required: false, description: '조직 ID' })
  @ApiQuery({ name: 'limit', required: false, description: '조회 수', type: Number })
  @ApiResponse({ status: 200, description: '직원별 통계', type: [EmployeeLogStatsDto] })
  async getEmployeeStats(
    @Req() req: any,
    @Query('organizationId') organizationId?: string,
    @Query('limit') limit?: number,
  ): Promise<EmployeeLogStatsDto[]> {
    return this.controlLogsService.getEmployeeStats(
      organizationId,
      limit || 10,
      req.organizationScopeIds ?? undefined,
    );
  }

  @Get('recent')
  @ApiOperation({ summary: '최근 제어 로그 조회' })
  @ApiQuery({ name: 'limit', required: false, description: '조회 수', type: Number })
  @ApiResponse({ status: 200, description: '최근 로그 목록', type: [ControlLogResponseDto] })
  async getRecentLogs(@Req() req: any, @Query('limit') limit?: number): Promise<ControlLogResponseDto[]> {
    return this.controlLogsService.getRecentLogs(limit || 20, req.organizationScopeIds ?? undefined);
  }

  @Get('employee/:employeeId')
  @ApiOperation({ summary: '직원별 제어 로그 조회' })
  @ApiParam({ name: 'employeeId', description: '직원 ID' })
  @ApiResponse({ status: 200, description: '직원별 로그 목록', type: ControlLogListResponseDto })
  async findByEmployee(
    @Req() req: any,
    @Param('employeeId') employeeId: string,
    @Query() filter: ControlLogFilterDto,
  ): Promise<ControlLogListResponseDto> {
    return this.controlLogsService.findByEmployee(
      employeeId,
      filter,
      req.organizationScopeIds ?? undefined,
    );
  }

  @Get('device/:deviceId')
  @ApiOperation({ summary: '디바이스별 제어 로그 조회' })
  @ApiParam({ name: 'deviceId', description: '디바이스 ID' })
  @ApiResponse({ status: 200, description: '디바이스별 로그 목록', type: ControlLogListResponseDto })
  async findByDevice(
    @Req() req: any,
    @Param('deviceId') deviceId: string,
    @Query() filter: ControlLogFilterDto,
  ): Promise<ControlLogListResponseDto> {
    return this.controlLogsService.findByDevice(
      deviceId,
      filter,
      req.organizationScopeIds ?? undefined,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: '제어 로그 상세 조회' })
  @ApiParam({ name: 'id', description: '로그 ID' })
  @ApiResponse({ status: 200, description: '로그 상세 정보', type: ControlLogResponseDto })
  @ApiResponse({ status: 404, description: '로그를 찾을 수 없음' })
  async findOne(@Req() req: any, @Param('id') id: string): Promise<ControlLogResponseDto> {
    return this.controlLogsService.findOne(id, req.organizationScopeIds ?? undefined);
  }
}
