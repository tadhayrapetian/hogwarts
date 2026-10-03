import type { Address } from './types';

/** ISO 3166-1 alpha-2 codes. Names come from Intl.DisplayNames in the active UI language. */
export const COUNTRY_CODES = (
  'AD AE AF AG AI AL AM AO AR AT AU AW AZ BA BB BD BE BF BG BH BI BJ BM BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ ' +
  'DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FO FR GA GB GD GE GH GI GL GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IM IN IQ IR IS IT ' +
  'JE JM JO JP KE KG KH KM KN KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MK ML MM MN MO MT MU MV MW MX MY MZ NA NE NG ' +
  'NI NL NO NP NZ OM PA PE PG PH PK PL PR PS PT PY QA RO RS RU RW SA SC SD SE SG SI SK SL SM SN SO SR SV SY SZ TD TG TH TJ TM TN TO TR ' +
  'TT TW TZ UA UG US UY UZ VA VC VE VN YE ZA ZM ZW'
).split(' ');

const displayNameCache = new Map<string, Intl.DisplayNames | null>();

export function countryName(code: string | undefined, lang = 'en'): string {
  if (!code) return '';
  const upper = code.toUpperCase();
  let dn = displayNameCache.get(lang);
  if (dn === undefined) {
    try {
      dn = new Intl.DisplayNames([lang], { type: 'region' });
    } catch {
      dn = null;
    }
    displayNameCache.set(lang, dn);
  }
  try {
    return dn?.of(upper) ?? upper;
  } catch {
    return upper;
  }
}

/** Resolve a free-text country ("United Kingdom", "UK", "Россия", "Հայաստան") to an ISO code. */
export function resolveCountry(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  const raw = input.trim();
  if (!raw) return undefined;
  const upper = raw.toUpperCase();
  if (COUNTRY_CODES.includes(upper)) return upper;
  const aliases: Record<string, string> = {
    UK: 'GB',
    ENGLAND: 'GB',
    SCOTLAND: 'GB',
    WALES: 'GB',
    'NORTHERN IRELAND': 'GB',
    'GREAT BRITAIN': 'GB',
    BRITAIN: 'GB',
    USA: 'US',
    'U.S.A.': 'US',
    'U.S.': 'US',
    AMERICA: 'US',
    'UNITED STATES OF AMERICA': 'US',
    RUSSIA: 'RU',
    'RUSSIAN FEDERATION': 'RU',
    РОССИЯ: 'RU',
    РФ: 'RU',
    АРМЕНИЯ: 'AM',
    ՀԱՅԱՍՏԱՆ: 'AM',
    HOLLAND: 'NL',
    'SOUTH KOREA': 'KR',
    KOREA: 'KR',
  };
  if (aliases[upper]) return aliases[upper];
  const norm = upper.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  for (const lang of ['en', 'ru', 'hy', 'de', 'fr', 'es']) {
    for (const code of COUNTRY_CODES) {
      const n = countryName(code, lang).toUpperCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
      if (n === norm) return code;
    }
  }
  return undefined;
}

const POSTAL_PATTERNS: Record<string, RegExp> = {
  GB: /^(GIR ?0AA|[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})$/i,
  US: /^\d{5}(-\d{4})?$/,
  CA: /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d$/i,
  RU: /^\d{6}$/,
  BY: /^\d{6}$/,
  KZ: /^(\d{6}|[A-Z]\d{2}[A-Z]\d[A-Z]\d)$/i,
  AM: /^\d{4}$/,
  GE: /^\d{4}$/,
  UA: /^\d{5}$/,
  DE: /^\d{5}$/,
  FR: /^\d{5}$/,
  IT: /^\d{5}$/,
  ES: /^\d{5}$/,
  FI: /^\d{5}$/,
  TR: /^\d{5}$/,
  IE: /^[AC-FHKNPRTV-Y]\d{2}(\d|W) ?[0-9AC-FHKNPRTV-Y]{4}$/i,
  AU: /^\d{4}$/,
  NZ: /^\d{4}$/,
  AT: /^\d{4}$/,
  BE: /^\d{4}$/,
  CH: /^\d{4}$/,
  DK: /^\d{4}$/,
  NO: /^\d{4}$/,
  HU: /^\d{4}$/,
  NL: /^\d{4} ?[A-Z]{2}$/i,
  SE: /^\d{3} ?\d{2}$/,
  CZ: /^\d{3} ?\d{2}$/,
  SK: /^\d{3} ?\d{2}$/,
  GR: /^\d{3} ?\d{2}$/,
  PL: /^\d{2}-\d{3}$/,
  PT: /^\d{4}-\d{3}$/,
  JP: /^\d{3}-?\d{4}$/,
  IN: /^\d{6}$/,
  CN: /^\d{6}$/,
  BR: /^\d{5}-?\d{3}$/,
  IL: /^\d{7}$/,
};

