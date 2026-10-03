// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { collectKeys } from '../scripts/i18n-extract';
import { en } from '../src/i18n/en';
import { hy } from '../src/i18n/hy';
import { ru } from '../src/i18n/ru';

const { keys, unresolved } = collectKeys();
const has = (d: Record<string, string>, k: string) => d[k] !== undefined || d[`${k}_other`] !== undefined;
const placeholders = (s: string) => Array.from(s.matchAll(/\{(\w+)\}/g), (m) => m[1]).sort();

describe('translations', () => {
  it('resolves every dynamic key family', () => {
    expect(unresolved).toEqual([]);
  });
  for (const [name, dict] of Object.entries({ en, ru, hy })) {
    it(`${name} covers every key used in the code`, () => {
      expect(keys.filter((k) => !has(dict, k))).toEqual([]);
    });
  }
  it('keeps interpolation placeholders consistent across languages', () => {
    const bad: string[] = [];
    for (const [k, v] of Object.entries(en)) {
      for (const [name, dict] of [['ru', ru], ['hy', hy]] as const) {
        const other = dict[k];
        if (other !== undefined && placeholders(other).some((p) => !placeholders(v).includes(p))) bad.push(`${name}:${k}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
