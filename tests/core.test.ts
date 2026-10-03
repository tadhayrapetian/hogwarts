import { describe, expect, it } from 'vitest';
import { parseCSV, toCSV } from '../src/core/csv';
import { isValidPostalCode, formatAddressLines, resolveCountry } from '../src/core/countries';
import { findDuplicates, jaroWinkler, latinize, scorePair } from '../src/core/duplicates';
import { autoMapHeaders, rowToDraft } from '../src/core/importMap';
import { deriveOrderShipping, discountAmount, orderTotal, orderStatusFromStages } from '../src/core/orders';
import { can, DEFAULT_ROLE_PERMISSIONS } from '../src/core/permissions';
import { buildContext, findUnresolved, findVariables, formatDocumentNumber, renderTemplate } from '../src/core/template';
import type { Recipient, Shipment, User } from '../src/core/types';
import { ageFromDob, daysUntilBirthday, normalizeDateInput } from '../src/core/util';
import { isValidEmail, isValidPhone, validateRecipient } from '../src/core/validation';
import { readXlsx, writeXlsx } from '../src/core/xlsx';

function recipient(p: Partial<Recipient> = {}): Recipient {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    code: '000001',
    firstName: 'Alex',
    lastName: 'Smith',
    preferredName: '',
    addresses: [{ id: 'a', label: 'home', name: '', line1: '12 Larkspur Lane', line2: '', extra: '', city: 'London', region: '', postalCode: 'NW1 6XE', country: 'GB', notes: '' }],
    defaultAddressId: 'a',
    guardianName: '',
    guardianPhone: '',
    guardianEmail: '',
    altContact: '',
    preferredContact: 'post',
    deliveryInstructions: '',
    mailingNotes: '',
    favoriteSubject: '',
    favoriteColor: '',
    petName: '',
    owlName: '',
    favoriteCreature: '',
    interests: '',
    specialOccasion: '',
    status: 'active',
    tagIds: [],
    notes: '',
    city: 'London',
    country: 'GB',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'test',
    ...p,
  };
}

describe('template engine', () => {
  it('substitutes variables, fallbacks and reports unresolved ones', () => {
    const ctx = { first_name: 'Alex', pet_name: '' };
    expect(renderTemplate('Dear {{first_name}}!', ctx)).toBe('Dear Alex!');
    expect(renderTemplate('Pet: {{pet_name|your companion}}', ctx)).toBe('Pet: your companion');
    expect(renderTemplate('Owl: {{ owl_name }}.', ctx)).toBe('Owl: .');
    expect(findVariables('{{a}} {{b|x}} {{a}}')).toEqual(['a', 'b']);
    expect(findUnresolved('{{first_name}} {{pet_name}} {{owl_name|none}}', ctx)).toEqual(['pet_name']);
  });

  it('formats document numbers', () => {
    expect(formatDocumentNumber('EGA/{YYYY}/{NNNNN}', 42, '', new Date(2026, 9, 3))).toBe('EGA/2026/00042');
    expect(formatDocumentNumber('{YY}{MM}-{CODE}-{SEQ}', 7, '000184', new Date(2026, 0, 5))).toBe('2601-000184-7');
  });

  it('builds a personalised context with a country-formatted address block', () => {
    const vars = buildContext({ recipient: recipient({ schoolYear: 2, petName: 'Biscuit' }), lang: 'en', date: '2026-10-03' });
    expect(vars.full_name).toBe('Alex Smith');
    expect(vars.address_block.split('\n')).toEqual(['Alex Smith', '12 Larkspur Lane', 'LONDON', 'NW1 6XE', 'UNITED KINGDOM']);
    expect(vars.school_year_ordinal).toBe('2nd');
    expect(vars.year).toBe('2026');
  });
});

