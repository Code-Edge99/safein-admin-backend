import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthenticatedAdminRequest } from '../../common/types/authenticated-request.type';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  ReportMetricSettingsDto,
  ReportMetricSettingsResponseDto,
} from './dto/report-metric-settings.dto';
import { ReportMetricSettingsService } from './report-metric-settings.service';

@ApiTags('리포트 산정 기준')
@Controller('system-settings/report-metrics')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ReportMetricSettingsController {
  constructor(private readonly reportMetricSettingsService: ReportMetricSettingsService) {}

  @Get()
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: '리포트 산정 기준 조회' })
  @ApiResponse({ status: 200, type: ReportMetricSettingsResponseDto })
  findCurrent(): Promise<ReportMetricSettingsResponseDto> {
    return this.reportMetricSettingsService.findCurrent();
  }

  @Put()
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: '리포트 산정 기준 수정' })
  @ApiResponse({ status: 200, type: ReportMetricSettingsResponseDto })
  update(
    @Req() req: AuthenticatedAdminRequest,
    @Body() body: ReportMetricSettingsDto,
  ): Promise<ReportMetricSettingsResponseDto> {
    return this.reportMetricSettingsService.update(body, { id: req.user?.id });
  }
}