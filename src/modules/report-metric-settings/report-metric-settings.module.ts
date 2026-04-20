import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ReportMetricSettingsController } from './report-metric-settings.controller';
import { ReportMetricSettingsService } from './report-metric-settings.service';

@Module({
  imports: [PrismaModule],
  controllers: [ReportMetricSettingsController],
  providers: [ReportMetricSettingsService, RolesGuard],
  exports: [ReportMetricSettingsService],
})
export class ReportMetricSettingsModule {}