const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function toKstDate(value: Date): Date {
  return new Date(value.getTime() + KST_OFFSET_MS);
}

export function formatKstTimestampString(value: Date): string {
  const kstDate = toKstDate(value);
  const year = kstDate.getUTCFullYear();
  const month = pad2(kstDate.getUTCMonth() + 1);
  const day = pad2(kstDate.getUTCDate());
  const hours = pad2(kstDate.getUTCHours());
  const minutes = pad2(kstDate.getUTCMinutes());
  const seconds = pad2(kstDate.getUTCSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function formatKstDateKey(value: Date): string {
  const kstDate = toKstDate(value);
  const year = kstDate.getUTCFullYear();
  const month = pad2(kstDate.getUTCMonth() + 1);
  const day = pad2(kstDate.getUTCDate());

  return `${year}-${month}-${day}`;
}

export function formatKstMonthDay(value: Date): string {
  return formatKstDateKey(value).slice(5);
}

export function getKstStartOfDay(value: Date): Date {
  const kstDate = toKstDate(value);
  return new Date(Date.UTC(
    kstDate.getUTCFullYear(),
    kstDate.getUTCMonth(),
    kstDate.getUTCDate(),
  ) - KST_OFFSET_MS);
}

export function getKstDaysAgoStart(days: number, base: Date = new Date()): Date {
  return new Date(getKstStartOfDay(base).getTime() - (days * ONE_DAY_MS));
}

export function getKstMonthStart(value: Date, monthOffset = 0): Date {
  const kstDate = toKstDate(value);
  return new Date(Date.UTC(
    kstDate.getUTCFullYear(),
    kstDate.getUTCMonth() + monthOffset,
    1,
  ) - KST_OFFSET_MS);
}

export function preferKstTimestamp(storedValue: string | null | undefined, fallbackValue?: Date | null): string | null {
  if (storedValue) {
    return storedValue;
  }

  if (!fallbackValue) {
    return null;
  }

  return formatKstTimestampString(fallbackValue);
}

export function parseDateInputAsUtc(input: string, boundary: 'start' | 'end' = 'start'): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const time = boundary === 'start' ? '00:00:00.000' : '23:59:59.999';
    return new Date(`${input}T${time}+09:00`);
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date input: ${input}`);
  }

  return parsed;
}
