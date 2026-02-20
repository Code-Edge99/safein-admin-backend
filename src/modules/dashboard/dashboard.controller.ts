import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { DashboardService } from './dashboard.service';

@ApiTags('대시보드')
@Controller('dashboard')
@UseGuards(JwtAuthGuard, OrganizationScopeGuard)
@ApiBearerAuth()
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  @ApiOperation({ summary: '대시보드 통계' })
  getStats(@Req() req: any) {
    return this.dashboardService.getStats(req.organizationScopeIds ?? undefined);
  }

  @Get('hourly-data')
  @ApiOperation({ summary: '시간대별 차단 통계' })
  getHourlyData(
    @Req() req: any,
    @Query('organizationId') organizationId?: string,
    @Query('date') date?: string,
  ) {
    return this.dashboardService.getHourlyData(
      organizationId,
      date,
      req.organizationScopeIds ?? undefined,
    );
  }

  @Get('zone-violations')
  @ApiOperation({ summary: '구역별 위반 통계' })
  getZoneViolationData(
    @Req() req: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.dashboardService.getZoneViolationData(
      startDate,
      endDate,
      req.organizationScopeIds ?? undefined,
    );
  }

  @Get('organization-stats')
  @ApiOperation({ summary: '조직 일별 통계' })
  getOrganizationStats(
    @Req() req: any,
    @Query('organizationId') organizationId?: string,
    @Query('days') days?: number,
  ) {
    return this.dashboardService.getOrganizationDailyStats(
      organizationId,
      days ? Number(days) : 30,
      req.organizationScopeIds ?? undefined,
    );
  }

  @Get('employee-stats')
  @ApiOperation({ summary: '직원 리포트 통계' })
  getEmployeeStats(
    @Req() req: any,
    @Query('employeeId') employeeId?: string,
    @Query('organizationId') organizationId?: string,
    @Query('days') days?: number,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.dashboardService.getEmployeeDailyStats({
      employeeId,
      organizationId,
      days: days ? Number(days) : 7,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
      scopeOrganizationIds: req.organizationScopeIds ?? undefined,
    });
  }

  @Get('employee-report/:employeeId')
  @ApiOperation({ summary: '직원 리포트 상세 (Employee + ControlLog + DailyStat 기반)' })
  getEmployeeReportDetail(@Param('employeeId') employeeId: string, @Req() req: any) {
    return this.dashboardService.getEmployeeReportDetail(
      employeeId,
      req.organizationScopeIds ?? undefined,
    );
  }

  @Get('site-reports')
  @ApiOperation({ summary: '현장 리포트' })
  getSiteReports(@Req() req: any) {
    return this.dashboardService.getSiteReports(req.organizationScopeIds ?? undefined);
  }
}
