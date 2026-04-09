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
import { TimePoliciesService } from './time-policies.service';
import {
  CreateTimePolicyDto,
  UpdateTimePolicyDto,
  TimePolicyFilterDto,
  TimePolicyResponseDto,
  TimePolicyListResponseDto,
  TimePolicyStatsDto,
  CheckTimeActiveDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { AuthenticatedAdminRequest } from '../../common/types/authenticated-request.type';

@ApiTags('Time Policies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationScopeGuard)
@Controller('time-policies')
export class TimePoliciesController {
  constructor(private readonly timePoliciesService: TimePoliciesService) {}

  @Post()
  @ApiOperation({ summary: '시간 정책 생성' })
  @ApiResponse({ status: 201, description: '정책 생성 성공', type: TimePolicyResponseDto })
  async create(@Req() req: AuthenticatedAdminRequest, @Body() createTimePolicyDto: CreateTimePolicyDto): Promise<TimePolicyResponseDto> {
    return this.timePoliciesService.create(createTimePolicyDto, req.organizationScopeIds ?? undefined, req.user?.id);
  }

  @Get()
  @ApiOperation({ summary: '시간 정책 목록 조회' })
  @ApiResponse({ status: 200, description: '정책 목록', type: TimePolicyListResponseDto })
  async findAll(@Req() req: AuthenticatedAdminRequest, @Query() filter: TimePolicyFilterDto): Promise<TimePolicyListResponseDto> {
    return this.timePoliciesService.findAll(filter, req.organizationScopeIds ?? undefined);
  }

  @Get('stats')
  @ApiOperation({ summary: '시간 정책 통계 조회' })
  @ApiResponse({ status: 200, description: '정책 통계', type: TimePolicyStatsDto })
  async getStats(@Req() req: AuthenticatedAdminRequest): Promise<TimePolicyStatsDto> {
    return this.timePoliciesService.getStats(req.organizationScopeIds ?? undefined);
  }

  @Get('organization/:organizationId')
  @ApiOperation({ summary: '현장별 시간 정책 목록 조회' })
  @ApiParam({ name: 'organizationId', description: '현장 ID' })
  @ApiResponse({ status: 200, description: '현장별 정책 목록', type: [TimePolicyResponseDto] })
  async findByOrganization(
    @Req() req: AuthenticatedAdminRequest,
    @Param('organizationId') organizationId: string,
  ): Promise<TimePolicyResponseDto[]> {
    return this.timePoliciesService.findByOrganization(organizationId, req.organizationScopeIds ?? undefined);
  }

  @Get(':id')
  @ApiOperation({ summary: '시간 정책 상세 조회' })
  @ApiParam({ name: 'id', description: '정책 ID' })
  @ApiResponse({ status: 200, description: '정책 상세 정보', type: TimePolicyResponseDto })
  @ApiResponse({ status: 404, description: '정책을 찾을 수 없음' })
  async findOne(@Req() req: AuthenticatedAdminRequest, @Param('id') id: string): Promise<TimePolicyResponseDto> {
    return this.timePoliciesService.findOne(id, req.organizationScopeIds ?? undefined);
  }

  @Post(':id/check-active')
  @ApiOperation({ summary: '시간 정책 활성 여부 확인' })
  @ApiParam({ name: 'id', description: '정책 ID' })
  @ApiResponse({
    status: 200,
    description: '활성 여부',
    schema: { type: 'object', properties: { isActive: { type: 'boolean' } } },
  })
  async checkTimeActive(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() checkDto: CheckTimeActiveDto,
  ): Promise<{ isActive: boolean }> {
    const checkTime = checkDto.checkTime ? new Date(checkDto.checkTime) : undefined;
    const isActive = await this.timePoliciesService.isTimeActive(
      id,
      checkTime,
      req.organizationScopeIds ?? undefined,
    );
    return { isActive };
  }

  @Patch(':id')
  @ApiOperation({ summary: '시간 정책 수정' })
  @ApiParam({ name: 'id', description: '정책 ID' })
  @ApiResponse({ status: 200, description: '정책 수정 성공', type: TimePolicyResponseDto })
  @ApiResponse({ status: 404, description: '정책을 찾을 수 없음' })
  async update(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() updateTimePolicyDto: UpdateTimePolicyDto,
  ): Promise<TimePolicyResponseDto> {
    return this.timePoliciesService.update(id, updateTimePolicyDto, req.organizationScopeIds ?? undefined, req.user?.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '시간 정책 삭제' })
  @ApiParam({ name: 'id', description: '정책 ID' })
  @ApiResponse({ status: 204, description: '정책 삭제 성공' })
  @ApiResponse({ status: 404, description: '정책을 찾을 수 없음' })
  async remove(@Req() req: AuthenticatedAdminRequest, @Param('id') id: string): Promise<void> {
    return this.timePoliciesService.remove(id, req.organizationScopeIds ?? undefined);
  }
}
