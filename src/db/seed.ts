import { defaultSettings } from '../core/defaults';
import { orderTotal } from '../core/orders';
import { buildContext, formatDocumentNumber } from '../core/template';
import type {
  Activity,
  Address,
  AppSettings,
  Customer,
  GeneratedDoc,
  InventoryItem,
  Note,
  Order,
  OrderStatus,
  PrintBatch,
  Product,
  Project,
  ProjectStage,
  Recipient,
  Shipment,
  ShipmentStatus,
  Supplier,
  Tag,
  Task,
} from '../core/types';
import { PROJECT_STAGES } from '../core/types';
import { addDays, seededRandom, toISODate, uid } from '../core/util';
import { db } from './db';
import { seedCharacters, seedEnvelopes, seedHouses, seedPostmarks, seedSeals, seedStamps, seedTemplates } from './seedDesigns';
import { copyEnvelope, copyLayout, layoutText, projectDocFromTemplate } from './services';

const pad = (n: number, l: number) => String(n).padStart(l, '0');

interface PersonSeed {
  first: string;
  last: string;
  pref?: string;
  dob?: string;
  country: string;
  city: string;
  region?: string;
  postal: string;
  line1: string;
  line2?: string;
  house: number;
  year: number;
  subject: string;
  color: string;
  pet: string;
  owl: string;
  creature: string;
  interests: string;
  guardian: string;
  email: string;
  phone: string;
  tags: string[];
  status?: Recipient['status'];
  lang?: 'en' | 'ru' | 'hy';
}

