import { foldedSize, fitsEnvelope } from '../core/defaults';
import { findUnresolved, type VarContext } from '../core/template';
import type { Layout, Order, Project, Recipient } from '../core/types';
import { validateAddress, type Issue } from '../core/validation';
import { renderTemplate } from '../core/template';
import type { RenderLib } from './context';
import { browserMeasure, layoutTextFit, type MeasureFn } from './textLayout';

/** Values that only exist later in the pipeline (a tracking number after shipping); empty is expected before. */
const LATE_VARIABLES = new Set(['tracking_number']);

export interface ProjectCheckInput {
  project: Project;
  recipient?: Recipient | null;
  order?: Order | null;
  vars: VarContext;
  lib: RenderLib;
  measure?: MeasureFn;
}

function layoutIssues(layout: Layout, where: string, input: ProjectCheckInput, issues: Issue[]) {
  const { project, lib, vars } = input;
  for (const el of layout.elements) {
    if (el.hidden) continue;
    if (el.type === 'text') {
      for (const v of findUnresolved(el.text, vars).filter((x) => !LATE_VARIABLES.has(x)))
        issues.push({ code: 'unresolved_var', level: 'warning', params: { var: v, where }, subject: where });
      const res = layoutTextFit(el, renderTemplate(el.text, vars), input.measure ?? browserMeasure);
      if (res.overflow) issues.push({ code: 'text_overflow', level: 'warning', params: { where }, subject: where });
    }
    if (el.type === 'barcode') for (const v of findUnresolved(el.value, vars).filter((x) => !LATE_VARIABLES.has(x))) issues.push({ code: 'unresolved_var', level: 'warning', params: { var: v, where }, subject: where });
    if (el.type === 'stamp') {
      const id = el.stampRef === '$project' ? project.stampId : el.stampRef;
      if (!id || !lib.stamps.has(id)) issues.push({ code: 'missing_stamp', level: 'warning', params: { where }, subject: where });
    }
    if (el.type === 'postmark') {
      const id = el.postmarkRef === '$project' ? project.postmarkId : el.postmarkRef;
      if (!id || !lib.postmarks.has(id)) issues.push({ code: 'missing_postmark', level: 'warning', params: { where }, subject: where });
    }
    if (el.type === 'seal') {
      let ok = false;
      if (el.sealRef === '$project') ok = !!project.sealId && lib.seals.has(project.sealId);
      else if (el.sealRef === '$house') {
        const h = input.recipient?.houseId ? lib.houses.get(input.recipient.houseId) : undefined;
        ok = !!h?.sealId && lib.seals.has(h.sealId);
      } else if (el.sealRef === '$sender') {
        const c = project.senderId ? lib.characters.get(project.senderId) : undefined;
        ok = !!c?.sealId && lib.seals.has(c.sealId);
      } else ok = lib.seals.has(el.sealRef);
      if (!ok) issues.push({ code: 'missing_seal', level: 'warning', params: { where }, subject: where });
    }
    if (el.type === 'signature') {
      const id = el.characterRef === '$sender' ? project.senderId : el.characterRef;
      if (!id || !lib.characters.has(id)) issues.push({ code: 'missing_sender', level: 'warning', params: { where }, subject: where });
    }
    if (el.type === 'image' && (!el.assetId || !lib.assets.has(el.assetId))) issues.push({ code: 'missing_image', level: 'warning', params: { where }, subject: where });
    if (el.x < 0 || el.y < 0 || el.x + el.w > layout.w + 0.5 || el.y + el.h > layout.h + 0.5)
      issues.push({ code: 'outside_page', level: 'warning', params: { where }, subject: where });
  }
}

/** Pre-print readiness check for one mail package. */
export function validateProject(input: ProjectCheckInput): Issue[] {
  const { project, recipient, order } = input;
  const issues: Issue[] = [];
  if (!recipient) issues.push({ code: 'no_recipient', level: 'error', subject: 'recipient' });
  else {
    if (recipient.status === 'anonymized' || recipient.status === 'archived') issues.push({ code: 'recipient_inactive', level: 'error', subject: 'recipient' });
    const addr = recipient.addresses.find((a) => a.id === project.shipping.addressId) ?? recipient.addresses.find((a) => a.id === recipient.defaultAddressId) ?? recipient.addresses[0];
    for (const i of validateAddress(addr, 'address')) issues.push({ ...i, subject: 'recipient', href: `#/recipients/${recipient.id}?edit=1` });
  }
  layoutIssues(project.letter, 'letter', input, issues);
  layoutIssues(project.envelope.front, 'envelope', input, issues);
  layoutIssues(project.envelope.back, 'envelope', input, issues);
  for (const d of project.documents) layoutIssues(d.layout, d.name, input, issues);
  const folded = foldedSize(project.letter.w, project.letter.h, project.fold);
  if (!fitsEnvelope(folded, [project.envelope.front.w, project.envelope.front.h]))
    issues.push({ code: 'letter_too_big', level: 'error', params: { w: Math.round(folded[0]), h: Math.round(folded[1]), env: project.envelope.size }, subject: 'envelope' });
  for (const d of project.documents) {
    if (!fitsEnvelope([d.layout.w, d.layout.h], [project.envelope.front.w, project.envelope.front.h]) && !fitsEnvelope(foldedSize(d.layout.w, d.layout.h, 'half'), [project.envelope.front.w, project.envelope.front.h]))
      issues.push({ code: 'document_too_big', level: 'warning', params: { where: d.name }, subject: d.name });
  }
  if (!project.shipping.carrierId) issues.push({ code: 'no_carrier', level: 'warning', subject: 'shipping' });
  if (order && order.paymentStatus === 'unpaid' && order.total > 0) issues.push({ code: 'order_unpaid', level: 'warning', subject: 'order' });
  // De-duplicate identical messages.
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.code}|${JSON.stringify(i.params ?? {})}|${i.field ?? ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
