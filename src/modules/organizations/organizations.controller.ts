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
  TransferResourcesDto,
  TransferResourcesResultDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { AuthenticatedAdminRequest } from '../../common/types/authenticated-request.type';

@ApiTags('현장')
@Controller('organizations')
@UseGuards(JwtAuthGuard, OrganizationScopeGuard)
@ApiBearerAuth()
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  @ApiOperation({ summary: '현장 생성' })
  @ApiResponse({ status: 201, description: '현장 생성 성공', type: OrganizationResponseDto })
  create(@Req() req: AuthenticatedAdminRequest, @Body() createOrganizationDto: CreateOrganizationDto): Promise<OrganizationResponseDto> {
    return this.organizationsService.create(
      createOrganizationDto,
      req.organizationScopeIds ?? undefined,
      req.user?.id,
    );
  }

  @Get()
  @ApiOperation({ summary: '전체 현장 목록 조회' })
  @ApiResponse({ status: 200, description: '현장 목록', type: [OrganizationResponseDto] })
  findAll(@Req() req: AuthenticatedAdminRequest): Promise<OrganizationResponseDto[]> {
    return this.organizationsService.findAll(req.organizationScopeIds ?? undefined);
  }

  @Get('tree')
  @ApiOperation({ summary: '현장 트리 조회' })
  @ApiResponse({ status: 200, description: '현장 트리', type: [OrganizationTreeDto] })
  findTree(@Req() req: AuthenticatedAdminRequest): Promise<OrganizationTreeDto[]> {
    return this.organizationsService.findTree(req.organizationScopeIds ?? undefined);
  }

  @Get(':id')
  @ApiOperation({ summary: '현장 상세 조회' })
  @ApiParam({ name: 'id', description: '현장 ID' })
  @ApiResponse({ status: 200, description: '현장 상세', type: OrganizationResponseDto })
  @ApiResponse({ status: 404, description: '현장을 찾을 수 없음' })
  findOne(@Req() req: AuthenticatedAdminRequest, @Param('id') id: string): Promise<OrganizationResponseDto> {
    return this.organizationsService.findOne(id, req.organizationScopeIds ?? undefined);
  }

  @Get(':id/stats')
  @ApiOperation({ summary: '현장 통계 조회' })
  @ApiParam({ name: 'id', description: '현장 ID' })
  @ApiResponse({ status: 200, description: '현장 통계', type: OrganizationStatsDto })
  findOneWithStats(@Req() req: AuthenticatedAdminRequest, @Param('id') id: string): Promise<OrganizationStatsDto> {
    return this.organizationsService.findOneWithStats(id, req.organizationScopeIds ?? undefined);
  }

  @Get(':id/ancestors')
  @ApiOperation({ summary: '상위 현장 목록 조회' })
  @ApiParam({ name: 'id', description: '현장 ID' })
  @ApiResponse({ status: 200, description: '상위 현장 목록', type: [OrganizationResponseDto] })
  getAncestors(@Req() req: AuthenticatedAdminRequest, @Param('id') id: string): Promise<OrganizationResponseDto[]> {
    return this.organizationsService.getAncestors(id, req.organizationScopeIds ?? undefined);
  }

  @Get(':id/descendants')
  @ApiOperation({ summary: '하위 현장 목록 조회' })
  @ApiParam({ name: 'id', description: '현장 ID' })
  @ApiResponse({ status: 200, description: '하위 현장 목록', type: [OrganizationResponseDto] })
  getDescendants(@Req() req: AuthenticatedAdminRequest, @Param('id') id: string): Promise<OrganizationResponseDto[]> {
    return this.organizationsService.getDescendants(id, req.organizationScopeIds ?? undefined);
  }

  @Patch(':id')
  @ApiOperation({ summary: '현장 수정' })
  @ApiParam({ name: 'id', description: '현장 ID' })
  @ApiResponse({ status: 200, description: '현장 수정 성공', type: OrganizationResponseDto })
  update(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() updateOrganizationDto: UpdateOrganizationDto,
  ): Promise<OrganizationResponseDto> {
    return this.organizationsService.update(
      id,
      updateOrganizationDto,
      req.organizationScopeIds ?? undefined,
      req.user?.id,
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: '현장 삭제' })
  @ApiParam({ name: 'id', description: '현장 ID' })
  @ApiResponse({ status: 200, description: '현장 삭제 성공' })
  @ApiResponse({ status: 400, description: '삭제 불가 (하위 현장 또는 직원 존재)' })
  remove(@Req() req: AuthenticatedAdminRequest, @Param('id') id: string): Promise<void> {
    return this.organizationsService.remove(id, req.organizationScopeIds ?? undefined);
  }

  @Post(':id/transfer-resources')
  @ApiOperation({ summary: '직원 이관', description: '원본 현장의 직원을 대상 현장으로 이관합니다. 이관된 직원은 대상 현장의 정책을 따릅니다.' })
  @ApiParam({ name: 'id', description: '원본 현장 ID' })
  @ApiResponse({ status: 201, description: '이관 성공', type: TransferResourcesResultDto })
  transferResources(
    @Req() req: AuthenticatedAdminRequest,
    @Param('id') id: string,
    @Body() dto: TransferResourcesDto,
  ): Promise<TransferResourcesResultDto> {
    return this.organizationsService.transferResources(
      id,
      dto,
      req.organizationScopeIds ?? undefined,
    );
  }
}
