import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RequestBoardController } from './request-board.controller';
import { RequestBoardService } from './request-board.service';

@Module({
  imports: [PrismaModule],
  controllers: [RequestBoardController],
  providers: [RequestBoardService],
  exports: [RequestBoardService],
})
export class RequestBoardModule {}