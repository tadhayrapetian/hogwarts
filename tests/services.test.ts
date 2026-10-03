// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { verifyPassword } from '../src/db/auth';
import { exportDatabase, parseBackup, restoreDatabase } from '../src/db/backup';
import { db } from '../src/db/db';
import { loadDemoWorkspace } from '../src/db/seed';
import {
  anonymizeRecipient,
  createProject,
  createRecipient,
  createShipment,
  createUser,
  deleteRecipient,
  deleteUser,
  generateProject,
  importRecipients,
  mergeRecipients,
  newRecipientDraft,
  setProjectStage,
  setShipmentStatus,
} from '../src/db/services';

beforeAll(async () => {
  await loadDemoWorkspace();
});

describe('demo workspace', () => {
  it('creates a consistent, linked data set', async () => {
    const [recipients, orders, projects, shipments, templates, houses] = await Promise.all([
      db.recipients.count(),
      db.orders.toArray(),
      db.projects.toArray(),
      db.shipments.toArray(),
      db.templates.count(),
      db.houses.count(),
    ]);
    expect(recipients).toBe(26);
    expect(houses).toBe(4);
    expect(templates).toBeGreaterThanOrEqual(16);
    expect(orders.length).toBeGreaterThan(20);
    for (const p of projects) expect(orders.some((o) => o.id === p.orderId)).toBe(true);
    for (const s of shipments) expect(projects.some((p) => p.id === s.projectId)).toBe(true);
    expect(new Set(orders.map((o) => o.number)).size).toBe(orders.length);
  });
});

describe('recipients', () => {
  it('allocates sequential codes and bulk-imports with tags', async () => {
    const a = await createRecipient({ ...newRecipientDraft(), firstName: 'Test', lastName: 'One' });
    const imported = await importRecipients([{ recipient: { ...newRecipientDraft(), firstName: 'Test', lastName: 'Two' }, tagNames: ['Imported Batch'] }]);
    expect(Number(imported[0].code)).toBe(Number(a.code) + 1);
    const tag = await db.tags.where('name').equals('Imported Batch').first();
    expect(imported[0].tagIds).toContain(tag!.id);
  });

  it('merges duplicates and re-links their records', async () => {
    const smiths = await db.recipients.where('lastName').equals('Smith').filter((r) => r.firstName === 'John').toArray();
    expect(smiths).toHaveLength(2);
    const [keep, drop] = smiths;
    const before = await db.orders.where('recipientId').anyOf(keep.id, drop.id).count();
    await mergeRecipients(keep.id, drop.id);
    expect(await db.recipients.get(drop.id)).toBeUndefined();
    expect(await db.orders.where('recipientId').equals(keep.id).count()).toBe(before);
    const merged = await db.recipients.get(keep.id);
    expect(merged!.addresses.length).toBeGreaterThanOrEqual(1);
  });

  it('anonymizes personal data but keeps statistics', async () => {
    const r = (await db.recipients.where('city').equals('Bristol').first())!;
    await anonymizeRecipient(r.id);
    const a = (await db.recipients.get(r.id))!;
    expect(a.status).toBe('anonymized');
    expect(a.firstName).toBe('Anonymized');
    expect(a.guardianEmail).toBe('');
    expect(a.dob).toBeUndefined();
    expect(a.country).toBe('GB');
    const docs = await db.documents.where('recipientId').equals(r.id).toArray();
    expect(docs.every((d) => d.text === '')).toBe(true);
  });

  it('deletes a recipient with all related data', async () => {
    const r = (await db.recipients.where('city').equals('Zürich').first())!;
    await deleteRecipient(r.id, { deleteOrders: true });
    expect(await db.recipients.get(r.id)).toBeUndefined();
    expect(await db.projects.where('recipientId').equals(r.id).count()).toBe(0);
    expect(await db.documents.where('recipientId').equals(r.id).count()).toBe(0);
    expect(await db.shipments.where('recipientId').equals(r.id).count()).toBe(0);
    expect(await db.orders.where('recipientId').equals(r.id).count()).toBe(0);
  });
});

describe('production pipeline', () => {
  it('generates documents, consumes stock once and syncs order & shipping state', async () => {
    const template = (await db.templates.where('kind').equals('letter').first())!;
    const r = (await db.recipients.where('city').equals('Paris').first())!;
    const order = (await db.orders.where('recipientId').equals(r.id).first())!;
    const p = await createProject({ recipientId: r.id, orderId: order.id, templateId: template.id });
    const docs = await generateProject(p.id);
    expect(docs[0].kind).toBe('letter');
    expect(docs[0].text).toContain(r.firstName);
    expect(docs[0].number).toMatch(/^EGA\/\d{4}\/\d{5}$/);

    const paperBefore = (await db.inventory.where('sku').equals('PAP-A4-PAR').first())!.quantity;
    await setProjectStage([p.id], 'packed');
    await setProjectStage([p.id], 'ready');
    const paperAfter = (await db.inventory.where('sku').equals('PAP-A4-PAR').first())!.quantity;
    expect(paperAfter).toBe(paperBefore - 2);
    expect((await db.documents.where('projectId').equals(p.id).toArray()).every((d) => d.status === 'printed')).toBe(true);

    const s = await createShipment({ projectId: p.id, trackingNumber: 'RM123456789GB' });
    expect(s.status).toBe('label_created');
    await setShipmentStatus([s.id], 'shipped');
    await setShipmentStatus([s.id], 'delivered');
    const o2 = (await db.orders.get(order.id))!;
    expect(o2.trackingNumber).not.toBe('');
    const shipments = await db.shipments.where('orderId').equals(order.id).toArray();
    if (shipments.every((x) => x.status === 'delivered')) expect(o2.status).toBe('delivered');
    expect((await db.shipments.get(s.id))!.deliveredAt).toBeTruthy();
  });

  it('writes an audit trail without field values', async () => {
    const entries = await db.activity.toArray();
    expect(entries.some((e) => e.action === 'merge')).toBe(true);
    expect(entries.some((e) => e.action === 'anonymize')).toBe(true);
    expect(JSON.stringify(entries)).not.toContain('narine.s@example.com');
  });
});

describe('users & backup', () => {
  it('hashes passwords and protects the last admin', async () => {
    const admin = await createUser('boss', 'Boss', 'admin', 'secret123');
    expect(admin.passwordHash).not.toContain('secret');
    expect(await verifyPassword(admin, 'secret123')).toBe(true);
    expect(await verifyPassword(admin, 'wrong')).toBe(false);
    await expect(deleteUser(admin.id)).rejects.toMatchObject({ code: 'last_admin' });
  });

  it('round-trips an encrypted backup', async () => {
    const before = await db.recipients.count();
    const blob = await exportDatabase({ password: 'correct horse' });
    const text = await blob.text();
    expect(text).not.toContain('Petrova');
    await expect(parseBackup(text, 'nope')).rejects.toThrow('wrong_password');
    const payload = await parseBackup(text, 'correct horse');
    await db.recipients.clear();
    await restoreDatabase(payload, 'replace');
    expect(await db.recipients.count()).toBe(before);
  });
});
