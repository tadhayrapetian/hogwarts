import { countryName, formatAddressLines } from './countries';
import type { AppSettings, Character, House, Lang, Order, Project, Recipient, Shipment } from './types';
import { ageFromDob, formatLongDate, ordinal, parseISODate, todayISO } from './util';

/** All personalisation variables, grouped for the variable picker. */
export const VARIABLE_GROUPS: { group: string; keys: string[] }[] = [
  {
    group: 'recipient',
    keys: [
      'first_name',
      'last_name',
      'preferred_name',
      'full_name',
      'age',
      'birthday',
      'school_year',
      'school_year_ordinal',
      'house',
      'house_motto',
      'favorite_subject',
      'favorite_color',
      'pet_name',
      'owl_name',
      'favorite_creature',
      'interests',
      'special_occasion',
      'recipient_id',
    ],
  },
  { group: 'address', keys: ['address_block', 'address_line', 'city', 'region', 'postal_code', 'country'] },
  { group: 'family', keys: ['guardian_name'] },
  { group: 'sender', keys: ['sender_name', 'sender_title', 'sender_department', 'signoff', 'school_name', 'company_name', 'school_motto', 'return_address'] },
  {
    group: 'document',
    keys: ['today', 'date', 'year', 'next_year', 'term_start', 'document_number', 'order_number', 'project_code', 'tracking_number'],
  },
];

export const ALL_VARIABLES = VARIABLE_GROUPS.flatMap((g) => g.keys);

export type VarContext = Record<string, string>;

export interface ContextInput {
  recipient?: Recipient | null;
  house?: House | null;
  sender?: Character | null;
  settings?: AppSettings | null;
  order?: Order | null;
  project?: Project | null;
  shipment?: Shipment | null;
  documentNumber?: string;
  lang?: Lang;
  /** Date used for {{today}} – defaults to today. */
  date?: string;
}

export function buildContext(input: ContextInput): VarContext {
  const { recipient: r, house, sender, settings, order, project, shipment } = input;
  const lang = input.lang ?? settings?.regional.language ?? 'en';
  const date = input.date ?? todayISO();
  const d = parseISODate(date) ?? new Date();
  const addr = r ? r.addresses.find((a) => a.id === r.defaultAddressId) ?? r.addresses[0] : undefined;
  const display = r ? (r.preferredName?.trim() || r.firstName).trim() : '';
  const fullName = r ? `${r.firstName} ${r.lastName}`.trim() : '';
  const age = r ? ageFromDob(r.dob) ?? r.age : undefined;
  const birthday = r?.birthday
    ? formatLongDate(`2000-${r.birthday}`, lang).replace(/\s*2000\s*(г\.)?/, '').replace(/,\s*$/, '').trim()
    : '';
  const ctx: VarContext = {
    first_name: r?.firstName ?? '',
    last_name: r?.lastName ?? '',
    preferred_name: display,
    full_name: fullName,
    age: age !== undefined ? String(age) : '',
    birthday,
    school_year: r?.schoolYear ? String(r.schoolYear) : '',
    school_year_ordinal: r?.schoolYear ? ordinal(r.schoolYear, lang) : '',
    house: house?.name ?? '',
    house_motto: house?.motto ?? '',
    favorite_subject: r?.favoriteSubject ?? '',
    favorite_color: r?.favoriteColor ?? '',
    pet_name: r?.petName ?? '',
    owl_name: r?.owlName ?? '',
    favorite_creature: r?.favoriteCreature ?? '',
    interests: r?.interests ?? '',
    special_occasion: r?.specialOccasion ?? '',
    recipient_id: r ? `#${r.code}` : '',
    address_block: addr && r ? formatAddressLines(addr, fullName, lang).join('\n') : '',
    address_line: addr ? [addr.line1, addr.line2].filter(Boolean).join(', ') : '',
    city: addr?.city ?? r?.city ?? '',
    region: addr?.region ?? '',
    postal_code: addr?.postalCode ?? '',
    country: countryName(addr?.country ?? r?.country, lang),
    guardian_name: r?.guardianName ?? '',
    sender_name: sender?.name ?? '',
    sender_title: sender?.title ?? '',
    sender_department: sender?.department ?? '',
    signoff: sender?.signOff ?? '',
    school_name: settings?.company.schoolName ?? '',
    company_name: settings?.company.name ?? '',
    school_motto: settings?.company.motto ?? '',
    return_address: settings?.mail.returnAddress ?? '',
    today: formatLongDate(d, lang),
    date: formatLongDate(d, lang),
    year: String(d.getFullYear()),
    next_year: String(d.getFullYear() + 1),
    term_start: formatLongDate(new Date(d.getMonth() >= 8 ? d.getFullYear() + 1 : d.getFullYear(), 8, 1), lang),
    document_number: input.documentNumber ?? '',
    order_number: order?.number ?? '',
    project_code: project?.code ?? '',
    tracking_number: shipment?.trackingNumber ?? order?.trackingNumber ?? '',
  };
  return ctx;
}

