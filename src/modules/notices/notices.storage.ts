import { mkdirSync } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export const NOTICES_UPLOAD_ROOT = path.resolve(__dirname, '../../..', 'uploads', 'notices');
const LEGACY_NOTICES_UPLOAD_ROOT = path.resolve(__dirname, '../../../../uploads', 'notices');
export const NOTICE_ATTACHMENTS_DIR = 'attachments';
export const NOTICE_IMAGES_DIR = 'images';

export function getNoticeUploadDir(isInlineImage: boolean): string {
  return path.resolve(
    NOTICES_UPLOAD_ROOT,
    isInlineImage ? NOTICE_IMAGES_DIR : NOTICE_ATTACHMENTS_DIR,
  );
}

export function ensureNoticeUploadDirs(): void {
  mkdirSync(getNoticeUploadDir(false), { recursive: true });
  mkdirSync(getNoticeUploadDir(true), { recursive: true });
}

function normalizeFileExtension(originalName: string): string {
  const extension = path.extname(originalName || '').toLowerCase();
  if (!extension) {
    return '';
  }

  return extension.replace(/[^.a-z0-9]/g, '').slice(0, 20);
}

export function createStoredFileName(originalName: string): string {
  return `${Date.now()}-${randomUUID()}${normalizeFileExtension(originalName)}`;
}

export function sanitizeStoredFileName(fileName: string): string {
  const normalized = path.basename(fileName || '').trim();
  if (!normalized || normalized.includes('..') || normalized.includes('/') || normalized.includes('\\')) {
    throw new Error('유효하지 않은 파일명입니다.');
  }
  return normalized;
}

export function buildNoticeStoragePath(fileName: string, isInlineImage: boolean): string {
  const safeFileName = sanitizeStoredFileName(fileName);
  return path.posix.join(isInlineImage ? NOTICE_IMAGES_DIR : NOTICE_ATTACHMENTS_DIR, safeFileName);
}

export function resolveNoticeAbsolutePath(storagePath: string): string {
  return path.resolve(NOTICES_UPLOAD_ROOT, storagePath);
}

export function resolveNoticeAbsolutePathCandidates(storagePath: string): string[] {
  const roots = [NOTICES_UPLOAD_ROOT, LEGACY_NOTICES_UPLOAD_ROOT];
  const resolved = roots.map((root) => path.resolve(root, storagePath));
  return Array.from(new Set(resolved));
}
