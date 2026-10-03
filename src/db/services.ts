import type { Table } from 'dexie';
import { emptyLayout, defaultSettings, ENVELOPE_DIMENSIONS } from '../core/defaults';
import { deriveOrderShipping, orderStatusFromStages, orderTotal } from '../core/orders';
import { buildContext, formatDocumentNumber, renderTemplate } from '../core/template';
import type {
  Activity,
  ActivityAction,
  Address,
  AppSettings,
  Customer,
  DesignEl,
  DuplicateDecision,
  EnvelopeDesign,
  FileOwnerType,
  FileRec,
  GeneratedDoc,
  ID,
  InventoryItem,
  Layout,
  Note,
  Order,
  OrderStatus,
  PrintBatch,
  PrintSettings,
  Project,
  ProjectDoc,
  ProjectStage,
  Recipient,
  Shipment,
  ShipmentStatus,
  StockMovement,
  Tag,
  Task,
  Template,
  User,
} from '../core/types';
import { PROJECT_STAGES } from '../core/types';
import { clone, nowISO, todayISO, uid } from '../core/util';
import { actor, hashPassword, PBKDF2_ITERATIONS, randomSalt } from './auth';
import { db } from './db';

// ───────────────────────────── Infrastructure ─────────────────────────────

export class ServiceError extends Error {
  constructor(public code: string, public params?: Record<string, string | number>) {
    super(code);
  }
}

export async function audit(
  action: ActivityAction,
  entityType: string,
  summary: string,
  extra: Partial<Pick<Activity, 'entityId' | 'entityLabel' | 'recipientId' | 'fields'>> = {},
) {
  const a = actor();
  const entry: Activity = {
    id: uid(),
    ts: nowISO(),
    userId: a.userId,
    userName: a.userName,
    role: a.role,
    action,
    entityType,
    summary,
    ...extra,
  };
  await db.activity.add(entry);
}

async function nextSeq(key: string): Promise<number> {
  return db.transaction('rw', db.counters, async () => {
    const c = await db.counters.get(key);
    const value = (c?.value ?? 0) + 1;
    await db.counters.put({ key, value });
    return value;
  });
}

const year = () => new Date().getFullYear();
const pad = (n: number, len: number) => String(n).padStart(len, '0');

export async function getSettings(): Promise<AppSettings> {
  const s = await db.settings.get('app');
  if (s) return { ...defaultSettings(), ...s };
  const d = defaultSettings();
  await db.settings.put(d);
  return d;
}

export async function updateSettings(patch: Partial<AppSettings>, summary = 'settings') {
  const s = await getSettings();
  const next = { ...s, ...patch, key: 'app' as const };
  await db.settings.put(next);
  await audit('update', 'settings', `Updated ${summary}`, { fields: Object.keys(patch) });
}

function changedFields<T extends object>(before: T, after: Partial<T>): string[] {
  return Object.keys(after).filter((k) => JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify((after as Record<string, unknown>)[k]));
}

// ───────────────────────────── Recipients ─────────────────────────────

export function emptyAddress(label: Address['label'] = 'home', country = ''): Address {
  return { id: uid(), label, name: '', line1: '', line2: '', extra: '', city: '', region: '', postalCode: '', country, notes: '' };
}

export function newRecipientDraft(): Omit<Recipient, 'id' | 'code' | 'createdAt' | 'updatedAt' | 'createdBy'> {
  const addr = emptyAddress('home');
  return {
    firstName: '',
    lastName: '',
    preferredName: '',
    addresses: [addr],
    defaultAddressId: addr.id,
    guardianName: '',
    guardianPhone: '',
    guardianEmail: '',
    altContact: '',
    preferredContact: 'email',
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
    city: '',
    country: '',
  };
}

/** Keeps denormalised fields (city, country, birthday) in sync. */
export function syncRecipientDerived<T extends Partial<Recipient>>(r: T): T {
  const addrs = r.addresses ?? [];
  if (addrs.length && !addrs.some((a) => a.id === r.defaultAddressId)) r.defaultAddressId = addrs[0].id;
  const main = addrs.find((a) => a.id === r.defaultAddressId);
  r.city = main?.city ?? '';
  r.country = main?.country ?? '';
  if (r.dob && /^\d{4}-\d{2}-\d{2}$/.test(r.dob)) r.birthday = r.dob.slice(5);
  return r;
}

export const recipientName = (r: Pick<Recipient, 'firstName' | 'lastName'>) => `${r.firstName} ${r.lastName}`.trim();

export async function createRecipient(data: Omit<Recipient, 'id' | 'code' | 'createdAt' | 'updatedAt' | 'createdBy'>): Promise<Recipient> {
  const seq = await nextSeq('recipient');
  const now = nowISO();
  const rec: Recipient = syncRecipientDerived({
    ...clone(data),
    id: uid(),
    code: pad(seq, 6),
    createdAt: now,
    updatedAt: now,
    createdBy: actor().userName,
  });
  await db.recipients.add(rec);
  await audit('create', 'recipient', `Created recipient #${rec.code}`, { entityId: rec.id, entityLabel: `#${rec.code}`, recipientId: rec.id });
  return rec;
}

/** Bulk import: allocates codes in one go, creates missing tags by name, writes one audit entry. */
export async function importRecipients(
  rows: { recipient: Omit<Recipient, 'id' | 'code' | 'createdAt' | 'updatedAt' | 'createdBy'>; tagNames: string[] }[],
  extraTagIds: ID[] = [],
): Promise<Recipient[]> {
  const created: Recipient[] = [];
  await db.transaction('rw', db.recipients, db.tags, db.counters, db.activity, async () => {
    const tags = await db.tags.toArray();
    const byName = new Map(tags.map((t) => [t.name.toLowerCase(), t.id]));
    const palette = ['#7b2d26', '#2f6b4f', '#4b6a99', '#b08d57', '#8e5aa8', '#3f7f8c'];
    for (const r of rows)
      for (const name of r.tagNames) {
        if (!byName.has(name.toLowerCase())) {
          const tag: Tag = { id: uid(), name, color: palette[byName.size % palette.length] };
          await db.tags.add(tag);
          byName.set(name.toLowerCase(), tag.id);
        }
      }
    const c = await db.counters.get('recipient');
    let seq = c?.value ?? 0;
    const now = nowISO();
    for (const r of rows) {
      seq++;
      created.push(
        syncRecipientDerived({
          ...clone(r.recipient),
          tagIds: Array.from(new Set([...r.recipient.tagIds, ...extraTagIds, ...r.tagNames.map((n) => byName.get(n.toLowerCase())!)])),
          id: uid(),
          code: pad(seq, 6),
          createdAt: now,
          updatedAt: now,
          createdBy: actor().userName,
        }),
      );
    }
    await db.counters.put({ key: 'recipient', value: seq });
    await db.recipients.bulkAdd(created);
    await audit('import', 'recipient', `Imported ${created.length} recipient(s)`);
  });
  return created;
}

