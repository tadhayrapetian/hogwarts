import { ENVELOPE_DIMENSIONS, NO_BORDER, NO_WATERMARK, paperStyle } from '../core/defaults';
import type {
  BorderSpec,
  Character,
  DesignEl,
  DocumentType,
  EnvelopeDesign,
  FoldStyle,
  House,
  Layout,
  PaperKind,
  Postmark,
  Seal,
  Stamp,
  Template,
  TemplateCategory,
  Lang,
} from '../core/types';
import { uid } from '../core/util';
import { flapTip } from '../render/envelope';
import { text } from '../render/elements';

/** Original demo world: four houses, staff characters and a design library. No third-party IP. */

const T = '2025-10-01T09:00:00.000Z';

export function seedHouses(): House[] {
  const h = (name: string, symbol: string, p: string, s: string, a: string, motto: string, description: string, crestStyle: House['crestStyle'] = 'shield'): House => ({
    id: uid(),
    name,
    symbol,
    primaryColor: p,
    secondaryColor: s,
    accentColor: a,
    motto,
    description,
    crestStyle,
    createdAt: T,
    updatedAt: T,
  });
  return [
    h('Ravenwood', 'raven', '#1f2f52', '#8f9db3', '#e4e9f1', 'Wisdom in the Quiet Hours', 'Stargazers, readers and keepers of riddles. Ravenwood students study by candlelight in the north tower.'),
    h('Emberhart', 'flame', '#7a2412', '#d98c1f', '#f6d38c', 'Courage Kindles Courage', 'Bold, warm-hearted and first to volunteer. Their common room hearth has never gone out.'),
    h('Thornvale', 'stag', '#23402a', '#9b7a3c', '#ecdba6', 'Steadfast as the Old Oak', 'Gardeners, healers and loyal friends who tend the glasshouses and the forest paths.'),
    h('Tidewell', 'waves', '#14505a', '#bfd9d3', '#f3ead2', 'Ever Onward, Ever Curious', 'Explorers and inventors who chart the lake, the tides and every unmapped corridor.'),
  ];
}

export function seedSeals(houses: House[]): Seal[] {
  const s = (name: string, type: Seal['type'], shape: Seal['shape'], color: string, symbol: string, text: string, initials: string, year: string, size = 28, ribbons = false): Seal => ({
    id: uid(),
    name,
    type,
    shape,
    color,
    symbol,
    text,
    initials,
    year,
    size,
    ribbons,
    createdAt: T,
    updatedAt: T,
  });
  const academy = s('Academy Great Seal', 'wax', 'irregular', '#8e1f1b', 'owl', 'Elderglen Academy', '', 'MDCXLII', 30);
  const houseSeals = houses.map((h) => s(`${h.name} House Seal`, 'wax', 'irregular', h.primaryColor === '#1f2f52' ? '#2b3f6e' : h.primaryColor, h.symbol, h.name, '', '', 26));
  houseSeals.forEach((seal, i) => (houses[i].sealId = seal.id));
  return [
    academy,
    ...houseSeals,
    s('Headmistress Monogram', 'wax', 'scalloped', '#3d2a5c', '', '', 'AT', '', 24),
    s('Gold Seal of Merit', 'official', 'round', '#c9a227', 'star', 'Certified Excellence', '', '2026', 34, true),
    s('Embossed Library Seal', 'embossed', 'round', '#f1e6cc', 'book', 'Elderglen Library', '', '', 26),
    s('Archive Ink Seal', 'ink', 'octagon', '#24508a', 'scroll', 'Archive Office', 'AO', '', 26),
  ];
}

export function seedStamps(): Stamp[] {
  const st = (
    name: string,
    category: Stamp['category'],
    symbol: string,
    bg: string,
    ink: string,
    accent: string,
    title: string,
    value: string,
    subtitle: string,
    pattern: Stamp['pattern'] = 'guilloche',
    shape: Stamp['shape'] = 'perforated',
    w = 26,
    h = 31,
  ): Stamp => ({
    id: uid(),
    name,
    category,
    shape,
    w,
    h,
    bg,
    frame: ink,
    ink,
    accent,
    symbol,
    title,
    value,
    subtitle,
    font: 'cinzel',
    pattern,
    createdAt: T,
    updatedAt: T,
  });
  return [
    st('Owl Post Classic', 'owl_post', 'owl', '#efe2c4', '#5b1f1a', '#8a6a35', 'OWL POST', '1', 'ELDERGLEN'),
    st('Owl Post Night', 'owl_post', 'moonstar', '#1f2b45', '#e8d39a', '#e8d39a', 'OWL POST', '2', 'NIGHT FLIGHT', 'rays'),
    st('Express Owl', 'express', 'sparkles', '#f4d9a2', '#7a2e0e', '#c26a2a', 'EXPRESS', '5', 'SWIFT WINGS', 'rays'),
    st('Special Delivery Key', 'special_delivery', 'key', '#d9e4d2', '#2f5233', '#5d7f4f', 'SPECIAL DELIVERY', '3', 'BY HAND'),
    st('School Mail Castle', 'school_mail', 'castle', '#dde4ef', '#1f3d6b', '#4b6a99', 'SCHOOL MAIL', '1', 'GREAT HALL', 'lines'),
    st('Air Mail Feather', 'air_mail', 'feather', '#e5eef7', '#24508a', '#b0302a', 'AIR MAIL', '4', 'PAR AVION', 'lines', 'perforated', 31, 26),
    st('Archive Scroll', 'archive', 'scroll', '#e8dcc2', '#5a4026', '#8a6a35', 'ARCHIVE', '½', 'MDCXLII', 'dots'),
    st('Birthday Cake', 'birthday', 'cake', '#f7dfe2', '#8e2440', '#d0607a', 'HAPPY BIRTHDAY', '1', 'MANY RETURNS', 'dots'),
    st('Winter Snowflake', 'christmas', 'snowflake', '#dbe9e3', '#1d4d3a', '#b0302a', 'WINTER POST', '2', 'MIDWINTER', 'guilloche'),
    st('Yule Pine', 'christmas', 'pine', '#efe0c8', '#2a5a35', '#b0302a', 'SEASON’S GREETINGS', '3', 'MIDWINTER', 'rays', 'rounded'),
    st('Invitation Envelope', 'invitation', 'envelope', '#f3e9d6', '#6b3a1f', '#b08d57', 'INVITATION', '1', 'RSVP BY OWL', 'guilloche'),
    st('Secret Keyhole', 'secret', 'keyhole', '#2a2a38', '#d9c27a', '#d9c27a', 'CONFIDENTIAL', '?', 'FOR YOUR EYES', 'lines'),
  ];
}

