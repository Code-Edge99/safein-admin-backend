import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { LoginHistoryService } from './login-history.service';
import { AuthenticatedAdminRequest } from '../../common/types/authenticated-request.type';

@ApiTags('관리자 로그인 이력')
@Controller('login-history')
@UseGuards(JwtAuthGuard, RolesGuard, OrganizationScopeGuard)
@Roles('SUPER_ADMIN')
@ApiBearerAuth()
export class LoginHistoryController {
  constructor(private readonly loginHistoryService: LoginHistoryService) {}

  @Get()
  @ApiOperation({ summary: '관리자 로그인 이력 목록 조회' })
  findAll(
    @Req() req: AuthenticatedAdminRequest,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('accountId') accountId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.loginHistoryService.findAll({
      search,
      status,
      accountId,
      startDate,
      endDate,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    }, req.organizationScopeIds ?? undefined);
  }
}
