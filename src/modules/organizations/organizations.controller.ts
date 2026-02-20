import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Req,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
  OrganizationResponseDto,
  OrganizationTreeDto,
  OrganizationStatsDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';

@ApiTags('조직')
@Controller('organizations')
@UseGuards(JwtAuthGuard, OrganizationScopeGuard)
@ApiBearerAuth()
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  @ApiOperation({ summary: '조직 생성' })
  @ApiResponse({ status: 201, description: '조직 생성 성공', type: OrganizationResponseDto })
  create(@Req() req: any, @Body() createOrganizationDto: CreateOrganizationDto): Promise<OrganizationResponseDto> {
    return this.organizationsService.create(createOrganizationDto, req.organizationScopeIds ?? undefined);
  }

  @Get()
  @ApiOperation({ summary: '전체 조직 목록 조회' })
  @ApiResponse({ status: 200, description: '조직 목록', type: [OrganizationResponseDto] })
  findAll(@Req() req: any): Promise<OrganizationResponseDto[]> {
    return this.organizationsService.findAll(req.organizationScopeIds ?? undefined);
  }

  @Get('tree')
  @ApiOperation({ summary: '조직 트리 조회' })
  @ApiResponse({ status: 200, description: '조직 트리', type: [OrganizationTreeDto] })
  findTree(@Req() req: any): Promise<OrganizationTreeDto[]> {
    return this.organizationsService.findTree(req.organizationScopeIds ?? undefined);
  }

  @Get(':id')
  @ApiOperation({ summary: '조직 상세 조회' })
  @ApiParam({ name: 'id', description: '조직 ID' })
  @ApiResponse({ status: 200, description: '조직 상세', type: OrganizationResponseDto })
  @ApiResponse({ status: 404, description: '조직을 찾을 수 없음' })
  findOne(@Req() req: any, @Param('id', ParseUUIDPipe) id: string): Promise<OrganizationResponseDto> {
    return this.organizationsService.findOne(id, req.organizationScopeIds ?? undefined);
  }

  @Get(':id/stats')
  @ApiOperation({ summary: '조직 통계 조회' })
  @ApiParam({ name: 'id', description: '조직 ID' })
  @ApiResponse({ status: 200, description: '조직 통계', type: OrganizationStatsDto })
  findOneWithStats(@Req() req: any, @Param('id', ParseUUIDPipe) id: string): Promise<OrganizationStatsDto> {
    return this.organizationsService.findOneWithStats(id, req.organizationScopeIds ?? undefined);
  }

  @Get(':id/ancestors')
  @ApiOperation({ summary: '상위 조직 목록 조회' })
  @ApiParam({ name: 'id', description: '조직 ID' })
  @ApiResponse({ status: 200, description: '상위 조직 목록', type: [OrganizationResponseDto] })
  getAncestors(@Req() req: any, @Param('id', ParseUUIDPipe) id: string): Promise<OrganizationResponseDto[]> {
    return this.organizationsService.getAncestors(id, req.organizationScopeIds ?? undefined);
  }

  @Get(':id/descendants')
  @ApiOperation({ summary: '하위 조직 목록 조회' })
  @ApiParam({ name: 'id', description: '조직 ID' })
  @ApiResponse({ status: 200, description: '하위 조직 목록', type: [OrganizationResponseDto] })
  getDescendants(@Req() req: any, @Param('id', ParseUUIDPipe) id: string): Promise<OrganizationResponseDto[]> {
    return this.organizationsService.getDescendants(id, req.organizationScopeIds ?? undefined);
  }

  @Patch(':id')
  @ApiOperation({ summary: '조직 수정' })
  @ApiParam({ name: 'id', description: '조직 ID' })
  @ApiResponse({ status: 200, description: '조직 수정 성공', type: OrganizationResponseDto })
  update(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateOrganizationDto: UpdateOrganizationDto,
  ): Promise<OrganizationResponseDto> {
    return this.organizationsService.update(id, updateOrganizationDto, req.organizationScopeIds ?? undefined);
  }

  @Delete(':id')
  @ApiOperation({ summary: '조직 삭제' })
  @ApiParam({ name: 'id', description: '조직 ID' })
  @ApiResponse({ status: 200, description: '조직 삭제 성공' })
  @ApiResponse({ status: 400, description: '삭제 불가 (하위 조직 또는 직원 존재)' })
  remove(@Req() req: any, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.organizationsService.remove(id, req.organizationScopeIds ?? undefined);
  }
}
