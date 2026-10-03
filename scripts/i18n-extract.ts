/**
 * Lists every i18n key the source code can request.
 *  - literal keys:  t('section.key')
 *  - dynamic keys:  t(`prefix.${value}`) and tEnum('group', value) — expanded from the enum arrays below.
 * Used by scripts/i18n-keys.ts (CLI) and tests/i18n.test.ts.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as T from '../src/core/types';
import { ALL_VARIABLES, VARIABLE_GROUPS } from '../src/core/template';
import { IMPORT_FIELDS } from '../src/core/importMap';
import { ROLE_KEYS } from '../src/core/permissions';
import { SYMBOLS } from '../src/render/symbols';
import { ELEMENT_TYPES } from '../src/render/elements';
import { en } from '../src/i18n/en';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

export function collectKeys(): { keys: string[]; unresolved: { prefix: string; files: string[] }[] } {
const files = walk('src').filter((f) => !f.startsWith(join('src', 'i18n')));
const literal = new Set<string>();
const dynamicPrefixes = new Map<string, Set<string>>();
const enumGroups = new Set<string>();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*['"]([A-Za-z0-9_.-]+)['"]/g)) literal.add(m[1]);
  for (const m of src.matchAll(/\bt\(\s*`([A-Za-z0-9_.-]*)\$\{/g)) {
    const set = dynamicPrefixes.get(m[1]) ?? new Set<string>();
    set.add(f);
    dynamicPrefixes.set(m[1], set);
  }
  for (const m of src.matchAll(/\btEnum\(\s*['"]([A-Za-z]+)['"]/g)) enumGroups.add(m[1]);
  // Keys passed around as data, e.g. { group: 'nav.recipients' } or label keys in arrays.
  for (const m of src.matchAll(/(?:group|labelKey|titleKey):\s*['"]([a-z]+\.[A-Za-z0-9_.]+)['"]/g)) literal.add(m[1]);
}

const codesIn = (paths: string[], re: RegExp) => {
  const out = new Set<string>();
  for (const p of paths) for (const m of readFileSync(p, 'utf8').matchAll(re)) out.add(m[1]);
  return Array.from(out);
};
const valCodes = codesIn(['src/core/validation.ts', 'src/render/validateProject.ts', 'src/core/importMap.ts'], /code: '([a-z_]+)'/g);
const fieldNames = [
  ...codesIn(['src/core/validation.ts', 'src/core/importMap.ts'], /field: [`']([a-zA-Z.${}]+)[`']/g).filter((f) => !f.includes('$')),
  ...['address.line1', 'address.city', 'address.country', 'address.postalCode'],
  ...['firstName', 'lastName', 'preferredName', 'dob', 'birthday', 'guardianName', 'guardianEmail', 'guardianPhone', 'petName', 'owlName', 'favoriteSubject', 'houseId', 'schoolYear', 'age', 'house', 'address'],
];
const serviceErrors = [...codesIn(['src/db/services.ts'], /ServiceError\('([a-z_]+)'/g), 'generic', 'invalid_file'];

/** Known value sets for dynamic key prefixes. */
const FAMILIES: Record<string, readonly string[]> = {
  'val.': valCodes,
  'fieldname.': fieldNames,
  'err.': serviceErrors,
  'el.': [...ELEMENT_TYPES, 'envelope'],
  'symbol.': SYMBOLS.map((s) => s.key),
  'paper.': T.PAPER_KINDS,
  'border.': T.BORDER_STYLES,
  'watermark.': ['none', 'symbol', 'text', 'badge'],
  'align.': ['left', 'center', 'right', 'justify'],
  'valign.': ['top', 'middle', 'bottom'],
  'transform.': ['none', 'uppercase', 'lowercase', 'mirror'],
  'fit.': ['contain', 'cover', 'stretch'],
  'filter.': ['none', 'sepia', 'grayscale'],
  'divider.': ['line', 'double', 'dotted', 'ornament', 'flourish', 'diamond'],
  'shape.': ['rect', 'roundrect', 'ellipse', 'ornateframe', 'banner'],
  'fontkind.': ['serif', 'display', 'script', 'sans', 'mono'],
  'var.': ALL_VARIABLES,
  'vargroup.': VARIABLE_GROUPS.map((g) => g.group),
  'tplcat.': T.TEMPLATE_CATEGORIES,
  'doctype.': T.DOCUMENT_TYPES,
  'stampcat.': T.STAMP_CATEGORIES,
  'sealtype.': T.SEAL_TYPES,
  'sealshape.': T.SEAL_SHAPES,
  'pmshape.': T.POSTMARK_SHAPES,
  'flap.': ['pointed', 'straight', 'curved', 'wallet'],
  'liner.': ['none', 'stripes', 'stars', 'damask', 'dots', 'diamonds'],
  'fold.': ['none', 'half', 'trifold'],
  'orientation.': ['auto', 'portrait', 'landscape'],
  'format.': ['csv', 'xlsx', 'json', 'pdf', 'print'],
  'filecat.': T.FILE_CATEGORIES,
  'dockind.': ['letter', 'document', 'envelope', 'label'],
  'role.': ROLE_KEYS,
  'perm.': T.PERMISSIONS,
  'invcat.': T.INVENTORY_CATEGORIES,
  'movement.': ['purchase', 'consumption', 'adjustment', 'return'],
  'prodcat.': T.PRODUCT_CATEGORIES,
  'charrole.': T.CHARACTER_ROLES,
  'writing.': T.WRITING_STYLES,
  'notif.type.': ['newOrder', 'lowStock', 'birthday', 'unprinted', 'unshipped', 'returned', 'missingAddress', 'invalidPostal', 'overdue'],
  'notif.msg.': ['newOrder', 'lowStock', 'birthday', 'unprinted', 'unshipped', 'returned', 'missingAddress', 'invalidPostal', 'overdue'],
  'dupreason.': ['name_exact', 'name_similar', 'dob', 'birthday', 'address', 'postal', 'city', 'email', 'phone'],
  'dup.decision.': ['keep_both', 'ignore'],
  'importfield.': IMPORT_FIELDS,
  'import.filter.': ['all', 'errors', 'duplicates', 'ok'],
  'package.step.': ['recipient', 'template', 'letter', 'envelope', 'postage', 'documents', 'order', 'review'],
  'package.order.': ['new', 'existing', 'none'],
  'print.inc.': ['letters', 'documents', 'envelopes', 'labels', 'stamps', 'packingSlips'],
  'editor.margin_': ['top', 'right', 'bottom', 'left'],
  'auth.': ['pw_short', 'pw_mix'],
  'backup.err.': ['invalid_file', 'password_required', 'wrong_password'],
};
const ENUM_GROUPS: Record<string, readonly string[]> = {
  order: T.ORDER_STATUSES,
  payment: T.PAYMENT_STATUSES,
  production: T.PRODUCTION_STATUSES,
  orderShipping: T.ORDER_SHIPPING_STATUSES,
  shipment: T.SHIPMENT_STATUSES,
  stage: T.PROJECT_STAGES,
  recipient: T.RECIPIENT_STATUSES,
  batch: T.BATCH_STATUSES,
  doc: ['generated', 'printed', 'void'],
  contact: T.CONTACT_METHODS,
  addressLabel: T.ADDRESS_LABELS,
  task: T.TASK_TYPES,
  action: T.ACTIVITY_ACTIONS,
};

const keys = new Set(literal);
const unresolved: { prefix: string; files: string[] }[] = [];
for (const [prefix, where] of dynamicPrefixes) {
  const fam = FAMILIES[prefix];
  if (prefix.startsWith('enum.')) continue;
  if (!fam) {
    // Allow page-defined families declared in i18n dictionaries: anything already present with that prefix counts.
    const known = Object.keys(en).filter((k) => k.startsWith(prefix));
    if (known.length) known.forEach((k) => keys.add(k));
    else unresolved.push({ prefix, files: Array.from(where) });
    continue;
  }
  for (const v of fam) keys.add(`${prefix}${v}`);
}
for (const g of enumGroups) {
  const vals = ENUM_GROUPS[g];
  if (!vals) unresolved.push({ prefix: `enum.${g}.`, files: ['tEnum'] });
  else for (const v of vals) keys.add(`enum.${g}.${v}`);
}
return { keys: Array.from(keys).sort(), unresolved };
}
