import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';

@Module({
  imports: [PrismaModule],
  controllers: [AuditLogsController],
  providers: [AuditLogsService, OrganizationScopeGuard],
  exports: [AuditLogsService],
})
export class AuditLogsModule {}
