import { Module } from '@nestjs/common';
import { HarmfulAppsService } from './harmful-apps.service';
import { HarmfulAppsController } from './harmful-apps.controller';
import { HarmfulAppPresetsService } from './harmful-app-presets.service';
import { HarmfulAppPresetsController } from './harmful-app-presets.controller';

@Module({
  controllers: [HarmfulAppsController, HarmfulAppPresetsController],
  providers: [HarmfulAppsService, HarmfulAppPresetsService],
  exports: [HarmfulAppsService, HarmfulAppPresetsService],
})
export class HarmfulAppsModule {}
