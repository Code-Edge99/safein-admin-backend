import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DocumentIssuesController } from './document-issues.controller';
import { DocumentIssuesService } from './document-issues.service';

@Module({
  imports: [PrismaModule],
  controllers: [DocumentIssuesController],
  providers: [DocumentIssuesService],
})
export class DocumentIssuesModule {}
