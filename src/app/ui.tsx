import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

/** Global UI state: wizards that can be opened from anywhere. */
export interface PackagePrefill {
  recipientId?: string;
  orderId?: string;
  templateId?: string;
}

interface UICtx {
  packageWizard: PackagePrefill | null;
  openPackageWizard: (p?: PackagePrefill) => void;
  closePackageWizard: () => void;
  bulkWizard: { recipientIds: string[] } | null;
  openBulkWizard: (ids?: string[]) => void;
  closeBulkWizard: () => void;
}

const Ctx = createContext<UICtx | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [packageWizard, setPW] = useState<PackagePrefill | null>(null);
  const [bulkWizard, setBW] = useState<{ recipientIds: string[] } | null>(null);
  const openPackageWizard = useCallback((p: PackagePrefill = {}) => setPW(p), []);
  const closePackageWizard = useCallback(() => setPW(null), []);
  const openBulkWizard = useCallback((ids: string[] = []) => setBW({ recipientIds: ids }), []);
  const closeBulkWizard = useCallback(() => setBW(null), []);
  return <Ctx.Provider value={{ packageWizard, openPackageWizard, closePackageWizard, bulkWizard, openBulkWizard, closeBulkWizard }}>{children}</Ctx.Provider>;
}

export function useUI(): UICtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useUI outside provider');
  return c;
}
