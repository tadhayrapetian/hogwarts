import { nowISO } from '../core/util';
import { BACKUP_TABLES, db, type BackupTable } from './db';
import { audit, getSettings, updateSettings } from './services';

/**
 * Full-database backup as JSON. File attachments (Blobs) are embedded as data URLs.
 * Optionally encrypted with AES-GCM using a key derived from a password (PBKDF2-SHA256).
 */

export const BACKUP_FORMAT = 'hmms-backup';
export const BACKUP_VERSION = 1;

interface BackupPayload {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  app: string;
  tables: Record<string, unknown[]>;
}

interface EncryptedBackup {
  format: 'hmms-backup-encrypted';
  version: number;
  salt: string;
  iv: string;
  iterations: number;
  data: string;
}

function blobToDataURL(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

async function dataURLToBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  return res.blob();
}

function b64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function exportDatabase(opts: { password?: string; includeActivity?: boolean } = {}): Promise<Blob> {
  const tables: Record<string, unknown[]> = {};
  for (const name of BACKUP_TABLES) {
    if (name === 'activity' && opts.includeActivity === false) continue;
    const rows = await db.table(name).toArray();
    if (name === 'files') {
      tables[name] = await Promise.all(rows.map(async (f: { blob: Blob }) => ({ ...f, blob: { __blob: await blobToDataURL(f.blob) } })));
    } else tables[name] = rows;
  }
  const payload: BackupPayload = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: nowISO(), app: 'Hogwarts Mail Management System', tables };
  let json = JSON.stringify(payload);
  if (opts.password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const iterations = 210_000;
    const key = await deriveKey(opts.password, salt, iterations);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(json)));
    const enc: EncryptedBackup = { format: 'hmms-backup-encrypted', version: BACKUP_VERSION, salt: b64(salt), iv: b64(iv), iterations, data: b64(cipher) };
    json = JSON.stringify(enc);
  }
  const s = await getSettings();
  await updateSettings({ backup: { ...s.backup, lastBackupAt: nowISO() } }, 'backup date');
  await audit('backup', 'database', `Exported database backup${opts.password ? ' (encrypted)' : ''}`);
  return new Blob([json], { type: 'application/json' });
}

export class BackupError extends Error {}

export function isEncryptedBackup(text: string): boolean {
  try {
    return JSON.parse(text).format === 'hmms-backup-encrypted';
  } catch {
    return false;
  }
}

export async function parseBackup(text: string, password?: string): Promise<BackupPayload> {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new BackupError('invalid_file');
  }
  let payload = obj as BackupPayload | EncryptedBackup;
  if (payload.format === 'hmms-backup-encrypted') {
    if (!password) throw new BackupError('password_required');
    const enc = payload as EncryptedBackup;
    try {
      const key = await deriveKey(password, unb64(enc.salt), enc.iterations);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(enc.iv) }, key, unb64(enc.data));
      payload = JSON.parse(new TextDecoder().decode(plain));
    } catch {
      throw new BackupError('wrong_password');
    }
  }
  if ((payload as BackupPayload).format !== BACKUP_FORMAT || typeof (payload as BackupPayload).tables !== 'object') throw new BackupError('invalid_file');
  return payload as BackupPayload;
}

export function backupSummary(p: BackupPayload): { table: string; count: number }[] {
  return Object.entries(p.tables).map(([table, rows]) => ({ table, count: Array.isArray(rows) ? rows.length : 0 }));
}

const UNIQUE_FIELDS: Partial<Record<BackupTable, string>> = {
  users: 'username',
  recipients: 'code',
  customers: 'code',
  orders: 'number',
  projects: 'code',
  batches: 'code',
  shipments: 'code',
};

/** mode "replace" wipes the local database first; "merge" upserts records by id. */
export async function restoreDatabase(p: BackupPayload, mode: 'replace' | 'merge') {
  const prepared: Partial<Record<BackupTable, unknown[]>> = {};
  for (const name of BACKUP_TABLES) {
    const rows = p.tables[name];
    if (!Array.isArray(rows)) continue;
    if (name === 'files') {
      prepared[name] = await Promise.all(
        (rows as { blob: { __blob?: string } }[]).map(async (f) => ({ ...f, blob: f.blob?.__blob ? await dataURLToBlob(f.blob.__blob) : new Blob() })),
      );
    } else prepared[name] = rows;
  }
  await db.transaction('rw', db.tables, async () => {
    if (mode === 'replace') for (const t of db.tables) await t.clear();
    for (const name of BACKUP_TABLES) {
      let rows = prepared[name] as Record<string, unknown>[] | undefined;
      if (!rows?.length) continue;
      if (mode === 'merge') {
        if (name === 'settings') continue;
        if (name === 'counters') {
          for (const c of rows as { key: string; value: number }[]) {
            const cur = await db.counters.get(c.key);
            await db.counters.put({ key: c.key, value: Math.max(cur?.value ?? 0, c.value) });
          }
          continue;
        }
        // Skip records whose unique business key already belongs to a different record.
        const uniqueField = UNIQUE_FIELDS[name];
        if (uniqueField) {
          const existing = new Map<string, string>();
          for (const r of (await db.table(name).toArray()) as Record<string, string>[]) existing.set(r[uniqueField], r.id);
          rows = rows.filter((r) => {
            const owner = existing.get(String(r[uniqueField]));
            return !owner || owner === r.id;
          });
        }
      }
      await db.table(name).bulkPut(rows);
    }
  });
  await audit('restore', 'database', `Restored database backup from ${p.exportedAt} (${mode})`);
}
