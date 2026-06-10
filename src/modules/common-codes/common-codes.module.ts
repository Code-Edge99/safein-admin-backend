import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CommonCodesController } from './common-codes.controller';
import { CommonCodesService } from './common-codes.service';

@Module({
  imports: [PrismaModule],
  controllers: [CommonCodesController],
  providers: [CommonCodesService],
  exports: [CommonCodesService],
})
export class CommonCodesModule {}
