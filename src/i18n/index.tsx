import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Lang } from '../core/types';
import { en } from './en';
import { ru } from './ru';
import { hy } from './hy';

export type Dict = Record<string, string>;

export const DICTS: Record<Lang, Dict> = { en, ru, hy };
export const LANGS: { code: Lang; label: string; locale: string }[] = [
  { code: 'en', label: 'English', locale: 'en-GB' },
  { code: 'ru', label: 'Русский', locale: 'ru-RU' },
  { code: 'hy', label: 'Հայերեն', locale: 'hy-AM' },
];

export type TFn = (key: string, params?: Record<string, string | number | undefined>) => string;

export function translate(lang: Lang, key: string, params?: Record<string, string | number | undefined>): string {
  const dict = DICTS[lang] ?? en;
  let s: string | undefined;
  if (params && typeof params.count === 'number') {
    try {
      const cat = new Intl.PluralRules(lang).select(params.count);
      s = dict[`${key}_${cat}`] ?? en[`${key}_${cat}`];
    } catch {
      /* ignore */
    }
  }
  s = s ?? dict[key] ?? en[key];
  if (s === undefined) {
    if (import.meta.env?.DEV) console.warn(`[i18n] missing key: ${key}`);
    s = key.split('.').pop() ?? key;
  }
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (params[k] !== undefined ? String(params[k]) : m));
  return s;
}

interface I18nCtx {
  lang: Lang;
  locale: string;
  setLang: (l: Lang) => void;
  t: TFn;
  /** Translates enum values: tEnum('order', 'in_production') → "In Production". */
  tEnum: (group: string, value: string | undefined) => string;
}

const Ctx = createContext<I18nCtx | null>(null);

const STORAGE_KEY = 'hmms.lang';

export function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Lang | null;
    if (stored && DICTS[stored]) return stored;
  } catch {
    /* ignore */
  }
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2);
  return (['ru', 'hy'].includes(nav) ? nav : 'en') as Lang;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = l;
  }, []);
  const value = useMemo<I18nCtx>(() => {
    const t: TFn = (key, params) => translate(lang, key, params);
    return {
      lang,
      locale: LANGS.find((l) => l.code === lang)?.locale ?? 'en-GB',
      setLang,
      t,
      tEnum: (group, v) => (v ? translate(lang, `enum.${group}.${v}`) : ''),
    };
  }, [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useI18n outside provider');
  return c;
}
