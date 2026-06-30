import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { EffectivePermissionsGuard } from '../auth/guards/effective-permissions.guard';
import { PermissionsModule } from '../permissions/permissions.module';
import { SafetyChecklistsController } from './safety-checklists.controller';
import { SafetyChecklistsService } from './safety-checklists.service';

@Module({
  imports: [PrismaModule, PermissionsModule],
  controllers: [SafetyChecklistsController],
  providers: [SafetyChecklistsService, EffectivePermissionsGuard],
  exports: [SafetyChecklistsService],
})
export class SafetyChecklistsModule {}
