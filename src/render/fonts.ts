import type { FontKey } from '../core/types';

export interface FontDef {
  key: FontKey;
  label: string;
  family: string;
  /** Full CSS stack with per-script fallbacks (Cyrillic, Armenian). */
  stack: string;
  kind: 'serif' | 'display' | 'script' | 'sans' | 'mono';
  scripts: ('latin' | 'cyrillic' | 'armenian')[];
}

const SERIF_FALLBACK = `'Cormorant Garamond', 'Noto Serif Armenian', Georgia, serif`;
const SCRIPT_FALLBACK = `'Marck Script', 'Noto Serif Armenian', cursive`;

export const FONTS: Record<FontKey, FontDef> = {
  cormorant: { key: 'cormorant', label: 'Cormorant Garamond', family: 'Cormorant Garamond', stack: `'Cormorant Garamond', 'Noto Serif Armenian', Georgia, serif`, kind: 'serif', scripts: ['latin', 'cyrillic'] },
  garamond: { key: 'garamond', label: 'EB Garamond', family: 'EB Garamond', stack: `'EB Garamond', 'Noto Serif Armenian', Georgia, serif`, kind: 'serif', scripts: ['latin', 'cyrillic'] },
  cinzel: { key: 'cinzel', label: 'Cinzel', family: 'Cinzel', stack: `'Cinzel', ${SERIF_FALLBACK}`, kind: 'display', scripts: ['latin'] },
  fell: { key: 'fell', label: 'IM Fell English', family: 'IM Fell English', stack: `'IM Fell English', ${SERIF_FALLBACK}`, kind: 'serif', scripts: ['latin'] },
  greatvibes: { key: 'greatvibes', label: 'Great Vibes', family: 'Great Vibes', stack: `'Great Vibes', ${SCRIPT_FALLBACK}`, kind: 'script', scripts: ['latin', 'cyrillic'] },
  pinyon: { key: 'pinyon', label: 'Pinyon Script', family: 'Pinyon Script', stack: `'Pinyon Script', ${SCRIPT_FALLBACK}`, kind: 'script', scripts: ['latin'] },
  marck: { key: 'marck', label: 'Marck Script', family: 'Marck Script', stack: `'Marck Script', 'Noto Serif Armenian', cursive`, kind: 'script', scripts: ['latin', 'cyrillic'] },
  armenian: { key: 'armenian', label: 'Noto Serif Armenian', family: 'Noto Serif Armenian', stack: `'Noto Serif Armenian', 'EB Garamond', Georgia, serif`, kind: 'serif', scripts: ['latin', 'armenian'] },
  inter: { key: 'inter', label: 'Inter', family: 'Inter', stack: `'Inter', 'Noto Serif Armenian', system-ui, sans-serif`, kind: 'sans', scripts: ['latin', 'cyrillic'] },
  oswald: { key: 'oswald', label: 'Oswald', family: 'Oswald', stack: `'Oswald', 'Inter', 'Noto Serif Armenian', sans-serif`, kind: 'sans', scripts: ['latin', 'cyrillic'] },
  typewriter: { key: 'typewriter', label: 'Special Elite', family: 'Special Elite', stack: `'Special Elite', 'Courier New', 'Noto Serif Armenian', monospace`, kind: 'mono', scripts: ['latin'] },
};

export const fontStack = (key: FontKey | undefined) => (FONTS[key ?? 'garamond'] ?? FONTS.garamond).stack;

let fontsReady: Promise<void> | null = null;

/** Loads every design font (all scripts) so text measurement and canvas export are exact. */
export function ensureFontsLoaded(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return Promise.resolve();
  if (!fontsReady) {
    const sample = 'AaBbЯяЖжԱաՔք 0123';
    const loads: Promise<unknown>[] = [];
    for (const f of Object.values(FONTS)) {
      for (const w of ['400', '600', '700']) {
        loads.push(document.fonts.load(`${w} 16px '${f.family}'`, sample).catch(() => undefined));
      }
      loads.push(document.fonts.load(`italic 400 16px '${f.family}'`, sample).catch(() => undefined));
    }
    fontsReady = Promise.all(loads).then(() => undefined);
  }
  return fontsReady;
}

// ───────────── Embedding fonts into exported SVG files ─────────────

interface FaceRule {
  family: string;
  css: string;
  url: string;
  ranges: [number, number][];
}

let faceRules: FaceRule[] | null = null;
const dataUrlCache = new Map<string, Promise<string>>();

function parseRanges(range: string): [number, number][] {
  if (!range) return [[0, 0x10ffff]];
  return range.split(',').map((part) => {
    const p = part.trim().replace(/^U\+/i, '');
    if (p.includes('-')) {
      const [a, b] = p.split('-');
      return [parseInt(a, 16), parseInt(b, 16)] as [number, number];
    }
    if (p.includes('?')) return [parseInt(p.replace(/\?/g, '0'), 16), parseInt(p.replace(/\?/g, 'F'), 16)] as [number, number];
    const v = parseInt(p, 16);
    return [v, v] as [number, number];
  });
}

function collectFaceRules(): FaceRule[] {
  if (faceRules) return faceRules;
  const out: FaceRule[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const family = rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
      const src = rule.style.getPropertyValue('src');
      const m = /url\(["']?([^"')]+\.woff2)["']?\)/.exec(src) ?? /url\(["']?([^"')]+)["']?\)/.exec(src);
      if (!m) continue;
      const url = new URL(m[1], sheet.href ?? document.baseURI).href;
      out.push({ family, css: rule.cssText, url, ranges: parseRanges(rule.style.getPropertyValue('unicode-range')) });
    }
  }
  faceRules = out;
  return out;
}

function toDataUrl(url: string): Promise<string> {
  let p = dataUrlCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => r.blob())
      .then(
        (b) =>
          new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result));
            fr.onerror = () => reject(fr.error);
            fr.readAsDataURL(b);
          }),
      );
    dataUrlCache.set(url, p);
  }
  return p;
}

/**
 * Returns a <style> block with @font-face rules (fonts inlined as data URLs) for exactly the
 * families and unicode subsets used by `svg`, so exported SVG/PNG/PDF render identically anywhere.
 */
export async function embeddedFontCSS(svg: string): Promise<string> {
  const used = new Set<string>();
  for (const m of svg.matchAll(/font-family(?:=|:)\s*"?([^";>]+)/g)) {
    for (const fam of m[1].split(',')) used.add(fam.replace(/&quot;|&#x27;|['"]/g, '').trim());
  }
  const text = svg.replace(/<[^>]+>/g, '');
  const codepoints = new Set<number>();
  for (const ch of text) codepoints.add(ch.codePointAt(0)!);
  const rules = collectFaceRules().filter((r) => used.has(r.family) && r.ranges.some(([a, b]) => Array.from(codepoints).some((c) => c >= a && c <= b)));
  const css = await Promise.all(
    rules.map(async (r) => {
      const data = await toDataUrl(r.url);
      return r.css.replace(/src:[^;]+;/, `src: url(${data}) format('woff2');`);
    }),
  );
  return css.join('\n');
}
