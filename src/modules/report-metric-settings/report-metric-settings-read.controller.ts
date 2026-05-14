import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReportMetricSettingsResponseDto } from './dto/report-metric-settings.dto';
import { ReportMetricSettingsService } from './report-metric-settings.service';

@ApiTags('리포트 산정 기준')
@Controller('report-metric-settings')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ReportMetricSettingsReadController {
  constructor(private readonly reportMetricSettingsService: ReportMetricSettingsService) {}

  @Get('shared')
  @ApiOperation({ summary: '리포트/대시보드 공통 산정 기준 조회' })
  @ApiResponse({ status: 200, type: ReportMetricSettingsResponseDto })
  findSharedCurrent(): Promise<ReportMetricSettingsResponseDto> {
    return this.reportMetricSettingsService.findCurrent();
  }
}