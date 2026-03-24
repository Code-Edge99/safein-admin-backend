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
  EmployeeMdmManualUnblockDto,
  EmployeeDeviceLogoutUntilNextLoginDto,
  BulkAssignWorkTypeDto,
  BulkMoveOrganizationDto,
  BulkEmployeeActionDto,
  EmployeeStatusEnum,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { PaginatedResponse } from '../../common/dto';
import { AuthenticatedAdminRequest } from '../../common/types/authenticated-request.type';

@ApiTags('직원')
@Controller('employees')
@UseGuards(JwtAuthGuard, OrganizationScopeGuard)
@ApiBearerAuth()
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Post()
  @ApiOperation({ summary: '직원 생성' })
  @ApiResponse({ status: 201, description: '직원 생성 성공', type: EmployeeResponseDto })
  create(@Req() req: AuthenticatedAdminRequest, @Body() createEmployeeDto: CreateEmployeeDto): Promise<EmployeeResponseDto> {
    return this.employeesService.create(createEmployeeDto, req.organizationScopeIds ?? undefined);
  }

  @Get()
  @ApiOperation({ summary: '직원 목록 조회' })
  @ApiResponse({ status: 200, description: '직원 목록' })
  findAll(@Req() req: AuthenticatedAdminRequest, @Query() filter: EmployeeFilterDto): Promise<PaginatedResponse<EmployeeResponseDto>> {
    return this.employeesService.findAll(filter, req.organizationScopeIds ?? undefined);
  }

  @Get('stats')
  @ApiOperation({ summary: '직원 통계 조회' })
  @ApiResponse({ status: 200, description: '직원 통계' })
  getStats(@Req() req: AuthenticatedAdminRequest) {
    return this.employeesService.getStats(req.organizationScopeIds ?? undefined);
  }

  @Get(':employeeId')
  @ApiOperation({ summary: '직원 상세 조회' })
  @ApiParam({ name: 'employeeId', description: '직원 ID' })
  @ApiResponse({ status: 200, description: '직원 상세', type: EmployeeDetailDto })
  @ApiResponse({ status: 404, description: '직원을 찾을 수 없음' })
  findOne(@Req() req: AuthenticatedAdminRequest, @Param('employeeId') employeeId: string): Promise<EmployeeDetailDto> {
    return this.employeesService.findOne(employeeId, req.organizationScopeIds ?? undefined);
  }

  @Patch(':employeeId')
  @ApiOperation({ summary: '직원 수정' })
  @ApiParam({ name: 'employeeId', description: '직원 ID' })
  @ApiResponse({ status: 200, description: '직원 수정 성공', type: EmployeeResponseDto })
  update(
    @Req() req: AuthenticatedAdminRequest,
    @Param('employeeId') employeeId: string,
    @Body() updateEmployeeDto: UpdateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.update(employeeId, updateEmployeeDto, req.organizationScopeIds ?? undefined);
  }

  @Patch(':employeeId/assign-device')
  @ApiOperation({ summary: '직원에 장치 할당' })
  @ApiParam({ name: 'employeeId', description: '직원 ID' })
  @ApiResponse({ status: 200, description: '장치 할당 성공', type: EmployeeResponseDto })
  assignDevice(
    @Req() req: AuthenticatedAdminRequest,
    @Param('employeeId') employeeId: string,
    @Body() body: { deviceId: string },
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.assignDevice(employeeId, body.deviceId, req.organizationScopeIds ?? undefined);
  }

  @Patch(':employeeId/unassign-device')
  @ApiOperation({ summary: '직원 장치 할당 해제' })
  @ApiParam({ name: 'employeeId', description: '직원 ID' })
  @ApiResponse({ status: 200, description: '장치 할당 해제 성공', type: EmployeeResponseDto })
  unassignDevice(@Req() req: AuthenticatedAdminRequest, @Param('employeeId') employeeId: string): Promise<EmployeeResponseDto> {
    return this.employeesService.unassignDevice(employeeId, req.organizationScopeIds ?? undefined);
  }

  @Post(':employeeId/mdm/manual-unblock')
  @ApiOperation({ summary: '직원 디바이스 수동 해제 설정 (다음 로그인 전까지)' })
  @ApiParam({ name: 'employeeId', description: '직원 ID' })
  @ApiResponse({ status: 200, description: '수동 해제 설정 성공' })
  setMdmManualUnblock(
    @Req() req: AuthenticatedAdminRequest,
    @Param('employeeId') employeeId: string,
    @Body() dto: EmployeeMdmManualUnblockDto,
  ) {
    return this.employeesService.setMdmManualUnblock(employeeId, dto, req.organizationScopeIds ?? undefined);
  }

  @Post(':employeeId/devices/logout-until-next-login')
  @ApiOperation({ summary: '직원 iOS 디바이스 강제 로그아웃 및 다음 로그인 전까지 정책 미적용' })
  @ApiParam({ name: 'employeeId', description: '직원 ID' })
  @ApiResponse({ status: 200, description: '강제 로그아웃 처리 성공' })
  forceLogoutDeviceUntilNextLogin(
    @Req() req: AuthenticatedAdminRequest,
    @Param('employeeId') employeeId: string,
    @Body() dto: EmployeeDeviceLogoutUntilNextLoginDto,
  ) {
    return this.employeesService.forceLogoutDeviceUntilNextLogin(employeeId, dto, req.organizationScopeIds ?? undefined);
  }

  @Delete(':employeeId')
  @ApiOperation({ summary: '직원 삭제' })
  @ApiParam({ name: 'employeeId', description: '직원 ID' })
  @ApiResponse({ status: 200, description: '직원 삭제 성공' })
  remove(@Req() req: AuthenticatedAdminRequest, @Param('employeeId') employeeId: string): Promise<void> {
    return this.employeesService.remove(employeeId, req.organizationScopeIds ?? undefined);
  }

  @Post('bulk/assign-work-type')
  @ApiOperation({ summary: '일괄 근무 유형 할당' })
  @ApiResponse({ status: 200, description: '처리된 직원 수' })
  bulkAssignWorkType(@Req() req: AuthenticatedAdminRequest, @Body() dto: BulkAssignWorkTypeDto): Promise<{ updated: number }> {
    return this.employeesService.bulkAssignWorkType(dto, req.organizationScopeIds ?? undefined);
  }

  @Post('bulk/move-organization')
  @ApiOperation({ summary: '일괄 조직 이동' })
  @ApiResponse({ status: 200, description: '처리된 직원 수' })
  bulkMoveOrganization(@Req() req: AuthenticatedAdminRequest, @Body() dto: BulkMoveOrganizationDto): Promise<{ updated: number }> {
    return this.employeesService.bulkMoveOrganization(dto, req.organizationScopeIds ?? undefined);
  }

  @Post('bulk/activate')
  @ApiOperation({ summary: '일괄 활성화' })
  @ApiResponse({ status: 200, description: '처리된 직원 수' })
  bulkActivate(@Req() req: AuthenticatedAdminRequest, @Body() dto: BulkEmployeeActionDto): Promise<{ updated: number }> {
    return this.employeesService.bulkUpdateStatus(
      dto.employeeIds,
      EmployeeStatusEnum.ACTIVE,
      req.organizationScopeIds ?? undefined,
    );
  }

  @Post('bulk/deactivate')
  @ApiOperation({ summary: '일괄 퇴사 처리' })
  @ApiResponse({ status: 200, description: '처리된 직원 수' })
  bulkDeactivate(@Req() req: AuthenticatedAdminRequest, @Body() dto: BulkEmployeeActionDto): Promise<{ updated: number }> {
    return this.employeesService.bulkUpdateStatus(
      dto.employeeIds,
      EmployeeStatusEnum.RESIGNED,
      req.organizationScopeIds ?? undefined,
    );
  }
}