export async function updateRecipient(id: ID, patch: Partial<Recipient>, summary?: string): Promise<Recipient> {
  const before = await db.recipients.get(id);
  if (!before) throw new ServiceError('not_found');
  const next = syncRecipientDerived({ ...before, ...clone(patch), id, updatedAt: nowISO(), updatedBy: actor().userName });
  await db.recipients.put(next);
  const fields = changedFields(before, patch);
  if (fields.length)
    await audit('update', 'recipient', summary ?? `Changed ${fields.join(', ')} of #${before.code}`, {
      entityId: id,
      entityLabel: `#${before.code}`,
      recipientId: id,
      fields,
    });
  return next;
}

export async function bulkUpdateRecipients(ids: ID[], fn: (r: Recipient) => Partial<Recipient>, summary: string) {
  await db.transaction('rw', db.recipients, db.activity, async () => {
    const list = await db.recipients.bulkGet(ids);
    const now = nowISO();
    const updated = list.filter((r): r is Recipient => !!r).map((r) => syncRecipientDerived({ ...r, ...fn(r), updatedAt: now, updatedBy: actor().userName }));
    await db.recipients.bulkPut(updated);
    await audit('update', 'recipient', `${summary} (${updated.length})`);
  });
}

export async function touchRecipientContact(id: ID | undefined) {
  if (!id) return;
  await db.recipients.update(id, { lastContactAt: nowISO() });
}

/**
 * Deletes a recipient and everything that belongs to them (addresses, notes, tasks, files,
 * projects, generated documents, shipments). Orders are deleted or detached on request.
 */
export async function deleteRecipient(id: ID, opts: { deleteOrders: boolean }) {
  const r = await db.recipients.get(id);
  if (!r) return;
  await db.transaction(
    'rw',
    [db.recipients, db.notes, db.tasks, db.files, db.projects, db.documents, db.shipments, db.orders, db.batches, db.activity],
    async () => {
      const projects = await db.projects.where('recipientId').equals(id).toArray();
      const projectIds = projects.map((p) => p.id);
      await db.documents.where('recipientId').equals(id).delete();
      await db.shipments.where('recipientId').equals(id).delete();
      for (const pid of projectIds) await db.files.where('[ownerType+ownerId]').equals(['project', pid]).delete();
      await db.projects.bulkDelete(projectIds);
      if (projectIds.length) {
        const batches = await db.batches.toArray();
        for (const b of batches)
          if (b.projectIds.some((p) => projectIds.includes(p)))
            await db.batches.update(b.id, { projectIds: b.projectIds.filter((p) => !projectIds.includes(p)) });
      }
      await db.notes.where('recipientId').equals(id).delete();
      await db.tasks.where('recipientId').equals(id).delete();
      await db.files.where('[ownerType+ownerId]').equals(['recipient', id]).delete();
      const orders = await db.orders.where('recipientId').equals(id).toArray();
      if (opts.deleteOrders) await db.orders.bulkDelete(orders.map((o) => o.id));
      else for (const o of orders) await db.orders.update(o.id, { recipientId: undefined });
      await db.recipients.delete(id);
      // Redact the audit trail: keep the event, drop personal labels.
      await db.activity.where('recipientId').equals(id).modify({ entityLabel: `#${r.code}` });
      await audit('delete', 'recipient', `Deleted recipient #${r.code} and related data`, { entityLabel: `#${r.code}` });
    },
  );
}

/** Irreversibly strips personal data while keeping anonymous statistics (country, counts, orders). */
export async function anonymizeRecipient(id: ID) {
  const r = await db.recipients.get(id);
  if (!r) return;
  await db.transaction('rw', [db.recipients, db.notes, db.files, db.documents, db.shipments, db.activity, db.tasks], async () => {
    const country = r.country;
    const anon: Recipient = {
      ...r,
      firstName: 'Anonymized',
      lastName: `#${r.code}`,
      preferredName: '',
      dob: undefined,
      age: undefined,
      birthday: undefined,
      gender: undefined,
      addresses: [{ ...emptyAddress('home', country) }],
      guardianName: '',
      guardianPhone: '',
      guardianEmail: '',
      altContact: '',
      preferredContact: 'none',
      deliveryInstructions: '',
      mailingNotes: '',
      favoriteSubject: '',
      favoriteColor: '',
      petName: '',
      owlName: '',
      favoriteCreature: '',
      interests: '',
      specialOccasion: '',
      specialOccasionDate: undefined,
      notes: '',
      tagIds: [],
      status: 'anonymized',
      anonymizedAt: nowISO(),
      updatedAt: nowISO(),
    };
    anon.defaultAddressId = anon.addresses[0].id;
    await db.recipients.put(syncRecipientDerived(anon));
    await db.notes.where('recipientId').equals(id).delete();
    await db.tasks.where('recipientId').equals(id).delete();
    await db.files.where('[ownerType+ownerId]').equals(['recipient', id]).delete();
    await db.documents.where('recipientId').equals(id).modify({ text: '' });
    await db.shipments
      .where('recipientId')
      .equals(id)
      .modify((s: Shipment) => {
        s.recipientName = 'Anonymized';
        s.address = { ...emptyAddress('home', s.address.country), id: s.address.id };
      });
    await db.activity.where('recipientId').equals(id).modify({ entityLabel: `#${r.code}` });
    await audit('anonymize', 'recipient', `Anonymized recipient #${r.code}`, { entityId: id, entityLabel: `#${r.code}`, recipientId: id });
  });
}

