import { Module } from '@nestjs/common';
import { HarmfulAppsService } from './harmful-apps.service';
import { HarmfulAppsController } from './harmful-apps.controller';
import { AllowedAppPresetsService } from './harmful-app-presets.service';
import { AllowedAppPresetsController } from './harmful-app-presets.controller';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@Module({
  controllers: [HarmfulAppsController, AllowedAppPresetsController],
  providers: [HarmfulAppsService, AllowedAppPresetsService, OrganizationScopeGuard, RolesGuard],
  exports: [HarmfulAppsService, AllowedAppPresetsService],
})
export class HarmfulAppsModule {}
