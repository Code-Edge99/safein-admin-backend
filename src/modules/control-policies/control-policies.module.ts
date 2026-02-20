import { Module } from '@nestjs/common';
import { ControlPoliciesService } from './control-policies.service';
import { ControlPoliciesController } from './control-policies.controller';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';

@Module({
  controllers: [ControlPoliciesController],
  providers: [ControlPoliciesService, OrganizationScopeGuard],
  exports: [ControlPoliciesService],
})
export class ControlPoliciesModule {}