export function seedPostmarks(): Postmark[] {
  const pm = (name: string, textTop: string, location: string, shape: Postmark['shape'], color: string, number = '', size = 28, wear = 0.45, rotation = -8): Postmark => ({
    id: uid(),
    name,
    text: textTop,
    location,
    dateFormat: 'DD MMM YYYY',
    dateSource: 'today',
    number,
    shape,
    size,
    opacity: 0.85,
    rotation,
    inkWear: wear,
    color,
    font: 'oswald',
    createdAt: T,
    updatedAt: T,
  });
  return [
    pm('Owl Post Office · Duplex', 'Owl Post Office', 'Elderglen', 'duplex', '#2b2b2b', 'No. 7', 26, 0.5, -4),
    pm('Great Hall · Double ring', 'School Mail', 'Great Hall', 'double', '#7a1f1a', '', 27, 0.4, -12),
    pm('Express Owl · Oval', 'Express Owl', 'North Tower', 'oval', '#1f3d6b', 'EX-12', 30, 0.35, 6),
    pm('Archive Office · Box', 'Archive Office', 'Vault III', 'rect', '#5a4026', '', 30, 0.55, -3),
    pm('Midnight Delivery · Wavy', 'Midnight Delivery', 'Moon Tower', 'wavy', '#24243a', '', 24, 0.5, -6),
  ];
}

export function seedCharacters(houses: House[], seals: Seal[]): Character[] {
  const c = (
    name: string,
    role: Character['role'],
    title: string,
    department: string,
    signatureText: string,
    signatureFont: Character['signatureFont'],
    signatureColor: string,
    portraitSymbol: string,
    portraitColor: string,
    writingStyle: Character['writingStyle'],
    signOff: string,
    bio: string,
    sealId?: string,
    houseId?: string,
  ): Character => ({
    id: uid(),
    name,
    role,
    title,
    department,
    signatureText,
    signatureFont,
    signatureColor,
    portraitSymbol,
    portraitColor,
    writingStyle,
    signOff,
    bio,
    sealId,
    houseId,
    createdAt: T,
    updatedAt: T,
  });
  const monogram = seals.find((s) => s.name === 'Headmistress Monogram');
  const academy = seals.find((s) => s.name === 'Academy Great Seal');
  const library = seals.find((s) => s.name === 'Embossed Library Seal');
  const archive = seals.find((s) => s.name === 'Archive Ink Seal');
  return [
    c('Aurelia Thornbury', 'headmaster', 'Headmistress', 'Office of the Headmistress', 'Aurelia Thornbury', 'greatvibes', '#1b2a4a', 'crown', '#3d2a5c', 'formal', 'Yours most sincerely,', 'Headmistress for nineteen years; keeps a raven named Comma and answers every letter by hand.', monogram?.id ?? academy?.id),
    c('Cassius Wren', 'deputy', 'Deputy Headmaster', 'Department of Celestial Studies', 'C. Wren', 'pinyon', '#24243a', 'moonstar', '#1f2f52', 'scholarly', 'Under the same stars,', 'Teaches astronomy from the roof of the observatory and grades homework in silver ink.', academy?.id),
    c('Isolde Fairweather', 'librarian', 'Head Librarian', 'The Elderglen Library', 'Isolde Fairweather', 'greatvibes', '#2f5233', 'book', '#2f5233', 'warm', 'With bookish regards,', 'Knows where every book is, including the ones that move at night.', library?.id),
    c('Barnaby Quillfeather', 'postmaster', 'Owl Postmaster', 'Owl Post Office', 'B. Quillfeather', 'marck', '#5b1f1a', 'owl', '#7a2412', 'playful', 'Swift wings and safe landings,', 'Has trained four hundred owls and remembers each one’s favourite biscuit.', academy?.id),
    c('Ophelia Ashgrove', 'archivist', 'Keeper of the Archives', 'Archive Office', 'O. Ashgrove', 'pinyon', '#3b2a1a', 'scroll', '#5a4026', 'mysterious', 'Until the next page turns,', 'Guards the sealed vaults and writes quest cards for the bravest students.', archive?.id),
    c('Elias Merriweather', 'house_rep', 'Ravenwood House Representative', 'Ravenwood House', 'Elias M.', 'greatvibes', '#1f2f52', 'raven', '#1f2f52', 'warm', 'Wings up,', 'Seventh-year prefect and unofficial tour guide of the north tower.', houses[0]?.sealId, houses[0]?.id),
  ];
}

// ───────────── Layout helpers ─────────────

function layout(w: number, h: number, paper: PaperKind, border: Partial<BorderSpec> = {}, elements: DesignEl[] = [], wm: Partial<Layout['watermark']> = {}): Layout {
  return {
    w,
    h,
    paper: paperStyle(paper),
    border: { ...NO_BORDER, ...border },
    watermark: { ...NO_WATERMARK, ...wm },
    margins: { top: 15, right: 15, bottom: 15, left: 15 },
    elements,
  };
}

type NoId<T> = T extends unknown ? Omit<T, 'id'> : never;
const el = (e: NoId<DesignEl>): DesignEl => ({ ...e, id: uid() }) as DesignEl;

function tpl(name: string, kind: Template['kind'], category: TemplateCategory, docType: DocumentType, description: string, l: Layout, extra: Partial<Template> = {}, language: Lang = 'en', fold: FoldStyle = 'none'): Template {
  return { id: uid(), name, kind, category, docType, description, language, layout: l, documentTemplateIds: [], fold, createdAt: T, updatedAt: T, ...extra };
}

// ───────────── Envelopes ─────────────

