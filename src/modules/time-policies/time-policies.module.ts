import { Module } from '@nestjs/common';
import { TimePoliciesService } from './time-policies.service';
import { TimePoliciesController } from './time-policies.controller';

@Module({
  controllers: [TimePoliciesController],
  providers: [TimePoliciesService],
  exports: [TimePoliciesService],
})
export class TimePoliciesModule {}
