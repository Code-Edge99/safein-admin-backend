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
} from '@nestjs/swagger';
import { ControlPoliciesService } from './control-policies.service';
import {
  CreateControlPolicyDto,
  UpdateControlPolicyDto,
  ControlPolicyFilterDto,
  ControlPolicyResponseDto,
  ControlPolicyDetailDto,
  ControlPolicyListResponseDto,
  ControlPolicyStatsDto,
  AssignZonesDto,
  AssignTimePoliciesDto,
  AssignBehaviorConditionsDto,
  AssignAllowedAppsDto,
  AssignEmployeesDto,
  BulkControlPolicyActionDto,
  BulkControlPolicyStatusUpdateDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { AuthenticatedAdminRequest } from '../../common/types/authenticated-request.type';

@ApiTags('Control Policies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationScopeGuard)
@Controller('control-policies')
export class ControlPoliciesController {
  constructor(private readonly controlPoliciesService: ControlPoliciesService) {}

  @Post()
  @ApiOperation({ summary: '제어 정책 생성' })
  @ApiResponse({ status: 201, description: '정책 생성 성공', type: ControlPolicyDetailDto })
  async create(@Req() req: AuthenticatedAdminRequest, @Body() createDto: CreateControlPolicyDto): Promise<ControlPolicyDetailDto> {
    return this.controlPoliciesService.create(createDto, req.organizationScopeIds ?? undefined, req.user?.id);
  }

  @Get()
  @ApiOperation({ summary: '제어 정책 목록 조회' })
  @ApiResponse({ status: 200, description: '정책 목록', type: ControlPolicyListResponseDto })
  async findAll(@Req() req: AuthenticatedAdminRequest, @Query() filter: ControlPolicyFilterDto): Promise<ControlPolicyListResponseDto> {
    return this.controlPoliciesService.findAll(filter, req.organizationScopeIds ?? undefined);
  }

  @Get('stats')
  @ApiOperation({ summary: '제어 정책 통계 조회' })
  @ApiResponse({ status: 200, description: '정책 통계', type: ControlPolicyStatsDto })
  async getStats(@Req() req: AuthenticatedAdminRequest): Promise<ControlPolicyStatsDto> {
    return this.controlPoliciesService.getStats(req.organizationScopeIds ?? undefined);
  }

  @Get('organization/:orgId')
  @ApiOperation({ summary: '조직별 제어 정책 조회' })
  @ApiParam({ name: 'orgId', description: '조직 ID' })
  @ApiResponse({ status: 200, description: '정책 목록', type: [ControlPolicyResponseDto] })
  async findByOrganization(@Req() req: AuthenticatedAdminRequest, @Param('orgId') orgId: string): Promise<ControlPolicyResponseDto[]> {
    return this.controlPoliciesService.findByOrganization(orgId, req.organizationScopeIds ?? undefined);
  }

  @Get('work-type/:workTypeId')
  @ApiOperation({ summary: '작업 유형별 제어 정책 조회' })
  @ApiParam({ name: 'workTypeId', description: '작업 유형 ID' })
  @ApiResponse({ status: 200, description: '정책 상세 정보', type: ControlPolicyDetailDto })
  async findByWorkType(
    @Req() req: AuthenticatedAdminRequest,
    @Param('workTypeId') workTypeId: string,
  ): Promise<ControlPolicyDetailDto | null> {
    return this.controlPoliciesService.findByWorkType(workTypeId, req.organizationScopeIds ?? undefined);
  }

  @Get(':id')
  @ApiOperation({ summary: '제어 정책 상세 조회' })
  @ApiParam({ name: 'id', description: '정책 ID' })
  @ApiResponse({ status: 200, description: '정책 상세 정보', type: ControlPolicyDetailDto })
  @ApiResponse({ status: 404, description: '정책을 찾을 수 없음' })
  async findOne(@Req() req: AuthenticatedAdminRequest, @Param('id') id: string): Promise<ControlPolicyDetailDto> {
    return this.controlPoliciesService.findOneDetail(id, req.organizationScopeIds ?? undefined);
  }

  @Patch(':id')
  @ApiOperation({ summary: '제어 정책 수정' })
  @ApiParam({ name: 'id', description: '정책 ID' })
  @ApiResponse({ status: 200, description: '정책 수정 성공', type: ControlPolicyDetailDto })
  @ApiResponse({ status: 404, description: '정책을 찾을 수 없음' })
  async update(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() updateDto: UpdateControlPolicyDto,
  ): Promise<ControlPolicyDetailDto> {
    return this.controlPoliciesService.update(id, updateDto, req.organizationScopeIds ?? undefined, req.user?.id);
  }

  @Patch(':id/toggle-active')
  @ApiOperation({ summary: '제어 정책 활성/비활성 토글' })
  @ApiParam({ name: 'id', description: '정책 ID' })
  @ApiResponse({ status: 200, description: '상태 변경 성공', type: ControlPolicyResponseDto })
  async toggleActive(@Req() req: AuthenticatedAdminRequest, @Param('id') id: string): Promise<ControlPolicyResponseDto> {
    return this.controlPoliciesService.toggleActive(id, req.organizationScopeIds ?? undefined);
  }

  @Patch(':id/zones')
  @ApiOperation({ summary: '제어 정책 구역 할당' })
  @ApiParam({ name: 'id', description: '정책 ID' })
  @ApiResponse({ status: 200, description: '구역 할당 성공', type: ControlPolicyDetailDto })
  async assignZones(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() dto: AssignZonesDto,
  ): Promise<ControlPolicyDetailDto> {
    return this.controlPoliciesService.assignZones(id, dto.zoneIds, req.organizationScopeIds ?? undefined);
  }

  @Patch(':id/time-policies')
  @ApiOperation({ summary: '제어 정책 시간 정책 할당' })
  @ApiParam({ name: 'id', description: '정책 ID' })
  @ApiResponse({ status: 200, description: '시간 정책 할당 성공', type: ControlPolicyDetailDto })
  async assignTimePolicies(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() dto: AssignTimePoliciesDto,
  ): Promise<ControlPolicyDetailDto> {
    return this.controlPoliciesService.assignTimePolicies(
      id,
      dto.timePolicyIds,
      req.organizationScopeIds ?? undefined,
    );
  }

  @Patch(':id/behavior-conditions')
  @ApiOperation({ summary: '제어 정책 행동 조건 할당' })
  @ApiParam({ name: 'id', description: '정책 ID' })
  @ApiResponse({ status: 200, description: '행동 조건 할당 성공', type: ControlPolicyDetailDto })
  async assignBehaviorConditions(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() dto: AssignBehaviorConditionsDto,
  ): Promise<ControlPolicyDetailDto> {
    return this.controlPoliciesService.assignBehaviorConditions(
      id,
      dto.behaviorConditionIds,
      req.organizationScopeIds ?? undefined,
    );
  }

  @Patch(':id/allowed-apps')
  @ApiOperation({ summary: '제어 정책 허용앱 프리셋 할당' })
  @ApiParam({ name: 'id', description: '정책 ID' })
  @ApiResponse({ status: 200, description: '허용앱 프리셋 할당 성공', type: ControlPolicyDetailDto })
  async assignAllowedApps(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() dto: AssignAllowedAppsDto,
  ): Promise<ControlPolicyDetailDto> {
    return this.controlPoliciesService.assignAllowedApps(
      id,
      dto.allowedAppPresetIds,
      req.organizationScopeIds ?? undefined,
    );
  }

  @Patch(':id/employees')
  @ApiOperation({ summary: '제어 정책 대상 직원 할당' })
  @ApiParam({ name: 'id', description: '정책 ID' })
  @ApiResponse({ status: 200, description: '직원 할당 성공', type: ControlPolicyDetailDto })
  async assignEmployees(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() dto: AssignEmployeesDto,
  ): Promise<ControlPolicyDetailDto> {
    return this.controlPoliciesService.assignEmployees(
      id,
      dto.employeeIds,
      req.organizationScopeIds ?? undefined,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '제어 정책 삭제' })
  @ApiParam({ name: 'id', description: '정책 ID' })
  @ApiResponse({ status: 204, description: '정책 삭제 성공' })
  @ApiResponse({ status: 404, description: '정책을 찾을 수 없음' })
  async remove(@Req() req: AuthenticatedAdminRequest, @Param('id') id: string): Promise<void> {
    return this.controlPoliciesService.remove(id, req.organizationScopeIds ?? undefined);
  }

  @Post('bulk/delete')
  @ApiOperation({ summary: '제어 정책 일괄 삭제' })
  @ApiResponse({ status: 200, description: '삭제된 정책 수' })
  async bulkDelete(
    @Req() req: AuthenticatedAdminRequest,
    @Body() dto: BulkControlPolicyActionDto,
  ): Promise<{ requested: number; deleted: number; skipped: number }> {
    return this.controlPoliciesService.bulkRemove(dto.policyIds, req.organizationScopeIds ?? undefined);
  }

  @Post('bulk/status')
  @ApiOperation({ summary: '제어 정책 일괄 활성/비활성' })
  @ApiResponse({ status: 200, description: '처리된 정책 수' })
  async bulkUpdateStatus(
    @Req() req: AuthenticatedAdminRequest,
    @Body() dto: BulkControlPolicyStatusUpdateDto,
  ): Promise<{ requested: number; updated: number; skipped: number }> {
    return this.controlPoliciesService.bulkSetActive(dto.policyIds, dto.isActive, req.organizationScopeIds ?? undefined);
  }
}
