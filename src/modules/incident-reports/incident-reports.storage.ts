import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { extname, resolve } from 'path';

const INCIDENT_REPORT_UPLOAD_DIR = resolve(process.cwd(), 'uploads', 'incident-reports');

export function ensureIncidentReportUploadDir(): void {
  if (!existsSync(INCIDENT_REPORT_UPLOAD_DIR)) {
    mkdirSync(INCIDENT_REPORT_UPLOAD_DIR, { recursive: true });
  }
}

export function getIncidentReportUploadDir(): string {
  ensureIncidentReportUploadDir();
  return INCIDENT_REPORT_UPLOAD_DIR;
}

export function normalizeUploadOriginalName(fileName: string): string {
  const trimmed = String(fileName || '').trim();
  if (!trimmed) {
    return 'image.jpg';
  }

  try {
    return trimmed.normalize('NFC');
  } catch {
    return trimmed;
  }
}

export function createStoredFileName(originalName: string): string {
  const normalizedOriginalName = normalizeUploadOriginalName(originalName);
  const extension = extname(normalizedOriginalName) || '.jpg';
  return `${randomUUID()}${extension.toLowerCase()}`;
}