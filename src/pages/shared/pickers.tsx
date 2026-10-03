import { useLiveQuery } from 'dexie-react-hooks';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { sampleContext } from '../../core/template';
import type { Customer, EnvelopeDesign, Postmark, Recipient, Seal, Stamp, Template } from '../../core/types';
import { normalizeText } from '../../core/util';
import { db } from '../../db/db';
import { useLib } from '../../app/data';
import { useI18n } from '../../i18n';
import type { RenderCtx } from '../../render/context';
import { LayoutView, PostmarkView, SealView, StampView } from '../../ui/art';

/** Render context with sample data (template previews). */
export function useSampleCtx(idPrefix: string, recipient?: Recipient | null): RenderCtx {
  const lib = useLib();
  const { lang, locale } = useI18n();
  return useMemo(() => {
    const vars = sampleContext(lib.settings, lang);
    if (recipient) {
      const house = recipient.houseId ? lib.houses.get(recipient.houseId) : undefined;
      Object.assign(vars, {
        first_name: recipient.firstName,
        last_name: recipient.lastName,
        preferred_name: recipient.preferredName || recipient.firstName,
        full_name: `${recipient.firstName} ${recipient.lastName}`,
        house: house?.name ?? vars.house,
        house_motto: house?.motto ?? vars.house_motto,
        pet_name: recipient.petName,
        owl_name: recipient.owlName,
        city: recipient.city,
      });
    }
    const house = recipient?.houseId ?? lib.houseList[0]?.id;
    return {
      vars,
      lib,
      refs: {
        stampId: lib.settings?.defaults.stampId,
        postmarkId: lib.settings?.defaults.postmarkId,
        sealId: lib.settings?.defaults.sealId,
        senderId: lib.settings?.mail.defaultSenderId,
        houseId: house,
      },
      idPrefix,
      locale,
    };
  }, [lib, lang, locale, idPrefix, recipient]);
}

function useClickOutside(ref: React.RefObject<HTMLElement>, on: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && on();
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [ref, on, active]);
}

export function RecipientSelect({ value, onChange, placeholder, allowEmpty }: { value?: string; onChange: (id: string | undefined, r?: Recipient) => void; placeholder?: string; allowEmpty?: boolean }) {
  const { t } = useI18n();
  const recipients = useLiveQuery(() => db.recipients.orderBy('lastName').toArray(), []) ?? [];
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  const current = recipients.find((r) => r.id === value);
  const list = useMemo(() => {
    const n = normalizeText(q);
    return recipients.filter((r) => r.status !== 'anonymized' && (!n || normalizeText(`${r.firstName} ${r.lastName} ${r.code} ${r.city}`).includes(n))).slice(0, 60);
  }, [recipients, q]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="input" style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <span className="grow truncate">{current ? `${current.firstName} ${current.lastName} · #${current.code}` : <span className="muted">{placeholder ?? t('pick.recipient')}</span>}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="popover" style={{ left: 0, right: 0, top: 40, padding: 6, maxHeight: 320, overflowY: 'auto' }}>
          <div className="global-search" style={{ maxWidth: 'none', marginBottom: 6 }}>
            <Search />
            <input className="input sm" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.search')} />
          </div>
          {allowEmpty && (
            <button type="button" className="btn ghost sm" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => (onChange(undefined), setOpen(false))}>
              — {t('common.none')}
            </button>
          )}
          {list.map((r) => (
            <button
              type="button"
              key={r.id}
              className="btn ghost sm"
              style={{ width: '100%', justifyContent: 'flex-start', height: 'auto', padding: '6px 8px' }}
              onClick={() => {
                onChange(r.id, r);
                setOpen(false);
              }}
            >
              {r.id === value && <Check />}
              <span className="grow" style={{ textAlign: 'left' }}>
                {r.firstName} {r.lastName}
                <span className="muted small"> · #{r.code} · {r.city}</span>
              </span>
            </button>
          ))}
          {!list.length && <div className="muted small" style={{ padding: 8 }}>{t('common.noResults')}</div>}
        </div>
      )}
    </div>
  );
}

export function CustomerSelect({ value, onChange }: { value?: string; onChange: (id: string | undefined, c?: Customer) => void }) {
  const { t } = useI18n();
  const customers = useLiveQuery(() => db.customers.orderBy('name').toArray(), []) ?? [];
  return (
    <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined, customers.find((c) => c.id === e.target.value))}>
      <option value="">— {t('common.none')}</option>
      {customers.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name} · {c.code}
        </option>
      ))}
    </select>
  );
}

type PickKind = 'stamp' | 'postmark' | 'seal';