const PEOPLE: PersonSeed[] = [
  { first: 'Alex', last: 'Smith', dob: '2015-10-14', country: 'GB', city: 'London', postal: 'NW1 6XE', line1: '12 Larkspur Lane', line2: 'Flat 3', house: 0, year: 1, subject: 'Astronomy', color: 'midnight blue', pet: 'Biscuit', owl: 'Hazel', creature: 'moon-moth', interests: 'stars, drawing maps', guardian: 'Morgan Smith', email: 'morgan.smith@example.com', phone: '+44 7700 900123', tags: ['New Student', 'Birthday'] },
  { first: 'Amelia', last: 'Clarke', dob: '2015-03-02', country: 'GB', city: 'Manchester', postal: 'M1 1AE', line1: '4 Mosley Street', house: 1, year: 1, subject: 'Potion-making', color: 'scarlet', pet: 'Pip', owl: 'Saffron', creature: 'fire salamander', interests: 'football, baking', guardian: 'Helen Clarke', email: 'helen.clarke@example.com', phone: '+44 7700 900456', tags: ['VIP'] },
  { first: 'Oliver', last: 'Bennett', dob: '2014-11-28', country: 'GB', city: 'Edinburgh', postal: 'EH1 1YZ', line1: '27 Royal Mile', house: 2, year: 2, subject: 'Herbology', color: 'moss green', pet: 'Thistle', owl: 'Bramble', creature: 'tree sprite', interests: 'gardening, chess', guardian: 'Fiona Bennett', email: 'f.bennett@example.com', phone: '+44 7700 900789', tags: ['Returning'] },
  { first: 'Isla', last: 'Murphy', dob: '2015-10-20', country: 'IE', city: 'Dublin', postal: 'D02 X285', line1: '8 Merrion Square', house: 3, year: 1, subject: 'Charms', color: 'sea green', pet: 'Murphy', owl: 'Wren', creature: 'selkie', interests: 'swimming, harp', guardian: 'Aoife Murphy', email: 'aoife.murphy@example.com', phone: '+353 85 123 4567', tags: ['Gift', 'Birthday'] },
  { first: 'Noah', last: 'Williams', dob: '2016-01-09', country: 'US', city: 'Boston', region: 'MA', postal: '02108', line1: '45 Beacon Street', house: 0, year: 1, subject: 'History of Magic', color: 'silver', pet: 'Rocket', owl: 'Atlas', creature: 'griffin', interests: 'robots, reading', guardian: 'Dana Williams', email: 'dana.w@example.com', phone: '+1 617 555 0142', tags: ['New Student'] },
  { first: 'Sophia', last: 'Martinez', dob: '2015-06-17', country: 'US', city: 'Austin', region: 'TX', postal: '78701', line1: '310 Congress Avenue', line2: 'Apt 12B', house: 1, year: 2, subject: 'Flying', color: 'gold', pet: 'Churro', owl: 'Luna', creature: 'phoenix', interests: 'dance, horses', guardian: 'Carmen Martinez', email: 'carmen.m@example.com', phone: '+1 512 555 0188', tags: ['Christmas', 'Returning'] },
  { first: 'Liam', last: 'Brooks', dob: '2014-08-03', country: 'CA', city: 'Toronto', region: 'ON', postal: 'M5V 2T6', line1: '200 Front Street West', house: 3, year: 3, subject: 'Navigation', color: 'teal', pet: 'Maple', owl: 'Comet', creature: 'kraken', interests: 'sailing, hockey', guardian: 'Jordan Brooks', email: 'jbrooks@example.com', phone: '+1 416 555 0110', tags: ['Returning', 'VIP'] },
  { first: 'Mia', last: 'Schneider', dob: '2015-12-11', country: 'DE', city: 'Berlin', postal: '10115', line1: 'Invalidenstraße 43', house: 2, year: 1, subject: 'Herbology', color: 'forest green', pet: 'Knopf', owl: 'Ember', creature: 'unicorn', interests: 'violin, hiking', guardian: 'Katrin Schneider', email: 'k.schneider@example.com', phone: '+49 30 1234567', tags: ['Christmas'] },
  { first: 'Lucas', last: 'Dubois', dob: '2016-04-25', country: 'FR', city: 'Paris', postal: '75004', line1: '12 Rue de Rivoli', house: 0, year: 1, subject: 'Astronomy', color: 'indigo', pet: 'Croissant', owl: 'Minuit', creature: 'dragon', interests: 'comics, fencing', guardian: 'Claire Dubois', email: 'claire.dubois@example.com', phone: '+33 6 12 34 56 78', tags: ['New Student'] },
  { first: 'Анна', last: 'Петрова', dob: '2015-10-08', country: 'RU', city: 'Москва', postal: '101000', line1: 'ул. Мясницкая, д. 15', line2: 'кв. 42', house: 1, year: 1, subject: 'Зельеварение', color: 'вишнёвый', pet: 'Барсик', owl: 'Звёздочка', creature: 'жар-птица', interests: 'рисование, книги', guardian: 'Елена Петрова', email: 'elena.petrova@example.com', phone: '+7 915 123-45-67', tags: ['Birthday', 'New Student'], lang: 'ru' },
  { first: 'Максим', last: 'Иванов', dob: '2014-05-19', country: 'RU', city: 'Санкт-Петербург', postal: '190000', line1: 'Невский пр., д. 28', line2: 'кв. 7', house: 3, year: 3, subject: 'Астрономия', color: 'синий', pet: 'Рекс', owl: 'Буран', creature: 'грифон', interests: 'шахматы, плавание', guardian: 'Ольга Иванова', email: 'olga.ivanova@example.com', phone: '+7 921 765-43-21', tags: ['Returning'], lang: 'ru' },
  { first: 'Անի', last: 'Սարգսյան', dob: '2015-09-30', country: 'AM', city: 'Երևան', postal: '0010', line1: 'Աբովյան փ. 10', line2: 'բն. 5', house: 2, year: 1, subject: 'Բուսաբանություն', color: 'ծիրանագույն', pet: 'Մուրկա', owl: 'Աստղիկ', creature: 'վիշապ', interests: 'պար, նկարչություն', guardian: 'Նարինե Սարգսյան', email: 'narine.s@example.com', phone: '+374 91 123456', tags: ['VIP'], lang: 'hy' },
  { first: 'Դավիթ', last: 'Հակոբյան', dob: '2016-02-14', country: 'AM', city: 'Գյումրի', postal: '3101', line1: 'Ռիժկովի փ. 22', house: 0, year: 1, subject: 'Աստղագիտություն', color: 'կապույտ', pet: 'Բոբիկ', owl: 'Արծիվ', creature: 'գրիֆոն', interests: 'շախմատ, ֆուտբոլ', guardian: 'Արամ Հակոբյան', email: 'aram.h@example.com', phone: '+374 77 654321', tags: ['New Student'], lang: 'hy' },
  { first: 'Charlotte', last: 'Evans', dob: '2015-07-07', country: 'AU', city: 'Sydney', region: 'NSW', postal: '2000', line1: '1 Macquarie Street', house: 1, year: 2, subject: 'Care of Creatures', color: 'coral', pet: 'Koala', owl: 'Opal', creature: 'bunyip', interests: 'surfing, animals', guardian: 'Emma Evans', email: 'emma.evans@example.com', phone: '+61 412 345 678', tags: ['Returning'] },
  { first: 'Henry', last: 'Walker', dob: '2014-12-24', country: 'NZ', city: 'Wellington', postal: '6011', line1: '15 Lambton Quay', house: 3, year: 3, subject: 'Navigation', color: 'ocean blue', pet: 'Kiwi', owl: 'Tui', creature: 'taniwha', interests: 'rugby, stargazing', guardian: 'Sam Walker', email: 'sam.walker@example.com', phone: '+64 21 123 4567', tags: ['Christmas'] },
  { first: 'Ella', last: 'Johansson', dob: '2015-05-30', country: 'SE', city: 'Stockholm', postal: '111 52', line1: 'Drottninggatan 21', house: 0, year: 2, subject: 'Runes', color: 'pale blue', pet: 'Smilla', owl: 'Frost', creature: 'troll', interests: 'skiing, puzzles', guardian: 'Lena Johansson', email: 'lena.j@example.com', phone: '+46 70 123 45 67', tags: [] },
  { first: 'Ava', last: 'Rossi', dob: '2016-03-12', country: 'IT', city: 'Roma', postal: '00184', line1: 'Via Nazionale 50', house: 2, year: 1, subject: 'Herbology', color: 'olive', pet: 'Gelato', owl: 'Stella', creature: 'centaur', interests: 'painting, cooking', guardian: 'Giulia Rossi', email: 'giulia.rossi@example.com', phone: '+39 333 123 4567', tags: ['Gift'] },
  { first: 'Ethan', last: 'Kowalski', dob: '2015-01-21', country: 'PL', city: 'Warszawa', postal: '00-001', line1: 'ul. Marszałkowska 1', house: 1, year: 1, subject: 'Duelling theory', color: 'crimson', pet: 'Burek', owl: 'Iskra', creature: 'basilisk', interests: 'judo, games', guardian: 'Anna Kowalska', email: 'anna.k@example.com', phone: '+48 600 123 456', tags: ['New Student'] },
  { first: 'Grace', last: 'Taylor', pref: 'Gracie', dob: '2015-08-15', country: 'GB', city: 'Bristol', postal: 'BS1 4ST', line1: '9 Harbourside', house: 0, year: 1, subject: 'Charms', color: 'lavender', pet: 'Muffin', owl: 'Pebble', creature: 'pixie', interests: 'singing, crafts', guardian: 'Laura Taylor', email: 'laura.taylor@example.com', phone: '+44 7700 900321', tags: ['Gift'] },
  { first: 'John', last: 'Smith', dob: '2014-06-02', country: 'GB', city: 'Leeds', postal: 'LS1 4AP', line1: '14 Park Row', house: 2, year: 2, subject: 'Flying', color: 'green', pet: 'Rex', owl: 'Archie', creature: 'hippogriff', interests: 'cricket', guardian: 'Jane Smith', email: 'jane.smith@example.com', phone: '+44 7700 900999', tags: ['Returning'] },
  { first: 'John', last: 'Smith', dob: '2014-06-02', country: 'GB', city: 'Leeds', postal: 'LS1 4AP', line1: '14 Park Row', line2: 'Flat 2', house: 2, year: 2, subject: '', color: '', pet: '', owl: '', creature: '', interests: '', guardian: 'Jane Smith', email: 'jane.smith@example.com', phone: '', tags: [] },
  { first: 'Leo', last: 'Fischer', dob: '2016-06-06', country: 'CH', city: 'Zürich', postal: '8001', line1: 'Bahnhofstrasse 10', house: 3, year: 1, subject: 'Clockwork charms', color: 'brass', pet: 'Tick', owl: 'Tock', creature: 'golem', interests: 'clocks, mountains', guardian: 'Marc Fischer', email: 'marc.fischer@example.com', phone: '+41 79 123 45 67', tags: [] },
  { first: 'Zoe', last: 'Adams', country: 'US', city: 'Seattle', region: 'WA', postal: '', line1: '', house: 3, year: 1, subject: '', color: 'teal', pet: '', owl: '', creature: '', interests: '', guardian: 'Chris Adams', email: 'chris.adams@example.com', phone: '', tags: ['Special Delivery'], status: 'prospect' },
  { first: 'Freddie', last: 'Hughes', dob: '2015-02-27', country: 'GB', city: 'Cardiff', postal: 'CF10 XX', line1: '3 Castle Street', house: 1, year: 1, subject: 'Flying', color: 'red', pet: 'Taffy', owl: 'Dewi', creature: 'red dragon', interests: 'rugby, choir', guardian: 'Rhian Hughes', email: 'rhian.hughes@example', phone: '+44 7700 900654', tags: ['New Student'] },
  { first: 'Ruby', last: 'Collins', dob: '2015-10-04', country: 'GB', city: 'York', postal: 'YO1 7HH', line1: '22 Stonegate', house: 1, year: 1, subject: 'Divination', color: 'ruby red', pet: 'Clementine', owl: 'Sorrel', creature: 'phoenix', interests: 'theatre, tarot', guardian: 'Megan Collins', email: 'megan.collins@example.com', phone: '+44 7700 900777', tags: ['Birthday', 'Quest'] },
  { first: 'Jack', last: 'Morrison', dob: '2013-04-18', country: 'GB', city: 'Glasgow', postal: 'G1 1XQ', line1: '40 George Square', house: 2, year: 4, subject: 'Herbology', color: 'tartan green', pet: 'Hamish', owl: 'Bonnie', creature: 'kelpie', interests: 'bagpipes, history', guardian: 'Iain Morrison', email: 'iain.m@example.com', phone: '+44 7700 900888', tags: ['Returning'], status: 'archived' },
];