export function seedEnvelopes(): EnvelopeDesign[] {
  const env = (name: string, size: EnvelopeDesign['size'], paper: PaperKind, front: (w: number, h: number) => DesignEl[], back: (w: number, h: number) => DesignEl[], liner: EnvelopeDesign['liner'], flap: EnvelopeDesign['flap'] = 'pointed', border: Partial<BorderSpec> = {}): EnvelopeDesign => {
    const [w, h] = ENVELOPE_DIMENSIONS[size as Exclude<typeof size, 'custom'>];
    return {
      id: uid(),
      name,
      size,
      flap,
      front: layout(w, h, paper, border, front(w, h)),
      back: layout(w, h, paper, {}, back(w, h)),
      liner,
      createdAt: T,
      updatedAt: T,
    };
  };
  const sealAtTip = (flap: EnvelopeDesign['flap'], size = 30) => (w: number, h: number): DesignEl[] => {
    const [tx, ty] = flapTip(flap, w, h);
    return [
      el({ type: 'seal', x: tx - size / 2, y: ty - size / 2, w: size, h: size, sealRef: '$project' }),
      text({ x: w / 2 - 60, y: h - 16, w: 120, h: 8, text: '{{school_name}} · Owl Post Office', font: 'cinzel', size: 7, align: 'center', color: '#6b4a2b', letterSpacing: 0.08 }),
    ];
  };
  const classicFront = (font: 'garamond' | 'typewriter' | 'cormorant', color: string, accent: string) => (w: number, h: number): DesignEl[] => [
    text({ x: 10, y: 9, w: 90, h: 14, text: '{{return_address}}', font: 'inter', size: 6.5, color: accent, lineHeight: 1.3 }),
    el({ type: 'postmark', x: w - 66, y: 9, w: 36, h: 30, postmarkRef: '$project' }),
    el({ type: 'stamp', x: w - 34, y: 8, w: 25, h: 30, stampRef: '$project' }),
    text({ x: w * 0.42, y: h * 0.48, w: w * 0.54, h: h * 0.42, text: '{{address_block}}', font, size: font === 'typewriter' ? 11 : 13, weight: font === 'typewriter' ? 400 : 500, color, lineHeight: 1.3, autoFit: true }),
    el({ type: 'barcode', x: 10, y: h - 18, w: 48, h: 10, value: '{{tracking_number}}', showText: true, color: '#3a2a1a' }),
  ];
  return [
    env(
      'Parchment Classic · C5',
      'C5',
      'parchment',
      (w, h) => [
        ...classicFront('garamond', '#2b1d10', '#6b4a2b')(w, h),
        el({ type: 'symbol', x: 12, y: h * 0.5, w: 16, h: 16, symbol: 'owl', color: '#8a6a35', strokeWidth: 1.2, opacity: 0.8 }),
      ],
      sealAtTip('pointed', 32),
      { pattern: 'damask', color: '#5b1f1a', color2: '#b08d57' },
      'pointed',
      { style: 'single', color: '#8a6a35', width: 0.4, inset: 4 },
    ),
    env('Birthday Rose · C6', 'C6', 'cream', classicFront('cormorant', '#5b1630', '#8e2440'), sealAtTip('curved', 26), { pattern: 'stripes', color: '#8e2440', color2: '#f2c5cf' }, 'curved', {
      style: 'stamp',
      color: '#d0607a',
      width: 0.7,
      inset: 3,
    }),
    env(
      'Winter Night · DL',
      'DL',
      'midnight',
      (w, h) =>
        classicFront('cormorant', '#ead9a6', '#c9b27a')(w, h).map((e) => (e.type === 'barcode' ? { ...e, color: '#ead9a6' } : e)),
      (w, h) => sealAtTip('pointed', 26)(w, h).map((e) => (e.type === 'text' ? { ...e, color: '#c9b27a' } : e)),
      { pattern: 'stars', color: '#1d2433', color2: '#c9b27a' },
      'pointed',
      { style: 'deco', color: '#c9b27a', width: 0.5, inset: 4 },
    ),
    env('Quest Kraft · DL', 'DL', 'kraft', classicFront('typewriter', '#2a1c10', '#4a3420'), sealAtTip('straight', 24), { pattern: 'diamonds', color: '#a8865a', color2: '#5a4026' }, 'straight'),
  ];
}

// ───────────── Letter templates ─────────────

