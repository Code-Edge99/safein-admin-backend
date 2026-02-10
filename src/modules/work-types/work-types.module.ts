import { Module } from '@nestjs/common';
import { WorkTypesService } from './work-types.service';
import { WorkTypesController } from './work-types.controller';

@Module({
  controllers: [WorkTypesController],
  providers: [WorkTypesService],
  exports: [WorkTypesService],
})
export class WorkTypesModule {}
