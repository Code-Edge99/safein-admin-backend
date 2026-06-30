import { access } from 'fs/promises';
import { basename, extname, resolve } from 'path';

const SAFETY_INSPECTION_UPLOAD_ROOT_CANDIDATES = Array.from(new Set([
  resolve(process.cwd(), 'uploads', 'safety-inspections'),
  resolve(process.cwd(), '..', 'uploads', 'safety-inspections'),
  resolve(process.cwd(), '..', 'safein-admin-backend', 'uploads', 'safety-inspections'),
  resolve(process.cwd(), '..', 'safein-app-backend', 'uploads', 'safety-inspections'),
]));

const IMAGE_EXTENSIONS = new Set(['.avif', '.bmp', '.gif', '.heic', '.heif', '.jpeg', '.jpg', '.png', '.webp']);

export function sanitizeSafetyInspectionStoredFileName(fileName: string): string {
  const normalized = basename(String(fileName || '').trim());

  if (!normalized || normalized.includes('..') || normalized.includes('/') || normalized.includes('\\')) {
    throw new Error('유효하지 않은 파일명입니다.');
  }

  return normalized;
}

export async function resolveSafetyInspectionStoredFilePath(fileName: string): Promise<string | null> {
  let safeFileName: string;
  try {
    safeFileName = sanitizeSafetyInspectionStoredFileName(fileName);
  } catch {
    return null;
  }

  for (const rootPath of SAFETY_INSPECTION_UPLOAD_ROOT_CANDIDATES) {
    const absolutePath = resolve(rootPath, safeFileName);
    try {
      await access(absolutePath);
      return absolutePath;
    } catch {
      // try next candidate
    }
  }

  return null;
}

export function isSafetyInspectionImageFile(file: { originalName?: string; fileName?: string; mimeType?: string }): boolean {
  const mimeType = String(file.mimeType || '').toLowerCase();
  const extension = extname(String(file.originalName || file.fileName || '')).toLowerCase();
  return mimeType.startsWith('image/') || IMAGE_EXTENSIONS.has(extension);
}

export function buildContentDisposition(fileName: string, isInline: boolean): string {
  const dispositionType = isInline ? 'inline' : 'attachment';
  const encodedFileName = encodeURIComponent(fileName);
  const normalizedFileName = (() => {
    try {
      return fileName.normalize('NFC');
    } catch {
      return fileName;
    }
  })();
  const asciiFallback = normalizedFileName
    .replace(/[\r\n"]/g, ' ')
    .replace(/\\/g, '_')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || 'download';

  return `${dispositionType}; filename="${asciiFallback}"; filename*=UTF-8''${encodedFileName}`;
}