const TAGS: [string, string][] = [
  ['Birthday', '#b0607a'],
  ['New Student', '#2f6b4f'],
  ['Returning', '#4b6a99'],
  ['VIP', '#b08d57'],
  ['Gift', '#8e5aa8'],
  ['Christmas', '#a33a2f'],
  ['School Event', '#3f7f8c'],
  ['Quest', '#6b4a2b'],
  ['Special Delivery', '#c26a2a'],
];

export interface SeedResult {
  recipients: number;
  orders: number;
}

/** Builds a complete, internally consistent demo workspace with a year of history. */
export async function loadDemoWorkspace(): Promise<SeedResult> {
  const now = new Date();
  const rnd = seededRandom('owlpost-demo');
  const daysAgo = (n: number, hour = 10) => {
    const d = addDays(now, -n);
    d.setHours(hour, Math.floor(rnd() * 59), 0, 0);
    return d.toISOString();
  };

  const settings: AppSettings = { ...defaultSettings(), workspace: { createdAt: daysAgo(370), demo: true } };
  const houses = seedHouses();
  const seals = seedSeals(houses);
  const stamps = seedStamps();
  const postmarks = seedPostmarks();
  const characters = seedCharacters(houses, seals);
  const envelopes = seedEnvelopes();
  const { templates, byName } = seedTemplates({ envelopes, stamps, postmarks, seals, characters });
  settings.mail.defaultSenderId = characters[0].id;
  settings.mail.defaultLetterTemplateId = byName['Admission Letter'].id;
  settings.defaults = {
    paper: 'parchment',
    envelopeId: envelopes[0].id,
    stampId: stamps[0].id,
    postmarkId: postmarks[0].id,
    sealId: seals[0].id,
  };

  const tags: Tag[] = TAGS.map(([name, color]) => ({ id: uid(), name, color }));
  const tagId = (n: string) => tags.find((t) => t.name === n)!.id;

  const products: Product[] = [
    { id: uid(), sku: 'PKG-ADM', name: 'Admission Package', description: 'Admission letter, student card, enrolment certificate, wax-sealed C5 envelope.', category: 'package', price: 34, templateId: byName['Admission Letter'].id, documentTemplateIds: [byName['Student Card'].id, byName['Certificate of Enrolment'].id], active: true, createdAt: daysAgo(380) },
    { id: uid(), sku: 'LTR-BDAY', name: 'Birthday Letter', description: 'A5 birthday letter in a rose C6 envelope.', category: 'letter', price: 14.5, templateId: byName['Birthday Letter'].id, documentTemplateIds: [], active: true, createdAt: daysAgo(380) },
    { id: uid(), sku: 'LTR-XMAS', name: 'Midwinter Letter', description: 'Gold-on-midnight seasonal letter.', category: 'letter', price: 16, templateId: byName['Midwinter Letter'].id, documentTemplateIds: [], active: true, createdAt: daysAgo(380) },
    { id: uid(), sku: 'PKG-QUEST', name: 'Quest Pack', description: 'Quest letter with quest card and mirror-written secret message.', category: 'package', price: 22, templateId: byName['Special Quest'].id, documentTemplateIds: [byName['Quest Card'].id, byName['Secret Message'].id], active: true, createdAt: daysAgo(380) },
    { id: uid(), sku: 'DOC-HOUSE', name: 'House Certificate', description: 'A5 house certificate add-on.', category: 'document', price: 6, templateId: byName['House Certificate'].id, documentTemplateIds: [], active: true, createdAt: daysAgo(380) },
    { id: uid(), sku: 'DOC-ACH', name: 'Certificate of Achievement', description: 'Landscape certificate with gold seal.', category: 'document', price: 9.5, templateId: byName['Certificate of Achievement'].id, documentTemplateIds: [], active: true, createdAt: daysAgo(380) },
    { id: uid(), sku: 'ADD-WAX', name: 'Real wax seal upgrade', description: 'Hand-poured wax seal instead of printed seal.', category: 'addon', price: 3.5, documentTemplateIds: [], active: true, createdAt: daysAgo(380) },
    { id: uid(), sku: 'SHP-EXP', name: 'Express Owl Delivery', description: 'Tracked express shipping.', category: 'shipping', price: 7.9, documentTemplateIds: [], active: true, createdAt: daysAgo(380) },
  ];
  const product = (sku: string) => products.find((p) => p.sku === sku)!;

  // ── Recipients & customers ──
  const customers: Customer[] = [];
  const recipients: Recipient[] = [];
  let custSeq = 0;
  PEOPLE.forEach((p, i) => {
    const created = daysAgo(360 - i * 11);
    let customer = customers.find((c) => c.email === p.email);
    if (!customer) {
      custSeq++;
      customer = {
        id: uid(),
        code: `C-${pad(custSeq, 5)}`,
        name: p.guardian,
        email: p.email,
        phone: p.phone,
        notes: '',
        createdAt: created,
        updatedAt: created,
      };
      customers.push(customer);
    }
    const addr: Address = {
      id: uid(),
      label: 'home',
      name: '',
      line1: p.line1,
      line2: p.line2 ?? '',
      extra: '',
      city: p.city,
      region: p.region ?? '',
      postalCode: p.postal,
      country: p.country,
      notes: '',
    };
    const addresses = [addr];
    if (i === 0)
      addresses.push({ id: uid(), label: 'school', name: 'Alex Smith c/o Larkspur Primary', line1: '1 School Road', line2: '', extra: '', city: 'London', region: '', postalCode: 'NW1 7AA', country: 'GB', notes: 'Term-time only' });
    recipients.push({
      id: uid(),
      code: pad(184 + i, 6),
      firstName: p.first,
      lastName: p.last,
      preferredName: p.pref ?? '',
      dob: p.dob,
      birthday: p.dob?.slice(5),
      addresses,
      defaultAddressId: addr.id,
      guardianName: p.guardian,
      guardianPhone: p.phone,
      guardianEmail: p.email,
      altContact: '',
      preferredContact: p.email ? 'email' : 'post',
      deliveryInstructions: i === 0 ? 'Leave with the neighbour at No. 14 if nobody is home.' : '',
      mailingNotes: i === 1 ? 'Wants real wax seals on everything.' : '',
      houseId: houses[p.house].id,
      schoolYear: p.year,
      favoriteSubject: p.subject,
      favoriteColor: p.color,
      petName: p.pet,
      owlName: p.owl,
      characterId: undefined,
      favoriteCreature: p.creature,
      interests: p.interests,
      specialOccasion: p.tags.includes('Birthday') ? 'Birthday' : '',
      customerId: customer.id,
      status: p.status ?? 'active',
      tagIds: p.tags.map(tagId),
      notes: i === 19 ? 'Possibly entered twice by mistake – check duplicates.' : '',
      city: p.city,
      country: p.country,
      createdAt: created,
      updatedAt: created,
      createdBy: 'Admin',
    });
  });

  // ── Orders, projects, documents, shipments ──
  const orders: Order[] = [];
  const projects: Project[] = [];
  const documents: GeneratedDoc[] = [];
  const shipments: Shipment[] = [];
  const activity: Activity[] = [];
  const counters: Record<string, number> = {};
  const next = (key: string) => (counters[key] = (counters[key] ?? 0) + 1);
  const log = (ts: string, action: Activity['action'], entityType: string, summary: string, extra: Partial<Activity> = {}, who = 'Admin', role = 'admin') =>
    activity.push({ id: uid(), ts, userId: 'seed', userName: who, role, action, entityType, summary, ...extra });

  const plan: { r: number; sku: string; age: number; extra?: string[] }[] = [];
  // A year of orders – older ones delivered, recent ones in flight.
  const skus = ['PKG-ADM', 'LTR-BDAY', 'LTR-XMAS', 'PKG-QUEST', 'PKG-ADM', 'DOC-ACH'];
  recipients.forEach((r, i) => {
    if (r.status === 'prospect' || i === 20) return;
    const n = 1 + (i % 3 === 0 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const age = Math.max(1, Math.round(330 - i * 12 - k * 140 + rnd() * 20));
      plan.push({ r: i, sku: skus[(i + k) % skus.length], age: age < 0 ? 2 + i : age, extra: i % 4 === 1 ? ['ADD-WAX'] : i % 5 === 2 ? ['DOC-HOUSE'] : [] });
    }
  });
  // Fresh activity for the production board.
  [
    { r: 0, sku: 'PKG-ADM', age: 1 },
    { r: 3, sku: 'LTR-BDAY', age: 2 },
    { r: 9, sku: 'LTR-BDAY', age: 3 },
    { r: 24, sku: 'PKG-QUEST', age: 4 },
    { r: 12, sku: 'PKG-ADM', age: 5 },
    { r: 8, sku: 'PKG-ADM', age: 6 },
    { r: 4, sku: 'PKG-ADM', age: 7 },
    { r: 17, sku: 'PKG-ADM', age: 8 },
    { r: 18, sku: 'DOC-ACH', age: 9 },
    { r: 13, sku: 'LTR-BDAY', age: 12 },
    { r: 1, sku: 'PKG-QUEST', age: 15 },
    { r: 6, sku: 'PKG-ADM', age: 19 },
  ].forEach((x) => plan.push({ ...x, extra: [] }));
  plan.sort((a, b) => b.age - a.age);

  const stageFor = (age: number, i: number): { order: OrderStatus; stage: ProjectStage; ship?: ShipmentStatus } => {
    if (age > 40) return i % 17 === 5 ? { order: 'delivered', stage: 'ready', ship: 'returned' } : { order: 'delivered', stage: 'ready', ship: 'delivered' };
    if (age > 21) return { order: 'delivered', stage: 'ready', ship: 'delivered' };
    if (age > 14) return { order: 'shipped', stage: 'ready', ship: i % 2 ? 'in_transit' : 'out_for_delivery' };
    if (age > 10) return { order: 'shipped', stage: 'ready', ship: 'shipped' };
    const ladder: { order: OrderStatus; stage: ProjectStage; ship?: ShipmentStatus }[] = [
      { order: 'new', stage: 'created' },
      { order: 'confirmed', stage: 'created' },
      { order: 'in_production', stage: 'approved' },
      { order: 'ready_to_print', stage: 'generated' },
      { order: 'ready_to_print', stage: 'generated' },
      { order: 'printed', stage: 'printed' },
      { order: 'printed', stage: 'folded' },
      { order: 'packed', stage: 'packed' },
      { order: 'packed', stage: 'ready', ship: 'preparing' },
      { order: 'packed', stage: 'ready', ship: 'label_created' },
    ];
    return ladder[Math.min(ladder.length - 1, Math.max(0, age - 1))];
  };

  const completedBatchProjects: string[] = [];
  const draftBatchProjects: string[] = [];
  plan.forEach((pl, idx) => {
    const r = recipients[pl.r];
    const createdISO = daysAgo(pl.age, 9 + (idx % 8));
    const created = new Date(createdISO);
    const y = created.getFullYear();
    const st = stageFor(pl.age, idx);
    const prod = product(pl.sku);
    const items = [{ id: uid(), productId: prod.id, name: prod.name, qty: 1, unitPrice: prod.price }];
    for (const sku of pl.extra ?? []) {
      const p = product(sku);
      items.push({ id: uid(), productId: p.id, name: p.name, qty: 1, unitPrice: p.price });
    }
    const intl = r.country !== 'GB';
    const order: Order = {
      id: uid(),
      number: `HM-${y}-${pad(next(`order-${y}`) + 1800, 6)}`,
      customerId: r.customerId,
      recipientId: r.id,
      items,
      discountType: idx % 9 === 3 ? 'percent' : 'amount',
      discountValue: idx % 9 === 3 ? 10 : 0,
      shippingFee: intl ? 4.5 : 0,
      total: 0,
      currency: settings.regional.currency,
      status: st.order,
      paymentStatus: st.order === 'new' ? 'unpaid' : idx % 13 === 4 ? 'partial' : 'paid',
      amountPaid: 0,
      productionStatus: st.stage === 'created' ? 'not_started' : ['packed', 'ready'].includes(st.stage) ? 'done' : 'in_progress',
      shippingStatus: !st.ship || st.ship === 'preparing' || st.ship === 'label_created' ? 'not_shipped' : st.ship === 'delivered' ? 'delivered' : st.ship === 'returned' ? 'returned' : 'shipped',
      trackingNumber: '',
      dueDate: toISODate(addDays(created, 10)),
      notes: idx % 7 === 2 ? 'Please deliver before the weekend.' : '',
      statusHistory: [{ status: 'new', at: createdISO, by: 'Admin' }],
      createdAt: createdISO,
      updatedAt: createdISO,
      createdBy: 'Admin',
    };
    order.total = orderTotal(order);
    order.amountPaid = order.paymentStatus === 'paid' ? order.total : order.paymentStatus === 'partial' ? Math.round(order.total / 2) : 0;
    if (st.order !== 'new') order.statusHistory.push({ status: st.order, at: daysAgo(Math.max(0, pl.age - 2)), by: 'Admin' });
    orders.push(order);
    log(createdISO, 'create', 'order', `Created order ${order.number}`, { entityId: order.id, entityLabel: order.number, recipientId: r.id });

    const t = templates.find((x) => x.id === prod.templateId)!;
    const lang = PEOPLE[pl.r].lang;
    const letterTemplate = t.category === 'admission' && lang === 'ru' ? byName['Письмо о зачислении'] : t.category === 'admission' && lang === 'hy' ? byName['Ընդունելության նամակ'] : t;
    const docTemplates = [...letterTemplate.documentTemplateIds, ...(pl.extra?.includes('DOC-HOUSE') ? [byName['House Certificate'].id] : [])]
      .map((id) => templates.find((x) => x.id === id)!)
      .filter(Boolean);
    const env = envelopes.find((e) => e.id === letterTemplate.envelopeId) ?? envelopes[0];
    const stageIdx = PROJECT_STAGES.indexOf(st.stage);
    const project: Project = {
      id: uid(),
      code: `P-${y}-${pad(next(`project-${y}`), 4)}`,
      name: `${letterTemplate.name} — ${r.firstName} ${r.lastName}`,
      recipientId: r.id,
      orderId: order.id,
      templateId: letterTemplate.id,
      category: letterTemplate.category,
      letter: copyLayout(letterTemplate.kind === 'document' ? letterTemplate.layout : letterTemplate.layout),
      envelope: copyEnvelope(env),
      stampId: letterTemplate.stampId,
      postmarkId: letterTemplate.postmarkId,
      postmarkDate: undefined,
      sealId: letterTemplate.sealId,
      senderId: letterTemplate.senderId,
      documents: docTemplates.map(projectDocFromTemplate),
      fold: letterTemplate.kind === 'document' ? 'none' : letterTemplate.fold,
      print: {},
      shipping: { addressId: r.defaultAddressId, carrierId: intl ? (r.country === 'RU' ? 'russianpost' : r.country === 'AM' ? 'haypost' : r.country === 'US' ? 'usps' : 'dhl') : 'royalmail', service: '', notes: '' },
      stage: st.stage,
      status: 'active',
      assembly: {},
      inventoryDeducted: stageIdx >= PROJECT_STAGES.indexOf('packed'),
      dueDate: order.dueDate,
      stageHistory: PROJECT_STAGES.slice(0, stageIdx + 1).map((s, k) => ({ status: s, at: daysAgo(Math.max(0, pl.age - k * 0.6)), by: k > 2 ? 'Production' : 'Admin' })),
      createdAt: createdISO,
      updatedAt: createdISO,
      createdBy: 'Admin',
    };
    if (letterTemplate.kind === 'document') {
      // Certificate-only orders: the certificate is the main "letter".
      project.fold = 'none';
      project.envelope = copyEnvelope(envelopes[0]);
    }
    if (stageIdx >= PROJECT_STAGES.indexOf('ready')) project.assembly = Object.fromEntries(['print', 'cut', 'fold', 'insert', 'seal', 'stamp', 'pack'].map((k) => [k, true]));
    projects.push(project);
    log(createdISO, 'create', 'project', `Created project ${project.code}`, { entityId: project.id, entityLabel: project.code, recipientId: r.id });

    let shipment: Shipment | undefined;
    if (st.ship) {
      const shipAge = Math.max(0, pl.age - 5);
      const sy = new Date(daysAgo(shipAge)).getFullYear();
      const flow: ShipmentStatus[] =
        st.ship === 'returned' ? ['preparing', 'label_created', 'shipped', 'in_transit', 'returned'] : ['preparing', 'label_created', 'shipped', 'in_transit', 'out_for_delivery', 'delivered'];
      const upto = flow.indexOf(st.ship);
      const carrierId = project.shipping.carrierId!;
      const tracking = carrierId === 'owl' ? '' : `${carrierId.slice(0, 2).toUpperCase()}${pad(Math.floor(rnd() * 1e9), 9)}${r.country}`;
      shipment = {
        id: uid(),
        code: `SH-${sy}-${pad(next(`shipment-${sy}`), 5)}`,
        orderId: order.id,
        projectId: project.id,
        recipientId: r.id,
        recipientName: `${r.firstName} ${r.lastName}`,
        address: { ...r.addresses[0] },
        carrierId,
        service: settings.carriers.find((c) => c.id === carrierId)?.services[0] ?? '',
        trackingNumber: upto >= 1 ? tracking : '',
        shippingDate: upto >= 2 ? toISODate(new Date(daysAgo(shipAge))) : undefined,
        estimatedDelivery: upto >= 1 ? toISODate(addDays(new Date(daysAgo(shipAge)), intl ? 7 : 3)) : undefined,
        deliveredAt: st.ship === 'delivered' ? daysAgo(Math.max(0, shipAge - (intl ? 6 : 2))) : undefined,
        status: st.ship,
        cost: intl ? 6.8 : 2.4,
        weight: 45 + docTemplates.length * 12,
        events: flow.slice(0, upto + 1).map((s, k) => ({ status: s, at: daysAgo(Math.max(0, shipAge - k * (intl ? 1.5 : 0.6))), by: 'Production' })),
        notes: '',
        createdAt: daysAgo(shipAge + 1),
        updatedAt: daysAgo(shipAge),
      };
      if (shipment.trackingNumber) order.trackingNumber = shipment.trackingNumber;
      shipments.push(shipment);
      log(shipment.createdAt, 'ship', 'shipment', `${shipment.code} → ${shipment.status}`, { entityId: shipment.id, entityLabel: shipment.code, recipientId: r.id }, 'Production', 'production');
    }

    if (stageIdx >= PROJECT_STAGES.indexOf('generated')) {
      const house = houses.find((h) => h.id === r.houseId);
      const sender = characters.find((c) => c.id === project.senderId);
      const genAt = daysAgo(Math.max(0, pl.age - 1));
      const gy = new Date(genAt).getFullYear();
      const make = (kind: GeneratedDoc['kind'], title: string, layoutText_: (vars: Record<string, string>) => string, extra: Partial<GeneratedDoc> = {}) => {
        const seq = next(`doc-${gy}`);
        const number = formatDocumentNumber(settings.mail.documentNumberFormat, seq, r.code, new Date(genAt));
        const vars = buildContext({ recipient: r, house, sender, settings, order, project, shipment, documentNumber: number, date: genAt.slice(0, 10) });
        const printed = stageIdx >= PROJECT_STAGES.indexOf('printed');
        documents.push({
          id: uid(),
          code: `DOC-${gy}-${pad(seq, 5)}`,
          number,
          projectId: project.id,
          recipientId: r.id,
          orderId: order.id,
          kind,
          title,
          text: layoutText_(vars),
          status: printed ? 'printed' : 'generated',
          createdAt: genAt,
          printedAt: printed ? daysAgo(Math.max(0, pl.age - 2)) : undefined,
          createdBy: 'Admin',
          ...extra,
        });
      };
      make('letter', letterTemplate.name, (v) => layoutText(project.letter, v), { templateId: letterTemplate.id });
      for (const d of project.documents) make('document', d.name, (v) => layoutText(d.layout, v), { templateId: d.templateId, docType: d.docType });
      make('envelope', `${project.envelope.size} envelope`, (v) => v.address_block);
      log(genAt, 'generate', 'project', `Generated ${project.documents.length + 2} item(s) for ${project.code}`, { entityId: project.id, entityLabel: project.code, recipientId: r.id }, 'Editor', 'editor');
      if (stageIdx >= PROJECT_STAGES.indexOf('printed') && pl.age > 30 && pl.age < 80) completedBatchProjects.push(project.id);
      if (st.stage === 'generated') draftBatchProjects.push(project.id);
    }
    if (st.ship && ['delivered', 'shipped', 'in_transit', 'out_for_delivery'].includes(st.ship)) r.lastContactAt = shipment?.shippingDate ? `${shipment.shippingDate}T12:00:00.000Z` : r.lastContactAt;
  });

  // ── Print batches ──
  const batches: PrintBatch[] = [];
  const mkBatch = (ids: string[], status: PrintBatch['status'], age: number, name: string) => {
    if (!ids.length) return;
    const at = daysAgo(age);
    const by = new Date(at).getFullYear();
    const b: PrintBatch = {
      id: uid(),
      code: `B-${by}-${pad(next(`batch-${by}`) + 41, 4)}`,
      name,
      projectIds: ids,
      status,
      settings: { ...settings.print },
      include: { letters: true, envelopes: true, labels: true, stamps: false, documents: true, packingSlips: true },
      notes: '',
      createdAt: at,
      updatedAt: at,
      printedAt: status === 'completed' || status === 'printed' ? at : undefined,
      createdBy: 'Production',
    };
    batches.push(b);
    for (const p of projects) if (ids.includes(p.id)) p.batchId = b.id;
    for (const d of documents) if (ids.includes(d.projectId) && status !== 'draft') d.batchId = b.id;
    log(at, 'print', 'batch', `Printed batch ${b.code}`, { entityId: b.id, entityLabel: b.code }, 'Production', 'production');
  };
  mkBatch(completedBatchProjects, 'completed', 45, 'Late summer admissions');
  mkBatch(draftBatchProjects, 'draft', 1, 'This week – ready to print');

  // ── Suppliers & inventory ──
  const supplier = (name: string, contact: string, email: string, phone: string, website: string, productsText: string, prices: string, lastOrderAge: number): Supplier => ({
    id: uid(),
    name,
    contact,
    email,
    phone,
    website,
    products: productsText,
    prices,
    notes: '',
    lastOrder: toISODate(addDays(now, -lastOrderAge)),
    createdAt: daysAgo(380),
    updatedAt: daysAgo(lastOrderAge),
  });
  const suppliers = [
    supplier('Vellum & Quill Paper Co.', 'Harriet Vellum', 'orders@vellumquill.example', '+44 20 7946 0101', 'https://vellumquill.example', 'Parchment paper, card stock, envelopes', 'A4 parchment 120gsm £0.18/sheet; C5 envelopes £0.32', 21),
    supplier('Ember Wax Works', 'Tomas Ember', 'hello@emberwax.example', '+44 161 496 0202', 'https://emberwax.example', 'Sealing wax sticks, brass seal dies', 'Wax stick £1.10; custom die £38', 48),
    supplier('Postbox Labels Ltd', 'Priya Shah', 'sales@postboxlabels.example', '+44 113 496 0303', 'https://postboxlabels.example', 'Address labels, kraft boxes, tissue', 'L7163 sheet £0.21; gift box £1.40', 12),
    supplier('Inkwell Printing Supplies', 'Owen Marsh', 'support@inkwell.example', '+44 29 2018 0404', 'https://inkwell.example', 'Printer ink, toner, maintenance kits', 'Black ink £18; colour ink £24', 63),
  ];
  const inv = (name: string, category: InventoryItem['category'], sku: string, quantity: number, minQuantity: number, unit: string, location: string, s: Supplier, cost: number, usagePerPackage: number): InventoryItem => ({
    id: uid(),
    name,
    category,
    sku,
    quantity,
    minQuantity,
    unit,
    location,
    supplierId: s.id,
    cost,
    notes: '',
    usagePerPackage,
    movements: [
      { id: uid(), at: daysAgo(90), delta: quantity + Math.round(minQuantity * 1.5), reason: 'purchase', note: 'Initial stock', by: 'Admin' },
      { id: uid(), at: daysAgo(30), delta: -Math.round(minQuantity * 1.5), reason: 'consumption', note: 'Packed mail packages', by: 'Production' },
    ],
    createdAt: daysAgo(380),
    updatedAt: daysAgo(10),
  });
  const [paperS, waxS, labelS, inkS] = suppliers;
  const inventory: InventoryItem[] = [
    inv('Envelopes C5 · parchment', 'envelopes', 'ENV-C5-PAR', 140, 50, 'pcs', 'Shelf A1', paperS, 0.32, 1),
    inv('Envelopes DL · kraft', 'envelopes', 'ENV-DL-KRA', 35, 40, 'pcs', 'Shelf A2', paperS, 0.24, 0),
    inv('Envelopes C6 · cream', 'envelopes', 'ENV-C6-CRM', 60, 30, 'pcs', 'Shelf A3', paperS, 0.21, 0),
    inv('Paper A4 parchment 120gsm', 'paper', 'PAP-A4-PAR', 480, 200, 'sheets', 'Shelf B1', paperS, 0.18, 2),
    inv('Paper A5 cream 100gsm', 'paper', 'PAP-A5-CRM', 90, 100, 'sheets', 'Shelf B2', paperS, 0.09, 0),
    inv('Card stock 300gsm (cards)', 'cards', 'CRD-300', 210, 100, 'sheets', 'Shelf B3', paperS, 0.35, 0.2),
    inv('Sealing wax · burgundy', 'wax', 'WAX-BUR', 12, 10, 'sticks', 'Drawer C1', waxS, 1.1, 0.1),
    inv('Sealing wax · gold', 'wax', 'WAX-GLD', 3, 5, 'sticks', 'Drawer C1', waxS, 1.25, 0),
    inv('Brass seal die · owl', 'seals', 'SEAL-OWL', 2, 1, 'pcs', 'Drawer C2', waxS, 38, 0),
    inv('Address labels L7163', 'labels', 'LBL-L7163', 38, 20, 'sheets', 'Shelf D1', labelS, 0.21, 0.07),
    inv('Kraft gift boxes', 'packaging', 'PKG-BOX', 24, 15, 'pcs', 'Floor E', labelS, 1.4, 0),
    inv('Tissue paper · ivory', 'packaging', 'PKG-TIS', 40, 20, 'sheets', 'Floor E', labelS, 0.12, 0),
    inv('Printer ink · black', 'printing', 'INK-BLK', 2, 2, 'cartridges', 'Cabinet F', inkS, 18, 0.01),
    inv('Printer ink · colour', 'printing', 'INK-COL', 1, 2, 'cartridges', 'Cabinet F', inkS, 24, 0.01),
    inv('Postage stamps (real) · 1st class', 'stamps', 'STP-1ST', 64, 40, 'pcs', 'Safe', labelS, 1.35, 0),
  ];

  // ── Notes & tasks ──
  const notes: Note[] = [
    { id: uid(), recipientId: recipients[0].id, text: 'Parent asked for the owl to be named Hazel in every letter. Loves maps – consider a quest pack for the winter.', pinned: true, createdAt: daysAgo(40), updatedAt: daysAgo(40), createdBy: 'Admin' },
    { id: uid(), recipientId: recipients[0].id, text: 'Called Morgan: confirmed new flat number (Flat 3).', pinned: false, createdAt: daysAgo(12), updatedAt: daysAgo(12), createdBy: 'Editor' },
    { id: uid(), recipientId: recipients[1].id, text: 'VIP – always use real wax seals and hand-written envelope.', pinned: true, createdAt: daysAgo(100), updatedAt: daysAgo(100), createdBy: 'Admin' },
    { id: uid(), recipientId: recipients[9].id, text: 'Пишем по-русски. Любит кошек.', pinned: false, createdAt: daysAgo(60), updatedAt: daysAgo(60), createdBy: 'Editor' },
  ];
  const today = new Date();
  const task = (title: string, type: Task['type'], r: Recipient | undefined, inDays: number, done = false): Task => ({
    id: uid(),
    title,
    type,
    recipientId: r?.id,
    dueDate: toISODate(addDays(today, inDays)),
    done,
    notes: '',
    createdAt: daysAgo(5),
    createdBy: 'Admin',
  });
  const tasks: Task[] = [
    task('Send birthday letter to Ruby', 'birthday', recipients[24], 1),
    task('Birthday letter for Анна', 'birthday', recipients[9], 4),
    task('Follow up: returned shipment – confirm address', 'followup', recipients[5], 0),
    task('Schedule winter quest for Alex', 'contact', recipients[0], 9),
    task('Call Chris Adams for the mailing address', 'contact', recipients[22], 2),
    task('Order more gold sealing wax', 'production', undefined, -1),
    task('Christmas letters – start design review', 'production', undefined, 30),
  ];

  // ── Activity for recipients ──
  for (const r of recipients) log(r.createdAt, 'create', 'recipient', `Created recipient #${r.code}`, { entityId: r.id, entityLabel: `#${r.code}`, recipientId: r.id });
  log(daysAgo(12), 'update', 'recipient', `Changed addresses of #${recipients[0].code}`, { entityId: recipients[0].id, entityLabel: `#${recipients[0].code}`, recipientId: recipients[0].id, fields: ['addresses'] }, 'Editor', 'editor');

  counters.recipient = 184 + recipients.length;
  counters.customer = custSeq;

  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) await t.clear();
    await db.settings.put(settings);
    await db.houses.bulkAdd(houses);
    await db.seals.bulkAdd(seals);
    await db.stamps.bulkAdd(stamps);
    await db.postmarks.bulkAdd(postmarks);
    await db.characters.bulkAdd(characters);
    await db.envelopes.bulkAdd(envelopes);
    await db.templates.bulkAdd(templates);
    await db.tags.bulkAdd(tags);
    await db.products.bulkAdd(products);
    await db.customers.bulkAdd(customers);
    await db.recipients.bulkAdd(recipients);
    await db.orders.bulkAdd(orders);
    await db.projects.bulkAdd(projects);
    await db.documents.bulkAdd(documents);
    await db.shipments.bulkAdd(shipments);
    await db.batches.bulkAdd(batches);
    await db.suppliers.bulkAdd(suppliers);
    await db.inventory.bulkAdd(inventory);
    await db.notes.bulkAdd(notes);
    await db.tasks.bulkAdd(tasks);
    await db.activity.bulkAdd(activity);
    await db.counters.bulkPut(Object.entries(counters).map(([key, value]) => ({ key, value: key.startsWith('order-') ? value + 1800 : key.startsWith('batch-') ? value + 41 : value })));
  });
  return { recipients: recipients.length, orders: orders.length };
}

