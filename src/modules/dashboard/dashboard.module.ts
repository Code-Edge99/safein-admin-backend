import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { ReportMetricSettingsModule } from '../report-metric-settings/report-metric-settings.module';

@Module({
  imports: [PrismaModule, ReportMetricSettingsModule],
  controllers: [DashboardController],
  providers: [DashboardService, OrganizationScopeGuard],
  exports: [DashboardService],
})
export class DashboardModule {}
