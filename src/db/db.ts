import Dexie, { type Table } from 'dexie';
import type {
  Activity,
  AppSettings,
  Asset,
  Character,
  Counter,
  Customer,
  Dismissal,
  DuplicateDecision,
  EnvelopeDesign,
  FileRec,
  GeneratedDoc,
  House,
  InventoryItem,
  Note,
  Order,
  Postmark,
  PrintBatch,
  Product,
  Project,
  Recipient,
  Seal,
  Shipment,
  Stamp,
  Supplier,
  Tag,
  Task,
  Template,
  User,
} from '../core/types';

/**
 * Local-first database (IndexedDB via Dexie).
 * All tables are keyed by string ids; human codes are indexed for search.
 * The repository/service layer (services.ts) is the only place that writes,
 * so it can later be swapped for a server API without touching the UI.
 */
export class HmmsDB extends Dexie {
  users!: Table<User, string>;
  recipients!: Table<Recipient, string>;
  customers!: Table<Customer, string>;
  tags!: Table<Tag, string>;
  notes!: Table<Note, string>;
  tasks!: Table<Task, string>;
  files!: Table<FileRec, string>;
  houses!: Table<House, string>;
  characters!: Table<Character, string>;
  assets!: Table<Asset, string>;
  templates!: Table<Template, string>;
  envelopes!: Table<EnvelopeDesign, string>;
  stamps!: Table<Stamp, string>;
  postmarks!: Table<Postmark, string>;
  seals!: Table<Seal, string>;
  products!: Table<Product, string>;
  orders!: Table<Order, string>;
  projects!: Table<Project, string>;
  documents!: Table<GeneratedDoc, string>;
  batches!: Table<PrintBatch, string>;
  shipments!: Table<Shipment, string>;
  inventory!: Table<InventoryItem, string>;
  suppliers!: Table<Supplier, string>;
  activity!: Table<Activity, string>;
  settings!: Table<AppSettings, string>;
  counters!: Table<Counter, string>;
  dismissals!: Table<Dismissal, string>;
  duplicateDecisions!: Table<DuplicateDecision, string>;

  constructor(name = 'hmms') {
    super(name);
    this.version(1).stores({
      users: 'id, &username, role',
      recipients: 'id, &code, lastName, firstName, country, city, houseId, status, customerId, createdAt, updatedAt, *tagIds',
      customers: 'id, &code, name, email',
      tags: 'id, name',
      notes: 'id, recipientId, createdAt',
      tasks: 'id, recipientId, orderId, dueDate, done',
      files: 'id, [ownerType+ownerId], ownerId, createdAt',
      houses: 'id, name',
      characters: 'id, name, role',
      assets: 'id',
      templates: 'id, kind, category, docType',
      envelopes: 'id, size',
      stamps: 'id, category',
      postmarks: 'id',
      seals: 'id, type',
      products: 'id, sku, category',
      orders: 'id, &number, recipientId, customerId, status, createdAt, dueDate',
      projects: 'id, &code, recipientId, orderId, stage, status, batchId, createdAt, updatedAt',
      documents: 'id, code, projectId, recipientId, orderId, kind, status, createdAt, batchId',
      batches: 'id, &code, status, createdAt',
      shipments: 'id, &code, orderId, projectId, recipientId, status, trackingNumber, shippingDate, createdAt',
      inventory: 'id, sku, category, supplierId',
      suppliers: 'id, name',
      activity: 'id, ts, userId, entityType, entityId, recipientId, action',
      settings: 'key',
      counters: 'key',
      dismissals: 'key',
      duplicateDecisions: 'key',
    });
  }
}

export const db = new HmmsDB();

/** Tables included in backups, in restore order. */
export const BACKUP_TABLES = [
  'settings',
  'users',
  'tags',
  'houses',
  'assets',
  'seals',
  'stamps',
  'postmarks',
  'characters',
  'envelopes',
  'templates',
  'products',
  'customers',
  'recipients',
  'notes',
  'tasks',
  'orders',
  'projects',
  'documents',
  'batches',
  'shipments',
  'suppliers',
  'inventory',
  'files',
  'activity',
  'counters',
  'dismissals',
  'duplicateDecisions',
] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];