const VAR_RE = /\{\{\s*([a-z_][a-z0-9_]*)\s*(?:\|([^}]*))?\}\}/gi;

/**
 * Replaces {{variable}} and {{variable|fallback}} placeholders.
 * Unknown/empty variables without fallback are left empty (and reported by `findUnresolved`).
 */
export function renderTemplate(text: string, ctx: VarContext, keepMissing = false): string {
  return text.replace(VAR_RE, (whole, key: string, fallback?: string) => {
    const v = ctx[key.toLowerCase()];
    if (v !== undefined && v !== '') return v;
    if (fallback !== undefined) return fallback.trim();
    return keepMissing ? whole : '';
  });
}

export function findVariables(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(VAR_RE)) out.add(m[1].toLowerCase());
  return Array.from(out);
}

/** Variables that would render empty (no value and no fallback). */
export function findUnresolved(text: string, ctx: VarContext): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(VAR_RE)) {
    const key = m[1].toLowerCase();
    const v = ctx[key];
    if ((v === undefined || v === '') && m[2] === undefined) out.add(key);
  }
  return Array.from(out);
}

export function isKnownVariable(key: string): boolean {
  return ALL_VARIABLES.includes(key);
}

/** Expands document number patterns: {YYYY} {YY} {MM} {NNNNN} {CODE} {SEQ}. */
export function formatDocumentNumber(pattern: string, seq: number, recipientCode = '', date = new Date()): string {
  return pattern
    .replace(/\{YYYY\}/g, String(date.getFullYear()))
    .replace(/\{YY\}/g, String(date.getFullYear()).slice(2))
    .replace(/\{MM\}/g, String(date.getMonth() + 1).padStart(2, '0'))
    .replace(/\{(N+)\}/g, (_, n: string) => String(seq).padStart(n.length, '0'))
    .replace(/\{CODE\}/g, recipientCode)
    .replace(/\{SEQ\}/g, String(seq));
}

/** Sample data used for previews in the template editor when no recipient is chosen. */
export function sampleContext(settings?: AppSettings | null, lang: Lang = 'en'): VarContext {
  const sample: Recipient = {
    id: 'sample',
    code: '000184',
    firstName: lang === 'ru' ? 'Алекс' : lang === 'hy' ? 'Ալեքս' : 'Alex',
    lastName: lang === 'ru' ? 'Смит' : lang === 'hy' ? 'Սմիթ' : 'Smith',
    preferredName: '',
    age: 11,
    birthday: '10-14',
    addresses: [
      {
        id: 'a',
        label: 'home',
        name: '',
        line1: '12 Larkspur Lane',
        line2: 'Flat 3',
        extra: '',
        city: 'London',
        region: '',
        postalCode: 'NW1 6XE',
        country: 'GB',
        notes: '',
      },
    ],
    defaultAddressId: 'a',
    guardianName: 'Morgan Smith',
    guardianPhone: '',
    guardianEmail: '',
    altContact: '',
    preferredContact: 'email',
    deliveryInstructions: '',
    mailingNotes: '',
    schoolYear: 1,
    favoriteSubject: 'Potions & Herbology',
    favoriteColor: 'midnight blue',
    petName: 'Biscuit',
    owlName: 'Hazel',
    favoriteCreature: 'moon-moth',
    interests: 'astronomy, drawing',
    specialOccasion: '',
    status: 'active',
    tagIds: [],
    notes: '',
    city: 'London',
    country: 'GB',
    createdAt: '',
    updatedAt: '',
    createdBy: '',
  };
  const ctx = buildContext({ recipient: sample, settings, lang });
  ctx.house = ctx.house || 'Ravenwood';
  ctx.house_motto = ctx.house_motto || 'Wisdom in the Quiet Hours';
  ctx.sender_name = ctx.sender_name || 'Aurelia Thornbury';
  ctx.sender_title = ctx.sender_title || 'Headmistress';
  ctx.signoff = ctx.signoff || 'Yours most sincerely,';
  ctx.document_number = ctx.document_number || 'ADM/2026/00184';
  ctx.order_number = ctx.order_number || 'HM-2026-001842';
  ctx.project_code = ctx.project_code || 'P-2026-0042';
  ctx.tracking_number = ctx.tracking_number || 'OWL123456789GB';
  return ctx;
}
