import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { can as canDo } from '../core/permissions';
import type { AppSettings, Permission, User } from '../core/types';
import { nowISO } from '../core/util';
import { loadSession, saveSession, setActor, verifyPassword } from '../db/auth';
import { db } from '../db/db';
import { audit } from '../db/services';

type Status = 'loading' | 'setup' | 'login' | 'locked' | 'ready';

interface SessionCtx {
  status: Status;
  user: User | null;
  settings: AppSettings | undefined;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  lock: () => void;
  unlock: (password: string) => Promise<boolean>;
  can: (p: Permission) => boolean;
  /** Re-evaluate after first-run setup or a database restore. */
  refresh: () => Promise<void>;
  signInAs: (user: User) => Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [userId, setUserId] = useState<string | null>(null);
  const user = useLiveQuery(() => (userId ? db.users.get(userId) : undefined), [userId]) ?? null;
  const settings = useLiveQuery(() => db.settings.get('app'), []);
  const lastActive = useRef(Date.now());

  const refresh = useCallback(async () => {
    const count = await db.users.count();
    if (!count) {
      setStatus('setup');
      return;
    }
    const s = loadSession();
    if (s) {
      const u = await db.users.get(s.userId);
      if (u && u.active) {
        setUserId(u.id);
        setActor(u);
        const st = await db.settings.get('app');
        const idleMs = (st?.privacy.autoLockMinutes ?? 20) * 60000;
        const expired = idleMs > 0 && Date.now() - s.lastActive > idleMs;
        setStatus(s.locked || expired ? 'locked' : 'ready');
        lastActive.current = Date.now();
        return;
      }
    }
    setStatus('login');
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signInAs = useCallback(async (u: User) => {
    setUserId(u.id);
    setActor(u);
    await db.users.update(u.id, { lastLoginAt: nowISO() });
    saveSession({ userId: u.id, startedAt: Date.now(), lastActive: Date.now(), locked: false });
    lastActive.current = Date.now();
    await audit('login', 'user', `${u.username} signed in`, { entityId: u.id });
    setStatus('ready');
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      const u = await db.users.where('username').equals(username.trim().toLowerCase()).first();
      if (!u || !u.active || !(await verifyPassword(u, password))) return false;
      await signInAs(u);
      return true;
    },
    [signInAs],
  );

  const logout = useCallback(async () => {
    if (user) await audit('logout', 'user', `${user.username} signed out`, { entityId: user.id });
    saveSession(null);
    setActor(null);
    setUserId(null);
    setStatus('login');
  }, [user]);

  const lock = useCallback(() => {
    const s = loadSession();
    if (s) saveSession({ ...s, locked: true });
    setStatus('locked');
  }, []);

  const unlock = useCallback(
    async (password: string) => {
      if (!user || !(await verifyPassword(user, password))) return false;
      const s = loadSession();
      if (s) saveSession({ ...s, locked: false, lastActive: Date.now() });
      lastActive.current = Date.now();
      setStatus('ready');
      return true;
    },
    [user],
  );

  // Idle auto-lock.
  useEffect(() => {
    if (status !== 'ready') return;
    const touch = () => {
      lastActive.current = Date.now();
    };
    const events = ['mousemove', 'keydown', 'pointerdown', 'wheel', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = setInterval(() => {
      const s = loadSession();
      if (s) saveSession({ ...s, lastActive: lastActive.current });
      const minutes = settings?.privacy.autoLockMinutes ?? 20;
      if (minutes > 0 && Date.now() - lastActive.current > minutes * 60000) lock();
    }, 15000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      clearInterval(timer);
    };
  }, [status, settings?.privacy.autoLockMinutes, lock]);

  // A deactivated or deleted account loses access immediately.
  useEffect(() => {
    if (status === 'ready' && userId && user === null) {
      db.users.get(userId).then((u) => {
        if (!u || !u.active) {
          saveSession(null);
          setStatus('login');
        }
      });
    } else if (status === 'ready' && user && !user.active) {
      saveSession(null);
      setStatus('login');
    }
    if (user) setActor(user);
  }, [user, userId, status]);

  const value = useMemo<SessionCtx>(
    () => ({ status, user, settings, login, logout, lock, unlock, refresh, signInAs, can: (p) => canDo(user, p, settings) }),
    [status, user, settings, login, logout, lock, unlock, refresh, signInAs],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSession outside provider');
  return c;
}