function admissionLetter(lang: Lang): Layout {
  const L = {
    en: {
      salutation: 'Dear {{preferred_name}},',
      body:
        'We are delighted to inform you that you have been offered a place at {{school_name}}. Your name was entered in our Great Register on the day you were born, and this autumn its pages have finally turned to you.\n\nYou will join **{{house}}**, whose motto — *{{house_motto}}* — will guide you through your {{school_year_ordinal|first}} year. Term begins on {{term_start}}. Please find enclosed your student card and a list of required equipment.\n\nWe await your reply by owl no later than 31 July. We hear that {{owl_name|your owl}} is most reliable, and {{pet_name|your companion}} will be very welcome in the dormitories.',
      closing: '{{signoff}}',
      footer: '{{school_name}} · Owl Post Office · {{year}}',
      ref: 'Ref. {{document_number}}\n{{date}}',
    },
    ru: {
      salutation: 'Дорогой(ая) {{preferred_name}}!',
      body:
        'С радостью сообщаем, что вы зачислены в {{school_name}}. Ваше имя было вписано в нашу Великую книгу в день вашего рождения, и этой осенью её страницы наконец открылись для вас.\n\nВы будете учиться на факультете **{{house}}**, девиз которого — *{{house_motto}}* — станет вашим проводником. Учебный год начинается {{term_start}}. К письму прилагаются студенческий билет и список необходимых принадлежностей.\n\nЖдём вашего ответа совиной почтой не позднее 31 июля. Говорят, {{owl_name|ваша сова}} весьма надёжна, а {{pet_name|ваш питомец}} будет желанным гостем в спальнях.',
      closing: 'С искренним уважением,',
      footer: '{{school_name}} · Совиная почта · {{year}}',
      ref: '№ {{document_number}}\n{{date}}',
    },
    hy: {
      salutation: 'Սիրելի՛ {{preferred_name}},',
      body:
        'Ուրախությամբ տեղեկացնում ենք, որ դուք ընդունված եք {{school_name}}։ Ձեր անունը գրանցվել է մեր Մեծ մատյանում ձեր ծննդյան օրը, և այս աշնանը նրա էջերը վերջապես բացվեցին ձեզ համար։\n\nԴուք կսովորեք **{{house}}** ֆակուլտետում, որի նշանաբանը՝ *{{house_motto}}*, կուղեկցի ձեզ։ Ուսումնական տարին սկսվում է {{term_start}}։ Նամակին կից են ուսանողական տոմսը և անհրաժեշտ պարագաների ցանկը։\n\nՍպասում ենք ձեր պատասխանին բվային փոստով մինչև հուլիսի 31-ը։',
      closing: 'Խորին հարգանքով,',
      footer: '{{school_name}} · Բվային փոստ · {{year}}',
      ref: '№ {{document_number}}\n{{date}}',
    },
  }[lang];
  const bodyFont = lang === 'hy' ? 'armenian' : lang === 'ru' ? 'cormorant' : 'garamond';
  const bodySize = lang === 'hy' ? 10.5 : lang === 'ru' ? 12.5 : 12;
  return layout(
    210,
    297,
    'parchment',
    { style: 'ornate', color: '#7a5a32', width: 0.5, inset: 9 },
    [
      el({ type: 'badge', x: 88, y: 16, w: 34, h: 41, houseRef: '$school', showName: true }),
      text({ x: 20, y: 60, w: 170, h: 10, text: '{{school_name}}', font: 'cinzel', size: lang === 'en' ? 17 : 15, weight: 700, align: 'center', color: '#4a2a14', letterSpacing: 0.04 }),
      text({ x: 20, y: 70, w: 170, h: 7, text: '*{{school_motto}}*', font: 'garamond', size: 10, align: 'center', color: '#6b4a2b' }),
      el({ type: 'divider', x: 60, y: 78, w: 90, h: 5, style: 'ornament', color: '#8a6a35', thickness: 0.35 }),
      text({ x: 120, y: 86, w: 68, h: 11, text: L.ref, font: 'garamond', size: 9, align: 'right', color: '#5a4630', lineHeight: 1.3 }),
      text({ x: 24, y: 99, w: 162, h: 8, text: L.salutation, font: bodyFont, size: bodySize + 1, weight: 600, color: '#2b1d10' }),
      text({ x: 24, y: 110, w: 162, h: 118, text: L.body, font: bodyFont, size: bodySize, align: 'justify', lineHeight: 1.45, color: '#2b1d10', dropCap: true, dropCapColor: '#7a1f1a' }),
      text({ x: 112, y: 232, w: 76, h: 7, text: L.closing, font: bodyFont, size: bodySize, italic: true, align: 'center', color: '#2b1d10' }),
      el({ type: 'signature', x: 112, y: 239, w: 76, h: 30, characterRef: '$sender', showName: true, showTitle: true }),
      el({ type: 'seal', x: 30, y: 238, w: 30, h: 30, sealRef: '$project' }),
      text({ x: 20, y: 279, w: 170, h: 5, text: L.footer, font: 'cinzel', size: 7, align: 'center', color: '#7a5a32', letterSpacing: 0.08 }),
    ],
    { kind: 'badge', value: '$school', opacity: 0.06, size: 150 },
  );
}

function birthdayLetter(): Layout {
  return layout(148, 210, 'cream', { style: 'filigree', color: '#b0607a', width: 0.45, inset: 6 }, [
    el({ type: 'symbol', x: 64, y: 14, w: 20, h: 20, symbol: 'cake', color: '#8e2440', strokeWidth: 1.3 }),
    text({ x: 14, y: 37, w: 120, h: 18, text: 'Happy Birthday, {{preferred_name}}!', font: 'greatvibes', size: 26, align: 'center', color: '#8e2440', autoFit: true }),
    el({ type: 'divider', x: 39, y: 56, w: 70, h: 4, style: 'flourish', color: '#b0607a', thickness: 0.35 }),
    text({
      x: 16,
      y: 64,
      w: 116,
      h: 80,
      text:
        'Today the whole of {{school_name}} raises its candles to you! The owls in the tower have been practising a birthday song since dawn (they are not very good at it).\n\nWe hope your {{age|new}}th year brings you brave adventures, good books and plenty of cake for {{pet_name|your favourite creature}} too.\n\nA small surprise from the kitchens awaits you in the Great Hall.',
      font: 'cormorant',
      size: 11.5,
      align: 'center',
      lineHeight: 1.4,
      color: '#3b1d24',
      autoFit: true,
    }),
    text({ x: 34, y: 150, w: 80, h: 6, text: '{{signoff}}', font: 'cormorant', size: 11, italic: true, align: 'center', color: '#3b1d24' }),
    el({ type: 'signature', x: 34, y: 156, w: 80, h: 26, characterRef: '$sender', showName: true, showTitle: true }),
    el({ type: 'seal', x: 61, y: 185, w: 18, h: 18, sealRef: '$project' }),
  ]);
}

