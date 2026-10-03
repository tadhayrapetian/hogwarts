import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ArrowRight, Plus, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { buildContext } from '../core/template';
import type { Layout, Project, Recipient, Template, TextEl } from '../core/types';
import { clone, nowISO } from '../core/util';
import { db } from '../db/db';
import { createOrder, createProject } from '../db/services';
import { useFmt, useLib } from '../app/data';
import { useAction } from '../app/feedback';
import { navigate } from '../app/router';
import { useI18n } from '../i18n';
import type { RenderCtx } from '../render/context';
import { validateProject } from '../render/validateProject';
import { LayoutView } from '../ui/art';
import { Field, IssueList, Modal, ReadyBanner } from '../ui/kit';
import { RecipientForm } from './recipients/RecipientForm';
import { EnvelopePicker, LibraryPicker, MultiTemplatePicker, RecipientSelect, TemplatePicker } from './shared/pickers';
import type { PackagePrefill } from '../app/ui';

const STEPS = ['recipient', 'template', 'letter', 'envelope', 'postage', 'documents', 'order', 'review'] as const;

export function PackageWizard({ prefill, onClose }: { prefill: PackagePrefill; onClose: () => void }) {
  const { t, lang, locale } = useI18n();
  const fmt = useFmt();
  const lib = useLib();
  const run = useAction();
  const [step, setStep] = useState(0);
  const [recipientId, setRecipientId] = useState<string | undefined>(prefill.recipientId);
  const [newRecipient, setNewRecipient] = useState(false);
  const [template, setTemplate] = useState<Template | undefined>();
  const [letter, setLetter] = useState<Layout | undefined>();
  const [envelopeId, setEnvelopeId] = useState<string | undefined>();
  const [stampId, setStampId] = useState<string | undefined>();
  const [postmarkId, setPostmarkId] = useState<string | undefined>();
  const [sealId, setSealId] = useState<string | undefined>();
  const [senderId, setSenderId] = useState<string | undefined>();
  const [docIds, setDocIds] = useState<string[]>([]);
  const [orderMode, setOrderMode] = useState<'none' | 'existing' | 'new'>(prefill.orderId ? 'existing' : 'new');
  const [orderId, setOrderId] = useState<string | undefined>(prefill.orderId);
  const [productId, setProductId] = useState<string | undefined>();
  const recipient = useLiveQuery(() => (recipientId ? db.recipients.get(recipientId) : undefined), [recipientId]);
  const orders = useLiveQuery(() => (recipientId ? db.orders.where('recipientId').equals(recipientId).toArray() : []), [recipientId]) ?? [];
  const products = useLiveQuery(() => db.products.filter((p) => p.active).toArray(), []) ?? [];
  const characters = useLiveQuery(() => db.characters.toArray(), []) ?? [];
  const templates = useLiveQuery(() => db.templates.where('kind').equals('letter').toArray(), []) ?? [];

  // Prefill template from the order's product, or the default letter template.
  useEffect(() => {
    if (template || !templates.length) return;
    (async () => {
      let tid = prefill.templateId;
      if (!tid && prefill.orderId) {
        const o = await db.orders.get(prefill.orderId);
        for (const it of o?.items ?? []) {
          const p = it.productId ? await db.products.get(it.productId) : undefined;
          if (p?.templateId) {
            tid = p.templateId;
            break;
          }
        }
      }
      const s = await db.settings.get('app');
      const tp = templates.find((x) => x.id === (tid ?? s?.mail.defaultLetterTemplateId)) ?? templates[0];
      if (tp) pickTemplate(tp);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates.length]);

  const pickTemplate = (tp: Template) => {
    setTemplate(tp);
    setLetter(clone(tp.layout));
    setEnvelopeId(tp.envelopeId ?? lib.settings?.defaults.envelopeId);
    setStampId(tp.stampId ?? lib.settings?.defaults.stampId);
    setPostmarkId(tp.postmarkId ?? lib.settings?.defaults.postmarkId);
    setSealId(tp.sealId ?? lib.settings?.defaults.sealId);
    setSenderId(tp.senderId ?? lib.settings?.mail.defaultSenderId);
    setDocIds(tp.documentTemplateIds);
    const prod = products.find((p) => p.templateId === tp.id);
    if (prod) setProductId(prod.id);
  };

  const ctx: RenderCtx = useMemo(() => {
    const house = recipient?.houseId ? lib.houses.get(recipient.houseId) : undefined;
    const sender = senderId ? lib.characters.get(senderId) : undefined;
    const vars = buildContext({ recipient, house, sender, settings: lib.settings, lang, documentNumber: 'DRAFT' });
    return { vars, lib, refs: { stampId, postmarkId, sealId, senderId, houseId: recipient?.houseId }, idPrefix: 'wz', locale };
  }, [recipient, senderId, stampId, postmarkId, sealId, lib, lang, locale]);

  const draftProject: Project | undefined = useMemo(() => {
    if (!letter || !template) return undefined;
    return {
      id: 'draft',
      code: 'DRAFT',
      name: template.name,
      recipientId,
      category: template.category,
      letter,
      envelope: { id: 'e', name: '', size: 'C5', flap: 'pointed', front: letter, back: letter, liner: { pattern: 'none', color: '#000', color2: '#000' }, createdAt: '', updatedAt: '' },
      stampId,
      postmarkId,
      sealId,
      senderId,
      documents: [],
      fold: template.fold,
      print: {},
      shipping: { addressId: recipient?.defaultAddressId, carrierId: lib.settings?.mail.defaultCarrierId, notes: '' },
      stage: 'created',
      status: 'active',
      assembly: {},
      stageHistory: [],
      createdAt: nowISO(),
      updatedAt: nowISO(),
      createdBy: '',
    } as Project;
  }, [letter, template, recipientId, stampId, postmarkId, sealId, senderId, recipient, lib.settings]);

  const envelope = useLiveQuery(() => (envelopeId ? db.envelopes.get(envelopeId) : undefined), [envelopeId]);
  const issues = useMemo(() => {
    if (!draftProject) return [];
    const p = envelope ? { ...draftProject, envelope } : draftProject;
    return validateProject({ project: p, recipient: recipient ?? null, vars: ctx.vars, lib }).filter((i) => !(i.code === 'letter_too_big' && !envelope));
  }, [draftProject, envelope, recipient, ctx, lib]);

  const bodyEl = useMemo(() => {
    if (!letter) return undefined;
    const texts = letter.elements.filter((e): e is TextEl => e.type === 'text');
    return texts.sort((a, b) => b.text.length - a.text.length)[0];
  }, [letter]);

  const canNext = () => {
    const s = STEPS[step];
    if (s === 'recipient') return !!recipientId;
    if (s === 'template') return !!template;
    if (s === 'order') return orderMode !== 'existing' || !!orderId;
    return true;
  };

  const create = async () => {
    if (!template || !recipientId) return;
    const project = await run(async () => {
      let oid: string | undefined = orderMode === 'existing' ? orderId : undefined;
      if (orderMode === 'new') {
        const prod = products.find((p) => p.id === productId);
        const o = await createOrder({ recipientId, customerId: recipient?.customerId, items: prod ? [{ id: crypto.randomUUID(), productId: prod.id, name: prod.name, qty: 1, unitPrice: prod.price }] : [] });
        oid = o.id;
      }
      return createProject({ recipientId, orderId: oid, templateId: template.id, envelopeId, stampId, postmarkId, sealId, senderId, documentTemplateIds: docIds, letter });
    }, t('package.created'));
    if (project) {
      onClose();
      navigate(`/projects/${project.id}`);
    }
  };

  const s = STEPS[step];
  return (
    <Modal
      title={t('package.create')}
      sub={t('package.sub')}
      onClose={onClose}
      size="xl"
      initialFocus={false}
      footer={
        <>
          <div className="left">
            <div className="steps">
              {STEPS.map((x, i) => (
                <span key={x} className={`s ${i === step ? 'active' : i < step ? 'done' : ''}`} style={{ cursor: i < step ? 'pointer' : undefined }} onClick={() => i < step && setStep(i)}>
                  <span className="n">{i + 1}</span>
                  <span className="hide-mobile">{t(`package.step.${x}`)}</span>
                </span>
              ))}
            </div>
          </div>
          {step > 0 && (
            <button className="btn" onClick={() => setStep(step - 1)}>
              <ArrowLeft /> {t('common.back')}
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button className="btn primary" disabled={!canNext()} onClick={() => setStep(step + 1)}>
              {t('common.next')} <ArrowRight />
            </button>
          ) : (
            <button className="btn accent" disabled={!recipientId || !template} onClick={create}>
              <Wand2 /> {t('package.createProject')}
            </button>
          )}
        </>
      }
    >
      {s === 'recipient' && (
        <div className="col gap-16" style={{ maxWidth: 560 }}>
          <Field label={t('package.chooseRecipient')}>
            <RecipientSelect value={recipientId} onChange={(id) => setRecipientId(id)} />
          </Field>
          <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setNewRecipient(true)}>
            <Plus /> {t('recipient.new')}
          </button>
          {recipient && (
            <div className="card pad flat">
              <b>
                {recipient.firstName} {recipient.lastName}
              </b>{' '}
              · #{recipient.code} · {recipient.city}
              <div className="muted small">{[recipient.petName && `🐾 ${recipient.petName}`, recipient.owlName && `🦉 ${recipient.owlName}`].filter(Boolean).join(' · ')}</div>
            </div>
          )}
        </div>
      )}
      {s === 'template' && <TemplatePicker value={template?.id} onChange={pickTemplate} ctx={ctx} />}
      {s === 'letter' && letter && (
        <div className="grid grid-2">
          <div className="desk" style={{ minHeight: 420, padding: 20 }}>
            <LayoutView layout={letter} ctx={ctx} className="single" style={{ height: 520, width: 'auto', maxWidth: '100%' }} />
          </div>
          <div className="col gap-12">
            <Field label={t('project.sender')}>
              <select className="select" value={senderId ?? ''} onChange={(e) => setSenderId(e.target.value || undefined)}>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.title}
                  </option>
                ))}
              </select>
            </Field>
            {bodyEl && (
              <Field label={t('package.letterText')} hint={t('package.letterTextHint')}>
                <textarea
                  className="textarea"
                  rows={14}
                  value={bodyEl.text}
                  onChange={(e) => setLetter({ ...letter, elements: letter.elements.map((x) => (x.id === bodyEl.id ? { ...x, text: e.target.value } : x)) as Layout['elements'] })}
                />
              </Field>
            )}
          </div>
        </div>
      )}
      {s === 'envelope' && <EnvelopePicker value={envelopeId} onChange={(e) => setEnvelopeId(e.id)} ctx={ctx} />}
      {s === 'postage' && (
        <div className="col gap-16">
          <h3>{t('el.stamp')}</h3>
          <LibraryPicker kind="stamp" value={stampId} onChange={setStampId} />
          <h3>{t('el.postmark')}</h3>
          <LibraryPicker kind="postmark" value={postmarkId} onChange={setPostmarkId} />
          <h3>{t('el.seal')}</h3>
          <LibraryPicker kind="seal" value={sealId} onChange={setSealId} />
        </div>
      )}
      {s === 'documents' && <MultiTemplatePicker value={docIds} onChange={setDocIds} ctx={ctx} />}
      {s === 'order' && (
        <div className="col gap-16" style={{ maxWidth: 620 }}>
          <div className="tabs pill">
            {(['new', 'existing', 'none'] as const).map((m) => (
              <button key={m} className={orderMode === m ? 'active' : ''} onClick={() => setOrderMode(m)}>
                {t(`package.order.${m}`)}
              </button>
            ))}
          </div>
          {orderMode === 'new' && (
            <Field label={t('order.product')}>
              <select className="select" value={productId ?? ''} onChange={(e) => setProductId(e.target.value || undefined)}>
                <option value="">—</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {fmt.money(p.price)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {orderMode === 'existing' && (
            <Field label={t('nav.orders')}>
              <select className="select" value={orderId ?? ''} onChange={(e) => setOrderId(e.target.value || undefined)}>
                <option value="">—</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.number} · {o.items.map((i) => i.name).join(', ')}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      )}
      {s === 'review' && (
        <div className="grid grid-2">
          <div className="col gap-12">
            <ReadyBanner issues={issues} />
            <IssueList issues={issues} />
            <dl className="kv mt-8">
              <dt>{t('nav.recipients')}</dt>
              <dd>{recipient ? `${recipient.firstName} ${recipient.lastName}` : '—'}</dd>
              <dt>{t('project.template')}</dt>
              <dd>{template?.name}</dd>
              <dt>{t('el.envelope')}</dt>
              <dd>{envelope?.name ?? '—'}</dd>
              <dt>{t('el.stamp')}</dt>
              <dd>{stampId ? lib.stamps.get(stampId)?.name : '—'}</dd>
              <dt>{t('el.postmark')}</dt>
              <dd>{postmarkId ? lib.postmarks.get(postmarkId)?.name : '—'}</dd>
              <dt>{t('el.seal')}</dt>
              <dd>{sealId ? lib.seals.get(sealId)?.name : '—'}</dd>
              <dt>{t('project.tab.documents')}</dt>
              <dd>{docIds.length}</dd>
              <dt>{t('nav.orders')}</dt>
              <dd>{t(`package.order.${orderMode}`)}</dd>
            </dl>
            <div className="muted small">{t('package.reviewHint')}</div>
          </div>
          <div className="desk" style={{ minHeight: 360, padding: 20 }}>
            {envelope && <LayoutView layout={envelope.front} ctx={ctx} className="single" style={{ width: '92%', height: 'auto' }} />}
          </div>
        </div>
      )}
      {newRecipient && (
        <RecipientForm
          stay
          onClose={() => setNewRecipient(false)}
          onSaved={(r: Recipient) => {
            setRecipientId(r.id);
            setNewRecipient(false);
          }}
        />
      )}
    </Modal>
  );
}
