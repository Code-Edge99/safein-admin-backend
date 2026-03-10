import { Module } from '@nestjs/common';
import { TimePoliciesService } from './time-policies.service';
import { TimePoliciesController } from './time-policies.controller';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { ControlPoliciesModule } from '../control-policies/control-policies.module';

@Module({
  imports: [ControlPoliciesModule],
  controllers: [TimePoliciesController],
  providers: [TimePoliciesService, OrganizationScopeGuard],
  exports: [TimePoliciesService],
})
export class TimePoliciesModule {}
