import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { ArchiveFileDto } from './dto/system-storage.dto';

const PARTITION_ARCHIVE_KIND = 'device_locations_partition_archive';
const RETENTION_ARCHIVE_KIND = 'retention_row_archive';
const MANIFEST_NAME_RE = /^[A-Za-z0-9._-]+\.manifest\.json$/;
const SAFE_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface ArchiveManifest {
  kind?: string;
  parentTable?: string;
  partitionName?: string;
  partitionBound?: string;
  table?: string;
  rowCount?: number;
  dumpFile?: string;
  archivedAt?: string;
}

@Injectable()
export class ArchiveCatalogService {
  private readonly logger = new Logger(ArchiveCatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async listArchives(): Promise<ArchiveFileDto[]> {
    const dir = this.resolveArchiveDir();
    if (!fs.existsSync(dir)) {
      return [];
    }

    const files = fs.readdirSync(dir).filter((name) => MANIFEST_NAME_RE.test(name));
    const results: ArchiveFileDto[] = [];

    for (const manifestFile of files) {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, manifestFile), 'utf8')) as ArchiveManifest;
        const dumpFile = manifest.dumpFile ?? null;
        const dumpExists = Boolean(dumpFile && fs.existsSync(path.join(dir, dumpFile)));

        if (manifest.kind === PARTITION_ARCHIVE_KIND && manifest.partitionName) {
          const partitionExists = SAFE_IDENTIFIER_RE.test(manifest.partitionName)
            ? await this.relationExists(manifest.partitionName)
            : false;

          results.push({
            manifestFile,
            archiveKind: 'partition',
            targetName: manifest.partitionName,
            table: manifest.parentTable ?? null,
            partitionName: manifest.partitionName,
            partitionBound: manifest.partitionBound ?? null,
            rowCount: manifest.rowCount ?? null,
            archivedAt: manifest.archivedAt ?? null,
            dumpFile,
            dumpExists,
            partitionExists,
          });
          continue;
        }

        if (manifest.kind === RETENTION_ARCHIVE_KIND && manifest.table) {
          results.push({
            manifestFile,
            archiveKind: 'rows',
            targetName: manifest.table,
            table: manifest.table,
            partitionName: null,
            partitionBound: null,
            rowCount: manifest.rowCount ?? null,
            archivedAt: manifest.archivedAt ?? null,
            dumpFile,
            dumpExists,
            partitionExists: false,
          });
        }
      } catch (error) {
        this.logger.warn(`manifest 파싱 실패(${manifestFile}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    results.sort((a, b) => String(b.archivedAt ?? '').localeCompare(String(a.archivedAt ?? '')));
    return results;
  }

  private async relationExists(relationName: string): Promise<boolean> {
    if (!SAFE_IDENTIFIER_RE.test(relationName)) {
      return false;
    }

    const rows = await this.prisma.$queryRawUnsafe<Array<{ name: string | null }>>(
      `SELECT to_regclass('public.${relationName}')::text AS "name"`,
    );
    return Boolean(rows[0]?.name);
  }

  private resolveArchiveDir(): string {
    const configured = this.config.get<string>('SAFEIN_ARCHIVE_DIR') ?? process.env.SAFEIN_ARCHIVE_DIR;
    return path.resolve(configured || path.join(process.cwd(), 'archive'));
  }
}
