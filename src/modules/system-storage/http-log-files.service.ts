import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readdir, stat, unlink } from 'node:fs/promises';
import * as path from 'node:path';
import { DeleteHttpLogFileResultDto, HttpLogFileDto } from './dto/system-storage.dto';

type HttpLogSource = 'admin-backend' | 'app-backend';

interface HttpLogSourceConfig {
  source: HttpLogSource;
  prefix: string;
  envKeys: string[];
  defaultDir: string;
}

interface ResolvedHttpLogSourceConfig extends HttpLogSourceConfig {
  directory: string;
  exactFileName: string | null;
}

const HTTP_LOG_FILE_NAME_RE = /^[A-Za-z0-9._-]+\.log$/;

@Injectable()
export class HttpLogFilesService {
  constructor(private readonly config: ConfigService) {}

  async listFiles(): Promise<HttpLogFileDto[]> {
    const results: HttpLogFileDto[] = [];

    for (const source of this.resolveSources()) {
      const fileNames = await this.listSourceFileNames(source);
      for (const fileName of fileNames) {
        const filePath = path.join(source.directory, fileName);
        try {
          const fileStat = await stat(filePath);
          if (!fileStat.isFile()) {
            continue;
          }

          results.push({
            source: source.source,
            fileName,
            directory: source.directory,
            sizeBytes: Math.max(0, Math.round(fileStat.size)),
            logDate: this.extractLogDate(source.prefix, fileName),
            modifiedAt: fileStat.mtime.toISOString(),
          });
        } catch {
          // Ignore files that are removed or changed while the list is being read.
        }
      }
    }

    return results.sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)));
  }

  async deleteFile(source: HttpLogSource, fileName: string): Promise<DeleteHttpLogFileResultDto> {
    const normalizedFileName = path.basename(fileName || '');
    if (!normalizedFileName || normalizedFileName !== fileName || !HTTP_LOG_FILE_NAME_RE.test(normalizedFileName)) {
      throw new BadRequestException('Invalid log file name.');
    }

    const target = (await this.listFiles()).find((file) => file.source === source && file.fileName === normalizedFileName);
    if (!target) {
      throw new NotFoundException('HTTP log file was not found.');
    }

    await unlink(path.join(target.directory, target.fileName));
    return {
      deleted: true,
      source,
      fileName: normalizedFileName,
    };
  }

  private async listSourceFileNames(source: ResolvedHttpLogSourceConfig): Promise<string[]> {
    if (source.exactFileName) {
      return [source.exactFileName];
    }

    try {
      const entries = await readdir(source.directory, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((fileName) => this.isExpectedLogFile(source.prefix, fileName));
    } catch {
      return [];
    }
  }

  private resolveSources(): ResolvedHttpLogSourceConfig[] {
    const sources: HttpLogSourceConfig[] = [
      {
        source: 'admin-backend',
        prefix: 'admin-backend',
        envKeys: ['SAFEIN_ADMIN_HTTP_LOG_FILE_PATH', 'SAFEIN_HTTP_LOG_FILE_PATH'],
        defaultDir: path.join(process.cwd(), 'logs'),
      },
      {
        source: 'app-backend',
        prefix: 'app-backend',
        envKeys: ['SAFEIN_APP_HTTP_LOG_FILE_PATH', 'SAFEIN_HTTP_LOG_FILE_PATH'],
        defaultDir: path.resolve(process.cwd(), '..', 'safein-app-backend', 'logs'),
      },
    ];

    return sources.map((source) => {
      const configuredPath = this.readFirstConfiguredPath(source.envKeys);
      if (!configuredPath) {
        return { ...source, directory: path.resolve(source.defaultDir), exactFileName: null };
      }

      const resolvedPath = path.resolve(configuredPath);
      if (path.extname(resolvedPath)) {
        return {
          ...source,
          directory: path.dirname(resolvedPath),
          exactFileName: path.basename(resolvedPath),
        };
      }

      return { ...source, directory: resolvedPath, exactFileName: null };
    });
  }

  private readFirstConfiguredPath(keys: string[]): string | null {
    for (const key of keys) {
      const value = this.config.get<string>(key) ?? process.env[key];
      if (value?.trim()) {
        return value.trim();
      }
    }

    return null;
  }

  private isExpectedLogFile(prefix: string, fileName: string): boolean {
    return new RegExp(`^${this.escapeRegExp(prefix)}-\\d{4}-\\d{2}-\\d{2}\\.log$`).test(fileName);
  }

  private extractLogDate(prefix: string, fileName: string): string | null {
    const match = fileName.match(new RegExp(`^${this.escapeRegExp(prefix)}-(\\d{4}-\\d{2}-\\d{2})\\.log$`));
    return match?.[1] ?? null;
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