/** Merges `secondaryId` into `primaryId`, re-linking every related record. */
export async function mergeRecipients(primaryId: ID, secondaryId: ID, fieldValues: Partial<Recipient> = {}) {
  const [a, b] = await Promise.all([db.recipients.get(primaryId), db.recipients.get(secondaryId)]);
  if (!a || !b) throw new ServiceError('not_found');
  await db.transaction(
    'rw',
    [db.recipients, db.orders, db.projects, db.documents, db.shipments, db.notes, db.tasks, db.files, db.activity, db.duplicateDecisions],
    async () => {
      const merged: Recipient = { ...a };
      const fillable: (keyof Recipient)[] = [
        'preferredName', 'dob', 'age', 'birthday', 'gender', 'guardianName', 'guardianPhone', 'guardianEmail', 'altContact',
        'deliveryInstructions', 'mailingNotes', 'houseId', 'schoolYear', 'favoriteSubject', 'favoriteColor', 'petName', 'owlName',
        'characterId', 'favoriteCreature', 'interests', 'specialOccasion', 'specialOccasionDate', 'customerId',
      ];
      for (const k of fillable) {
        const av = merged[k];
        if ((av === undefined || av === '' || av === null) && b[k] !== undefined && b[k] !== '') (merged as unknown as Record<string, unknown>)[k] = b[k];
      }
      Object.assign(merged, fieldValues);
      merged.notes = [a.notes, b.notes].filter(Boolean).join('\n');
      merged.tagIds = Array.from(new Set([...a.tagIds, ...b.tagIds]));
      const sig = (x: Address) => `${x.line1}|${x.city}|${x.postalCode}|${x.country}`.toLowerCase();
      const seen = new Set(merged.addresses.map(sig));
      for (const addr of b.addresses) if (!seen.has(sig(addr)) && addr.line1) merged.addresses.push({ ...addr, id: uid() });
      merged.updatedAt = nowISO();
      await db.recipients.put(syncRecipientDerived(merged));
      for (const t of [db.orders, db.projects, db.documents, db.shipments, db.notes, db.tasks] as Table<{ recipientId?: ID }, string>[])
        await t.where('recipientId').equals(secondaryId).modify({ recipientId: primaryId });
      await db.files.where('[ownerType+ownerId]').equals(['recipient', secondaryId]).modify({ ownerId: primaryId });
      await db.activity.where('recipientId').equals(secondaryId).modify({ recipientId: primaryId });
      await db.recipients.delete(secondaryId);
      await audit('merge', 'recipient', `Merged #${b.code} into #${a.code}`, { entityId: primaryId, entityLabel: `#${a.code}`, recipientId: primaryId });
    },
  );
}

export async function setDuplicateDecision(a: ID, b: ID, decision: DuplicateDecision['decision']) {
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  await db.duplicateDecisions.put({ key, decision, at: nowISO(), by: actor().userName });
}

// ───────────────────────────── Customers, tags, notes, tasks, files ─────────────────────────────

export async function saveCustomer(c: Partial<Customer> & { name: string }): Promise<Customer> {
  const now = nowISO();
  if (c.id) {
    const before = await db.customers.get(c.id);
    if (before) {
      const next = { ...before, ...c, updatedAt: now } as Customer;
      await db.customers.put(next);
      await audit('update', 'customer', `Updated customer ${before.code}`, { entityId: c.id, entityLabel: before.code, fields: changedFields(before, c) });
      return next;
    }
  }
  const seq = await nextSeq('customer');
  const rec: Customer = { email: '', phone: '', notes: '', ...c, id: c.id ?? uid(), code: `C-${pad(seq, 5)}`, createdAt: now, updatedAt: now };
  await db.customers.add(rec);
  await audit('create', 'customer', `Created customer ${rec.code}`, { entityId: rec.id, entityLabel: rec.code });
  return rec;
}

export async function deleteCustomer(id: ID) {
  const c = await db.customers.get(id);
  if (!c) return;
  await db.transaction('rw', [db.customers, db.recipients, db.orders, db.files, db.activity], async () => {
    await db.recipients.where('customerId').equals(id).modify({ customerId: undefined });
    await db.orders.where('customerId').equals(id).modify({ customerId: undefined });
    await db.files.where('[ownerType+ownerId]').equals(['customer', id]).delete();
    await db.customers.delete(id);
    await audit('delete', 'customer', `Deleted customer ${c.code}`, { entityLabel: c.code });
  });
}

export async function saveTag(t: Partial<Tag> & { name: string }): Promise<Tag> {
  const tag: Tag = { color: '#7b2d26', ...t, id: t.id ?? uid() };
  await db.tags.put(tag);
  await audit(t.id ? 'update' : 'create', 'tag', `${t.id ? 'Updated' : 'Created'} tag "${tag.name}"`, { entityId: tag.id });
  return tag;
}

export async function deleteTag(id: ID) {
  const tag = await db.tags.get(id);
  await db.transaction('rw', db.tags, db.recipients, db.activity, async () => {
    await db.recipients.where('tagIds').equals(id).modify((r: Recipient) => {
      r.tagIds = r.tagIds.filter((x) => x !== id);
    });
    await db.tags.delete(id);
    await audit('delete', 'tag', `Deleted tag "${tag?.name ?? id}"`);
  });
}

export async function addNote(recipientId: ID, text: string): Promise<Note> {
  const now = nowISO();
  const note: Note = { id: uid(), recipientId, text, pinned: false, createdAt: now, updatedAt: now, createdBy: actor().userName };
  await db.notes.add(note);
  await audit('create', 'note', 'Added note', { entityId: note.id, recipientId });
  return note;
}

export async function updateNote(id: ID, patch: Partial<Note>) {
  await db.notes.update(id, { ...patch, updatedAt: nowISO() });
}

export async function deleteNote(id: ID) {
  const n = await db.notes.get(id);
  await db.notes.delete(id);
  await audit('delete', 'note', 'Deleted note', { recipientId: n?.recipientId });
}

export async function saveTask(t: Partial<Task> & { title: string; dueDate: string }): Promise<Task> {
  const task: Task = { type: 'contact', done: false, notes: '', createdAt: nowISO(), createdBy: actor().userName, ...t, id: t.id ?? uid() };
  await db.tasks.put(task);
  if (!t.id) await audit('create', 'task', `Scheduled "${task.title}" for ${task.dueDate}`, { entityId: task.id, recipientId: task.recipientId });
  return task;
}

export async function toggleTask(id: ID) {
  const t = await db.tasks.get(id);
  if (!t) return;
  await db.tasks.update(id, { done: !t.done, doneAt: !t.done ? nowISO() : undefined });
  if (!t.done && t.type === 'contact') await touchRecipientContact(t.recipientId);
}

export async function deleteTask(id: ID) {
  await db.tasks.delete(id);
}

export const MAX_FILE_SIZE = 25 * 1024 * 1024;

