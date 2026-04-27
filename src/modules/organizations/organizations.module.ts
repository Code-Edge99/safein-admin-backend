import { Module } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { ControlPoliciesModule } from '../control-policies/control-policies.module';

@Module({
  imports: [ControlPoliciesModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, OrganizationScopeGuard],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
