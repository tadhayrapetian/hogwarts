import type { Recipient } from './types';
import { normalizeText } from './util';

const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y',
  ь: '', э: 'e', ю: 'yu', я: 'ya',
};
const ARM: Record<string, string> = {
  ա: 'a', բ: 'b', գ: 'g', դ: 'd', ե: 'e', զ: 'z', է: 'e', ը: 'y', թ: 't', ժ: 'zh', ի: 'i', լ: 'l', խ: 'kh', ծ: 'ts', կ: 'k',
  հ: 'h', ձ: 'dz', ղ: 'gh', ճ: 'ch', մ: 'm', յ: 'y', ն: 'n', շ: 'sh', ո: 'o', չ: 'ch', պ: 'p', ջ: 'j', ռ: 'r', ս: 's',
  վ: 'v', տ: 't', ր: 'r', ց: 'ts', ւ: 'v', փ: 'p', ք: 'k', և: 'ev', օ: 'o', ֆ: 'f',
};

/** Latin, lower-case, diacritic-free form so "Алекс", "Ալեքս" and "Alex" can be compared. */
export function latinize(s: string | undefined): string {
  const n = normalizeText(s);
  let out = '';
  for (const ch of n) out += CYR[ch] ?? ARM[ch] ?? ch;
  return out.replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

export function jaroWinkler(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aM = new Array(a.length).fill(false);
  const bM = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(i + range + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (bM[j] || a[i] !== b[j]) continue;
      aM[i] = bM[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aM[i]) continue;
    while (!bM[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Simplified Soundex on latinised text, used to block candidate pairs. */
export function soundex(s: string): string {
  const t = latinize(s).replace(/[^a-z]/g, '');
  if (!t) return '';
  const codes: Record<string, string> = { b: '1', f: '1', p: '1', v: '1', c: '2', g: '2', j: '2', k: '2', q: '2', s: '2', x: '2', z: '2', d: '3', t: '3', l: '4', m: '5', n: '5', r: '6' };
  let out = t[0];
  let last = codes[t[0]] ?? '';
  for (let i = 1; i < t.length && out.length < 4; i++) {
    const c = codes[t[i]] ?? '';
    if (c && c !== last) out += c;
    if (t[i] !== 'h' && t[i] !== 'w') last = c;
  }
  return out.padEnd(4, '0');
}

export type DuplicateReason = 'name_exact' | 'name_similar' | 'dob' | 'birthday' | 'address' | 'postal' | 'city' | 'email' | 'phone';

export interface DuplicateMatch {
  a: string;
  b: string;
  score: number;
  reasons: DuplicateReason[];
}

type Comparable = Pick<
  Recipient,
  'firstName' | 'lastName' | 'preferredName' | 'dob' | 'birthday' | 'guardianEmail' | 'guardianPhone' | 'addresses' | 'defaultAddressId' | 'city'
>;

const digits = (s?: string) => (s ?? '').replace(/\D/g, '').slice(-9);
const postal = (s?: string) => (s ?? '').replace(/\s+/g, '').toUpperCase();

function mainAddress(r: Comparable) {
  return r.addresses?.find((a) => a.id === r.defaultAddressId) ?? r.addresses?.[0];
}

export function scorePair(a: Comparable, b: Comparable): { score: number; reasons: DuplicateReason[] } {
  const reasons: DuplicateReason[] = [];
  let score = 0;
  const fa = latinize(a.firstName);
  const fb = latinize(b.firstName);
  const la = latinize(a.lastName);
  const lb = latinize(b.lastName);
  const direct = (jaroWinkler(fa, fb) + jaroWinkler(la, lb)) / 2;
  const swapped = (jaroWinkler(fa, lb) + jaroWinkler(la, fb)) / 2;
  const pref = a.preferredName || b.preferredName ? (jaroWinkler(latinize(a.preferredName || a.firstName), latinize(b.preferredName || b.firstName)) + jaroWinkler(la, lb)) / 2 : 0;
  const nameSim = Math.max(direct, swapped, pref);
  if (fa && la && fa === fb && la === lb) {
    score += 60;
    reasons.push('name_exact');
  } else if (nameSim >= 0.9) {
    score += 40;
    reasons.push('name_similar');
  } else if (nameSim >= 0.82) {
    score += 20;
    reasons.push('name_similar');
  }

  if (a.dob && b.dob) {
    if (a.dob === b.dob) {
      score += 30;
      reasons.push('dob');
    } else score -= 35;
  } else if (a.birthday && b.birthday) {
    if (a.birthday === b.birthday) {
      score += 10;
      reasons.push('birthday');
    } else score -= 20;
  }

  const aa = mainAddress(a);
  const ab = mainAddress(b);
  if (aa && ab) {
    if (aa.line1 && latinize(aa.line1) === latinize(ab.line1)) {
      score += 15;
      reasons.push('address');
    }
    if (aa.postalCode && postal(aa.postalCode) === postal(ab.postalCode)) {
      score += 15;
      reasons.push('postal');
    } else if (aa.city && latinize(aa.city) === latinize(ab.city)) {
      score += 5;
      reasons.push('city');
    }
  } else if (a.city && latinize(a.city) === latinize(b.city)) {
    score += 5;
    reasons.push('city');
  }

  if (a.guardianEmail && normalizeText(a.guardianEmail) === normalizeText(b.guardianEmail)) {
    score += 25;
    reasons.push('email');
  }
  const pa = digits(a.guardianPhone);
  if (pa.length >= 7 && pa === digits(b.guardianPhone)) {
    score += 20;
    reasons.push('phone');
  }
  // Same family contact but clearly different children (siblings) should not be flagged.
  if (!reasons.includes('name_exact') && !reasons.includes('name_similar')) score = Math.min(score, 45);
  return { score: Math.max(0, Math.min(100, score)), reasons };
}

export const DUPLICATE_THRESHOLD = 60;

function blockingKeys(r: Comparable): string[] {
  const keys: string[] = [];
  const ln = soundex(r.lastName);
  const fn = soundex(r.firstName);
  if (ln) keys.push(`l:${ln}`);
  if (ln && fn) keys.push(`x:${fn}${ln}`, `x:${ln}${fn}`);
  if (r.guardianEmail) keys.push(`e:${normalizeText(r.guardianEmail)}`);
  const ph = digits(r.guardianPhone);
  if (ph.length >= 7) keys.push(`p:${ph}`);
  return keys;
}

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Finds likely duplicate pairs using blocking so it scales to thousands of records. */
export function findDuplicates<T extends Comparable & { id: string }>(
  records: T[],
  excluded: Set<string> = new Set(),
  threshold = DUPLICATE_THRESHOLD,
): DuplicateMatch[] {
  const blocks = new Map<string, T[]>();
  for (const r of records) {
    for (const k of blockingKeys(r)) {
      const list = blocks.get(k);
      if (list) list.push(r);
      else blocks.set(k, [r]);
    }
  }
  const seen = new Set<string>();
  const out: DuplicateMatch[] = [];
  for (const list of blocks.values()) {
    if (list.length < 2) continue;
    const capped = list.slice(0, 400);
    for (let i = 0; i < capped.length; i++) {
      for (let j = i + 1; j < capped.length; j++) {
        const key = pairKey(capped[i].id, capped[j].id);
        if (seen.has(key) || excluded.has(key)) continue;
        seen.add(key);
        const { score, reasons } = scorePair(capped[i], capped[j]);
        if (score >= threshold) out.push({ a: capped[i].id, b: capped[j].id, score, reasons });
      }
    }
  }
  return out.sort((x, y) => y.score - x.score);
}

/** Matches one candidate (e.g. an import row) against existing records. */
export function findMatchesFor<T extends Comparable & { id: string }>(candidate: Comparable, records: T[], threshold = DUPLICATE_THRESHOLD) {
  const keys = new Set(blockingKeys(candidate));
  const out: { record: T; score: number; reasons: DuplicateReason[] }[] = [];
  for (const r of records) {
    if (!blockingKeys(r).some((k) => keys.has(k))) continue;
    const { score, reasons } = scorePair(candidate, r);
    if (score >= threshold) out.push({ record: r, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score);
}
