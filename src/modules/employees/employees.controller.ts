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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { EmployeesService } from './employees.service';
import {
  CreateEmployeeDto,
  UpdateEmployeeDto,
  EmployeeResponseDto,
  EmployeeDetailDto,
  EmployeeFilterDto,
  BulkAssignWorkTypeDto,
  BulkMoveOrganizationDto,
  BulkEmployeeActionDto,
  EmployeeStatusEnum,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaginatedResponse } from '../../common/dto';

@ApiTags('직원')
@Controller('employees')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Post()
  @ApiOperation({ summary: '직원 생성' })
  @ApiResponse({ status: 201, description: '직원 생성 성공', type: EmployeeResponseDto })
  create(@Body() createEmployeeDto: CreateEmployeeDto): Promise<EmployeeResponseDto> {
    return this.employeesService.create(createEmployeeDto);
  }

  @Get()
  @ApiOperation({ summary: '직원 목록 조회' })
  @ApiResponse({ status: 200, description: '직원 목록' })
  findAll(@Query() filter: EmployeeFilterDto): Promise<PaginatedResponse<EmployeeResponseDto>> {
    return this.employeesService.findAll(filter);
  }

  @Get('stats')
  @ApiOperation({ summary: '직원 통계 조회' })
  @ApiResponse({ status: 200, description: '직원 통계' })
  getStats() {
    return this.employeesService.getStats();
  }

  @Get(':employeeId')
  @ApiOperation({ summary: '직원 상세 조회' })
  @ApiParam({ name: 'employeeId', description: '직원 ID' })
  @ApiResponse({ status: 200, description: '직원 상세', type: EmployeeDetailDto })
  @ApiResponse({ status: 404, description: '직원을 찾을 수 없음' })
  findOne(@Param('employeeId') employeeId: string): Promise<EmployeeDetailDto> {
    return this.employeesService.findOne(employeeId);
  }

  @Patch(':employeeId')
  @ApiOperation({ summary: '직원 수정' })
  @ApiParam({ name: 'employeeId', description: '직원 ID' })
  @ApiResponse({ status: 200, description: '직원 수정 성공', type: EmployeeResponseDto })
  update(
    @Param('employeeId') employeeId: string,
    @Body() updateEmployeeDto: UpdateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.update(employeeId, updateEmployeeDto);
  }

  @Patch(':employeeId/assign-device')
  @ApiOperation({ summary: '직원에 장치 할당' })
  @ApiParam({ name: 'employeeId', description: '직원 ID' })
  @ApiResponse({ status: 200, description: '장치 할당 성공', type: EmployeeResponseDto })
  assignDevice(
    @Param('employeeId') employeeId: string,
    @Body() body: { deviceId: string },
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.assignDevice(employeeId, body.deviceId);
  }

  @Patch(':employeeId/unassign-device')
  @ApiOperation({ summary: '직원 장치 할당 해제' })
  @ApiParam({ name: 'employeeId', description: '직원 ID' })
  @ApiResponse({ status: 200, description: '장치 할당 해제 성공', type: EmployeeResponseDto })
  unassignDevice(@Param('employeeId') employeeId: string): Promise<EmployeeResponseDto> {
    return this.employeesService.unassignDevice(employeeId);
  }

  @Delete(':employeeId')
  @ApiOperation({ summary: '직원 삭제' })
  @ApiParam({ name: 'employeeId', description: '직원 ID' })
  @ApiResponse({ status: 200, description: '직원 삭제 성공' })
  remove(@Param('employeeId') employeeId: string): Promise<void> {
    return this.employeesService.remove(employeeId);
  }

  @Post('bulk/assign-work-type')
  @ApiOperation({ summary: '일괄 근무 유형 할당' })
  @ApiResponse({ status: 200, description: '처리된 직원 수' })
  bulkAssignWorkType(@Body() dto: BulkAssignWorkTypeDto): Promise<{ updated: number }> {
    return this.employeesService.bulkAssignWorkType(dto);
  }

  @Post('bulk/move-organization')
  @ApiOperation({ summary: '일괄 조직 이동' })
  @ApiResponse({ status: 200, description: '처리된 직원 수' })
  bulkMoveOrganization(@Body() dto: BulkMoveOrganizationDto): Promise<{ updated: number }> {
    return this.employeesService.bulkMoveOrganization(dto);
  }

  @Post('bulk/activate')
  @ApiOperation({ summary: '일괄 활성화' })
  @ApiResponse({ status: 200, description: '처리된 직원 수' })
  bulkActivate(@Body() dto: BulkEmployeeActionDto): Promise<{ updated: number }> {
    return this.employeesService.bulkUpdateStatus(dto.employeeIds, EmployeeStatusEnum.ACTIVE);
  }

  @Post('bulk/deactivate')
  @ApiOperation({ summary: '일괄 퇴사 처리' })
  @ApiResponse({ status: 200, description: '처리된 직원 수' })
  bulkDeactivate(@Body() dto: BulkEmployeeActionDto): Promise<{ updated: number }> {
    return this.employeesService.bulkUpdateStatus(dto.employeeIds, EmployeeStatusEnum.RESIGNED);
  }
}