function christmasLetter(): Layout {
  return layout(
    210,
    297,
    'midnight',
    { style: 'deco', color: '#c9b27a', width: 0.6, inset: 10 },
    [
      el({ type: 'symbol', x: 95, y: 22, w: 20, h: 20, symbol: 'snowflake', color: '#e8d39a', strokeWidth: 1.1 }),
      text({ x: 20, y: 46, w: 170, h: 16, text: 'Midwinter Greetings', font: 'cinzel', size: 24, weight: 700, align: 'center', color: '#ead9a6', letterSpacing: 0.06 }),
      text({ x: 20, y: 62, w: 170, h: 8, text: 'from the halls of {{school_name}}', font: 'cormorant', size: 12, italic: true, align: 'center', color: '#c9b27a' }),
      el({ type: 'divider', x: 60, y: 72, w: 90, h: 5, style: 'diamond', color: '#c9b27a', thickness: 0.35 }),
      text({ x: 28, y: 86, w: 154, h: 9, text: 'Dear {{preferred_name}},', font: 'cormorant', size: 14, weight: 600, color: '#efe3bf' }),
      text({
        x: 28,
        y: 97,
        w: 154,
        h: 120,
        text:
          'The lake has frozen, the great tree is lit with a thousand floating candles, and the owls are wearing their tiny winter scarves. As the longest night arrives, every house gathers by the fire to tell stories of the year — and yours, dear {{first_name}}, was among the bravest.\n\n{{house|Your house}} sends its warmest wishes, and so does {{owl_name|the whole Owl Post}}. May your midwinter be full of light, laughter and secret parcels.\n\nWe will save you a seat at the feast.',
        font: 'cormorant',
        size: 12.5,
        align: 'justify',
        lineHeight: 1.5,
        color: '#efe3bf',
        dropCap: true,
        dropCapColor: '#e8c36a',
      }),
      text({ x: 112, y: 222, w: 76, h: 7, text: '{{signoff}}', font: 'cormorant', size: 12, italic: true, align: 'center', color: '#efe3bf' }),
      el({ type: 'signature', x: 112, y: 229, w: 76, h: 30, characterRef: '$sender', showName: false, showTitle: false }),
      el({ type: 'stamp', x: 26, y: 228, w: 24, h: 29, stampRef: '$project', rotation: -6 }),
      text({ x: 20, y: 276, w: 170, h: 5, text: '✶  {{year}}  ✶', font: 'cinzel', size: 8, align: 'center', color: '#c9b27a' }),
    ],
    { kind: 'symbol', value: 'snowflake', opacity: 0.05, size: 160, color: '#ffffff' },
  );
}

function questLetter(): Layout {
  return layout(210, 297, 'aged', { style: 'double', color: '#5a4026', width: 0.5, inset: 10 }, [
    el({ type: 'symbol', x: 95, y: 20, w: 20, h: 20, symbol: 'compass', color: '#5a4026', strokeWidth: 1.2 }),
    text({ x: 20, y: 44, w: 170, h: 12, text: 'A QUEST FOR {{first_name}}', font: 'fell', size: 22, align: 'center', color: '#3b2a1a', letterSpacing: 0.05, autoFit: true }),
    text({ x: 20, y: 57, w: 170, h: 6, text: 'Quest № {{document_number}} · issued {{date}}', font: 'typewriter', size: 9, align: 'center', color: '#5a4026' }),
    el({ type: 'divider', x: 40, y: 66, w: 130, h: 4, style: 'double', color: '#5a4026', thickness: 0.3 }),
    text({
      x: 28,
      y: 76,
      w: 154,
      h: 140,
      text:
        '{{preferred_name}},\n\nThe Keeper of the Archives has noticed your talent for {{favorite_subject|curious questions}}. Something has gone missing from Vault III: a small brass key engraved with a crescent moon.\n\nClues are hidden in three places you know well. The first is near something {{favorite_color|blue}}. The second will be found by whoever listens to {{owl_name|the owls}}. The third — only the bravest member of {{house|your house}} will understand.\n\nReturn the key before the next full moon and your name will be written into the Archive of Explorers.\n\nTell no one. Burn after reading. (Or keep it safe — your choice.)',
      font: 'typewriter',
      size: 11,
      align: 'left',
      lineHeight: 1.5,
      color: '#2a1c10',
    }),
    el({ type: 'signature', x: 112, y: 224, w: 76, h: 30, characterRef: '$sender', showName: true, showTitle: true }),
    el({ type: 'seal', x: 30, y: 226, w: 28, h: 28, sealRef: '$project' }),
  ]);
}

// ───────────── Document templates ─────────────

function studentCard(): Layout {
  return layout(85.6, 54, 'cream', { style: 'single', color: '#8a6a35', width: 0.3, inset: 2 }, [
    el({ type: 'shape', x: 0, y: 0, w: 85.6, h: 11, shape: 'rect', fill: '#5b1f1a', stroke: '', strokeWidth: 0 }),
    text({ x: 4, y: 2.2, w: 77.6, h: 7, text: '{{school_name}}', font: 'cinzel', size: 7.5, weight: 700, align: 'center', color: '#f3e3c0', autoFit: true, valign: 'middle' }),
    el({ type: 'badge', x: 4, y: 14, w: 20, h: 24, houseRef: '$recipient', showName: false }),
    text({ x: 27, y: 14, w: 55, h: 3.5, text: 'STUDENT CARD', font: 'oswald', size: 6, color: '#8a6a35', letterSpacing: 0.15 }),
    text({ x: 27, y: 18.5, w: 55, h: 7, text: '{{full_name}}', font: 'cormorant', size: 12, weight: 700, color: '#2b1d10', autoFit: true }),
    text({ x: 27, y: 26.5, w: 55, h: 12, text: 'House: **{{house}}**\nYear: {{school_year|1}} · ID {{recipient_id}}', font: 'inter', size: 6.5, color: '#3b2a1a', lineHeight: 1.35 }),
    el({ type: 'barcode', x: 27, y: 41, w: 54, h: 9, value: '{{recipient_id}}', showText: true, color: '#2b1d10' }),
    el({ type: 'symbol', x: 8, y: 41, w: 10, h: 10, symbol: 'owl', color: '#8a6a35', strokeWidth: 1.4 }),
  ]);
}

function libraryCard(): Layout {
  return layout(85.6, 54, 'kraft', { style: 'dashed', color: '#4a3420', width: 0.3, inset: 2.5 }, [
    el({ type: 'symbol', x: 5, y: 5, w: 12, h: 12, symbol: 'book', color: '#3b2a1a', strokeWidth: 1.4 }),
    text({ x: 19, y: 5.5, w: 62, h: 6, text: 'ELDERGLEN LIBRARY', font: 'fell', size: 10, color: '#2a1c10', letterSpacing: 0.06 }),
    text({ x: 19, y: 11.5, w: 62, h: 4, text: 'Reader’s ticket · valid {{year}}–{{next_year}}', font: 'typewriter', size: 6, color: '#3b2a1a' }),
    el({ type: 'divider', x: 5, y: 18, w: 75.6, h: 3, style: 'dotted', color: '#3b2a1a', thickness: 0.3 }),
    text({ x: 5, y: 22, w: 75.6, h: 7, text: '{{full_name}}', font: 'typewriter', size: 11, color: '#2a1c10', autoFit: true }),
    text({ x: 5, y: 30, w: 50, h: 12, text: 'Favourite subject: {{favorite_subject|—}}\nCard No. {{document_number}}', font: 'typewriter', size: 6, color: '#3b2a1a', lineHeight: 1.4 }),
    el({ type: 'seal', x: 60, y: 28, w: 20, h: 20, sealRef: '$sender' }),
  ]);
}

