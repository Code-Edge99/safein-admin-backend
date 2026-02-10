import { Module } from '@nestjs/common';
import { ControlLogsService } from './control-logs.service';
import { ControlLogsController } from './control-logs.controller';

@Module({
  controllers: [ControlLogsController],
  providers: [ControlLogsService],
  exports: [ControlLogsService],
})
export class ControlLogsModule {}
