import { ValidationError } from 'class-validator';

const KOREAN_PATTERN = /[ㄱ-ㅎㅏ-ㅣ가-힣]/;

const FIELD_LABELS: Record<string, string> = {
  id: 'ID',
  accountId: '계정 ID',
  action: '동작',
  actionStatus: '조치 상태',
  allowedAppIds: '허용앱',
  appName: '앱 이름',
  appVersion: '앱 버전',
  attachments: '첨부파일',
  attendeeIds: '교육 대상자',
  category: '분류',
  companyId: '회사',
  content: '내용',
  coordinates: '좌표',
  currentPassword: '현재 비밀번호',
  date: '날짜',
  dateFrom: '시작일',
  dateTo: '종료일',
  days: '요일',
  description: '설명',
  deviceId: '장비 ID',
  email: '이메일',
  employeeId: '직원',
  employeeIds: '직원 목록',
  employeeIdAtAssign: '배정 당시 직원 ID',
  endDate: '종료일',
  endTime: '종료 시간',
  excludes: '예외 시간',
  groupId: '그룹',
  helpText: '보조 설명',
  includeUnsubmitted: '미제출 포함 여부',
  industry: '업종',
  inspectionDate: '점검일',
  isActive: '사용 여부',
  isDraft: '임시저장 여부',
  items: '점검 항목',
  language: '언어',
  latitude: '위도',
  limit: '페이지 크기',
  location: '장소',
  longitude: '경도',
  message: '메시지',
  name: '이름',
  newPassword: '새 비밀번호',
  organizationId: '회사/조직',
  os: '운영체제',
  osVersion: '운영체제 버전',
  packageName: '패키지명',
  page: '페이지',
  password: '비밀번호',
  phone: '전화번호',
  platform: '플랫폼',
  policyId: '정책',
  position: '직책',
  question: '점검 항목 내용',
  radius: '반경',
  required: '필수 응답 여부',
  reviewComment: '검토 메모',
  reviewStatus: '조치 상태',
  role: '권한',
  search: '검색어',
  sections: '구역',
  shape: '구역 모양',
  sortBy: '정렬 기준',
  sortOrder: '정렬 순서',
  sourceLanguage: '원문 언어',
  startDate: '시작일',
  startTime: '시작 시간',
  status: '상태',
  targetEmployeeIds: '적용 대상',
  targetLanguages: '번역 대상 언어',
  teamId: '팀',
  title: '제목',
  type: '유형',
  username: '아이디',
  zoneId: '구역',
};

function uniqueMessages(messages: string[]): string[] {
  return Array.from(new Set(messages.map((message) => message.trim()).filter(Boolean)));
}

function fieldLabel(path: string): string {
  const parts = path.split('.').filter(Boolean);
  const property = [...parts].reverse().find((part) => !/^\d+$/.test(part)) ?? path;

  if (parts.includes('sections') && property === 'title') {
    return '구역명';
  }

  if (parts.includes('items') && property === 'question') {
    return '점검 항목 내용';
  }

  if (parts.includes('items') && property === 'category') {
    return '점검 항목 분류';
  }

  return FIELD_LABELS[property] ?? property;
}

function extractLimit(message: string): string | null {
  return message.match(/(?:equal to|than) (\d+)/i)?.[1] ?? null;
}

function translateDefaultValidationMessage(
  constraint: string,
  message: string,
  path: string,
): string {
  const label = fieldLabel(path);

  if (KOREAN_PATTERN.test(message)) {
    return message;
  }

  if (constraint === 'whitelistValidation' || /^property .+ should not exist$/i.test(message)) {
    return `${label} 항목은 이 요청에서 사용할 수 없습니다.`;
  }

  if (constraint === 'isString') {
    return `${label}은(는) 문자로 입력해주세요.`;
  }

  if (constraint === 'isNotEmpty') {
    return `${label}을(를) 입력해주세요.`;
  }

  if (constraint === 'isEmail') {
    return `${label} 형식이 올바르지 않습니다.`;
  }

  if (constraint === 'isEnum' || constraint === 'isIn') {
    return `${label} 값이 올바르지 않습니다.`;
  }

  if (constraint === 'isArray') {
    return `${label}은(는) 목록 형식이어야 합니다.`;
  }

  if (constraint === 'arrayMinSize' || constraint === 'arrayNotEmpty') {
    return `${label}을(를) 1개 이상 입력해주세요.`;
  }

  if (constraint === 'isBoolean') {
    return `${label}은(는) true 또는 false 값이어야 합니다.`;
  }

  if (constraint === 'isInt') {
    return `${label}은(는) 정수로 입력해주세요.`;
  }

  if (constraint === 'isNumber') {
    return `${label}은(는) 숫자로 입력해주세요.`;
  }

  if (constraint === 'isUUID') {
    return `${label} 형식이 올바르지 않습니다.`;
  }

  if (constraint === 'isDateString') {
    return `${label}은(는) 날짜/시간 형식이어야 합니다.`;
  }

  if (constraint === 'matches') {
    if (/date/i.test(path)) {
      return `${label}은(는) YYYY-MM-DD 형식이어야 합니다.`;
    }

    if (/time/i.test(path)) {
      return `${label}은(는) HH:mm 형식이어야 합니다.`;
    }

    return `${label} 형식이 올바르지 않습니다.`;
  }

  if (constraint === 'minLength') {
    const limit = extractLimit(message);
    return limit ? `${label}은(는) ${limit}자 이상 입력해주세요.` : `${label} 길이가 너무 짧습니다.`;
  }

  if (constraint === 'maxLength') {
    const limit = extractLimit(message);
    return limit ? `${label}은(는) ${limit}자 이하로 입력해주세요.` : `${label} 길이가 너무 깁니다.`;
  }

  if (constraint === 'min') {
    const limit = extractLimit(message);
    return limit ? `${label}은(는) ${limit} 이상이어야 합니다.` : `${label} 값이 너무 작습니다.`;
  }

  if (constraint === 'max') {
    const limit = extractLimit(message);
    return limit ? `${label}은(는) ${limit} 이하여야 합니다.` : `${label} 값이 너무 큽니다.`;
  }

  if (constraint === 'validateNested') {
    return `${label} 입력값을 확인해주세요.`;
  }

  return `${label} 입력값이 올바르지 않습니다.`;
}

function flattenValidationMessages(error: ValidationError, parentPath = ''): string[] {
  const path = parentPath ? `${parentPath}.${error.property}` : error.property;
  const messages = Object.entries(error.constraints ?? {}).map(([constraint, message]) => (
    translateDefaultValidationMessage(constraint, message, path)
  ));

  const childMessages = (error.children ?? []).flatMap((child) => flattenValidationMessages(child, path));
  return [...messages, ...childMessages];
}

export function buildKoreanValidationMessages(errors: ValidationError[]): string[] {
  const messages = uniqueMessages(errors.flatMap((error) => flattenValidationMessages(error)));
  return messages.length > 0 ? messages : ['요청 값이 올바르지 않습니다.'];
}