/** Empty workspace with the essential library (houses, designs, templates) but no people or orders. */
export async function loadStarterLibrary() {
  const settings: AppSettings = defaultSettings();
  const houses = seedHouses();
  const seals = seedSeals(houses);
  const stamps = seedStamps();
  const postmarks = seedPostmarks();
  const characters = seedCharacters(houses, seals);
  const envelopes = seedEnvelopes();
  const { templates, byName } = seedTemplates({ envelopes, stamps, postmarks, seals, characters });
  settings.mail.defaultSenderId = characters[0].id;
  settings.mail.defaultLetterTemplateId = byName['Admission Letter'].id;
  settings.defaults = { paper: 'parchment', envelopeId: envelopes[0].id, stampId: stamps[0].id, postmarkId: postmarks[0].id, sealId: seals[0].id };
  const tags: Tag[] = TAGS.map(([name, color]) => ({ id: uid(), name, color }));
  await db.transaction('rw', db.tables, async () => {
    await db.settings.put(settings);
    await db.houses.bulkPut(houses);
    await db.seals.bulkPut(seals);
    await db.stamps.bulkPut(stamps);
    await db.postmarks.bulkPut(postmarks);
    await db.characters.bulkPut(characters);
    await db.envelopes.bulkPut(envelopes);
    await db.templates.bulkPut(templates);
    await db.tags.bulkPut(tags);
  });
}