function achievementCertificate(): Layout {
  return layout(
    297,
    210,
    'ivory',
    { style: 'ornate', color: '#9a7b3c', width: 0.6, inset: 9 },
    [
      el({ type: 'badge', x: 131, y: 18, w: 35, h: 42, houseRef: '$school', showName: false }),
      text({ x: 30, y: 62, w: 237, h: 14, text: 'Certificate of Achievement', font: 'cinzel', size: 26, weight: 700, align: 'center', color: '#5b3a18', letterSpacing: 0.04 }),
      text({ x: 30, y: 80, w: 237, h: 7, text: 'This is proudly presented to', font: 'cormorant', size: 13, italic: true, align: 'center', color: '#5a4630' }),
      text({ x: 40, y: 88, w: 217, h: 22, text: '{{full_name}}', font: 'greatvibes', size: 40, align: 'center', color: '#2b1d10', autoFit: true, valign: 'middle' }),
      el({ type: 'divider', x: 88, y: 111, w: 121, h: 4, style: 'flourish', color: '#9a7b3c', thickness: 0.35 }),
      text({ x: 50, y: 118, w: 197, h: 20, text: 'for outstanding curiosity, kindness and excellence in {{favorite_subject|magical studies}} as a member of House {{house|of the Academy}}.', font: 'cormorant', size: 14, align: 'center', color: '#3b2a1a', lineHeight: 1.35 }),
      el({ type: 'signature', x: 34, y: 150, w: 80, h: 32, characterRef: '$sender', showName: true, showTitle: true }),
      el({ type: 'seal', x: 132, y: 146, w: 33, h: 40, sealRef: '$project' }),
      text({ x: 183, y: 160, w: 80, h: 6, text: '{{date}}', font: 'cormorant', size: 13, align: 'center', color: '#3b2a1a' }),
      el({ type: 'divider', x: 193, y: 167, w: 60, h: 2, style: 'line', color: '#9a7b3c', thickness: 0.3 }),
      text({ x: 183, y: 170, w: 80, h: 5, text: 'Date of award · {{document_number}}', font: 'cormorant', size: 9, italic: true, align: 'center', color: '#5a4630' }),
    ],
    { kind: 'symbol', value: 'star', opacity: 0.04, size: 170 },
  );
}

function diploma(): Layout {
  return layout(297, 210, 'parchment', { style: 'double', color: '#3b2a1a', width: 0.7, inset: 10 }, [
    text({ x: 30, y: 24, w: 237, h: 10, text: '{{school_name}}', font: 'cinzel', size: 16, weight: 700, align: 'center', color: '#3b2a1a', letterSpacing: 0.1 }),
    text({ x: 30, y: 40, w: 237, h: 22, text: 'Diploma', font: 'fell', size: 46, align: 'center', color: '#5b1f1a' }),
    text({
      x: 45,
      y: 72,
      w: 207,
      h: 40,
      text: 'Be it known that **{{full_name}}** of House {{house|of the Academy}} has completed the {{school_year_ordinal|first}} year of study with distinction and is hereby admitted to all the privileges of a scholar of this Academy.',
      font: 'garamond',
      size: 15,
      align: 'center',
      lineHeight: 1.45,
      color: '#2b1d10',
    }),
    el({ type: 'badge', x: 30, y: 122, w: 38, h: 46, houseRef: '$recipient', showName: true }),
    el({ type: 'signature', x: 95, y: 135, w: 70, h: 32, characterRef: '$sender', showName: true, showTitle: true }),
    el({ type: 'seal', x: 200, y: 128, w: 40, h: 46, sealRef: '$project' }),
    text({ x: 30, y: 184, w: 237, h: 6, text: 'Given under our seal on {{date}} · {{document_number}}', font: 'garamond', size: 10, italic: true, align: 'center', color: '#5a4630' }),
  ]);
}

function houseCertificate(): Layout {
  return layout(210, 148, 'cream', { style: 'filigree', color: '#6b4a2b', width: 0.45, inset: 7 }, [
    el({ type: 'badge', x: 18, y: 24, w: 46, h: 55, houseRef: '$recipient', showName: true }),
    text({ x: 72, y: 24, w: 122, h: 10, text: 'House Certificate', font: 'cinzel', size: 18, weight: 700, color: '#3b2a1a' }),
    text({ x: 72, y: 38, w: 122, h: 34, text: 'This certifies that **{{full_name}}** has been welcomed as a true member of House **{{house}}**, and is entitled to its hearth, its colours and its secrets.\n\n*{{house_motto}}*', font: 'garamond', size: 11, lineHeight: 1.4, color: '#2b1d10' }),
    el({ type: 'signature', x: 72, y: 88, w: 64, h: 28, characterRef: '$sender', showName: true, showTitle: true }),
    el({ type: 'seal', x: 152, y: 90, w: 30, h: 30, sealRef: '$house' }),
    text({ x: 20, y: 128, w: 170, h: 5, text: '{{document_number}} · {{date}}', font: 'inter', size: 6.5, align: 'center', color: '#7a5a32' }),
  ]);
}

