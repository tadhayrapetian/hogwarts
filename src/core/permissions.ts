import type { AppSettings, Permission, RoleKey, User } from './types';
import { PERMISSIONS } from './types';

export const ROLE_KEYS: RoleKey[] = ['admin', 'editor', 'production', 'viewer'];

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  admin: [...PERMISSIONS],
  editor: [
    'recipients.view',
    'recipients.edit',
    'recipients.contact',
    'orders.view',
    'orders.edit',
    'projects.edit',
    'design.edit',
    'templates.edit',
    'production.edit',
    'print',
    'shipping.edit',
    'analytics.view',
    'files.edit',
    'data.import',
    'data.export',
  ],
  production: ['recipients.view', 'orders.view', 'production.edit', 'print', 'shipping.edit', 'inventory.edit', 'projects.edit'],
  viewer: ['recipients.view', 'orders.view', 'analytics.view'],
};

export function permissionsFor(role: RoleKey, settings?: AppSettings | null): Set<Permission> {
  if (role === 'admin') return new Set(PERMISSIONS);
  const list = settings?.roles?.[role] ?? DEFAULT_ROLE_PERMISSIONS[role] ?? [];
  return new Set(list);
}

export function can(user: User | null | undefined, perm: Permission, settings?: AppSettings | null): boolean {
  if (!user || !user.active) return false;
  return permissionsFor(user.role, settings).has(perm);
}