describe('validation', () => {
  it('validates email, phone and postal codes per country', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('rhian.hughes@example')).toBe(false);
    expect(isValidPhone('+44 7700 900123')).toBe(true);
    expect(isValidPhone('12-34')).toBe(false);
    expect(isValidPostalCode('GB', 'SW1A 1AA')).toBe(true);
    expect(isValidPostalCode('GB', 'CF10 XX')).toBe(false);
    expect(isValidPostalCode('RU', '101000')).toBe(true);
    expect(isValidPostalCode('AM', '0010')).toBe(true);
    expect(isValidPostalCode('US', '0210')).toBe(false);
    expect(isValidPostalCode('AE', '')).toBe(true);
  });

  it('flags required fields and missing addresses', () => {
    const issues = validateRecipient(recipient({ firstName: '', addresses: [] }), { requireAddress: true });
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(['required', 'missing_address']));
    expect(issues.filter((i) => i.level === 'error').length).toBeGreaterThanOrEqual(2);
    expect(validateRecipient(recipient())).toEqual([]);
  });

  it('resolves country names in several languages', () => {
    expect(resolveCountry('United Kingdom')).toBe('GB');
    expect(resolveCountry('Россия')).toBe('RU');
    expect(resolveCountry('am')).toBe('AM');
    expect(resolveCountry('Narnia')).toBeUndefined();
    expect(formatAddressLines({ line1: '1 Main St', city: 'Boston', region: 'MA', postalCode: '02108', country: 'US' }, 'Noah')).toContain('Boston, MA 02108');
  });
});

describe('dates', () => {
  it('normalises human date input', () => {
    expect(normalizeDateInput('14.10.2015')).toBe('2015-10-14');
    expect(normalizeDateInput('2015-10-14')).toBe('2015-10-14');
    expect(normalizeDateInput('10/30/2015')).toBe('2015-10-30');
    expect(normalizeDateInput('31.02.2015')).toBeUndefined();
    expect(normalizeDateInput(42291)).toBe('2015-10-14');
  });
  it('computes age and days until birthday', () => {
    expect(ageFromDob('2015-10-14', new Date(2026, 9, 3))).toBe(10);
    expect(ageFromDob('2015-10-14', new Date(2026, 9, 14))).toBe(11);
    expect(daysUntilBirthday('10-14', new Date(2026, 9, 3))).toBe(11);
    expect(daysUntilBirthday('10-03', new Date(2026, 9, 3))).toBe(0);
  });
});

describe('duplicate detection', () => {
  it('transliterates Cyrillic and Armenian for cross-script matching', () => {
    expect(latinize('Анна Петрова')).toBe('anna petrova');
    expect(latinize('Անի')).toBe('ani');
    expect(jaroWinkler('martha', 'marhta')).toBeGreaterThan(0.95);
  });
  it('finds exact duplicates but not siblings sharing a parent', () => {
    const a = recipient({ id: 'a', dob: '2014-06-02', guardianEmail: 'jane@example.com' });
    const b = recipient({ id: 'b', dob: '2014-06-02', guardianEmail: 'jane@example.com' });
    const sibling = recipient({ id: 'c', firstName: 'Emily', dob: '2016-02-01', guardianEmail: 'jane@example.com' });
    expect(scorePair(a, b).score).toBeGreaterThanOrEqual(85);
    expect(scorePair(a, sibling).score).toBeLessThan(60);
    const pairs = findDuplicates([a, b, sibling]);
    expect(pairs).toHaveLength(1);
    expect(new Set([pairs[0].a, pairs[0].b])).toEqual(new Set(['a', 'b']));
    expect(findDuplicates([a, b, sibling], new Set(['a|b']))).toHaveLength(0);
  });
});