export async function addFile(ownerType: FileOwnerType, ownerId: ID, file: File, category?: FileRec['category'], description = ''): Promise<FileRec> {
  if (file.size > MAX_FILE_SIZE) throw new ServiceError('file_too_large', { max: '25 MB' });
  const cat: FileRec['category'] =
    category ?? (file.type.startsWith('image/') ? 'photo' : file.type === 'application/pdf' ? 'pdf' : file.type.startsWith('text/') ? 'note' : 'document');
  const rec: FileRec = {
    id: uid(),
    ownerType,
    ownerId,
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    category: cat,
    description,
    blob: file,
    createdAt: nowISO(),
    createdBy: actor().userName,
  };
  await db.files.add(rec);
  await audit('create', 'file', `Uploaded file ${file.name}`, { entityId: rec.id, recipientId: ownerType === 'recipient' ? ownerId : undefined });
  return rec;
}

export async function deleteFile(id: ID) {
  const f = await db.files.get(id);
  if (!f) return;
  await db.files.delete(id);
  await audit('delete', 'file', `Deleted file ${f.name}`, { recipientId: f.ownerType === 'recipient' ? f.ownerId : undefined });
}

// ───────────────────────────── Generic library records ─────────────────────────────

type LibraryTable = 'houses' | 'characters' | 'templates' | 'envelopes' | 'stamps' | 'postmarks' | 'seals' | 'products' | 'suppliers' | 'inventory';

export async function saveRecord<T extends { id: ID; name?: string }>(table: LibraryTable, rec: T): Promise<T> {
  const t = db[table] as unknown as Table<T, string>;
  const before = await t.get(rec.id);
  const now = nowISO();
  const next = { ...rec, updatedAt: now, createdAt: (before as { createdAt?: string } | undefined)?.createdAt ?? (rec as { createdAt?: string }).createdAt ?? now };
  await t.put(next as T);
  const entity = table.replace(/s$/, '');
  if (!before) await audit('create', entity, `Created ${entity} "${rec.name ?? rec.id}"`, { entityId: rec.id });
  else {
    const fields = changedFields(before, rec).filter((f) => f !== 'updatedAt');
    // Design studios autosave continuously: record at most one update per record every 5 minutes.
    const last = lastRecordAudit.get(rec.id) ?? 0;
    if (fields.length && Date.now() - last > 5 * 60 * 1000) {
      lastRecordAudit.set(rec.id, Date.now());
      await audit('update', entity, `Updated ${entity} "${rec.name ?? rec.id}"`, { entityId: rec.id, fields });
    }
  }
  return next as T;
}

const lastRecordAudit = new Map<string, number>();

export async function deleteRecord(table: LibraryTable, id: ID) {
  const t = db[table] as unknown as Table<{ id: ID; name?: string }, string>;
  const rec = await t.get(id);
  await t.delete(id);
  const entity = table.replace(/s$/, '');
  await audit('delete', entity, `Deleted ${entity} "${rec?.name ?? id}"`, { entityId: id });
}

export async function saveAsset(name: string, dataUrl: string, mime: string, width: number, height: number) {
  const asset = { id: uid(), name, dataUrl, mime, width, height, size: Math.round((dataUrl.length * 3) / 4), createdAt: nowISO() };
  await db.assets.add(asset);
  return asset;
}

// ───────────────────────────── Orders ─────────────────────────────

export async function createOrder(data: Partial<Order>): Promise<Order> {
  const settings = await getSettings();
  const y = year();
  const seq = await nextSeq(`order-${y}`);
  const now = nowISO();
  const order: Order = {
    id: uid(),
    number: `${settings.mail.orderPrefix || 'HM'}-${y}-${pad(seq, 6)}`,
    items: [],
    discountType: 'amount',
    discountValue: 0,
    shippingFee: 0,
    total: 0,
    currency: settings.regional.currency,
    status: 'new',
    paymentStatus: 'unpaid',
    amountPaid: 0,
    productionStatus: 'not_started',
    shippingStatus: 'not_shipped',
    trackingNumber: '',
    notes: '',
    statusHistory: [],
    createdAt: now,
    updatedAt: now,
    createdBy: actor().userName,
    ...clone(data),
  };
  order.total = orderTotal(order);
  order.statusHistory = [{ status: order.status, at: now, by: actor().userName }];
  await db.orders.add(order);
  await audit('create', 'order', `Created order ${order.number}`, { entityId: order.id, entityLabel: order.number, recipientId: order.recipientId });
  return order;
}

export async function updateOrder(id: ID, patch: Partial<Order>): Promise<Order> {
  const before = await db.orders.get(id);
  if (!before) throw new ServiceError('not_found');
  const next: Order = { ...before, ...clone(patch), updatedAt: nowISO() };
  next.total = orderTotal(next);
  if (patch.amountPaid !== undefined && patch.paymentStatus === undefined && next.paymentStatus !== 'refunded')
    next.paymentStatus = next.amountPaid <= 0 ? 'unpaid' : next.amountPaid + 0.001 >= next.total ? 'paid' : 'partial';
  if (patch.status && patch.status !== before.status) next.statusHistory = [...before.statusHistory, { status: patch.status, at: nowISO(), by: actor().userName }];
  await db.orders.put(next);
  const fields = changedFields(before, patch);
  if (fields.length)
    await audit(patch.status && patch.status !== before.status ? 'status' : 'update', 'order', patch.status && patch.status !== before.status ? `Order ${before.number} → ${patch.status}` : `Updated order ${before.number}`, {
      entityId: id,
      entityLabel: before.number,
      recipientId: next.recipientId,
      fields,
    });
  return next;
}

export async function setOrderStatus(ids: ID[], status: OrderStatus) {
  for (const id of ids) await updateOrder(id, { status });
}

export async function deleteOrder(id: ID) {
  const o = await db.orders.get(id);
  if (!o) return;
  await db.transaction('rw', [db.orders, db.projects, db.shipments, db.documents, db.files, db.activity], async () => {
    await db.projects.where('orderId').equals(id).modify({ orderId: undefined });
    await db.shipments.where('orderId').equals(id).modify({ orderId: undefined });
    await db.documents.where('orderId').equals(id).modify({ orderId: undefined });
    await db.files.where('[ownerType+ownerId]').equals(['order', id]).delete();
    await db.orders.delete(id);
    await audit('delete', 'order', `Deleted order ${o.number}`, { entityLabel: o.number, recipientId: o.recipientId });
  });
}

async function syncOrderFromProjects(orderId: ID | undefined) {
  if (!orderId) return;
  const order = await db.orders.get(orderId);
  if (!order) return;
  const projects = (await db.projects.where('orderId').equals(orderId).toArray()).filter((p) => p.status === 'active');
  if (!projects.length) return;
  const stages = projects.map((p) => p.stage);
  const status = orderStatusFromStages(stages, order.status);
  const productionStatus = stages.every((s) => s === 'packed' || s === 'ready') ? 'done' : stages.some((s) => s !== 'created') ? 'in_progress' : 'not_started';
  const patch: Partial<Order> = {};
  if (status !== order.status) patch.status = status;
  if (productionStatus !== order.productionStatus) patch.productionStatus = productionStatus;
  if (Object.keys(patch).length) await updateOrder(orderId, patch);
}

