import { Module } from '@nestjs/common';
import { BehaviorConditionsService } from './behavior-conditions.service';
import { BehaviorConditionsController } from './behavior-conditions.controller';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { ControlPoliciesModule } from '../control-policies/control-policies.module';

@Module({
  imports: [ControlPoliciesModule],
  controllers: [BehaviorConditionsController],
  providers: [BehaviorConditionsService, OrganizationScopeGuard],
  exports: [BehaviorConditionsService],
})
export class BehaviorConditionsModule {}
