import { Module } from '@nestjs/common';
import { BehaviorConditionsService } from './behavior-conditions.service';
import { BehaviorConditionsController } from './behavior-conditions.controller';

@Module({
  controllers: [BehaviorConditionsController],
  providers: [BehaviorConditionsService],
  exports: [BehaviorConditionsService],
})
export class BehaviorConditionsModule {}