function awardCard(): Layout {
  return layout(148, 210, 'ivory', { style: 'deco', color: '#9a7b3c', width: 0.5, inset: 7 }, [
    el({ type: 'symbol', x: 59, y: 18, w: 30, h: 30, symbol: 'trophy', color: '#9a7b3c', strokeWidth: 1.2 }),
    text({ x: 14, y: 54, w: 120, h: 12, text: 'Award of Excellence', font: 'cinzel', size: 18, weight: 700, align: 'center', color: '#5b3a18', autoFit: true }),
    text({ x: 14, y: 70, w: 120, h: 18, text: '{{full_name}}', font: 'greatvibes', size: 30, align: 'center', color: '#2b1d10', autoFit: true }),
    text({ x: 18, y: 92, w: 112, h: 40, text: 'In recognition of remarkable work in **{{favorite_subject|the magical arts}}** during the {{year}} term.', font: 'cormorant', size: 13, align: 'center', lineHeight: 1.4, color: '#3b2a1a' }),
    el({ type: 'seal', x: 56, y: 136, w: 36, h: 40, sealRef: '$project' }),
    el({ type: 'signature', x: 34, y: 176, w: 80, h: 24, characterRef: '$sender', showName: true, showTitle: false }),
  ]);
}

function questCard(): Layout {
  return layout(105, 148, 'aged', { style: 'single', color: '#5a4026', width: 0.4, inset: 5 }, [
    el({ type: 'symbol', x: 44, y: 10, w: 17, h: 17, symbol: 'compass', color: '#5a4026', strokeWidth: 1.3 }),
    text({ x: 10, y: 30, w: 85, h: 9, text: 'QUEST CARD', font: 'fell', size: 16, align: 'center', color: '#3b2a1a', letterSpacing: 0.08 }),
    text({ x: 10, y: 40, w: 85, h: 5, text: '№ {{document_number}}', font: 'typewriter', size: 7.5, align: 'center', color: '#5a4026' }),
    el({ type: 'divider', x: 20, y: 47, w: 65, h: 3, style: 'dotted', color: '#5a4026', thickness: 0.3 }),
    text({ x: 12, y: 53, w: 81, h: 62, text: 'Seeker: **{{full_name}}**\n\nTask: find the brass key with the crescent moon.\n\nReward: a page in the Archive of Explorers and the gratitude of {{house|your house}}.', font: 'typewriter', size: 9, lineHeight: 1.45, color: '#2a1c10', autoFit: true }),
    el({ type: 'seal', x: 40, y: 117, w: 25, h: 25, sealRef: '$sender' }),
  ]);
}

function secretMessage(): Layout {
  return layout(148, 105, 'aged', { style: 'dashed', color: '#5a4026', width: 0.35, inset: 5 }, [
    el({ type: 'symbol', x: 10, y: 10, w: 12, h: 12, symbol: 'eye', color: '#5a4026', strokeWidth: 1.4 }),
    text({ x: 26, y: 11, w: 110, h: 8, text: 'SECRET MESSAGE · hold it up to a mirror', font: 'fell', size: 9.5, color: '#3b2a1a', letterSpacing: 0.04 }),
    text({ x: 14, y: 28, w: 120, h: 50, text: '{{preferred_name}}, the third clue sleeps beneath the oldest stair of the {{house|north}} tower. Speak the word “lantern” twice and knock once.', font: 'marck', size: 15, align: 'center', lineHeight: 1.35, color: '#2a1c10', transform: 'mirror', valign: 'middle' }),
    el({ type: 'seal', x: 62, y: 80, w: 20, h: 20, sealRef: '$project' }),
  ]);
}

function invitationCard(): Layout {
  return layout(148, 105, 'ivory', { style: 'double', color: '#6b3a1f', width: 0.45, inset: 5 }, [
    text({ x: 12, y: 13, w: 124, h: 9, text: 'You are cordially invited', font: 'greatvibes', size: 20, align: 'center', color: '#6b3a1f' }),
    text({ x: 12, y: 26, w: 124, h: 8, text: 'THE AUTUMN LANTERN FEAST', font: 'cinzel', size: 12, weight: 700, align: 'center', color: '#3b2a1a', letterSpacing: 0.06 }),
    el({ type: 'divider', x: 39, y: 36, w: 70, h: 3, style: 'diamond', color: '#b08d57', thickness: 0.3 }),
    text({ x: 14, y: 42, w: 120, h: 30, text: 'Dear {{preferred_name}}, join us in the Great Hall of {{school_name}} on the last evening of October for lanterns, music and the sorting of the new owls.', font: 'cormorant', size: 11.5, align: 'center', lineHeight: 1.35, color: '#2b1d10' }),
    text({ x: 14, y: 78, w: 80, h: 12, text: 'Dress: house colours\nRSVP by owl', font: 'cormorant', size: 9.5, italic: true, color: '#5a4630', lineHeight: 1.3 }),
    el({ type: 'stamp', x: 110, y: 70, w: 22, h: 26, stampRef: '$project', rotation: 5 }),
  ]);
}

function enrolmentCertificate(): Layout {
  return layout(210, 297, 'white', { style: 'single', color: '#1f3d6b', width: 0.6, inset: 12 }, [
    el({ type: 'badge', x: 90, y: 24, w: 30, h: 36, houseRef: '$school', showName: false }),
    text({ x: 25, y: 66, w: 160, h: 10, text: 'CERTIFICATE OF ENROLMENT', font: 'cinzel', size: 16, weight: 700, align: 'center', color: '#1f3d6b', letterSpacing: 0.06 }),
    text({ x: 25, y: 80, w: 160, h: 6, text: 'Reference {{document_number}}', font: 'inter', size: 8, align: 'center', color: '#4b6a99' }),
    text({
      x: 30,
      y: 100,
      w: 150,
      h: 80,
      text: 'The Registrar of {{school_name}} hereby certifies that\n\n**{{full_name}}**\n\nis enrolled as a {{school_year_ordinal|first}}-year student of House {{house|to be announced}} for the academic year beginning {{term_start}}.',
      font: 'garamond',
      size: 13,
      align: 'center',
      lineHeight: 1.5,
      color: '#1b2433',
    }),
    el({ type: 'signature', x: 30, y: 210, w: 70, h: 30, characterRef: '$sender', showName: true, showTitle: true }),
    el({ type: 'seal', x: 140, y: 205, w: 34, h: 40, sealRef: '$project' }),
    el({ type: 'barcode', x: 75, y: 262, w: 60, h: 12, value: '{{document_number}}', showText: true, color: '#1b2433' }),
  ]);
}