export function LibraryPicker({ kind, value, onChange, allowNone = true }: { kind: PickKind; value?: string; onChange: (id: string | undefined) => void; allowNone?: boolean }) {
  const { t } = useI18n();
  const items = useLiveQuery(async (): Promise<(Stamp | Postmark | Seal)[]> => (kind === 'stamp' ? db.stamps.toArray() : kind === 'postmark' ? db.postmarks.toArray() : db.seals.toArray()), [kind]) ?? [];
  return (
    <div className="thumb-grid">
      {allowNone && (
        <button type="button" className={`thumb-card ${!value ? 'selected' : ''}`} onClick={() => onChange(undefined)}>
          <div className="art muted">{t('common.none')}</div>
          <div className="title">{t('common.none')}</div>
        </button>
      )}
      {items.map((it) => (
        <button type="button" key={it.id} className={`thumb-card ${value === it.id ? 'selected' : ''}`} onClick={() => onChange(it.id)}>
          {value === it.id && (
            <span className="check-mark">
              <Check />
            </span>
          )}
          <div className="art">
            {kind === 'stamp' && <StampView stamp={it as Stamp} height={84} />}
            {kind === 'postmark' && <PostmarkView pm={it as Postmark} height={70} />}
            {kind === 'seal' && <SealView seal={it as Seal} size={80} />}
          </div>
          <div className="title truncate">{it.name}</div>
          {'category' in it && <div className="meta">{t(`stampcat.${(it as Stamp).category}`)}</div>}
          {'type' in it && <div className="meta">{t(`sealtype.${(it as Seal).type}`)}</div>}
        </button>
      ))}
    </div>
  );
}

export function TemplateThumb({ template, ctx, height = 150 }: { template: Template; ctx: RenderCtx; height?: number }) {
  const ratio = template.layout.w / template.layout.h;
  return <LayoutView layout={template.layout} ctx={ctx} height={height} width={height * ratio} className="paper-shadow" />;
}

export function EnvelopeThumb({ env, ctx, height = 110 }: { env: EnvelopeDesign; ctx: RenderCtx; height?: number }) {
  return <LayoutView layout={env.front} ctx={ctx} height={height} width={(height * env.front.w) / env.front.h} className="paper-shadow" />;
}

export function TemplatePicker({ value, onChange, kind = 'letter', ctx }: { value?: string; onChange: (t: Template) => void; kind?: 'letter' | 'document'; ctx: RenderCtx }) {
  const { t } = useI18n();
  const templates = useLiveQuery(() => db.templates.where('kind').equals(kind).filter((x) => !x.archived).toArray(), [kind]) ?? [];
  return (
    <div className="thumb-grid lg">
      {templates.map((tp) => (
        <button type="button" key={tp.id} className={`thumb-card ${value === tp.id ? 'selected' : ''}`} onClick={() => onChange(tp)}>
          {value === tp.id && (
            <span className="check-mark">
              <Check />
            </span>
          )}
          <div className="art" style={{ aspectRatio: '1 / 1' }}>
            <TemplateThumb template={tp} ctx={ctx} height={170} />
          </div>
          <div className="title">{tp.name}</div>
          <div className="meta">
            {t(`tplcat.${tp.category}`)} · {tp.language.toUpperCase()}
          </div>
        </button>
      ))}
    </div>
  );
}

export function MultiTemplatePicker({ value, onChange, ctx }: { value: string[]; onChange: (ids: string[]) => void; ctx: RenderCtx }) {
  const { t } = useI18n();
  const templates = useLiveQuery(() => db.templates.where('kind').equals('document').filter((x) => !x.archived).toArray(), []) ?? [];
  return (
    <div className="thumb-grid">
      {templates.map((tp) => {
        const on = value.includes(tp.id);
        return (
          <button type="button" key={tp.id} className={`thumb-card ${on ? 'selected' : ''}`} onClick={() => onChange(on ? value.filter((x) => x !== tp.id) : [...value, tp.id])}>
            {on && (
              <span className="check-mark">
                <Check />
              </span>
            )}
            <div className="art">
              <TemplateThumb template={tp} ctx={ctx} height={100} />
            </div>
            <div className="title truncate">{tp.name}</div>
            <div className="meta">{t(`doctype.${tp.docType}`)}</div>
          </button>
        );
      })}
    </div>
  );
}

export function EnvelopePicker({ value, onChange, ctx }: { value?: string; onChange: (e: EnvelopeDesign) => void; ctx: RenderCtx }) {
  const envelopes = useLiveQuery(() => db.envelopes.toArray(), []) ?? [];
  return (
    <div className="thumb-grid lg">
      {envelopes.map((env) => (
        <button type="button" key={env.id} className={`thumb-card ${value === env.id ? 'selected' : ''}`} onClick={() => onChange(env)}>
          {value === env.id && (
            <span className="check-mark">
              <Check />
            </span>
          )}
          <div className="art">
            <EnvelopeThumb env={env} ctx={ctx} height={100} />
          </div>
          <div className="title">{env.name}</div>
          <div className="meta">
            {env.size} · {Math.round(env.front.w)}×{Math.round(env.front.h)} mm
          </div>
        </button>
      ))}
    </div>
  );
}
