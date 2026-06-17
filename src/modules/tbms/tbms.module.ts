import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { TbmsController } from './tbms.controller';
import { TbmsService } from './tbms.service';

@Module({
  imports: [PrismaModule],
  controllers: [TbmsController],
  providers: [TbmsService],
  exports: [TbmsService],
})
export class TbmsModule {}
