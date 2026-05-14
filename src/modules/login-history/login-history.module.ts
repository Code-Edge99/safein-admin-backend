import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LoginHistoryController } from './login-history.controller';
import { LoginHistoryService } from './login-history.service';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

@Module({
  imports: [PrismaModule],
  controllers: [LoginHistoryController],
  providers: [LoginHistoryService, OrganizationScopeGuard, RolesGuard],
})
export class LoginHistoryModule {}
