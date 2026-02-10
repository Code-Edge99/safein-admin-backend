import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
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

@ApiTags('조직')
@Controller('organizations')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  @ApiOperation({ summary: '조직 생성' })
  @ApiResponse({ status: 201, description: '조직 생성 성공', type: OrganizationResponseDto })
  create(@Body() createOrganizationDto: CreateOrganizationDto): Promise<OrganizationResponseDto> {
    return this.organizationsService.create(createOrganizationDto);
  }

  @Get()
  @ApiOperation({ summary: '전체 조직 목록 조회' })
  @ApiResponse({ status: 200, description: '조직 목록', type: [OrganizationResponseDto] })
  findAll(): Promise<OrganizationResponseDto[]> {
    return this.organizationsService.findAll();
  }

  @Get('tree')
  @ApiOperation({ summary: '조직 트리 조회' })
  @ApiResponse({ status: 200, description: '조직 트리', type: [OrganizationTreeDto] })
  findTree(): Promise<OrganizationTreeDto[]> {
    return this.organizationsService.findTree();
  }

  @Get(':id')
  @ApiOperation({ summary: '조직 상세 조회' })
  @ApiParam({ name: 'id', description: '조직 ID' })
  @ApiResponse({ status: 200, description: '조직 상세', type: OrganizationResponseDto })
  @ApiResponse({ status: 404, description: '조직을 찾을 수 없음' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<OrganizationResponseDto> {
    return this.organizationsService.findOne(id);
  }

  @Get(':id/stats')
  @ApiOperation({ summary: '조직 통계 조회' })
  @ApiParam({ name: 'id', description: '조직 ID' })
  @ApiResponse({ status: 200, description: '조직 통계', type: OrganizationStatsDto })
  findOneWithStats(@Param('id', ParseUUIDPipe) id: string): Promise<OrganizationStatsDto> {
    return this.organizationsService.findOneWithStats(id);
  }

  @Get(':id/ancestors')
  @ApiOperation({ summary: '상위 조직 목록 조회' })
  @ApiParam({ name: 'id', description: '조직 ID' })
  @ApiResponse({ status: 200, description: '상위 조직 목록', type: [OrganizationResponseDto] })
  getAncestors(@Param('id', ParseUUIDPipe) id: string): Promise<OrganizationResponseDto[]> {
    return this.organizationsService.getAncestors(id);
  }

  @Get(':id/descendants')
  @ApiOperation({ summary: '하위 조직 목록 조회' })
  @ApiParam({ name: 'id', description: '조직 ID' })
  @ApiResponse({ status: 200, description: '하위 조직 목록', type: [OrganizationResponseDto] })
  getDescendants(@Param('id', ParseUUIDPipe) id: string): Promise<OrganizationResponseDto[]> {
    return this.organizationsService.getDescendants(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '조직 수정' })
  @ApiParam({ name: 'id', description: '조직 ID' })
  @ApiResponse({ status: 200, description: '조직 수정 성공', type: OrganizationResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateOrganizationDto: UpdateOrganizationDto,
  ): Promise<OrganizationResponseDto> {
    return this.organizationsService.update(id, updateOrganizationDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '조직 삭제' })
  @ApiParam({ name: 'id', description: '조직 ID' })
  @ApiResponse({ status: 200, description: '조직 삭제 성공' })
  @ApiResponse({ status: 400, description: '삭제 불가 (하위 조직 또는 직원 존재)' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.organizationsService.remove(id);
  }
}
