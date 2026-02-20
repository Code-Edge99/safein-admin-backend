import { Module } from '@nestjs/common';
import { ControlLogsService } from './control-logs.service';
import { ControlLogsController } from './control-logs.controller';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';

@Module({
  controllers: [ControlLogsController],
  providers: [ControlLogsService, OrganizationScopeGuard],
  exports: [ControlLogsService],
})
export class ControlLogsModule {}
