import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { AuditLogsService } from './audit-logs.service';
import { AuthenticatedAdminRequest } from '../../common/types/authenticated-request.type';

@ApiTags('감사 로그')
@Controller('audit-logs')
@UseGuards(JwtAuthGuard, OrganizationScopeGuard)
@ApiBearerAuth()
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @ApiOperation({ summary: '감사 로그 목록 조회' })
  findAll(
    @Req() req: AuthenticatedAdminRequest,
    @Query('search') search?: string,
    @Query('action') action?: string,
    @Query('resourceType') resourceType?: string,
    @Query('organizationId') organizationId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.auditLogsService.findAll({
      search,
      action,
      resourceType,
      organizationId,
      startDate,
      endDate,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    }, req.organizationScopeIds ?? undefined);
  }

  @Get(':id')
  @ApiOperation({ summary: '감사 로그 상세 조회' })
  findOne(@Req() req: AuthenticatedAdminRequest, @Param('id') id: string) {
    return this.auditLogsService.findOne(id, req.organizationScopeIds ?? undefined);
  }
}
