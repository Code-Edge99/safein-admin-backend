import { Module } from '@nestjs/common';
import { HarmfulAppsService } from './harmful-apps.service';
import { HarmfulAppsController } from './harmful-apps.controller';
import { HarmfulAppPresetsService } from './harmful-app-presets.service';
import { HarmfulAppPresetsController } from './harmful-app-presets.controller';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@Module({
  controllers: [HarmfulAppsController, HarmfulAppPresetsController],
  providers: [HarmfulAppsService, HarmfulAppPresetsService, OrganizationScopeGuard, RolesGuard],
  exports: [HarmfulAppsService, HarmfulAppPresetsService],
})
export class HarmfulAppsModule {}
