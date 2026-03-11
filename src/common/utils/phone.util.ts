export function normalizePhoneNumber(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '').trim();
}

export function normalizeOptionalPhoneNumber(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = normalizePhoneNumber(value);
  return normalized.length > 0 ? normalized : undefined;
}