async function syncOrderFromShipments(orderId: ID | undefined) {
  if (!orderId) return;
  const order = await db.orders.get(orderId);
  if (!order) return;
  const shipments = await db.shipments.where('orderId').equals(orderId).toArray();
  const shippingStatus = deriveOrderShipping(shipments);
  const patch: Partial<Order> = {};
  if (shippingStatus !== order.shippingStatus) patch.shippingStatus = shippingStatus;
  const tracking = shipments.find((s) => s.trackingNumber)?.trackingNumber;
  if (tracking && !order.trackingNumber) patch.trackingNumber = tracking;
  if (!['cancelled', 'archived'].includes(order.status)) {
    if (shippingStatus === 'delivered' && order.status !== 'delivered') patch.status = 'delivered';
    else if (shippingStatus === 'shipped' && order.status !== 'shipped') patch.status = 'shipped';
  }
  if (Object.keys(patch).length) await updateOrder(orderId, patch);
}

// ───────────────────────────── Projects ─────────────────────────────

export interface NewProjectInput {
  name?: string;
  recipientId?: ID;
  orderId?: ID;
  templateId?: ID;
  envelopeId?: ID;
  stampId?: ID;
  postmarkId?: ID;
  sealId?: ID;
  senderId?: ID;
  documentTemplateIds?: ID[];
  dueDate?: string;
  /** Edited letter layout (from the package wizard); defaults to the template layout. */
  letter?: Layout;
}

function rekey(elements: DesignEl[]): DesignEl[] {
  return elements.map((e) => ({ ...clone(e), id: uid() }));
}

export function copyLayout(l: Layout): Layout {
  return { ...clone(l), elements: rekey(l.elements) };
}

export function defaultEnvelope(size: EnvelopeDesign['size'] = 'C5'): EnvelopeDesign {
  const [w, h] = size === 'custom' ? [229, 162] : ENVELOPE_DIMENSIONS[size];
  const now = nowISO();
  return {
    id: uid(),
    name: `${size} envelope`,
    size,
    flap: 'pointed',
    front: emptyLayout(w, h, 'cream'),
    back: emptyLayout(w, h, 'cream'),
    liner: { pattern: 'none', color: '#5b1f1a', color2: '#b08d57' },
    createdAt: now,
    updatedAt: now,
  };
}

export function copyEnvelope(e: EnvelopeDesign): EnvelopeDesign {
  return { ...clone(e), front: copyLayout(e.front), back: copyLayout(e.back) };
}

export function projectDocFromTemplate(t: Template): ProjectDoc {
  return { id: uid(), templateId: t.id, name: t.name, docType: t.docType, layout: copyLayout(t.layout) };
}

export async function createProject(input: NewProjectInput): Promise<Project> {
  const settings = await getSettings();
  const template = input.templateId ? await db.templates.get(input.templateId) : undefined;
  const recipient = input.recipientId ? await db.recipients.get(input.recipientId) : undefined;
  const envId = input.envelopeId ?? template?.envelopeId ?? settings.defaults.envelopeId;
  const envSource = envId ? await db.envelopes.get(envId) : undefined;
  const docIds = input.documentTemplateIds ?? template?.documentTemplateIds ?? [];
  const docTemplates = (await db.templates.bulkGet(docIds)).filter((x): x is Template => !!x);
  const y = year();
  const seq = await nextSeq(`project-${y}`);
  const now = nowISO();
  const project: Project = {
    id: uid(),
    code: `P-${y}-${pad(seq, 4)}`,
    name: input.name || [template?.name ?? 'Mail package', recipient ? recipientName(recipient) : ''].filter(Boolean).join(' — '),
    recipientId: input.recipientId,
    orderId: input.orderId,
    templateId: template?.id,
    category: template?.category ?? 'general',
    letter: input.letter ? copyLayout(input.letter) : template ? copyLayout(template.layout) : emptyLayout(),
    envelope: envSource ? copyEnvelope(envSource) : defaultEnvelope(),
    stampId: input.stampId ?? template?.stampId ?? settings.defaults.stampId,
    postmarkId: input.postmarkId ?? template?.postmarkId ?? settings.defaults.postmarkId,
    sealId: input.sealId ?? template?.sealId ?? settings.defaults.sealId,
    senderId: input.senderId ?? template?.senderId ?? settings.mail.defaultSenderId,
    documents: docTemplates.map(projectDocFromTemplate),
    fold: template?.fold ?? 'trifold',
    print: {},
    shipping: { addressId: recipient?.defaultAddressId, carrierId: settings.mail.defaultCarrierId, notes: '' },
    stage: 'created',
    status: 'active',
    assembly: {},
    dueDate: input.dueDate,
    stageHistory: [{ status: 'created', at: now, by: actor().userName }],
    createdAt: now,
    updatedAt: now,
    createdBy: actor().userName,
  };
  await db.projects.add(project);
  await audit('create', 'project', `Created project ${project.code}`, { entityId: project.id, entityLabel: project.code, recipientId: project.recipientId });
  if (project.orderId) await syncOrderFromProjects(project.orderId);
  return project;
}

const lastProjectAudit = new Map<string, number>();

/** Autosave-friendly update: audit entries are throttled to one per project per 5 minutes. */
export async function updateProject(id: ID, patch: Partial<Project>) {
  const before = await db.projects.get(id);
  if (!before) throw new ServiceError('not_found');
  await db.projects.put({ ...before, ...patch, id, updatedAt: nowISO() });
  const last = lastProjectAudit.get(id) ?? 0;
  if (Date.now() - last > 5 * 60 * 1000) {
    lastProjectAudit.set(id, Date.now());
    await audit('update', 'project', `Edited project ${before.code}`, { entityId: id, entityLabel: before.code, recipientId: before.recipientId, fields: Object.keys(patch) });
  }
}