/** Countries where a postal code is not normally used. */
const NO_POSTAL = new Set(['AE', 'HK', 'QA', 'AG', 'BS', 'BZ', 'FJ', 'GD', 'JM', 'KN', 'LC', 'VC', 'TT']);

export function postalRequired(country: string | undefined): boolean {
  return !!country && !NO_POSTAL.has(country.toUpperCase());
}

/** true = valid, false = invalid, undefined = cannot be checked for this country. */
export function isValidPostalCode(country: string | undefined, code: string | undefined): boolean | undefined {
  if (!country) return undefined;
  const c = country.toUpperCase();
  const value = (code ?? '').trim();
  if (!value) return !postalRequired(c);
  const re = POSTAL_PATTERNS[c];
  if (!re) return /^[A-Z0-9 -]{2,10}$/i.test(value) ? undefined : false;
  return re.test(value);
}

export function postalExample(country: string | undefined): string {
  const ex: Record<string, string> = {
    GB: 'SW1A 1AA',
    US: '10001',
    CA: 'K1A 0B1',
    RU: '101000',
    AM: '0010',
    DE: '10115',
    FR: '75001',
    IE: 'D02 X285',
    NL: '1012 AB',
    PL: '00-001',
    AU: '2000',
  };
  return ex[(country ?? '').toUpperCase()] ?? '';
}

/** Formats a postal address in the conventions of the destination country. */
export function formatAddressLines(addr: Partial<Address>, addressee: string, lang = 'en'): string[] {
  const c = (addr.country ?? '').toUpperCase();
  const name = (addr.name && addr.name.trim()) || addressee;
  const street = [addr.line1, addr.line2].filter((s) => s && s.trim()).join(', ');
  const lines: string[] = [name];
  if (street) lines.push(street);
  if (addr.extra?.trim()) lines.push(addr.extra.trim());
  const city = (addr.city ?? '').trim();
  const region = (addr.region ?? '').trim();
  const postal = (addr.postalCode ?? '').trim();
  switch (c) {
    case 'GB':
    case 'IE':
      if (city) lines.push(city.toUpperCase());
      if (region) lines.push(region);
      if (postal) lines.push(postal.toUpperCase());
      break;
    case 'US':
    case 'CA':
    case 'AU':
      lines.push([city && `${city},`, region, postal].filter(Boolean).join(' ').trim());
      break;
    case 'RU':
    case 'BY':
    case 'KZ':
    case 'AM':
      lines.push([city, region].filter(Boolean).join(', '));
      if (postal) lines.push(postal);
      break;
    default:
      lines.push([postal, city].filter(Boolean).join(' '));
      if (region) lines.push(region);
  }
  if (c) lines.push(countryName(c, lang).toUpperCase());
  return lines.filter((l) => l && l.trim());
}

export function isAddressComplete(addr: Partial<Address> | undefined): boolean {
  if (!addr) return false;
  return !!(addr.line1?.trim() && addr.city?.trim() && addr.country?.trim() && (addr.postalCode?.trim() || !postalRequired(addr.country)));
}
