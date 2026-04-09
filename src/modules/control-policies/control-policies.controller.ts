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
  ApiBody,
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
  DispatchPolicyChangedDto,
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
  @ApiOperation({ summary: '현장별 제어 정책 조회' })
  @ApiParam({ name: 'orgId', description: '현장 ID' })
  @ApiResponse({ status: 200, description: '정책 목록', type: [ControlPolicyResponseDto] })
  async findByOrganization(@Req() req: AuthenticatedAdminRequest, @Param('orgId') orgId: string): Promise<ControlPolicyResponseDto[]> {
    return this.controlPoliciesService.findByOrganization(orgId, req.organizationScopeIds ?? undefined);
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

  @Post('dispatch-policy-changed')
  @ApiOperation({
    summary: '화면 변경 트리거: policy_changed 강제 전송',
    description:
      '화면에서 정책 관련 리소스(구역/시간정책/행동조건/허용앱 프리셋) 변경 시 대상 정책에 policy_changed를 강제로 전송합니다.\n\n'
      + '동작 규칙\n'
      + '- policyIds가 있으면 해당 정책 우선\n'
      + '- policyIds가 없으면 organizationId 필터 기반 조회\n'
      + '- trigger가 deactivate이면 비활성 정책도 대상으로 포함\n'
      + '- organization scope guard가 최종 대상 범위를 제한',
  })
  @ApiBody({
    type: DispatchPolicyChangedDto,
    description: '정책 변경 알림 디스패치 조건',
    examples: {
      byPolicies: {
        summary: '정책 ID 직접 지정',
        value: {
          policyIds: ['1f6f0b2e-5bb1-4c07-a6cb-3d7d9f0d1f20', 'e89a36b7-3baf-4a5d-9c42-3f5dd2a8bcb7'],
          trigger: 'update',
        },
      },
      byScopeFilter: {
        summary: '현장 필터 기반',
        value: {
          organizationId: '7af0eb0a-7f4f-4f5f-8157-2c1d2411d1a9',
          trigger: 'update',
        },
      },
      deactivateFlow: {
        summary: '해제/삭제 반영',
        value: {
          policyIds: ['1f6f0b2e-5bb1-4c07-a6cb-3d7d9f0d1f20'],
          trigger: 'deactivate',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'policy_changed 디스패치 결과',
    content: {
      'application/json': {
        examples: {
          success: {
            summary: '일부 또는 전체 대상 전송 완료',
            value: {
              requested: 5,
              dispatched: 5,
              skipped: 0,
            },
          },
          partiallySkipped: {
            summary: '요청 대비 일부 스킵',
            value: {
              requested: 5,
              dispatched: 3,
              skipped: 2,
            },
          },
        },
      },
    },
  })
  async dispatchPolicyChanged(
    @Req() req: AuthenticatedAdminRequest,
    @Body() dto: DispatchPolicyChangedDto,
  ): Promise<{ requested: number; dispatched: number; skipped: number }> {
    return this.controlPoliciesService.dispatchPolicyChangedByFilter(
      {
        policyIds: dto.policyIds,
        organizationId: dto.organizationId,
        trigger: dto.trigger,
      },
      req.organizationScopeIds ?? undefined,
    );
  }
}
