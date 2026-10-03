import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { defaultSettings } from '../core/defaults';
import { buildContext } from '../core/template';
import type { AppSettings, Project, Recipient } from '../core/types';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '../core/util';
import { db } from '../db/db';
import { useI18n } from '../i18n';
import { buildLib, type RenderCtx, type RenderLib } from '../render/context';

export function useSettings(): AppSettings {
  const s = useLiveQuery(() => db.settings.get('app'), []);
  return useMemo(() => ({ ...defaultSettings(), ...(s ?? {}) }) as AppSettings, [s]);
}

/** Lookup maps used by every renderer (stamps, seals, houses …). */
export function useLib(): RenderLib {
  const settings = useSettings();
  const stamps = useLiveQuery(() => db.stamps.toArray(), []);
  const postmarks = useLiveQuery(() => db.postmarks.toArray(), []);
  const seals = useLiveQuery(() => db.seals.toArray(), []);
  const houses = useLiveQuery(() => db.houses.toArray(), []);
  const characters = useLiveQuery(() => db.characters.toArray(), []);
  const assets = useLiveQuery(() => db.assets.toArray(), []);
  return useMemo(() => buildLib({ stamps, postmarks, seals, houses, characters, assets, settings }), [stamps, postmarks, seals, houses, characters, assets, settings]);
}

export function useFmt() {
  const settings = useSettings();
  const { locale } = useI18n();
  return useMemo(
    () => ({
      date: (d?: string | Date | null) => formatDate(d ?? undefined, settings.regional.dateFormat, locale),
      dateTime: (d?: string) => formatDateTime(d, settings.regional.dateFormat, locale),
      money: (n: number, currency?: string) => formatMoney(n, currency ?? settings.regional.currency, locale),
      num: (n: number, digits = 0) => formatNumber(n, locale, digits),
      currency: settings.regional.currency,
    }),
    [settings.regional.dateFormat, settings.regional.currency, locale],
  );
}

/** Full render context for a project (variables + references). */
export function useProjectCtx(project: Project | undefined, idPrefix: string, editor = false): RenderCtx | undefined {
  const lib = useLib();
  const { lang, locale } = useI18n();
  const recipient = useLiveQuery(() => (project?.recipientId ? db.recipients.get(project.recipientId) : undefined), [project?.recipientId]);
  const order = useLiveQuery(() => (project?.orderId ? db.orders.get(project.orderId) : undefined), [project?.orderId]);
  const shipment = useLiveQuery(() => (project ? db.shipments.where('projectId').equals(project.id).first() : undefined), [project?.id]);
  const doc = useLiveQuery(
    () => (project ? db.documents.where('projectId').equals(project.id).filter((d) => d.kind === 'letter' && d.status !== 'void').last() : undefined),
    [project?.id],
  );
  return useMemo(() => {
    if (!project) return undefined;
    const house = recipient?.houseId ? lib.houses.get(recipient.houseId) : undefined;
    const sender = project.senderId ? lib.characters.get(project.senderId) : undefined;
    const vars = buildContext({ recipient, house, sender, settings: lib.settings, order, project, shipment, documentNumber: doc?.number ?? (editor ? 'DRAFT' : ''), lang });
    return {
      vars,
      lib,
      refs: {
        stampId: project.stampId,
        postmarkId: project.postmarkId,
        sealId: project.sealId,
        senderId: project.senderId,
        houseId: recipient?.houseId,
        postmarkDate: project.postmarkDate,
        shipDate: shipment?.shippingDate,
      },
      idPrefix,
      locale,
      editor,
    };
  }, [project, recipient, order, shipment, doc, lib, lang, locale, idPrefix, editor]);
}

export function recipientDisplayName(r: Pick<Recipient, 'firstName' | 'lastName' | 'preferredName'> | undefined | null): string {
  if (!r) return '';
  return `${r.firstName} ${r.lastName}`.trim();
}
