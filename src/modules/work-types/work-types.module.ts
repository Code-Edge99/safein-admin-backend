import { Module } from '@nestjs/common';
import { WorkTypesService } from './work-types.service';
import { WorkTypesController } from './work-types.controller';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';

@Module({
  controllers: [WorkTypesController],
  providers: [WorkTypesService, OrganizationScopeGuard],
  exports: [WorkTypesService],
})
export class WorkTypesModule {}
