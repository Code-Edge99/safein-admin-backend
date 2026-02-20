import { Module } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';

@Module({
  controllers: [OrganizationsController],
  providers: [OrganizationsService, OrganizationScopeGuard],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
