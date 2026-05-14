import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { EffectivePermissionsGuard } from '../auth/guards/effective-permissions.guard';
import { PermissionsModule } from '../permissions/permissions.module';
import { IncidentReportsController } from './incident-reports.controller';
import { IncidentReportsService } from './incident-reports.service';

@Module({
  imports: [PrismaModule, PermissionsModule],
  controllers: [IncidentReportsController],
  providers: [IncidentReportsService, EffectivePermissionsGuard],
})
export class IncidentReportsModule {}