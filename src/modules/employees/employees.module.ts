import { Module } from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { EmployeesController } from './employees.controller';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { EmployeesHardDeleteScheduler } from './employees-hard-delete.scheduler';

@Module({
  controllers: [EmployeesController],
  providers: [EmployeesService, OrganizationScopeGuard, EmployeesHardDeleteScheduler],
  exports: [EmployeesService],
})
export class EmployeesModule {}
