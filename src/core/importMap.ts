import { resolveCountry } from './countries';
import type { Address, ContactMethod, House, Recipient } from './types';
import { CONTACT_METHODS } from './types';
import { normalizeDateInput, normalizeText, uid } from './util';
import { validateRecipient, type Issue } from './validation';

/** Fields a column can be mapped to during recipient import. */
export const IMPORT_FIELDS = [
  'fullName',
  'firstName',
  'lastName',
  'preferredName',
  'dob',
  'age',
  'birthday',
  'gender',
  'line1',
  'line2',
  'extra',
  'city',
  'region',
  'postalCode',
  'country',
  'guardianName',
  'guardianPhone',
  'guardianEmail',
  'altContact',
  'preferredContact',
  'deliveryInstructions',
  'mailingNotes',
  'house',
  'schoolYear',
  'favoriteSubject',
  'favoriteColor',
  'petName',
  'owlName',
  'favoriteCreature',
  'interests',
  'specialOccasion',
  'tags',
  'notes',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

const SYNONYMS: Record<ImportField, string[]> = {
  fullName: ['full name', 'name', 'child name', 'student', 'полное имя', 'фио', 'ребенок', 'ребёнок', 'անուն ազգանուն'],
  firstName: ['first name', 'firstname', 'given name', 'forename', 'first', 'имя', 'անուն'],
  lastName: ['last name', 'lastname', 'surname', 'family name', 'last', 'фамилия', 'ազգանուն'],
  preferredName: ['preferred name', 'nickname', 'known as', 'предпочитаемое имя', 'прозвище'],
  dob: ['date of birth', 'dob', 'birth date', 'birthdate', 'дата рождения', 'ծննդյան ամսաթիվ'],
  age: ['age', 'возраст', 'տարիք'],
  birthday: ['birthday', 'день рождения', 'ծննդյան օր'],
  gender: ['gender', 'sex', 'пол', 'սեռ'],
  line1: ['address', 'street', 'address line 1', 'address1', 'street address', 'адрес', 'улица', 'հասցե', 'փողոց'],
  line2: ['apartment', 'house', 'flat', 'apt', 'address line 2', 'address2', 'квартира', 'дом', 'բնակարան'],
  extra: ['additional address information', 'address extra', 'additional', 'доп. информация', 'дополнительно'],
  city: ['city', 'town', 'город', 'населенный пункт', 'քաղաք'],
  region: ['region', 'state', 'county', 'province', 'область', 'регион', 'край', 'մարզ'],
  postalCode: ['postal code', 'postcode', 'zip', 'zip code', 'post code', 'индекс', 'почтовый индекс', 'փոստային ինդեքս', 'ինդեքս'],
  country: ['country', 'страна', 'երկիր'],
  guardianName: ['parent', 'guardian', 'parent name', 'guardian name', 'parent / guardian name', 'родитель', 'опекун', 'ծնող'],
  guardianPhone: ['phone', 'telephone', 'mobile', 'parent phone', 'guardian phone', 'телефон', 'հեռախոս'],
  guardianEmail: ['email', 'e-mail', 'parent email', 'guardian email', 'почта', 'эл. почта', 'էլ. փոստ', 'էլփոստ'],
  altContact: ['alternative contact', 'alt contact', 'другой контакт', 'альтернативный контакт'],
  preferredContact: ['preferred contact', 'contact method', 'способ связи'],
  deliveryInstructions: ['delivery instructions', 'инструкции по доставке'],
  mailingNotes: ['mailing notes', 'special mailing notes', 'примечания к почте'],
  house: ['house', 'faculty', 'факультет', 'ֆակուլտետ'],
  schoolYear: ['school year', 'year', 'grade', 'курс', 'класс', 'կուրս'],
  favoriteSubject: ['favorite subject', 'favourite subject', 'любимый предмет'],
  favoriteColor: ['favorite color', 'favourite colour', 'favourite color', 'любимый цвет'],
  petName: ['pet name', 'pet', 'питомец', 'кличка питомца', 'ընտանի կենդանի'],
  owlName: ['owl name', 'owl', 'сова', 'имя совы', 'բու'],
  favoriteCreature: ['favorite magical creature', 'favourite creature', 'magical creature', 'любимое существо'],
  interests: ['interests', 'hobbies', 'personal interests', 'интересы', 'хобби', 'հետաքրքրություններ'],
  specialOccasion: ['special occasion', 'occasion', 'повод', 'событие'],
  tags: ['tags', 'labels', 'теги', 'метки', 'պիտակներ'],
  notes: ['notes', 'comment', 'comments', 'примечания', 'заметки', 'նշումներ'],
};

const clean = (s: string) => normalizeText(s).replace(/[_*:]/g, ' ').replace(/\s+/g, ' ').trim();

export function autoMapHeaders(headers: string[]): (ImportField | '')[] {
  const used = new Set<ImportField>();
  return headers.map((h) => {
    const c = clean(h);
    if (!c) return '';
    for (const field of IMPORT_FIELDS) {
      if (used.has(field)) continue;
      if (clean(field.replace(/([A-Z])/g, ' $1')) === c || SYNONYMS[field].some((s) => clean(s) === c)) {
        used.add(field);
        return field;
      }
    }
    for (const field of IMPORT_FIELDS) {
      if (used.has(field)) continue;
      if (SYNONYMS[field].some((s) => clean(s).length > 3 && c.includes(clean(s)))) {
        used.add(field);
        return field;
      }
    }
    return '';
  });
}

export interface ImportDraft {
  rowIndex: number;
  recipient: Omit<Recipient, 'id' | 'code' | 'createdAt' | 'updatedAt' | 'createdBy'>;
  tagNames: string[];
  issues: Issue[];
}

export interface ImportOptions {
  houses: House[];
  defaultCountry?: string;
  storeFullDob: boolean;
  collectGender: boolean;
}

export function rowToDraft(row: string[], mapping: (ImportField | '')[], rowIndex: number, opts: ImportOptions): ImportDraft {
  const v: Partial<Record<ImportField, string>> = {};
  mapping.forEach((f, i) => {
    if (f && row[i] !== undefined && String(row[i]).trim() !== '') v[f] = String(row[i]).trim();
  });
  let firstName = v.firstName ?? '';
  let lastName = v.lastName ?? '';
  if ((!firstName || !lastName) && v.fullName) {
    const parts = v.fullName.split(/\s+/);
    if (!firstName) firstName = parts.slice(0, -1).join(' ') || parts[0];
    if (!lastName) lastName = parts.length > 1 ? parts[parts.length - 1] : '';
  }
  const issues: Issue[] = [];
  const dob = v.dob ? normalizeDateInput(v.dob) : undefined;
  if (v.dob && !dob) issues.push({ code: 'date_invalid', level: 'warning', field: 'dob', params: { value: v.dob } });
  let birthday: string | undefined;
  if (dob) birthday = dob.slice(5);
  else if (v.birthday) {
    const b = normalizeDateInput(v.birthday.length <= 5 ? `${v.birthday}.2000` : v.birthday);
    birthday = b?.slice(5);
    if (!b) issues.push({ code: 'date_invalid', level: 'warning', field: 'birthday', params: { value: v.birthday } });
  }
  const country = v.country ? resolveCountry(v.country) : opts.defaultCountry;
  if (v.country && !country) issues.push({ code: 'invalid_country', level: 'error', field: 'address.country', params: { value: v.country } });
  const address: Address = {
    id: uid(),
    label: 'home',
    name: '',
    line1: v.line1 ?? '',
    line2: v.line2 ?? '',
    extra: v.extra ?? '',
    city: v.city ?? '',
    region: v.region ?? '',
    postalCode: v.postalCode ?? '',
    country: country ?? '',
    notes: '',
  };
  const houseName = v.house ? normalizeText(v.house) : '';
  const house = houseName ? opts.houses.find((h) => normalizeText(h.name) === houseName) : undefined;
  if (houseName && !house) issues.push({ code: 'unknown_house', level: 'warning', field: 'house', params: { value: v.house ?? '' } });
  const pc = normalizeText(v.preferredContact) as ContactMethod;
  const age = v.age ? Number(v.age) : undefined;
  const schoolYear = v.schoolYear ? Number(String(v.schoolYear).replace(/\D/g, '')) : undefined;
  const recipient: ImportDraft['recipient'] = {
    firstName,
    lastName,
    preferredName: v.preferredName ?? '',
    dob: opts.storeFullDob ? dob : undefined,
    age: age !== undefined && !isNaN(age) ? age : undefined,
    birthday,
    gender: opts.collectGender ? v.gender : undefined,
    addresses: [address],
    defaultAddressId: address.id,
    guardianName: v.guardianName ?? '',
    guardianPhone: v.guardianPhone ?? '',
    guardianEmail: v.guardianEmail ?? '',
    altContact: v.altContact ?? '',
    preferredContact: (CONTACT_METHODS as readonly string[]).includes(pc) ? pc : v.guardianEmail ? 'email' : 'post',
    deliveryInstructions: v.deliveryInstructions ?? '',
    mailingNotes: v.mailingNotes ?? '',
    houseId: house?.id,
    schoolYear: schoolYear && !isNaN(schoolYear) ? schoolYear : undefined,
    favoriteSubject: v.favoriteSubject ?? '',
    favoriteColor: v.favoriteColor ?? '',
    petName: v.petName ?? '',
    owlName: v.owlName ?? '',
    favoriteCreature: v.favoriteCreature ?? '',
    interests: v.interests ?? '',
    specialOccasion: v.specialOccasion ?? '',
    status: 'active',
    tagIds: [],
    notes: v.notes ?? '',
    city: address.city,
    country: address.country,
  };
  if (!opts.storeFullDob && dob && recipient.age === undefined) {
    const now = new Date();
    const d = new Date(dob);
    let a = now.getFullYear() - d.getFullYear();
    if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) a--;
    recipient.age = a;
  }
  issues.push(...validateRecipient(recipient));
  const tagNames = (v.tags ?? '')
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter(Boolean);
  return { rowIndex, recipient, tagNames, issues };
}

/** Columns of the downloadable import template. */
export const IMPORT_TEMPLATE_HEADERS = [
  'First Name',
  'Last Name',
  'Preferred Name',
  'Date of Birth',
  'Address',
  'Apartment',
  'City',
  'Region',
  'Postal Code',
  'Country',
  'Parent Name',
  'Parent Email',
  'Parent Phone',
  'House',
  'School Year',
  'Pet Name',
  'Owl Name',
  'Favorite Subject',
  'Tags',
];