export async function duplicateProject(id: ID, recipientId?: ID): Promise<Project> {
  const p = await db.projects.get(id);
  if (!p) throw new ServiceError('not_found');
  const y = year();
  const seq = await nextSeq(`project-${y}`);
  const now = nowISO();
  const rid = recipientId ?? p.recipientId;
  const r = rid ? await db.recipients.get(rid) : undefined;
  const copy: Project = {
    ...clone(p),
    id: uid(),
    code: `P-${y}-${pad(seq, 4)}`,
    name: recipientId && r ? `${p.name.split(' — ')[0]} — ${recipientName(r)}` : `${p.name} (copy)`,
    recipientId: rid,
    letter: copyLayout(p.letter),
    envelope: copyEnvelope(p.envelope),
    documents: p.documents.map((d) => ({ ...d, id: uid(), layout: copyLayout(d.layout) })),
    shipping: { ...p.shipping, addressId: recipientId ? r?.defaultAddressId : p.shipping.addressId },
    stage: 'created',
    status: 'active',
    batchId: undefined,
    assembly: {},
    inventoryDeducted: false,
    stageHistory: [{ status: 'created', at: now, by: actor().userName }],
    createdAt: now,
    updatedAt: now,
    createdBy: actor().userName,
  };
  await db.projects.add(copy);
  await audit('create', 'project', `Duplicated ${p.code} → ${copy.code}`, { entityId: copy.id, entityLabel: copy.code, recipientId: copy.recipientId });
  return copy;
}

/** Imports a project exported as JSON (with its images, stamp, postmark and seal). */
export async function importProjectJSON(payload: {
  format?: string;
  project?: Project;
  assets?: import('../core/types').Asset[];
  stamp?: import('../core/types').Stamp;
  postmark?: import('../core/types').Postmark;
  seal?: import('../core/types').Seal;
}): Promise<Project> {
  if (payload.format !== 'hmms-project' || !payload.project) throw new ServiceError('invalid_file');
  const src = payload.project;
  for (const a of payload.assets ?? []) if (!(await db.assets.get(a.id))) await db.assets.add(a);
  if (payload.stamp && !(await db.stamps.get(payload.stamp.id))) await db.stamps.add(payload.stamp);
  if (payload.postmark && !(await db.postmarks.get(payload.postmark.id))) await db.postmarks.add(payload.postmark);
  if (payload.seal && !(await db.seals.get(payload.seal.id))) await db.seals.add(payload.seal);
  const y = year();
  const seq = await nextSeq(`project-${y}`);
  const now = nowISO();
  const recipientExists = src.recipientId ? !!(await db.recipients.get(src.recipientId)) : false;
  const p: Project = {
    ...clone(src),
    id: uid(),
    code: `P-${y}-${pad(seq, 4)}`,
    recipientId: recipientExists ? src.recipientId : undefined,
    orderId: undefined,
    batchId: undefined,
    stage: 'created',
    status: 'active',
    assembly: {},
    inventoryDeducted: false,
    stageHistory: [{ status: 'created', at: now, by: actor().userName }],
    createdAt: now,
    updatedAt: now,
    createdBy: actor().userName,
  };
  await db.projects.add(p);
  await audit('import', 'project', `Imported project ${p.code} from ${src.code}`, { entityId: p.id, entityLabel: p.code });
  return p;
}

export async function archiveProjects(ids: ID[], archived = true) {
  await db.projects.where('id').anyOf(ids).modify({ status: archived ? 'archived' : 'active', updatedAt: nowISO() });
  await audit('update', 'project', `${archived ? 'Archived' : 'Restored'} ${ids.length} project(s)`);
}

export async function deleteProject(id: ID) {
  const p = await db.projects.get(id);
  if (!p) return;
  await db.transaction('rw', [db.projects, db.documents, db.shipments, db.files, db.batches, db.activity], async () => {
    await db.documents.where('projectId').equals(id).delete();
    await db.shipments.where('projectId').equals(id).modify({ projectId: undefined });
    await db.files.where('[ownerType+ownerId]').equals(['project', id]).delete();
    if (p.batchId) {
      const b = await db.batches.get(p.batchId);
      if (b) await db.batches.update(b.id, { projectIds: b.projectIds.filter((x) => x !== id) });
    }
    await db.projects.delete(id);
    await audit('delete', 'project', `Deleted project ${p.code}`, { entityLabel: p.code, recipientId: p.recipientId });
  });
}

/** Resolved text of every text element in a layout (frozen into the generated record). */
export function layoutText(layout: Layout, vars: Record<string, string>): string {
  return layout.elements
    .filter((e): e is Extract<DesignEl, { type: 'text' }> => e.type === 'text' && !e.hidden)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((e) => renderTemplate(e.text, vars))
    .filter((s) => s.trim())
    .join('\n\n');
}

/** Creates the frozen letter + document records for a project ("Generate"). */
export async function generateProject(id: ID): Promise<GeneratedDoc[]> {
  const p = await db.projects.get(id);
  if (!p) throw new ServiceError('not_found');
  const settings = await getSettings();
  const recipient = p.recipientId ? await db.recipients.get(p.recipientId) : undefined;
  const house = recipient?.houseId ? await db.houses.get(recipient.houseId) : undefined;
  const sender = p.senderId ? await db.characters.get(p.senderId) : undefined;
  const order = p.orderId ? await db.orders.get(p.orderId) : undefined;
  const shipment = (await db.shipments.where('projectId').equals(id).toArray())[0];
  const y = year();
  const now = nowISO();
  const docs: GeneratedDoc[] = [];
  // Void earlier versions.
  await db.documents.where('projectId').equals(id).modify((d: GeneratedDoc) => {
    if (d.status === 'generated') d.status = 'void';
  });
  const make = async (kind: GeneratedDoc['kind'], title: string, layout: Layout | null, extra: Partial<GeneratedDoc> = {}) => {
    const seq = await nextSeq(`doc-${y}`);
    const number = formatDocumentNumber(settings.mail.documentNumberFormat || 'DOC/{YYYY}/{NNNNN}', seq, recipient?.code ?? '');
    const vars = buildContext({ recipient, house, sender, settings, order, project: p, shipment, documentNumber: number });
    const doc: GeneratedDoc = {
      id: uid(),
      code: `DOC-${y}-${pad(seq, 5)}`,
      number,
      projectId: p.id,
      recipientId: p.recipientId,
      orderId: p.orderId,
      kind,
      title,
      text: layout ? layoutText(layout, vars) : vars.address_block,
      status: 'generated',
      createdAt: now,
      createdBy: actor().userName,
      ...extra,
    };
    docs.push(doc);
  };
  await make('letter', p.name.split(' — ')[0] || 'Letter', p.letter, { templateId: p.templateId });
  for (const d of p.documents) await make('document', d.name, d.layout, { templateId: d.templateId, docType: d.docType });
  await make('envelope', `${p.envelope.size} envelope`, p.envelope.front);
  await db.documents.bulkAdd(docs);
  await audit('generate', 'project', `Generated ${docs.length} item(s) for ${p.code}`, { entityId: id, entityLabel: p.code, recipientId: p.recipientId });
  return docs;
}