describe('orders', () => {
  const items = [
    { id: '1', name: 'Package', qty: 2, unitPrice: 34 },
    { id: '2', name: 'Seal', qty: 1, unitPrice: 3.5 },
  ];
  it('computes totals with discounts and shipping', () => {
    expect(orderTotal({ items, discountType: 'amount', discountValue: 5, shippingFee: 4.5 })).toBe(71);
    expect(discountAmount({ items, discountType: 'percent', discountValue: 10 })).toBe(7.15);
    expect(discountAmount({ items, discountType: 'amount', discountValue: 999 })).toBe(71.5);
  });
  it('derives statuses from projects and shipments', () => {
    const s = (status: Shipment['status']) => ({ status }) as Shipment;
    expect(deriveOrderShipping([])).toBe('not_shipped');
    expect(deriveOrderShipping([s('delivered'), s('delivered')])).toBe('delivered');
    expect(deriveOrderShipping([s('shipped'), s('preparing')])).toBe('partially');
    expect(deriveOrderShipping([s('returned')])).toBe('returned');
    expect(orderStatusFromStages(['generated', 'printed'], 'confirmed')).toBe('ready_to_print');
    expect(orderStatusFromStages(['packed'], 'in_production')).toBe('packed');
    expect(orderStatusFromStages(['created'], 'shipped')).toBe('shipped');
  });
});

describe('permissions', () => {
  const user = (role: User['role'], active = true) => ({ role, active }) as User;
  it('grants admin everything and restricts viewers', () => {
    expect(can(user('admin'), 'users.manage')).toBe(true);
    expect(can(user('viewer'), 'recipients.edit')).toBe(false);
    expect(can(user('production'), 'print')).toBe(true);
    expect(can(user('editor', false), 'recipients.view')).toBe(false);
    expect(DEFAULT_ROLE_PERMISSIONS.viewer).not.toContain('recipients.contact');
  });
});

describe('CSV and XLSX', () => {
  it('parses quoted CSV with auto-detected delimiter', () => {
    const rows = parseCSV('First Name;Last Name;Notes\r\nAlex;Smith;"likes ""owls""; maps"\nАнна;Петрова;\n');
    expect(rows).toEqual([
      ['First Name', 'Last Name', 'Notes'],
      ['Alex', 'Smith', 'likes "owls"; maps'],
      ['Анна', 'Петрова', ''],
    ]);
  });
  it('neutralises spreadsheet formula injection on export', () => {
    expect(toCSV([['=HYPERLINK("x")', '-5']])).toBe('\uFEFF"\'=HYPERLINK(""x"")",-5');
  });
  it('round-trips XLSX files', () => {
    const bytes = writeXlsx([{ name: 'Recipients', rows: [['First Name', 'Age'], ['Ani', 10], ['Анна', 11]] }]);
    const sheets = readXlsx(bytes);
    expect(sheets[0].name).toBe('Recipients');
    expect(sheets[0].rows).toEqual([
      ['First Name', 'Age'],
      ['Ani', '10'],
      ['Анна', '11'],
    ]);
  });
});

describe('import mapping', () => {
  it('maps English, Russian and Armenian headers', () => {
    expect(autoMapHeaders(['First Name', 'Фамилия', 'Postcode', 'Страна', 'Բու', 'whatever'])).toEqual(['firstName', 'lastName', 'postalCode', 'country', 'owlName', '']);
  });
  it('turns a row into a validated draft', () => {
    const mapping = autoMapHeaders(['Full Name', 'Date of Birth', 'Address', 'City', 'Postal Code', 'Country', 'Tags']);
    const d = rowToDraft(['Isla Murphy', '20/10/2015', '8 Merrion Square', 'Dublin', 'D02 X285', 'Ireland', 'Gift, Birthday'], mapping, 2, { houses: [], storeFullDob: true, collectGender: false });
    expect(d.recipient.firstName).toBe('Isla');
    expect(d.recipient.lastName).toBe('Murphy');
    expect(d.recipient.dob).toBe('2015-10-20');
    expect(d.recipient.birthday).toBe('10-20');
    expect(d.recipient.country).toBe('IE');
    expect(d.tagNames).toEqual(['Gift', 'Birthday']);
    expect(d.issues.filter((i) => i.level === 'error')).toEqual([]);
  });
});
