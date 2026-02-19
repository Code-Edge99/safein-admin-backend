import { Module } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';
import { RolesGuard } from '../auth/guards/roles.guard';

@Module({
  controllers: [AccountsController],
  providers: [AccountsService, RolesGuard],
  exports: [AccountsService],
})
export class AccountsModule {}
