import type { DateFormat, ISODate, ISODateTime } from './types';

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const nowISO = (): ISODateTime => new Date().toISOString();

export function toISODate(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const todayISO = (): ISODate => toISODate(new Date());

/** Parses YYYY-MM-DD (or a full ISO timestamp) as a local calendar date. */
export function parseISODate(s: string | undefined | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  if (s.length > 10) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function diffDays(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86400000);
}

export function ageFromDob(dob: string | undefined, at: Date = new Date()): number | undefined {
  const d = parseISODate(dob);
  if (!d) return undefined;
  let age = at.getFullYear() - d.getFullYear();
  const m = at.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < d.getDate())) age--;
  return age >= 0 && age < 130 ? age : undefined;
}

/** Days until the next occurrence of a MM-DD birthday (0 = today). */
export function daysUntilBirthday(mmdd: string | undefined, at: Date = new Date()): number | undefined {
  if (!mmdd) return undefined;
  const m = /^(\d{2})-(\d{2})$/.exec(mmdd);
  if (!m) return undefined;
  const month = Number(m[1]) - 1;
  const day = Number(m[2]);
  const today = startOfDay(at);
  let next = new Date(today.getFullYear(), month, day);
  if (next < today) next = new Date(today.getFullYear() + 1, month, day);
  return diffDays(next, today);
}

/**
 * Accepts many human date notations (ISO, DD.MM.YYYY, DD/MM/YYYY, MM/DD/YYYY when unambiguous,
 * Excel serial numbers) and returns YYYY-MM-DD.
 */
export function normalizeDateInput(raw: string | number | undefined | null, preferDayFirst = true): ISODate | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'number' || /^\d{5}(\.\d+)?$/.test(String(raw).trim())) {
    const serial = Number(raw);
    if (serial > 20000 && serial < 80000) {
      const epoch = Date.UTC(1899, 11, 30);
      const d = new Date(epoch + Math.round(serial) * 86400000);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    }
  }
  const s = String(raw).trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return validYMD(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (m) {
    let a = +m[1];
    let b = +m[2];
    let y = +m[3];
    if (y < 100) y += y > 50 ? 1900 : 2000;
    if (a > 12) return validYMD(y, b, a);
    if (b > 12) return validYMD(y, a, b);
    return preferDayFirst ? validYMD(y, b, a) : validYMD(y, a, b);
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return toISODate(d);
  return undefined;
}

function validYMD(y: number, m: number, d: number): ISODate | undefined {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return undefined;
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1) return undefined;
  return toISODate(dt);
}

const MONTHS_SHORT_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(value: string | Date | undefined | null, fmt: DateFormat = 'D MMM YYYY', locale = 'en'): string {
  if (!value) return '';
  const d = value instanceof Date ? value : parseISODate(value);
  if (!d) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  switch (fmt) {
    case 'DD.MM.YYYY':
      return `${dd}.${mm}.${yyyy}`;
    case 'DD/MM/YYYY':
      return `${dd}/${mm}/${yyyy}`;
    case 'MM/DD/YYYY':
      return `${mm}/${dd}/${yyyy}`;
    case 'YYYY-MM-DD':
      return `${yyyy}-${mm}-${dd}`;
    default:
      return `${d.getDate()} ${monthShort(d.getMonth(), locale)} ${yyyy}`;
  }
}

export function monthShort(month: number, locale = 'en'): string {
  try {
    return new Intl.DateTimeFormat(locale, { month: 'short' }).format(new Date(2026, month, 1)).replace('.', '');
  } catch {
    return MONTHS_SHORT_EN[month];
  }
}

export function monthLong(month: number, locale = 'en'): string {
  try {
    return new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(2026, month, 1));
  } catch {
    return MONTHS_SHORT_EN[month];
  }
}

/** Long, letter-style date: "3 October 2026". */
export function formatLongDate(value: string | Date | undefined, locale = 'en'): string {
  const d = value instanceof Date ? value : parseISODate(value ?? '');
  if (!d) return '';
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  } catch {
    return formatDate(d);
  }
}

export function formatDateTime(value: string | undefined, fmt: DateFormat, locale = 'en'): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return `${formatDate(d, fmt, locale)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatMoney(amount: number, currency: string, locale = 'en'): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount || 0);
  } catch {
    return `${(amount || 0).toFixed(2)} ${currency}`;
  }
}

export function formatNumber(n: number, locale = 'en', digits = 0): string {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n || 0);
  } catch {
    return String(n);
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function round(v: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function clone<T>(v: T): T {
  if (typeof structuredClone === 'function') return structuredClone(v);
  return JSON.parse(JSON.stringify(v));
}

export function groupBy<T, K extends string | number>(items: T[], key: (t: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const it of items) {
    const k = key(it);
    (out[k] ||= []).push(it);
  }
  return out;
}

export function countBy<T>(items: T[], key: (t: T) => string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const k = key(it);
    if (k === undefined) continue;
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

export function sum(items: number[]): number {
  return items.reduce((a, b) => a + (b || 0), 0);
}

export function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

export function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null || a === '') return 1;
  if (b === undefined || b === null || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => t && clearTimeout(t);
  return wrapped;
}

/** Lower-case, strip diacritics, collapse whitespace. */
export function normalizeText(s: string | undefined | null): string {
  return (s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Deterministic PRNG (mulberry32) – used for organic shapes (wax edges, paper stains). */
export function seededRandom(seed: string | number): () => number {
  let h = typeof seed === 'number' ? seed : hashString(seed);
  return () => {
    h |= 0;
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export function ordinal(n: number, lang = 'en'): string {
  if (lang === 'ru') return `${n}-й`;
  if (lang === 'hy') return n === 1 ? '1-ին' : `${n}-րդ`;
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function readFileAsText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

export function readFileAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function readFileAsArrayBuffer(file: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(file);
  });
}

export function safeFileName(s: string): string {
  return s.replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/_+/g, '_').slice(0, 80) || 'file';
}
