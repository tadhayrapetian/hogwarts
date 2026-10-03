import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { LABEL_PRESET_SPECS } from '../../core/defaults';
import { buildContext } from '../../core/template';
import type { AppSettings, BatchInclude, Order, PrintSettings, Project, Recipient, Shipment } from '../../core/types';
import { db } from '../../db/db';
import { useLib } from '../../app/data';
import { useI18n } from '../../i18n';
import type { RenderCtx, RenderLib } from '../../render/context';
import { addressLabelLayout, packingSlipLayout } from '../../render/elements';
import { DielineArt, dielineGeometry } from '../../render/envelope';
import type { PrintItem, PrintSection } from '../../render/imposition';
import { LayoutContent } from '../../render/LayoutSVG';
import { StampArt } from '../../render/stamp';
import { validateProject } from '../../render/validateProject';
import type { Issue } from '../../core/validation';

export interface ProjectBundle {
  project: Project;
  recipient?: Recipient;
  order?: Order;
  shipment?: Shipment;
  ctx: RenderCtx;
  issues: Issue[];
}

/** Loads everything needed to render & validate a set of projects. */
export function useBundles(projectIds: string[] | undefined): ProjectBundle[] | undefined {
  const lib = useLib();
  const { lang, locale } = useI18n();
  const key = (projectIds ?? []).join(',');
  const raw = useLiveQuery(async () => {
    if (!projectIds) return undefined;
    const projects = (await db.projects.bulkGet(projectIds)).filter((p): p is Project => !!p);
    const recipients = await db.recipients.bulkGet(projects.map((p) => p.recipientId ?? ''));
    const orders = await db.orders.bulkGet(projects.map((p) => p.orderId ?? ''));
    const shipments = await db.shipments.where('projectId').anyOf(projectIds).toArray();
    const docs = await db.documents.where('projectId').anyOf(projectIds).filter((d) => d.kind === 'letter' && d.status !== 'void').toArray();
    return { projects, recipients, orders, shipments, docs };
  }, [key]);
  return useMemo(() => {
    if (!raw) return undefined;
    return raw.projects.map((project, i) => {
      const recipient = raw.recipients[i] ?? undefined;
      const order = raw.orders[i] ?? undefined;
      const shipment = raw.shipments.find((s) => s.projectId === project.id);
      const doc = raw.docs.filter((d) => d.projectId === project.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).pop();
      const house = recipient?.houseId ? lib.houses.get(recipient.houseId) : undefined;
      const sender = project.senderId ? lib.characters.get(project.senderId) : undefined;
      const vars = buildContext({ recipient, house, sender, settings: lib.settings, order, project, shipment, documentNumber: doc?.number ?? '', lang });
      const ctx: RenderCtx = {
        vars,
        lib,
        refs: { stampId: project.stampId, postmarkId: project.postmarkId, sealId: project.sealId, senderId: project.senderId, houseId: recipient?.houseId, postmarkDate: project.postmarkDate, shipDate: shipment?.shippingDate },
        idPrefix: `b${i}`,
        locale,
      };
      const issues = validateProject({ project, recipient, order, vars, lib });
      return { project, recipient, order, shipment, ctx, issues };
    });
  }, [raw, lib, lang, locale]);
}

export function contentsList(b: ProjectBundle, lib: RenderLib, t: (k: string) => string): string[] {
  const p = b.project;
  const out = [p.name.split(' — ')[0] || t('preview.letter'), ...p.documents.map((d) => d.name), `${t('el.envelope')} ${p.envelope.size}`];
  if (p.stampId) out.push(`${t('el.stamp')}: ${lib.stamps.get(p.stampId)?.name ?? ''}`);
  if (p.sealId) out.push(`${t('el.seal')}: ${lib.seals.get(p.sealId)?.name ?? ''}`);
  for (const it of b.order?.items ?? []) if (!/package|letter/i.test(it.name)) out.push(`${it.qty}× ${it.name}`);
  return out;
}

