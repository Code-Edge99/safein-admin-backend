import { Module } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';

@Module({
  controllers: [AccountsController],
  providers: [AccountsService, RolesGuard, OrganizationScopeGuard],
  exports: [AccountsService],
})
export class AccountsModule {}
