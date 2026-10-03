import type { RoleKey, User } from '../core/types';

/**
 * Local authentication. Passwords are stored only as PBKDF2-SHA256 hashes with a random salt.
 * The active session lives in sessionStorage (cleared when the browser tab closes) and is
 * locked automatically after the configured idle time.
 */

export const PBKDF2_ITERATIONS = 210_000;

function toHex(buf: ArrayBuffer | Uint8Array): string {
  return Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function randomSalt(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return toHex(a);
}

export async function hashPassword(password: string, salt: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(salt), iterations }, key, 256);
  return toHex(bits);
}

export async function verifyPassword(user: Pick<User, 'passwordHash' | 'salt' | 'iterations'>, password: string): Promise<boolean> {
  const h = await hashPassword(password, user.salt, user.iterations);
  // Constant-time comparison.
  if (h.length !== user.passwordHash.length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ user.passwordHash.charCodeAt(i);
  return diff === 0;
}

export function passwordProblems(pw: string): string[] {
  const p: string[] = [];
  if (pw.length < 8) p.push('pw_short');
  if (!/[A-Za-zА-Яа-яԱ-Ֆա-ֆ]/.test(pw) || !/\d/.test(pw)) p.push('pw_mix');
  return p;
}

// ───────────── Session (who is acting – used by the audit log) ─────────────

export interface Actor {
  userId: string;
  userName: string;
  role: RoleKey | 'system';
}

const SYSTEM: Actor = { userId: 'system', userName: 'System', role: 'system' };
let current: Actor = SYSTEM;

export function setActor(user: User | null) {
  current = user ? { userId: user.id, userName: user.displayName || user.username, role: user.role } : SYSTEM;
}

export function actor(): Actor {
  return current;
}

const SESSION_KEY = 'hmms.session';

export interface StoredSession {
  userId: string;
  startedAt: number;
  lastActive: number;
  locked: boolean;
}

export function loadSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: StoredSession | null) {
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}
