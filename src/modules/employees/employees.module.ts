import { Module } from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { EmployeesController } from './employees.controller';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';

@Module({
  controllers: [EmployeesController],
  providers: [EmployeesService, OrganizationScopeGuard],
  exports: [EmployeesService],
})
export class EmployeesModule {}
