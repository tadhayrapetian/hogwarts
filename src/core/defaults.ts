import { DEFAULT_ROLE_PERMISSIONS } from './permissions';
import type {
  AppSettings,
  BorderSpec,
  Carrier,
  EnvelopeSize,
  LabelPreset,
  Layout,
  PaperKind,
  PaperSize,
  PaperStyle,
  PrintSettings,
  WatermarkSpec,
} from './types';
import { nowISO } from './util';

export const PAPER_DIMENSIONS: Record<Exclude<PaperSize, 'custom'>, [number, number]> = {
  A4: [210, 297],
  A5: [148, 210],
  A3: [297, 420],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
};

export const ENVELOPE_DIMENSIONS: Record<Exclude<EnvelopeSize, 'custom'>, [number, number]> = {
  DL: [220, 110],
  C6: [162, 114],
  C5: [229, 162],
  A5: [220, 155],
  A4: [324, 229],
};

export const LABEL_PRESET_SPECS: Record<Exclude<LabelPreset, 'custom'>, { w: number; h: number; cols: number; rows: number; gap: number }> = {
  L7160: { w: 63.5, h: 38.1, cols: 3, rows: 7, gap: 2.5 },
  L7163: { w: 99.1, h: 38.1, cols: 2, rows: 7, gap: 2.5 },
  L7165: { w: 99.1, h: 67.7, cols: 2, rows: 4, gap: 2.5 },
  L7173: { w: 99.1, h: 57, cols: 2, rows: 5, gap: 2.5 },
};

export const PAPER_COLORS: Record<PaperKind, string> = {
  parchment: '#f1e3c4',
  cream: '#f8f0dc',
  ivory: '#fbf7ec',
  aged: '#e8d4a8',
  white: '#ffffff',
  kraft: '#c9a67a',
  midnight: '#1d2433',
  custom: '#f4ead5',
};

export function paperStyle(kind: PaperKind, overrides: Partial<PaperStyle> = {}): PaperStyle {
  const textured = kind === 'parchment' || kind === 'aged' || kind === 'kraft';
  return {
    kind,
    color: PAPER_COLORS[kind],
    texture: textured ? 0.55 : kind === 'white' ? 0 : 0.25,
    vignette: kind === 'aged' ? 0.55 : kind === 'parchment' ? 0.35 : kind === 'white' ? 0 : 0.15,
    stains: kind === 'aged',
    ...overrides,
  };
}

export const NO_BORDER: BorderSpec = { style: 'none', color: '#6b4a2b', width: 0.6, inset: 8 };
export const NO_WATERMARK: WatermarkSpec = { kind: 'none', value: '', opacity: 0.08, size: 120, color: '#6b4a2b', rotation: 0 };

export function emptyLayout(w = 210, h = 297, paper: PaperKind = 'parchment'): Layout {
  return {
    w,
    h,
    paper: paperStyle(paper),
    border: { ...NO_BORDER },
    watermark: { ...NO_WATERMARK },
    margins: { top: 20, right: 20, bottom: 20, left: 20 },
    elements: [],
  };
}

export function defaultPrintSettings(): PrintSettings {
  return {
    paper: 'A4',
    paperW: 210,
    paperH: 297,
    orientation: 'auto',
    margins: 8,
    bleed: 0,
    cropMarks: true,
    cutLines: true,
    foldLines: true,
    safeArea: false,
    scale: 100,
    resolution: 200,
    envelopeMode: 'direct',
    labelPreset: 'L7163',
    labelW: 99.1,
    labelH: 38.1,
    labelCols: 2,
    labelRows: 7,
    labelGap: 2.5,
  };
}

export const DEFAULT_CARRIERS: Carrier[] = [
  { id: 'owl', name: 'Owl Post (hand delivery)', trackingUrl: '', services: ['Standard', 'Express', 'Midnight'], active: true },
  { id: 'royalmail', name: 'Royal Mail', trackingUrl: 'https://www.royalmail.com/track-your-item#/tracking-results/{tracking}', services: ['1st Class', '2nd Class', 'Signed For', 'International Tracked'], active: true },
  { id: 'dhl', name: 'DHL', trackingUrl: 'https://www.dhl.com/global-en/home/tracking/tracking-express.html?tracking-id={tracking}', services: ['Express', 'Parcel'], active: true },
  { id: 'ups', name: 'UPS', trackingUrl: 'https://www.ups.com/track?tracknum={tracking}', services: ['Standard', 'Express Saver'], active: true },
  { id: 'usps', name: 'USPS', trackingUrl: 'https://tools.usps.com/go/TrackConfirmAction?tLabels={tracking}', services: ['First-Class', 'Priority'], active: true },
  { id: 'russianpost', name: 'Почта России', trackingUrl: 'https://www.pochta.ru/tracking#{tracking}', services: ['Заказное письмо', 'Первый класс'], active: true },
  { id: 'haypost', name: 'HayPost', trackingUrl: 'https://www.haypost.am/en/track?code={tracking}', services: ['Registered', 'EMS'], active: true },
  { id: 'courier', name: 'Local courier', trackingUrl: '', services: ['Same day'], active: true },
];

export function defaultSettings(): AppSettings {
  return {
    key: 'app',
    company: {
      systemName: 'Hogwarts Mail Management System',
      name: 'Owlstone Correspondence Studio',
      schoolName: 'Elderglen Academy of Magical Arts',
      motto: 'Lux in Litteris',
      email: 'owlpost@example.com',
      phone: '+44 20 7946 0000',
      website: 'https://example.com',
      address: '1 Quill Lane\nLondon NW1 4AB\nUnited Kingdom',
    },
    mail: {
      returnAddress: 'Owl Post Office · Elderglen Academy\n1 Quill Lane, London NW1 4AB',
      defaultCarrierId: 'royalmail',
      documentNumberFormat: 'EGA/{YYYY}/{NNNNN}',
      orderPrefix: 'HM',
    },
    print: defaultPrintSettings(),
    regional: { currency: 'GBP', dateFormat: 'D MMM YYYY', language: 'en' },
    defaults: { paper: 'parchment' },
    notifications: {
      newOrder: true,
      lowStock: true,
      birthdays: true,
      birthdayDays: 21,
      unprinted: true,
      unprintedDays: 2,
      unshipped: true,
      unshippedDays: 2,
      returned: true,
      missingAddress: true,
      invalidPostal: true,
      overdue: true,
    },
    privacy: { collectGender: false, storeFullDob: true, autoLockMinutes: 20, retentionMonths: 36 },
    roles: JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS)),
    carriers: DEFAULT_CARRIERS.map((c) => ({ ...c, services: [...c.services] })),
    backup: { remindDays: 7 },
    workspace: { createdAt: nowISO(), demo: false },
  };
}

/** Folded letter size (mm) for fitting checks. */
export function foldedSize(w: number, h: number, fold: 'none' | 'half' | 'trifold'): [number, number] {
  if (fold === 'half') return [w, h / 2];
  if (fold === 'trifold') return [w, h / 3];
  return [w, h];
}

export function fitsEnvelope(letter: [number, number], env: [number, number], clearance = 4): boolean {
  const [lw, lh] = letter;
  const [ew, eh] = env;
  const fit = (a: number, b: number) => a + clearance <= ew && b + clearance <= eh;
  return fit(lw, lh) || fit(lh, lw);
}
