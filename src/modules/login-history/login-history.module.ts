import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LoginHistoryController } from './login-history.controller';
import { LoginHistoryService } from './login-history.service';

@Module({
  imports: [PrismaModule],
  controllers: [LoginHistoryController],
  providers: [LoginHistoryService],
  exports: [LoginHistoryService],
})
export class LoginHistoryModule {}
