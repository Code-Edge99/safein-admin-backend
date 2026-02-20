import { Module } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { DevicesController } from './devices.controller';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';

@Module({
  controllers: [DevicesController],
  providers: [DevicesService, OrganizationScopeGuard],
  exports: [DevicesService],
})
export class DevicesModule {}