async function consumeInventory(packages: number, note: string) {
  const items = (await db.inventory.toArray()).filter((i) => i.usagePerPackage > 0);
  for (const it of items) {
    const delta = -it.usagePerPackage * packages;
    const mv: StockMovement = { id: uid(), at: nowISO(), delta, reason: 'consumption', note, by: actor().userName };
    await db.inventory.update(it.id, { quantity: Math.max(0, it.quantity + delta), movements: [...it.movements, mv].slice(-200), updatedAt: nowISO() });
  }
}

/** Moves projects through the production pipeline with all side effects. */
export async function setProjectStage(ids: ID[], stage: ProjectStage) {
  const rank = (s: ProjectStage) => PROJECT_STAGES.indexOf(s);
  const orderIds = new Set<ID>();
  for (const id of ids) {
    const p = await db.projects.get(id);
    if (!p || p.stage === stage) continue;
    const now = nowISO();
    if (rank(stage) >= rank('generated')) {
      const existing = await db.documents.where('projectId').equals(id).filter((d) => d.status !== 'void').count();
      if (!existing) await generateProject(id);
    }
    if (rank(stage) >= rank('printed')) {
      await db.documents
        .where('projectId')
        .equals(id)
        .modify((d: GeneratedDoc) => {
          if (d.status === 'generated') {
            d.status = 'printed';
            d.printedAt = now;
          }
        });
    }
    const patch: Partial<Project> = { stage, updatedAt: now, stageHistory: [...p.stageHistory, { status: stage, at: now, by: actor().userName }] };
    if (rank(stage) >= rank('packed') && !p.inventoryDeducted) {
      await consumeInventory(1, `Packed ${p.code}`);
      patch.inventoryDeducted = true;
    }
    await db.projects.update(id, patch);
    await audit('status', 'project', `${p.code} → ${stage}`, { entityId: id, entityLabel: p.code, recipientId: p.recipientId });
    if (p.orderId) orderIds.add(p.orderId);
  }
  for (const oid of orderIds) await syncOrderFromProjects(oid);
}

export async function setAssemblyStep(id: ID, step: string, done: boolean) {
  // Atomic read-modify-write so rapid toggles never overwrite each other.
  await db.projects
    .where('id')
    .equals(id)
    .modify((p: Project) => {
      p.assembly = { ...(p.assembly ?? {}), [step]: done };
    });
}

// ───────────────────────────── Print batches ─────────────────────────────

export async function createBatch(projectIds: ID[], name?: string, settings?: Partial<PrintSettings>): Promise<PrintBatch> {
  const s = await getSettings();
  const y = year();
  const seq = await nextSeq(`batch-${y}`);
  const now = nowISO();
  const batch: PrintBatch = {
    id: uid(),
    code: `B-${y}-${pad(seq, 4)}`,
    name: name || `Batch ${pad(seq, 4)}`,
    projectIds,
    status: 'draft',
    settings: { ...s.print, ...settings },
    include: { letters: true, envelopes: true, labels: true, stamps: false, documents: true, packingSlips: true },
    notes: '',
    createdAt: now,
    updatedAt: now,
    createdBy: actor().userName,
  };
  await db.transaction('rw', db.batches, db.projects, db.activity, async () => {
    await db.batches.add(batch);
    await db.projects.where('id').anyOf(projectIds).modify({ batchId: batch.id });
    await audit('create', 'batch', `Created print batch ${batch.code} (${projectIds.length} projects)`, { entityId: batch.id, entityLabel: batch.code });
  });
  await ensureGenerated(projectIds);
  return batch;
}

/** Projects going to print must have their frozen documents (and reference numbers) first. */
export async function ensureGenerated(projectIds: ID[]) {
  const projects = (await db.projects.bulkGet(projectIds)).filter((p): p is Project => !!p);
  const behind = projects.filter((p) => PROJECT_STAGES.indexOf(p.stage) < PROJECT_STAGES.indexOf('generated')).map((p) => p.id);
  if (behind.length) await setProjectStage(behind, 'generated');
  for (const p of projects.filter((x) => !behind.includes(x.id))) {
    const docs = await db.documents.where('projectId').equals(p.id).filter((d) => d.status !== 'void').count();
    if (!docs) await generateProject(p.id);
  }
}

export async function updateBatch(id: ID, patch: Partial<PrintBatch>) {
  const before = await db.batches.get(id);
  if (!before) return;
  if (patch.projectIds) {
    const removed = before.projectIds.filter((p) => !patch.projectIds!.includes(p));
    const added = patch.projectIds.filter((p) => !before.projectIds.includes(p));
    if (removed.length) await db.projects.where('id').anyOf(removed).modify({ batchId: undefined });
    if (added.length) {
      await db.projects.where('id').anyOf(added).modify({ batchId: id });
      await ensureGenerated(added);
    }
  }
  await db.batches.put({ ...before, ...patch, updatedAt: nowISO() });
}

export async function markBatchPrinted(id: ID) {
  const b = await db.batches.get(id);
  if (!b) return;
  const projects = await db.projects.bulkGet(b.projectIds);
  const toAdvance = projects.filter((p): p is Project => !!p && PROJECT_STAGES.indexOf(p.stage) < PROJECT_STAGES.indexOf('printed')).map((p) => p.id);
  await setProjectStage(toAdvance, 'printed');
  await db.documents.where('projectId').anyOf(b.projectIds).modify((d: GeneratedDoc) => {
    if (d.status !== 'void') d.batchId = id;
  });
  await db.batches.update(id, { status: 'printed', printedAt: nowISO(), updatedAt: nowISO() });
  await audit('print', 'batch', `Printed batch ${b.code}`, { entityId: id, entityLabel: b.code });
}

export async function deleteBatch(id: ID) {
  const b = await db.batches.get(id);
  if (!b) return;
  await db.projects.where('batchId').equals(id).modify({ batchId: undefined });
  await db.batches.delete(id);
  await audit('delete', 'batch', `Deleted batch ${b.code}`, { entityLabel: b.code });
}

// ───────────────────────────── Shipments ─────────────────────────────

