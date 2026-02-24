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
  ApiQuery,
} from '@nestjs/swagger';
import { WorkTypesService } from './work-types.service';
import {
  CreateWorkTypeDto,
  UpdateWorkTypeDto,
  WorkTypeResponseDto,
  WorkTypeDetailDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';

@ApiTags('근무 유형')
@Controller('work-types')
@UseGuards(JwtAuthGuard, OrganizationScopeGuard)
@ApiBearerAuth()
export class WorkTypesController {
  constructor(private readonly workTypesService: WorkTypesService) {}

  @Post()
  @ApiOperation({ summary: '근무 유형 생성' })
  @ApiResponse({ status: 201, description: '근무 유형 생성 성공', type: WorkTypeResponseDto })
  create(@Req() req: any, @Body() createWorkTypeDto: CreateWorkTypeDto): Promise<WorkTypeResponseDto> {
    return this.workTypesService.create(createWorkTypeDto, req.organizationScopeIds ?? undefined);
  }

  @Get()
  @ApiOperation({ summary: '근무 유형 목록 조회' })
  @ApiQuery({ name: 'organizationId', required: false, description: '조직 ID로 필터링' })
  @ApiResponse({ status: 200, description: '근무 유형 목록', type: [WorkTypeResponseDto] })
  findAll(@Req() req: any, @Query('organizationId') organizationId?: string): Promise<WorkTypeResponseDto[]> {
    return this.workTypesService.findAll(organizationId, req.organizationScopeIds ?? undefined);
  }

  @Get('organization/:orgId')
  @ApiOperation({ summary: '조직별 근무 유형 조회' })
  @ApiParam({ name: 'orgId', description: '조직 ID' })
  @ApiResponse({ status: 200, description: '근무 유형 목록', type: [WorkTypeResponseDto] })
  findByOrganization(@Req() req: any, @Param('orgId') orgId: string): Promise<WorkTypeResponseDto[]> {
    return this.workTypesService.findAll(orgId, req.organizationScopeIds ?? undefined);
  }

  @Get(':id')
  @ApiOperation({ summary: '근무 유형 상세 조회' })
  @ApiParam({ name: 'id', description: '근무 유형 ID' })
  @ApiResponse({ status: 200, description: '근무 유형 상세', type: WorkTypeDetailDto })
  @ApiResponse({ status: 404, description: '근무 유형을 찾을 수 없음' })
  findOne(@Req() req: any, @Param('id') id: string): Promise<WorkTypeDetailDto> {
    return this.workTypesService.findOne(id, req.organizationScopeIds ?? undefined);
  }

  @Patch(':id')
  @ApiOperation({ summary: '근무 유형 수정' })
  @ApiParam({ name: 'id', description: '근무 유형 ID' })
  @ApiResponse({ status: 200, description: '근무 유형 수정 성공', type: WorkTypeResponseDto })
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() updateWorkTypeDto: UpdateWorkTypeDto,
  ): Promise<WorkTypeResponseDto> {
    return this.workTypesService.update(id, updateWorkTypeDto, req.organizationScopeIds ?? undefined);
  }

  @Patch(':id/toggle-active')
  @ApiOperation({ summary: '근무 유형 활성/비활성 토글' })
  @ApiParam({ name: 'id', description: '근무 유형 ID' })
  @ApiResponse({ status: 200, description: '상태 변경 성공', type: WorkTypeResponseDto })
  toggleActive(@Req() req: any, @Param('id') id: string): Promise<WorkTypeResponseDto> {
    return this.workTypesService.toggleActive(id, req.organizationScopeIds ?? undefined);
  }

  @Delete(':id')
  @ApiOperation({ summary: '근무 유형 삭제' })
  @ApiParam({ name: 'id', description: '근무 유형 ID' })
  @ApiResponse({ status: 200, description: '근무 유형 삭제 성공' })
  @ApiResponse({ status: 400, description: '사용 중인 직원이 있어 삭제 불가' })
  remove(@Req() req: any, @Param('id') id: string): Promise<void> {
    return this.workTypesService.remove(id, req.organizationScopeIds ?? undefined);
  }
}
