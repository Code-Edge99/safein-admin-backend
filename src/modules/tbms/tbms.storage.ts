import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import { basename, extname, resolve } from 'path';

const TBM_UPLOAD_DIR = resolve(process.cwd(), 'uploads', 'tbms');

const ALLOWED_AUDIO_EXTENSIONS = new Set([
  '.m4a',
  '.mp3',
  '.wav',
  '.mp4',
  '.webm',
  '.ogg',
  '.oga',
  '.flac',
  '.aac',
  '.opus',
]);

const ALLOWED_AUDIO_MIME_VALUES = new Set([
  'video/mp4',
  'video/webm',
  'application/octet-stream',
]);

const ALLOWED_ATTACHMENT_IMAGE_EXTENSIONS = new Set([
  '.avif',
  '.bmp',
  '.gif',
  '.heic',
  '.heif',
  '.jpeg',
  '.jpg',
  '.png',
  '.webp',
]);

const ALLOWED_ATTACHMENT_PDF_EXTENSIONS = new Set(['.pdf']);

const ALLOWED_ATTACHMENT_PDF_MIME_VALUES = new Set([
  'application/pdf',
  'application/x-pdf',
]);

export interface TbmUploadedFile {
  path: string;
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
}

export function ensureTbmUploadDir(): void {
  if (!existsSync(TBM_UPLOAD_DIR)) {
    mkdirSync(TBM_UPLOAD_DIR, { recursive: true });
  }
}

export function getTbmUploadDir(): string {
  ensureTbmUploadDir();
  return TBM_UPLOAD_DIR;
}

function recoverUtf8FileName(fileName: string): string {
  const trimmed = String(fileName || '').trim();
  if (!trimmed) {
    return '';
  }

  try {
    const recovered = Buffer.from(trimmed, 'latin1').toString('utf8').trim();
    if (!recovered || recovered.includes('�')) {
      return trimmed;
    }

    return Buffer.from(recovered, 'utf8').toString('latin1') === trimmed
      ? recovered
      : trimmed;
  } catch {
    return trimmed;
  }
}

export function normalizeTbmUploadOriginalName(fileName: string, fallback: string = 'file'): string {
  const trimmed = recoverUtf8FileName(fileName);
  if (!trimmed) {
    return fallback;
  }

  try {
    return trimmed.normalize('NFC');
  } catch {
    return trimmed;
  }
}

export function createTbmStoredFileName(originalName: string): string {
  const normalizedOriginalName = normalizeTbmUploadOriginalName(originalName);
  const extension = extname(normalizedOriginalName) || '.bin';
  return `${randomUUID()}${extension.toLowerCase()}`;
}

export function sanitizeTbmStoredFileName(fileName: string): string {
  const normalized = basename(String(fileName || '')).trim();

  if (!normalized || normalized.includes('..') || normalized.includes('/') || normalized.includes('\\')) {
    throw new Error('유효하지 않은 파일명입니다.');
  }

  return normalized;
}

export function isAllowedTbmAudioFile(file: { originalname?: string; mimetype?: string }): boolean {
  const extension = extname(String(file.originalname || '')).toLowerCase();
  const mimeType = String(file.mimetype || '').toLowerCase();

  return ALLOWED_AUDIO_EXTENSIONS.has(extension)
    && (mimeType.startsWith('audio/') || ALLOWED_AUDIO_MIME_VALUES.has(mimeType));
}

export function isTbmImageFile(file: { originalname?: string; mimetype?: string }): boolean {
  const extension = extname(String(file.originalname || '')).toLowerCase();
  const mimeType = String(file.mimetype || '').toLowerCase();

  return mimeType.startsWith('image/')
    || (ALLOWED_ATTACHMENT_IMAGE_EXTENSIONS.has(extension) && mimeType === 'application/octet-stream');
}

export function isAllowedTbmAttachmentFile(file: { originalname?: string; mimetype?: string }): boolean {
  const extension = extname(String(file.originalname || '')).toLowerCase();
  const mimeType = String(file.mimetype || '').toLowerCase();
  const isImage = ALLOWED_ATTACHMENT_IMAGE_EXTENSIONS.has(extension)
    && (mimeType.startsWith('image/') || mimeType === 'application/octet-stream');
  const isPdf = ALLOWED_ATTACHMENT_PDF_EXTENSIONS.has(extension)
    && (ALLOWED_ATTACHMENT_PDF_MIME_VALUES.has(mimeType) || mimeType === 'application/octet-stream');

  return isImage || isPdf;
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

export async function cleanupTbmUploadFiles(fileNames: string[]): Promise<void> {
  await Promise.all(
    fileNames
      .map((fileName) => String(fileName || '').trim())
      .filter(Boolean)
      .map(async (fileName) => {
        try {
          const safeFileName = sanitizeTbmStoredFileName(fileName);
          await unlink(resolve(getTbmUploadDir(), safeFileName));
        } catch (error) {
          const err = error as NodeJS.ErrnoException;
          if (err.code !== 'ENOENT') {
            // 파일 정리는 best-effort로 수행
          }
        }
      }),
  );
}
