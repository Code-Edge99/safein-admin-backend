import { Module } from '@nestjs/common';
import { ControlPoliciesService } from './control-policies.service';
import { ControlPoliciesController } from './control-policies.controller';

@Module({
  controllers: [ControlPoliciesController],
  providers: [ControlPoliciesService],
  exports: [ControlPoliciesService],
})
export class ControlPoliciesModule {}
