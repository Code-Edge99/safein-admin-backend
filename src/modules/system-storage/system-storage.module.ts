import { Module } from '@nestjs/common';
import { SystemStorageController } from './system-storage.controller';
import { SystemStorageService } from './system-storage.service';
import { PartitionArchiveRunner } from './partition-archive.runner';
import { RetentionCleanupRunner } from './retention-cleanup.runner';
import { ArchiveCatalogService } from './archive-catalog.service';
import { HttpLogFilesService } from './http-log-files.service';
import { RolesGuard } from '../auth/guards/roles.guard';

@Module({
  controllers: [SystemStorageController],
  providers: [
    SystemStorageService,
    PartitionArchiveRunner,
    RetentionCleanupRunner,
    ArchiveCatalogService,
    HttpLogFilesService,
    RolesGuard,
  ],
})
export class SystemStorageModule {}