export async function createShipment(data: Partial<Shipment> & { projectId?: ID; orderId?: ID }): Promise<Shipment> {
  const settings = await getSettings();
  const project = data.projectId ? await db.projects.get(data.projectId) : undefined;
  const orderId = data.orderId ?? project?.orderId;
  const order = orderId ? await db.orders.get(orderId) : undefined;
  const recipientId = data.recipientId ?? project?.recipientId ?? order?.recipientId;
  const r = recipientId ? await db.recipients.get(recipientId) : undefined;
  const addr =
    data.address ??
    (r ? r.addresses.find((a) => a.id === project?.shipping.addressId) ?? r.addresses.find((a) => a.id === r.defaultAddressId) ?? r.addresses[0] : undefined) ??
    emptyAddress();
  const y = year();
  const seq = await nextSeq(`shipment-${y}`);
  const now = nowISO();
  const status: ShipmentStatus = data.status ?? (data.trackingNumber ? 'label_created' : 'preparing');
  const s: Shipment = {
    id: uid(),
    code: `SH-${y}-${pad(seq, 5)}`,
    orderId,
    projectId: data.projectId,
    recipientId,
    recipientName: r ? recipientName(r) : data.recipientName ?? '',
    carrierId: project?.shipping.carrierId ?? settings.mail.defaultCarrierId,
    service: project?.shipping.service ?? '',
    trackingNumber: '',
    cost: 0,
    weight: 0,
    notes: '',
    createdAt: now,
    updatedAt: now,
    ...clone(data),
    address: clone(addr),
    status,
    events: [{ status, at: now, by: actor().userName }],
  };
  await db.shipments.add(s);
  await audit('create', 'shipment', `Created shipment ${s.code}`, { entityId: s.id, entityLabel: s.code, recipientId });
  await syncOrderFromShipments(orderId);
  return s;
}

export async function updateShipment(id: ID, patch: Partial<Shipment>) {
  const before = await db.shipments.get(id);
  if (!before) return;
  const next = { ...before, ...clone(patch), updatedAt: nowISO() };
  await db.shipments.put(next);
  const fields = changedFields(before, patch);
  if (fields.length) await audit('update', 'shipment', `Updated shipment ${before.code}`, { entityId: id, entityLabel: before.code, recipientId: before.recipientId, fields });
  await syncOrderFromShipments(next.orderId);
}

export async function setShipmentStatus(ids: ID[], status: ShipmentStatus, note = '') {
  for (const id of ids) {
    const s = await db.shipments.get(id);
    if (!s || s.status === status) continue;
    const now = nowISO();
    const patch: Partial<Shipment> = { status, updatedAt: now, events: [...s.events, { status, at: now, by: actor().userName, note }] };
    if (['shipped', 'in_transit', 'out_for_delivery', 'delivered'].includes(status) && !s.shippingDate) patch.shippingDate = todayISO();
    if (status === 'delivered') patch.deliveredAt = now;
    await db.shipments.update(id, patch);
    await audit('ship', 'shipment', `${s.code} → ${status}`, { entityId: id, entityLabel: s.code, recipientId: s.recipientId });
    if (status === 'shipped') await touchRecipientContact(s.recipientId);
    await syncOrderFromShipments(s.orderId);
  }
}

export async function deleteShipment(id: ID) {
  const s = await db.shipments.get(id);
  if (!s) return;
  await db.shipments.delete(id);
  await audit('delete', 'shipment', `Deleted shipment ${s.code}`, { entityLabel: s.code, recipientId: s.recipientId });
  await syncOrderFromShipments(s.orderId);
}

// ───────────────────────────── Inventory ─────────────────────────────

export async function adjustStock(id: ID, delta: number, reason: StockMovement['reason'], note = '') {
  const it = await db.inventory.get(id);
  if (!it) return;
  const mv: StockMovement = { id: uid(), at: nowISO(), delta, reason, note, by: actor().userName };
  const patch: Partial<InventoryItem> = { quantity: Math.max(0, it.quantity + delta), movements: [...it.movements, mv].slice(-200), updatedAt: nowISO() };
  await db.inventory.update(id, patch);
  if (reason === 'purchase' && it.supplierId) await db.suppliers.update(it.supplierId, { lastOrder: todayISO() });
  await audit('update', 'inventory', `Stock ${delta > 0 ? '+' : ''}${delta} ${it.unit} · ${it.name} (${reason})`, { entityId: id });
}

// ───────────────────────────── Users ─────────────────────────────

export async function createUser(username: string, displayName: string, role: User['role'], password: string, mustChange = false): Promise<User> {
  const uname = username.trim().toLowerCase();
  if (await db.users.where('username').equals(uname).first()) throw new ServiceError('username_taken');
  const salt = randomSalt();
  const user: User = {
    id: uid(),
    username: uname,
    displayName: displayName || username,
    role,
    salt,
    iterations: PBKDF2_ITERATIONS,
    passwordHash: await hashPassword(password, salt),
    active: true,
    mustChangePassword: mustChange,
    createdAt: nowISO(),
  };
  await db.users.add(user);
  await audit('create', 'user', `Created user ${uname} (${role})`, { entityId: user.id });
  return user;
}

export async function updateUser(id: ID, patch: Partial<Pick<User, 'displayName' | 'role' | 'active'>>) {
  const u = await db.users.get(id);
  if (!u) return;
  if ((patch.role && patch.role !== 'admin') || patch.active === false) {
    const admins = (await db.users.toArray()).filter((x) => x.role === 'admin' && x.active && x.id !== id);
    if (u.role === 'admin' && !admins.length) throw new ServiceError('last_admin');
  }
  await db.users.update(id, patch);
  await audit('update', 'user', `Updated user ${u.username}`, { entityId: id, fields: Object.keys(patch) });
}

export async function setUserPassword(id: ID, password: string, mustChange = false) {
  const salt = randomSalt();
  const passwordHash = await hashPassword(password, salt);
  await db.users.update(id, { salt, passwordHash, iterations: PBKDF2_ITERATIONS, mustChangePassword: mustChange });
  await audit('update', 'user', 'Password changed', { entityId: id, fields: ['password'] });
}

export async function deleteUser(id: ID) {
  const u = await db.users.get(id);
  if (!u) return;
  if (actor().userId === id) throw new ServiceError('cannot_delete_self');
  const admins = (await db.users.toArray()).filter((x) => x.role === 'admin' && x.active && x.id !== id);
  if (u.role === 'admin' && !admins.length) throw new ServiceError('last_admin');
  await db.users.delete(id);
  await audit('delete', 'user', `Deleted user ${u.username}`);
}

// ───────────────────────────── Misc ─────────────────────────────

export async function dismissNotification(key: string) {
  await db.dismissals.put({ key, at: nowISO() });
}

export async function restoreNotifications() {
  await db.dismissals.clear();
}

export async function clearAllData() {
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
}
