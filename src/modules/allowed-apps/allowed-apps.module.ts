import { Module } from '@nestjs/common';
import { AllowedAppsService } from './allowed-apps.service';
import { AllowedAppsController } from './allowed-apps.controller';
import { AllowedAppPresetsService } from './allowed-app-presets.service';
import { AllowedAppPresetsController } from './allowed-app-presets.controller';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { EffectivePermissionsGuard } from '../auth/guards/effective-permissions.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ControlPoliciesModule } from '../control-policies/control-policies.module';
import { PermissionsModule } from '../permissions/permissions.module';

@Module({
  imports: [ControlPoliciesModule, PermissionsModule],
  controllers: [AllowedAppsController, AllowedAppPresetsController],
  providers: [AllowedAppsService, AllowedAppPresetsService, OrganizationScopeGuard, EffectivePermissionsGuard, RolesGuard],
  exports: [AllowedAppsService, AllowedAppPresetsService],
})
export class AllowedAppsModule {}