export interface SeedTemplates {
  templates: Template[];
  byName: Record<string, Template>;
}

export function seedTemplates(ctx: {
  envelopes: EnvelopeDesign[];
  stamps: Stamp[];
  postmarks: Postmark[];
  seals: Seal[];
  characters: Character[];
}): SeedTemplates {
  const env = (n: string) => ctx.envelopes.find((e) => e.name.startsWith(n))?.id;
  const stamp = (n: string) => ctx.stamps.find((s) => s.name === n)?.id;
  const pm = (n: string) => ctx.postmarks.find((p) => p.name.startsWith(n))?.id;
  const seal = (n: string) => ctx.seals.find((s) => s.name === n)?.id;
  const ch = (n: string) => ctx.characters.find((c) => c.name === n)?.id;

  const docs = [
    tpl('Student Card', 'document', 'card', 'student_card', 'Wallet-size student identity card with house crest and barcode.', studentCard(), { sealId: seal('Academy Great Seal'), senderId: ch('Aurelia Thornbury') }),
    tpl('Library Card', 'document', 'card', 'library_card', 'Kraft reader’s ticket for the Academy library.', libraryCard(), { senderId: ch('Isolde Fairweather') }),
    tpl('Certificate of Enrolment', 'document', 'certificate', 'certificate', 'Formal enrolment certificate with registry number.', enrolmentCertificate(), { sealId: seal('Gold Seal of Merit'), senderId: ch('Cassius Wren') }),
    tpl('Certificate of Achievement', 'document', 'certificate', 'achievement_certificate', 'Landscape A4 certificate with gold seal.', achievementCertificate(), { sealId: seal('Gold Seal of Merit'), senderId: ch('Aurelia Thornbury') }),
    tpl('Diploma', 'document', 'certificate', 'diploma', 'End-of-year diploma with house crest.', diploma(), { sealId: seal('Academy Great Seal'), senderId: ch('Aurelia Thornbury') }),
    tpl('Award of Excellence', 'document', 'award', 'award', 'A5 award card for a favourite subject.', awardCard(), { sealId: seal('Gold Seal of Merit'), senderId: ch('Cassius Wren') }),
    tpl('House Certificate', 'document', 'certificate', 'house_certificate', 'A5 landscape certificate sealed with the house seal.', houseCertificate(), { senderId: ch('Elias Merriweather') }),
    tpl('Quest Card', 'document', 'quest', 'quest_card', 'A6 quest card from the Keeper of the Archives.', questCard(), { senderId: ch('Ophelia Ashgrove') }),
    tpl('Secret Message', 'document', 'secret', 'secret_message', 'Mirror-written secret note.', secretMessage(), { sealId: seal('Archive Ink Seal') }),
    tpl('Feast Invitation', 'document', 'invitation', 'invitation', 'A6 invitation to the Autumn Lantern Feast.', invitationCard(), { stampId: stamp('Invitation Envelope') }),
  ];
  const d = (n: string) => docs.find((x) => x.name === n)!.id;

  const letters = [
    tpl(
      'Admission Letter',
      'letter',
      'admission',
      'admission_letter',
      'The classic acceptance letter on parchment with school crest, wax seal and the headmistress’s signature.',
      admissionLetter('en'),
      {
        envelopeId: env('Parchment Classic'),
        stampId: stamp('Owl Post Classic'),
        postmarkId: pm('Owl Post Office'),
        sealId: seal('Academy Great Seal'),
        senderId: ch('Aurelia Thornbury'),
        documentTemplateIds: [d('Student Card'), d('Certificate of Enrolment')],
      },
      'en',
      'half',
    ),
    tpl(
      'Письмо о зачислении',
      'letter',
      'admission',
      'admission_letter',
      'Письмо о зачислении на русском языке.',
      admissionLetter('ru'),
      { envelopeId: env('Parchment Classic'), stampId: stamp('Owl Post Classic'), postmarkId: pm('Owl Post Office'), sealId: seal('Academy Great Seal'), senderId: ch('Aurelia Thornbury'), documentTemplateIds: [d('Student Card')] },
      'ru',
      'half',
    ),
    tpl(
      'Ընդունելության նամակ',
      'letter',
      'admission',
      'admission_letter',
      'Ընդունելության նամակ հայերեն։',
      admissionLetter('hy'),
      { envelopeId: env('Parchment Classic'), stampId: stamp('Owl Post Classic'), postmarkId: pm('Owl Post Office'), sealId: seal('Academy Great Seal'), senderId: ch('Aurelia Thornbury'), documentTemplateIds: [d('Student Card')] },
      'hy',
      'half',
    ),
    tpl('Birthday Letter', 'letter', 'birthday', 'other', 'A5 birthday greeting with a candle-lit owl serenade.', birthdayLetter(), {
      envelopeId: env('Birthday Rose'),
      stampId: stamp('Birthday Cake'),
      postmarkId: pm('Great Hall'),
      sealId: seal('Headmistress Monogram'),
      senderId: ch('Barnaby Quillfeather'),
    }, 'en', 'half'),
    tpl('Midwinter Letter', 'letter', 'christmas', 'other', 'Gold-on-midnight seasonal letter.', christmasLetter(), {
      envelopeId: env('Winter Night'),
      stampId: stamp('Winter Snowflake'),
      postmarkId: pm('Midnight Delivery'),
      sealId: seal('Academy Great Seal'),
      senderId: ch('Aurelia Thornbury'),
    }, 'en', 'trifold'),
    tpl('Special Quest', 'letter', 'quest', 'other', 'Typewritten quest on aged paper with clues personalised from the profile.', questLetter(), {
      envelopeId: env('Quest Kraft'),
      stampId: stamp('Secret Keyhole'),
      postmarkId: pm('Archive Office'),
      sealId: seal('Archive Ink Seal'),
      senderId: ch('Ophelia Ashgrove'),
      documentTemplateIds: [d('Quest Card'), d('Secret Message')],
    }, 'en', 'trifold'),
  ];
  const templates = [...letters, ...docs];
  return { templates, byName: Object.fromEntries(templates.map((t) => [t.name, t])) };
}
