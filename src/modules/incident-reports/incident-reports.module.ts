import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { IncidentReportsController } from './incident-reports.controller';
import { IncidentReportsService } from './incident-reports.service';

@Module({
  imports: [PrismaModule],
  controllers: [IncidentReportsController],
  providers: [IncidentReportsService],
})
export class IncidentReportsModule {}