/** Converts project bundles into printable sections (letters, documents, envelopes, labels, stamps, slips). */
export function buildSections(bundles: ProjectBundle[], s: PrintSettings, include: BatchInclude, settings: AppSettings | null | undefined, t: (k: string, p?: Record<string, string | number>) => string): PrintSection[] {
  const sections: PrintSection[] = [];
  const mk = (b: ProjectBundle, i: number, suffix: string) => ({ ...b.ctx, idPrefix: `${b.ctx.idPrefix}${suffix}${i}` });
  if (include.letters)
    sections.push({
      key: 'letters',
      title: t('print.sec.letters'),
      mode: 'grid',
      items: bundles.map((b, i): PrintItem => ({
        id: `${b.project.id}-l`,
        label: b.project.name,
        w: b.project.letter.w,
        h: b.project.letter.h,
        fold: b.project.fold,
        bleedColor: b.project.letter.paper.color,
        render: (uid) => <LayoutContent layout={b.project.letter} ctx={{ ...mk(b, i, 'l'), idPrefix: uid }} />,
      })),
    });
  if (include.documents)
    sections.push({
      key: 'documents',
      title: t('print.sec.documents'),
      mode: 'grid',
      items: bundles.flatMap((b, i) =>
        b.project.documents.map((d, j): PrintItem => ({
          id: `${b.project.id}-d${j}`,
          label: `${d.name} · ${b.project.code}`,
          w: d.layout.w,
          h: d.layout.h,
          bleedColor: d.layout.paper.color,
          render: (uid) => <LayoutContent layout={d.layout} ctx={{ ...mk(b, i * 10 + j, 'd'), idPrefix: uid }} />,
        })),
      ),
    });
  if (include.envelopes) {
    if (s.envelopeMode === 'dieline')
      sections.push({
        key: 'envelopes',
        title: t('print.sec.envelopesDie'),
        mode: 'grid',
        items: bundles.map((b, i): PrintItem => {
          const g = dielineGeometry(b.project.envelope.front.w, b.project.envelope.front.h);
          return { id: `${b.project.id}-e`, label: b.project.name, w: g.W, h: g.H, render: (uid) => <DielineArt env={b.project.envelope} ctx={{ ...mk(b, i, 'e'), idPrefix: uid }} /> };
        }),
      });
    else {
      sections.push({
        key: 'envelopes',
        title: t('print.sec.envelopes'),
        mode: 'direct',
        items: bundles.map((b, i): PrintItem => ({
          id: `${b.project.id}-e`,
          label: b.project.name,
          w: b.project.envelope.front.w,
          h: b.project.envelope.front.h,
          render: (uid) => <LayoutContent layout={b.project.envelope.front} ctx={{ ...mk(b, i, 'e'), idPrefix: uid }} />,
        })),
      });
      sections.push({
        key: 'envelopeBacks',
        title: t('print.sec.envelopeBacks'),
        mode: 'direct',
        items: bundles
          .filter((b) => b.project.envelope.back.elements.length)
          .map((b, i): PrintItem => ({
            id: `${b.project.id}-eb`,
            label: b.project.name,
            w: b.project.envelope.back.w,
            h: b.project.envelope.back.h,
            render: (uid) => <LayoutContent layout={{ ...b.project.envelope.back, paper: { ...b.project.envelope.back.paper, texture: 0, vignette: 0 } }} ctx={{ ...mk(b, i, 'eb'), idPrefix: uid }} background={false} />,
          })),
      });
    }
  }
  if (include.labels) {
    const spec = s.labelPreset === 'custom' ? { w: s.labelW, h: s.labelH } : LABEL_PRESET_SPECS[s.labelPreset];
    const layout = addressLabelLayout(spec.w, spec.h, { returnLine: settings?.mail.returnAddress, barcode: spec.h >= 36 });
    sections.push({
      key: 'labels',
      title: t('print.sec.labels'),
      mode: 'labels',
      items: bundles.map((b, i): PrintItem => ({ id: `${b.project.id}-lb`, label: b.project.name, w: spec.w, h: spec.h, render: (uid) => <LayoutContent layout={layout} ctx={{ ...mk(b, i, 'lb'), idPrefix: uid }} /> })),
    });
  }
  if (include.stamps)
    sections.push({
      key: 'stamps',
      title: t('print.sec.stamps'),
      mode: 'grid',
      items: bundles
        .filter((b) => b.project.stampId && b.ctx.lib.stamps.has(b.project.stampId))
        .map((b, i): PrintItem => {
          const st = b.ctx.lib.stamps.get(b.project.stampId!)!;
          return { id: `${b.project.id}-st`, label: st.name, w: st.w, h: st.h, render: (uid) => <StampArt stamp={st} uid={`${uid}-${i}`} asset={st.assetId ? b.ctx.lib.assets.get(st.assetId) : undefined} /> };
        }),
    });
  if (include.packingSlips)
    sections.push({
      key: 'slips',
      title: t('print.sec.slips'),
      mode: 'grid',
      items: bundles.map((b, i): PrintItem => {
        const layout = packingSlipLayout({
          title: b.project.name,
          order: b.order ? `${t('order.number')}: ${b.order.number}` : '',
          project: `${b.project.code} · ${b.project.name}`,
          contents: contentsList(b, b.ctx.lib, t),
          notes: [b.recipient?.deliveryInstructions, b.recipient?.mailingNotes, b.order?.notes].filter(Boolean).join(' · '),
        });
        return { id: `${b.project.id}-ps`, label: b.project.name, w: layout.w, h: layout.h, render: (uid) => <LayoutContent layout={layout} ctx={{ ...mk(b, i, 'ps'), idPrefix: uid }} /> };
      }),
    });
  return sections.filter((x) => x.items.length);
}
