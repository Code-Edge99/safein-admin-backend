import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LoginHistoryController } from './login-history.controller';
import { LoginHistoryService } from './login-history.service';
import { OrganizationScopeGuard } from '../auth/guards/organization-scope.guard';

@Module({
  imports: [PrismaModule],
  controllers: [LoginHistoryController],
  providers: [LoginHistoryService, OrganizationScopeGuard],
  exports: [LoginHistoryService],
})
export class LoginHistoryModule {}
