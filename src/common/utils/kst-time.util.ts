import { BadRequestException } from '@nestjs/common';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const TIMEZONE_AWARE_DATETIME_PATTERN = /(Z|[+-]\d{2}:\d{2}|[+-]\d{4})$/i;

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
  const normalized = input.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const time = boundary === 'start' ? '00:00:00.000' : '23:59:59.999';
    return new Date(`${normalized}T${time}+09:00`);
  }

  if (!TIMEZONE_AWARE_DATETIME_PATTERN.test(normalized)) {
    throw new BadRequestException(`Invalid date input (timezone required): ${input}`);
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`Invalid date input: ${input}`);
  }

  return parsed;
}

/**
 * 원시 로그/시계열 조회의 최대 소급 조회 기간(일).
 *
 * 파티션 보존·드롭 정책과 정합을 위한 단일 소스. 보존 정책이 보장하는 조회 가능 창보다
 * 길게 잡으면 드롭된 파티션을 건드려 "조용한 부분 응답"이 발생하므로, 이 값은
 * 항상 보장 보존 창(현재 정책상 직전 2년) 이하로 유지해야 한다.
 */
export const LOG_QUERY_MAX_WINDOW_DAYS = 730;

/**
 * 로그성(시계열) 조회의 날짜 범위를 보존 정책 한계 내로 강제한다.
 *
 * - 시작일이 한계(now - LOG_QUERY_MAX_WINDOW_DAYS, KST 일 시작 기준)보다 과거이면 거부한다
 *   → 드롭된 데이터에 대한 불완전(부분) 응답을 막고 명확히 실패시킨다.
 * - 시작일 미지정 시 하한을 한계로 기본 설정한다 → 전체 스캔/드롭 파티션 접근 방지.
 *
 * 반환값은 Prisma where 절(`timestamp`/`loginTime` 등)에 그대로 할당할 수 있는 `{ gte, lte? }`.
 */
export function resolveLogQueryDateRange(
  startDate?: string,
  endDate?: string,
  now: Date = new Date(),
): { gte: Date; lte?: Date } {
  const floor = getKstDaysAgoStart(LOG_QUERY_MAX_WINDOW_DAYS, now);
  const lte = endDate ? parseDateInputAsUtc(endDate, 'end') : undefined;

  if (!startDate) {
    return { gte: floor, lte };
  }

  const gte = parseDateInputAsUtc(startDate, 'start');
  if (gte.getTime() < floor.getTime()) {
    throw new BadRequestException(
      `로그 데이터는 최근 ${LOG_QUERY_MAX_WINDOW_DAYS}일 이내만 조회할 수 있습니다.`,
    );
  }

  return { gte, lte };
}
