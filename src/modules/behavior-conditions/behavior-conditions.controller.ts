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
import { BehaviorConditionsService } from './behavior-conditions.service';
import {
  CreateBehaviorConditionDto,
  UpdateBehaviorConditionDto,
  BehaviorConditionFilterDto,
  BehaviorConditionResponseDto,
  BehaviorConditionListResponseDto,
  BehaviorConditionStatsDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { AuthenticatedAdminRequest } from '../../common/types/authenticated-request.type';

@ApiTags('Behavior Conditions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationScopeGuard)
@Controller('behavior-conditions')
export class BehaviorConditionsController {
  constructor(private readonly behaviorConditionsService: BehaviorConditionsService) {}

  @Post()
  @ApiOperation({ summary: '행동 조건 생성' })
  @ApiResponse({ status: 201, description: '조건 생성 성공', type: BehaviorConditionResponseDto })
  async create(@Req() req: AuthenticatedAdminRequest, @Body() createDto: CreateBehaviorConditionDto): Promise<BehaviorConditionResponseDto> {
    return this.behaviorConditionsService.create(createDto, req.organizationScopeIds ?? undefined);
  }

  @Get()
  @ApiOperation({ summary: '행동 조건 목록 조회' })
  @ApiResponse({ status: 200, description: '조건 목록', type: BehaviorConditionListResponseDto })
  async findAll(@Req() req: AuthenticatedAdminRequest, @Query() filter: BehaviorConditionFilterDto): Promise<BehaviorConditionListResponseDto> {
    return this.behaviorConditionsService.findAll(filter, req.organizationScopeIds ?? undefined);
  }

  @Get('stats')
  @ApiOperation({ summary: '행동 조건 통계 조회' })
  @ApiResponse({ status: 200, description: '조건 통계', type: BehaviorConditionStatsDto })
  async getStats(@Req() req: AuthenticatedAdminRequest): Promise<BehaviorConditionStatsDto> {
    return this.behaviorConditionsService.getStats(req.organizationScopeIds ?? undefined);
  }

  @Get('organization/:organizationId')
  @ApiOperation({ summary: '조직별 행동 조건 목록 조회' })
  @ApiParam({ name: 'organizationId', description: '조직 ID' })
  @ApiResponse({ status: 200, description: '조직별 조건 목록', type: [BehaviorConditionResponseDto] })
  async findByOrganization(
    @Req() req: AuthenticatedAdminRequest,
    @Param('organizationId') organizationId: string,
  ): Promise<BehaviorConditionResponseDto[]> {
    return this.behaviorConditionsService.findByOrganization(
      organizationId,
      req.organizationScopeIds ?? undefined,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: '행동 조건 상세 조회' })
  @ApiParam({ name: 'id', description: '조건 ID' })
  @ApiResponse({ status: 200, description: '조건 상세 정보', type: BehaviorConditionResponseDto })
  @ApiResponse({ status: 404, description: '조건을 찾을 수 없음' })
  async findOne(@Req() req: AuthenticatedAdminRequest, @Param('id') id: string): Promise<BehaviorConditionResponseDto> {
    return this.behaviorConditionsService.findOne(id, req.organizationScopeIds ?? undefined);
  }

  @Patch(':id')
  @ApiOperation({ summary: '행동 조건 수정' })
  @ApiParam({ name: 'id', description: '조건 ID' })
  @ApiResponse({ status: 200, description: '조건 수정 성공', type: BehaviorConditionResponseDto })
  @ApiResponse({ status: 404, description: '조건을 찾을 수 없음' })
  async update(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() updateDto: UpdateBehaviorConditionDto,
  ): Promise<BehaviorConditionResponseDto> {
    return this.behaviorConditionsService.update(id, updateDto, req.organizationScopeIds ?? undefined);
  }

  @Patch(':id/toggle-active')
  @ApiOperation({ summary: '행동 조건 활성/비활성 토글' })
  @ApiParam({ name: 'id', description: '조건 ID' })
  @ApiResponse({ status: 200, description: '상태 변경 성공', type: BehaviorConditionResponseDto })
  async toggleActive(@Req() req: AuthenticatedAdminRequest, @Param('id') id: string): Promise<BehaviorConditionResponseDto> {
    return this.behaviorConditionsService.toggleActive(id, req.organizationScopeIds ?? undefined);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '행동 조건 삭제' })
  @ApiParam({ name: 'id', description: '조건 ID' })
  @ApiResponse({ status: 204, description: '조건 삭제 성공' })
  @ApiResponse({ status: 404, description: '조건을 찾을 수 없음' })
  async remove(@Req() req: AuthenticatedAdminRequest, @Param('id') id: string): Promise<void> {
    return this.behaviorConditionsService.remove(id, req.organizationScopeIds ?? undefined);
  }
}
