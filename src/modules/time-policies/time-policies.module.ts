import { Module } from '@nestjs/common';
import { TimePoliciesService } from './time-policies.service';
import { TimePoliciesController } from './time-policies.controller';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';

@Module({
  controllers: [TimePoliciesController],
  providers: [TimePoliciesService, OrganizationScopeGuard],
  exports: [TimePoliciesService],
})
export class TimePoliciesModule {}
