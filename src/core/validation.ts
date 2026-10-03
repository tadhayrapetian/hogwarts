import { COUNTRY_CODES, isValidPostalCode, postalRequired } from './countries';
import type { Address, Recipient } from './types';
import { parseISODate } from './util';

export type IssueLevel = 'error' | 'warning';

export interface Issue {
  /** i18n key under "val." */
  code: string;
  level: IssueLevel;
  field?: string;
  params?: Record<string, string | number>;
  /** Optional link target (hash route) to fix the problem. */
  href?: string;
  subject?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(v: string | undefined): boolean {
  return !!v && EMAIL_RE.test(v.trim());
}

/** Lenient international phone check: optional +, 7–15 digits, common separators. */
export function isValidPhone(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim();
  if (!/^\+?[\d\s().-]+$/.test(s)) return false;
  const digits = s.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

export function validateAddress(a: Partial<Address> | undefined, prefix = 'address'): Issue[] {
  const issues: Issue[] = [];
  if (!a) {
    issues.push({ code: 'missing_address', level: 'error', field: prefix });
    return issues;
  }
  if (!a.line1?.trim()) issues.push({ code: 'required', level: 'error', field: `${prefix}.line1` });
  if (!a.city?.trim()) issues.push({ code: 'required', level: 'error', field: `${prefix}.city` });
  if (!a.country?.trim()) issues.push({ code: 'required', level: 'error', field: `${prefix}.country` });
  else if (!COUNTRY_CODES.includes(a.country.toUpperCase())) issues.push({ code: 'invalid_country', level: 'error', field: `${prefix}.country` });
  if (a.country) {
    const postal = a.postalCode?.trim() ?? '';
    if (!postal && postalRequired(a.country)) issues.push({ code: 'postal_missing', level: 'error', field: `${prefix}.postalCode` });
    else if (postal && isValidPostalCode(a.country, postal) === false)
      issues.push({ code: 'postal_invalid', level: 'error', field: `${prefix}.postalCode`, params: { value: postal } });
  }
  return issues;
}

export interface RecipientValidationOptions {
  /** When true the mailing address must be complete (before printing / shipping). */
  requireAddress?: boolean;
}

export function validateRecipient(r: Partial<Recipient>, opts: RecipientValidationOptions = {}): Issue[] {
  const issues: Issue[] = [];
  if (!r.firstName?.trim()) issues.push({ code: 'required', level: 'error', field: 'firstName' });
  if (!r.lastName?.trim()) issues.push({ code: 'required', level: 'error', field: 'lastName' });
  if (r.guardianEmail?.trim() && !isValidEmail(r.guardianEmail)) issues.push({ code: 'email_invalid', level: 'error', field: 'guardianEmail' });
  if (r.guardianPhone?.trim() && !isValidPhone(r.guardianPhone)) issues.push({ code: 'phone_invalid', level: 'error', field: 'guardianPhone' });
  if (r.dob) {
    const d = parseISODate(r.dob);
    if (!d) issues.push({ code: 'date_invalid', level: 'error', field: 'dob' });
    else if (d > new Date()) issues.push({ code: 'date_future', level: 'error', field: 'dob' });
  }
  if (r.age !== undefined && r.age !== null && (r.age < 0 || r.age > 120)) issues.push({ code: 'age_invalid', level: 'error', field: 'age' });
  if (r.birthday && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(r.birthday)) issues.push({ code: 'date_invalid', level: 'error', field: 'birthday' });
  if (r.preferredContact === 'email' && !r.guardianEmail?.trim()) issues.push({ code: 'contact_missing_email', level: 'warning', field: 'guardianEmail' });
  if ((r.preferredContact === 'phone' || r.preferredContact === 'sms') && !r.guardianPhone?.trim())
    issues.push({ code: 'contact_missing_phone', level: 'warning', field: 'guardianPhone' });

  const addresses = r.addresses ?? [];
  const mailing = addresses.find((a) => a.id === r.defaultAddressId) ?? addresses[0];
  if (!mailing || isAddressEmpty(mailing)) {
    issues.push({ code: 'missing_address', level: opts.requireAddress ? 'error' : 'warning', field: 'address' });
  } else {
    const addrIssues = validateAddress(mailing, 'address');
    for (const i of addrIssues) issues.push(opts.requireAddress ? i : { ...i, level: i.code === 'postal_invalid' ? 'error' : 'warning' });
  }
  return issues;
}

export function isAddressEmpty(a: Partial<Address>): boolean {
  return !(a.line1?.trim() || a.city?.trim() || a.postalCode?.trim());
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.level === 'error');
}

export function issuesFor(issues: Issue[], field: string): Issue[] {
  return issues.filter((i) => i.field === field);
}
