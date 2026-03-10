import { Module } from '@nestjs/common';
import { ZonesService } from './zones.service';
import { ZonesController } from './zones.controller';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { ControlPoliciesModule } from '../control-policies/control-policies.module';

@Module({
  imports: [ControlPoliciesModule],
  controllers: [ZonesController],
  providers: [ZonesService, OrganizationScopeGuard],
  exports: [ZonesService],
})
export class ZonesModule {}
