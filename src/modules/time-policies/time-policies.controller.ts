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

@ApiTags('Time Policies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('time-policies')
export class TimePoliciesController {
  constructor(private readonly timePoliciesService: TimePoliciesService) {}

  @Post()
  @ApiOperation({ summary: '시간 정책 생성' })
  @ApiResponse({ status: 201, description: '정책 생성 성공', type: TimePolicyResponseDto })
  async create(@Body() createTimePolicyDto: CreateTimePolicyDto): Promise<TimePolicyResponseDto> {
    return this.timePoliciesService.create(createTimePolicyDto);
  }

  @Get()
  @ApiOperation({ summary: '시간 정책 목록 조회' })
  @ApiResponse({ status: 200, description: '정책 목록', type: TimePolicyListResponseDto })
  async findAll(@Query() filter: TimePolicyFilterDto): Promise<TimePolicyListResponseDto> {
    return this.timePoliciesService.findAll(filter);
  }

  @Get('stats')
  @ApiOperation({ summary: '시간 정책 통계 조회' })
  @ApiResponse({ status: 200, description: '정책 통계', type: TimePolicyStatsDto })
  async getStats(): Promise<TimePolicyStatsDto> {
    return this.timePoliciesService.getStats();
  }

  @Get('organization/:organizationId')
  @ApiOperation({ summary: '조직별 시간 정책 목록 조회' })
  @ApiParam({ name: 'organizationId', description: '조직 ID' })
  @ApiResponse({ status: 200, description: '조직별 정책 목록', type: [TimePolicyResponseDto] })
  async findByOrganization(
    @Param('organizationId') organizationId: string,
  ): Promise<TimePolicyResponseDto[]> {
    return this.timePoliciesService.findByOrganization(organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: '시간 정책 상세 조회' })
  @ApiParam({ name: 'id', description: '정책 ID' })
  @ApiResponse({ status: 200, description: '정책 상세 정보', type: TimePolicyResponseDto })
  @ApiResponse({ status: 404, description: '정책을 찾을 수 없음' })
  async findOne(@Param('id') id: string): Promise<TimePolicyResponseDto> {
    return this.timePoliciesService.findOne(id);
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
    @Param('id') id: string,
    @Body() checkDto: CheckTimeActiveDto,
  ): Promise<{ isActive: boolean }> {
    const checkTime = checkDto.checkTime ? new Date(checkDto.checkTime) : undefined;
    const isActive = await this.timePoliciesService.isTimeActive(id, checkTime);
    return { isActive };
  }

  @Patch(':id')
  @ApiOperation({ summary: '시간 정책 수정' })
  @ApiParam({ name: 'id', description: '정책 ID' })
  @ApiResponse({ status: 200, description: '정책 수정 성공', type: TimePolicyResponseDto })
  @ApiResponse({ status: 404, description: '정책을 찾을 수 없음' })
  async update(
    @Param('id') id: string,
    @Body() updateTimePolicyDto: UpdateTimePolicyDto,
  ): Promise<TimePolicyResponseDto> {
    return this.timePoliciesService.update(id, updateTimePolicyDto);
  }

  @Patch(':id/toggle-active')
  @ApiOperation({ summary: '시간 정책 활성/비활성 토글' })
  @ApiParam({ name: 'id', description: '정책 ID' })
  @ApiResponse({ status: 200, description: '상태 변경 성공', type: TimePolicyResponseDto })
  async toggleActive(@Param('id') id: string): Promise<TimePolicyResponseDto> {
    return this.timePoliciesService.toggleActive(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '시간 정책 삭제' })
  @ApiParam({ name: 'id', description: '정책 ID' })
  @ApiResponse({ status: 204, description: '정책 삭제 성공' })
  @ApiResponse({ status: 404, description: '정책을 찾을 수 없음' })
  async remove(@Param('id') id: string): Promise<void> {
    return this.timePoliciesService.remove(id);
  }
}
