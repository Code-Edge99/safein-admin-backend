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

@ApiTags('Behavior Conditions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('behavior-conditions')
export class BehaviorConditionsController {
  constructor(private readonly behaviorConditionsService: BehaviorConditionsService) {}

  @Post()
  @ApiOperation({ summary: '행동 조건 생성' })
  @ApiResponse({ status: 201, description: '조건 생성 성공', type: BehaviorConditionResponseDto })
  async create(@Body() createDto: CreateBehaviorConditionDto): Promise<BehaviorConditionResponseDto> {
    return this.behaviorConditionsService.create(createDto);
  }

  @Get()
  @ApiOperation({ summary: '행동 조건 목록 조회' })
  @ApiResponse({ status: 200, description: '조건 목록', type: BehaviorConditionListResponseDto })
  async findAll(@Query() filter: BehaviorConditionFilterDto): Promise<BehaviorConditionListResponseDto> {
    return this.behaviorConditionsService.findAll(filter);
  }

  @Get('stats')
  @ApiOperation({ summary: '행동 조건 통계 조회' })
  @ApiResponse({ status: 200, description: '조건 통계', type: BehaviorConditionStatsDto })
  async getStats(): Promise<BehaviorConditionStatsDto> {
    return this.behaviorConditionsService.getStats();
  }

  @Get('organization/:organizationId')
  @ApiOperation({ summary: '조직별 행동 조건 목록 조회' })
  @ApiParam({ name: 'organizationId', description: '조직 ID' })
  @ApiResponse({ status: 200, description: '조직별 조건 목록', type: [BehaviorConditionResponseDto] })
  async findByOrganization(
    @Param('organizationId') organizationId: string,
  ): Promise<BehaviorConditionResponseDto[]> {
    return this.behaviorConditionsService.findByOrganization(organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: '행동 조건 상세 조회' })
  @ApiParam({ name: 'id', description: '조건 ID' })
  @ApiResponse({ status: 200, description: '조건 상세 정보', type: BehaviorConditionResponseDto })
  @ApiResponse({ status: 404, description: '조건을 찾을 수 없음' })
  async findOne(@Param('id') id: string): Promise<BehaviorConditionResponseDto> {
    return this.behaviorConditionsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '행동 조건 수정' })
  @ApiParam({ name: 'id', description: '조건 ID' })
  @ApiResponse({ status: 200, description: '조건 수정 성공', type: BehaviorConditionResponseDto })
  @ApiResponse({ status: 404, description: '조건을 찾을 수 없음' })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateBehaviorConditionDto,
  ): Promise<BehaviorConditionResponseDto> {
    return this.behaviorConditionsService.update(id, updateDto);
  }

  @Patch(':id/toggle-active')
  @ApiOperation({ summary: '행동 조건 활성/비활성 토글' })
  @ApiParam({ name: 'id', description: '조건 ID' })
  @ApiResponse({ status: 200, description: '상태 변경 성공', type: BehaviorConditionResponseDto })
  async toggleActive(@Param('id') id: string): Promise<BehaviorConditionResponseDto> {
    return this.behaviorConditionsService.toggleActive(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '행동 조건 삭제' })
  @ApiParam({ name: 'id', description: '조건 ID' })
  @ApiResponse({ status: 204, description: '조건 삭제 성공' })
  @ApiResponse({ status: 404, description: '조건을 찾을 수 없음' })
  async remove(@Param('id') id: string): Promise<void> {
    return this.behaviorConditionsService.remove(id);
  }
}
