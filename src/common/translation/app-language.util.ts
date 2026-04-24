import { AppLanguage } from '@prisma/client';

export const SUPPORTED_APP_LANGUAGES = [
  AppLanguage.ko,
  AppLanguage.en,
  AppLanguage.ja,
  AppLanguage.zh_CN,
  AppLanguage.zh_TW,
  AppLanguage.vi,
  AppLanguage.th,
  AppLanguage.id,
  AppLanguage.tl,
  AppLanguage.ms,
  AppLanguage.es,
  AppLanguage.fr,
  AppLanguage.de,
  AppLanguage.pt,
  AppLanguage.hi,
] as const;

export const SUPPORTED_APP_LANGUAGE_VALUES = [...SUPPORTED_APP_LANGUAGES] as string[];

export const SUPPORTED_APP_LANGUAGE_DETAILS = [
  { appLanguage: AppLanguage.ko, translationLanguage: AppLanguage.ko, englishName: 'Korean', koreanName: '한국어' },
  { appLanguage: AppLanguage.en, translationLanguage: AppLanguage.en, englishName: 'English', koreanName: '영어' },
  { appLanguage: AppLanguage.ja, translationLanguage: AppLanguage.ja, englishName: 'Japanese', koreanName: '일본어' },
  { appLanguage: AppLanguage.zh_CN, translationLanguage: AppLanguage.zh_CN, englishName: 'Chinese Simplified', koreanName: '중국어 간체' },
  { appLanguage: AppLanguage.zh_TW, translationLanguage: AppLanguage.zh_TW, englishName: 'Chinese Traditional', koreanName: '중국어 번체' },
  { appLanguage: AppLanguage.vi, translationLanguage: AppLanguage.vi, englishName: 'Vietnamese', koreanName: '베트남어' },
  { appLanguage: AppLanguage.th, translationLanguage: AppLanguage.th, englishName: 'Thai', koreanName: '태국어' },
  { appLanguage: AppLanguage.id, translationLanguage: AppLanguage.id, englishName: 'Indonesian', koreanName: '인도네시아어' },
  { appLanguage: AppLanguage.tl, translationLanguage: AppLanguage.tl, englishName: 'Tagalog', koreanName: '타갈로그어' },
  { appLanguage: AppLanguage.ms, translationLanguage: AppLanguage.ms, englishName: 'Malay', koreanName: '말레이어' },
  { appLanguage: AppLanguage.es, translationLanguage: AppLanguage.es, englishName: 'Spanish', koreanName: '스페인어' },
  { appLanguage: AppLanguage.fr, translationLanguage: AppLanguage.fr, englishName: 'French', koreanName: '프랑스어' },
  { appLanguage: AppLanguage.de, translationLanguage: AppLanguage.de, englishName: 'German', koreanName: '독일어' },
  { appLanguage: AppLanguage.pt, translationLanguage: AppLanguage.pt, englishName: 'Portuguese', koreanName: '포르투갈어' },
  { appLanguage: AppLanguage.hi, translationLanguage: AppLanguage.hi, englishName: 'Hindi', koreanName: '힌디어' },
] as const;

const APP_LANGUAGE_ALIASES: Record<string, AppLanguage> = {
  ko: AppLanguage.ko,
  'ko-kr': AppLanguage.ko,
  en: AppLanguage.en,
  'en-us': AppLanguage.en,
  'en-gb': AppLanguage.en,
  ja: AppLanguage.ja,
  'ja-jp': AppLanguage.ja,
  'zh-cn': AppLanguage.zh_CN,
  'zh-hans': AppLanguage.zh_CN,
  zh_cn: AppLanguage.zh_CN,
  'zh-tw': AppLanguage.zh_TW,
  'zh-hant': AppLanguage.zh_TW,
  zh_tw: AppLanguage.zh_TW,
  vi: AppLanguage.vi,
  'vi-vn': AppLanguage.vi,
  th: AppLanguage.th,
  'th-th': AppLanguage.th,
  id: AppLanguage.id,
  'id-id': AppLanguage.id,
  tl: AppLanguage.tl,
  'tl-ph': AppLanguage.tl,
  fil: AppLanguage.tl,
  ms: AppLanguage.ms,
  'ms-my': AppLanguage.ms,
  es: AppLanguage.es,
  'es-es': AppLanguage.es,
  fr: AppLanguage.fr,
  'fr-fr': AppLanguage.fr,
  de: AppLanguage.de,
  'de-de': AppLanguage.de,
  pt: AppLanguage.pt,
  'pt-br': AppLanguage.pt,
  'pt-pt': AppLanguage.pt,
  hi: AppLanguage.hi,
  'hi-in': AppLanguage.hi,
};

export function normalizeAppLanguage(value: unknown): AppLanguage | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/g, '-');
  return APP_LANGUAGE_ALIASES[normalized] ?? null;
}

export function resolveAppLanguage(value: unknown, fallback: AppLanguage = AppLanguage.ko): AppLanguage {
  return normalizeAppLanguage(value) ?? fallback;
}