import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ReportMetricSettingsReadController } from './report-metric-settings-read.controller';
import { ReportMetricSettingsController } from './report-metric-settings.controller';
import { ReportMetricSettingsService } from './report-metric-settings.service';

@Module({
  imports: [PrismaModule],
  controllers: [ReportMetricSettingsController, ReportMetricSettingsReadController],
  providers: [ReportMetricSettingsService, RolesGuard],
  exports: [ReportMetricSettingsService],
})
export class ReportMetricSettingsModule {}