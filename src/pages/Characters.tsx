import { useLiveQuery } from 'dexie-react-hooks';
import { BookUser, Copy, ImageOff, Info, LayoutGrid, List, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CHARACTER_ROLES, FONT_KEYS, WRITING_STYLES, type Character, type CharacterRole, type FontKey, type House, type Seal } from '../core/types';
import { normalizeText, nowISO, readFileAsDataURL, uid } from '../core/util';
import { db } from '../db/db';
import { bulkUpdateRecipients, deleteRecord, saveAsset, saveRecord, updateProject, updateSettings } from '../db/services';
import { useLib, useSettings } from '../app/data';
import { useAction, useFeedback } from '../app/feedback';
import { useSession } from '../app/session';
import { useI18n } from '../i18n';
import { FONTS, fontStack } from '../render/fonts';
import { SYMBOLS, SymbolGlyph } from '../render/symbols';
import { HouseChip, Portrait, SealView } from '../ui/art';
import { Badge, ColorInput, DataTable, Drawer, Dropzone, EmptyState, Field, Modal, PageHeader, SearchInput, Section } from '../ui/kit';
import { ExportMenu } from './shared/ExportMenu';

const HEX = /^#[0-9a-f]{6}$/i;
const PAPER = { background: '#f4ead3', backgroundImage: 'radial-gradient(circle at 25% 15%, rgba(255,255,255,0.6), transparent 60%)', color: '#3a2a1a' };
const SCRIPT_FONTS: FontKey[] = ['greatvibes', 'pinyon', 'marck'];
const FONT_ORDER: FontKey[] = [...SCRIPT_FONTS, ...FONT_KEYS.filter((k) => !SCRIPT_FONTS.includes(k))];
const INKS = ['#1b1b1b', '#1b2a4a', '#24243a', '#2f5233', '#5b1f1a', '#3d2a5c', '#5a3a1a', '#14505a'];
const MEDALLIONS = ['#3d2a5c', '#1f2f52', '#2f5233', '#7a2412', '#14505a', '#5b1f1a', '#4a3a24', '#33393f'];
const MAX_PORTRAIT_BYTES = 5 * 1024 * 1024;
const PORTRAIT_PX = 512;

interface Usage {
  projects: number;
  templates: number;
  fans: number;
}

interface CharData {
  characters: Character[];
  houses: House[];
  seals: Seal[];
  usage: Map<string, Usage>;
}

const usesOf = (u: Usage | undefined) => (u ? u.projects + u.templates : 0);

/** Reads an image and scales it down so portraits stay small in the offline database. */
async function preparePortrait(file: File): Promise<{ dataUrl: string; mime: string; width: number; height: number }> {
  const url = await readFileAsDataURL(file);
  const img = new Image();
  img.src = url;
  await img.decode().catch(() => undefined);
  const w = img.naturalWidth || 256;
  const h = img.naturalHeight || 256;
  if (file.type === 'image/svg+xml' || Math.max(w, h) <= PORTRAIT_PX) return { dataUrl: url, mime: file.type, width: w, height: h };
  const scale = PORTRAIT_PX / Math.max(w, h);
  const cw = Math.round(w * scale);
  const ch = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { dataUrl: url, mime: file.type, width: w, height: h };
  ctx.drawImage(img, 0, 0, cw, ch);
  const mime = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  return { dataUrl: canvas.toDataURL(mime, 0.9), mime, width: cw, height: ch };
}

function SignaturePreview({ c, size = 34, fallback }: { c: Character; size?: number; fallback?: string }) {
  return (
    <div
      className="truncate"
      style={{ fontFamily: fontStack(c.signatureFont), color: HEX.test(c.signatureColor) ? c.signatureColor : '#1b2a4a', fontSize: size, lineHeight: 1.45, padding: '2px 0' }}
      aria-label={c.signatureText || c.name}
    >
      {c.signatureText || c.name || fallback}
    </div>
  );
}

// ───────────── Delete ─────────────

function DeleteCharacterModal({ character, data, onClose }: { character: Character; data: CharData; onClose: () => void }) {
  const { t } = useI18n();
  const settings = useSettings();
  const run = useAction();
  const refs = useLiveQuery(
    async () => ({
      projects: await db.projects.filter((p) => p.senderId === character.id).toArray(),
      templates: await db.templates.filter((tp) => tp.senderId === character.id).toArray(),
      fans: await db.recipients.filter((r) => r.characterId === character.id).primaryKeys(),
    }),
    [character.id],
  );
  const [replacement, setReplacement] = useState<string | null>(null);
  if (!refs) return null;
  const isDefault = settings.mail.defaultSenderId === character.id;
  const others = data.characters.filter((c) => c.id !== character.id).sort((a, b) => a.name.localeCompare(b.name));
  const fallback = isDefault ? (others.find((c) => c.role === character.role)?.id ?? others[0]?.id ?? '') : (settings.mail.defaultSenderId ?? '');
  const target = replacement ?? fallback;
  const uses = refs.projects.length + refs.templates.length;
  const needsTarget = uses > 0 || isDefault || refs.fans.length > 0;
  const doDelete = async () => {
    const ok = await run(async () => {
      const next = target || undefined;
      for (const p of refs.projects) await updateProject(p.id, { senderId: next });
      for (const tp of refs.templates) await saveRecord('templates', { ...tp, senderId: next });
      if (refs.fans.length) await bulkUpdateRecipients(refs.fans as string[], () => ({ characterId: next }), 'Character removed');
      if (isDefault) await updateSettings({ mail: { ...settings.mail, defaultSenderId: next } }, 'default sender');
      await deleteRecord('characters', character.id);
      return true;
    }, t('common.deleted'));
    if (ok) onClose();
  };
  return (
    <Modal
      title={t('character.deleteTitle', { name: character.name })}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn danger solid" onClick={doDelete}>
            <Trash2 /> {t('common.delete')}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>{t('character.deleteBody')}</p>
      {uses > 0 && <div className="issue warning mb-8">{t('character.deleteInUse', { projects: refs.projects.length, templates: refs.templates.length })}</div>}
      {refs.fans.length > 0 && <div className="issue warning mb-8">{t('character.deleteFans', { count: refs.fans.length })}</div>}
      {isDefault && <div className="issue warning mb-8">{t('character.deleteIsDefault')}</div>}
      {needsTarget && (
        <Field label={t('character.reassignTo')} hint={t('character.reassignHint')}>
          <select className="select" value={target} onChange={(e) => setReplacement(e.target.value)}>
            <option value="">— {t('common.none')}</option>
            {others.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {t(`charrole.${c.role}`)}
              </option>
            ))}
          </select>
        </Field>
      )}
    </Modal>
  );
}

// ───────────── Editor ─────────────

function CharacterEditor({
  initial,
  isNew,
  data,
  onClose,
  onSaveCopy,
  onDelete,
}: {
  initial: Character;
  isNew: boolean;
  data: CharData;
  onClose: () => void;
  onSaveCopy: (c: Character) => void;
  onDelete: (c: Character) => void;
}) {
  const { t } = useI18n();
  const { can } = useSession();
  const run = useAction();
  const { confirm, toast } = useFeedback();
  const lib = useLib();
  const settings = useSettings();
  const [c, setC] = useState<Character>(initial);
  const [uploading, setUploading] = useState(false);
  const set = (p: Partial<Character>) => setC((x) => ({ ...x, ...p }));
  const editable = can('design.edit');
  const dirty = JSON.stringify(c) !== JSON.stringify(initial);
  const nameErr = !c.name.trim() ? t('library.nameRequired') : undefined;
  const sigColorErr = HEX.test(c.signatureColor) ? undefined : t('house.colorInvalid');
  const medColorErr = HEX.test(c.portraitColor) ? undefined : t('house.colorInvalid');
  const valid = !nameErr && !sigColorErr && !medColorErr;
  const isDefault = settings.mail.defaultSenderId === c.id;
  const asset = c.portraitAssetId ? lib.assets.get(c.portraitAssetId) : undefined;
  const seal = c.sealId ? data.seals.find((s) => s.id === c.sealId) : undefined;
  const houses = [...data.houses].sort((a, b) => a.name.localeCompare(b.name));
  const seals = [...data.seals].sort((a, b) => a.name.localeCompare(b.name));
  const usage = data.usage.get(c.id);
  const suggestion = t(`character.signoffSuggest.${c.writingStyle}`);
  const previewChar: Character = { ...c, portraitColor: HEX.test(c.portraitColor) ? c.portraitColor : initial.portraitColor };

  const close = async () => {
    if (dirty && editable && !(await confirm({ title: t('library.discardTitle'), body: t('library.discardBody'), confirm: t('library.discard'), danger: true }))) return;
    onClose();
  };
  const normalized = (): Character => {
    const name = c.name.trim();
    return { ...c, name, title: c.title.trim(), department: c.department.trim(), signatureText: c.signatureText.trim() || name, signOff: c.signOff.trim(), bio: c.bio.trim() };
  };
  const save = async () => {
    const saved = await run(() => saveRecord('characters', normalized()), t('common.saved'));
    if (saved) onClose();
  };
  const upload = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast(t('character.notImage'), 'error');
    if (f.size > MAX_PORTRAIT_BYTES) return toast(t('err.file_too_large', { max: '5 MB' }), 'error');
    setUploading(true);
    await run(async () => {
      const img = await preparePortrait(f);
      const a = await saveAsset(f.name, img.dataUrl, img.mime, img.width, img.height);
      set({ portraitAssetId: a.id });
    });
    setUploading(false);
  };

  return (
    <Drawer
      wide
      title={isNew ? t('character.new') : c.name || t('character.edit')}
      sub={isNew ? t('character.newSub') : t('character.usage', { projects: usage?.projects ?? 0, templates: usage?.templates ?? 0 })}
      onClose={close}
      footer={
        <>
          {editable && !isNew && (
            <>
              <button className="btn danger" onClick={() => onDelete(initial)}>
                <Trash2 /> {t('common.delete')}
              </button>
              <button className="btn" disabled={!valid} onClick={() => onSaveCopy(normalized())}>
                <Copy /> {t('common.duplicate')}
              </button>
              <button
                className="btn"
                disabled={isDefault}
                onClick={() => run(() => updateSettings({ mail: { ...settings.mail, defaultSenderId: c.id } }, 'default sender'), t('character.defaultSet', { name: initial.name }))}
              >
                <Star /> {isDefault ? t('character.default') : t('character.setDefault')}
              </button>
            </>
          )}
          <span className="grow" />
          <button className="btn" onClick={close}>
            {editable ? t('common.cancel') : t('common.close')}
          </button>
          {editable && (
            <button className="btn primary" disabled={!valid || (!dirty && !isNew)} onClick={save}>
              {t('common.save')}
            </button>
          )}
        </>
      }
    >
      {!editable && <div className="issue warning mb-16">{t('library.readOnly')}</div>}
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="col gap-16">
          <div style={{ ...PAPER, borderRadius: 12, padding: 22, position: 'relative', minHeight: 280 }}>
            <div className="tiny" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.6, marginBottom: 14 }}>
              {t('character.previewTitle')}
            </div>
            <div className="row gap-12">
              <Portrait character={previewChar} assets={lib.assets} size={76} />
              <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
                <b className="truncate" style={{ fontFamily: fontStack('cinzel'), fontSize: 15 }}>
                  {c.name || t('character.newName')}
                </b>
                {c.title && <span className="small">{c.title}</span>}
                {c.department && <span className="tiny" style={{ opacity: 0.7 }}>{c.department}</span>}
              </div>
            </div>
            <div style={{ marginTop: 22, fontFamily: fontStack('garamond'), fontStyle: 'italic', fontSize: 17 }}>{c.signOff}</div>
            <SignaturePreview c={c} size={46} fallback={t('character.newName')} />
            <div style={{ fontFamily: fontStack('garamond'), fontSize: 14, paddingRight: seal ? 72 : 0 }}>
              {c.name}
              {c.title ? `, ${c.title}` : ''}
            </div>
            {seal && (
              <div style={{ position: 'absolute', right: 14, bottom: 10 }}>
                <SealView seal={seal} size={64} />
              </div>
            )}
          </div>
          <div className="row wrap gap-4">
            <Badge tone="primary">{t(`charrole.${c.role}`)}</Badge>
            <Badge tone="info">{t(`writing.${c.writingStyle}`)}</Badge>
            {isDefault && <Badge tone="success">{t('character.default')}</Badge>}
            {!isNew && <Badge tone={usesOf(usage) ? 'info' : 'neutral'}>{t('character.usedIn', { count: usesOf(usage) })}</Badge>}
          </div>
          <div className="issue" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}>
            <Info />
            <div className="grow">{t('character.originalNote')}</div>
          </div>
        </div>

        <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <Section title={t('character.secIdentity')}>
            <div className="form-grid">
              <Field label={t('field.name')} required error={nameErr} className="full">
                <input className="input" value={c.name} onChange={(e) => set({ name: e.target.value })} autoFocus={isNew} maxLength={60} />
              </Field>
              <Field label={t('character.title')}>
                <input className="input" value={c.title} onChange={(e) => set({ title: e.target.value })} maxLength={60} />
              </Field>
              <Field label={t('character.role')}>
                <select className="select" value={c.role} onChange={(e) => set({ role: e.target.value as CharacterRole })}>
                  {CHARACTER_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`charrole.${r}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('character.department')}>
                <input className="input" value={c.department} onChange={(e) => set({ department: e.target.value })} maxLength={80} />
              </Field>
              <Field label={t('field.house')}>
                <select className="select" value={c.houseId ?? ''} onChange={(e) => set({ houseId: e.target.value || undefined })}>
                  <option value="">— {t('common.none')}</option>
                  {houses.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('character.bio')} className="full">
                <textarea className="textarea" rows={3} value={c.bio} onChange={(e) => set({ bio: e.target.value })} />
              </Field>
            </div>
          </Section>

          <Section title={t('character.secSignature')}>
            <div className="form-grid">
              <Field label={t('character.signatureText')} hint={t('character.signatureHint')} className="full">
                <input className="input" value={c.signatureText} placeholder={c.name} onChange={(e) => set({ signatureText: e.target.value })} maxLength={60} />
              </Field>
              <Field label={t('character.signatureFont')} className="full">
                <div className="thumb-grid" style={{ maxHeight: 250, overflowY: 'auto', padding: 2 }}>
                  {FONT_ORDER.map((k) => (
                    <button key={k} type="button" className={`thumb-card ${c.signatureFont === k ? 'selected' : ''}`} aria-pressed={c.signatureFont === k} onClick={() => set({ signatureFont: k })}>
                      <span
                        className="truncate"
                        style={{ ...PAPER, fontFamily: FONTS[k].stack, fontSize: FONTS[k].kind === 'script' ? 26 : 19, lineHeight: 1.3, color: HEX.test(c.signatureColor) ? c.signatureColor : PAPER.color, borderRadius: 6, padding: '4px 8px' }}
                      >
                        {c.signatureText || c.name || FONTS[k].label}
                      </span>
                      <span className="meta">
                        {FONTS[k].label}
                        {FONTS[k].kind === 'script' ? ` · ${t('character.script')}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={t('character.signatureColor')} error={sigColorErr}>
                <ColorInput value={c.signatureColor} onChange={(v) => set({ signatureColor: v })} />
              </Field>
              <Field label={t('character.inkPresets')}>
                <div className="row wrap gap-4">
                  {INKS.map((ink) => (
                    <button key={ink} type="button" className={`btn xs icon ${c.signatureColor === ink ? 'primary' : ''}`} title={ink} aria-label={ink} onClick={() => set({ signatureColor: ink })}>
                      <span className="swatch" style={{ background: ink }} />
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={t('character.writingStyle')}>
                <select className="select" value={c.writingStyle} onChange={(e) => set({ writingStyle: e.target.value as Character['writingStyle'] })}>
                  {WRITING_STYLES.map((w) => (
                    <option key={w} value={w}>
                      {t(`writing.${w}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={t('character.signOff')}
                hint={
                  c.signOff.trim() !== suggestion && editable ? (
                    <button type="button" className="btn xs ghost" style={{ paddingLeft: 0 }} onClick={() => set({ signOff: suggestion })}>
                      {t('character.useSuggestion', { text: suggestion })}
                    </button>
                  ) : undefined
                }
              >
                <input className="input" value={c.signOff} onChange={(e) => set({ signOff: e.target.value })} maxLength={60} />
              </Field>
            </div>
          </Section>

          <Section title={t('character.secSeal')}>
            <Field
              label={t('character.seal')}
              hint={<a href="#/studio/seals">{t('house.manageSeals')}</a>}
            >
              <div className="row">
                <select className="select grow" value={c.sealId ?? ''} onChange={(e) => set({ sealId: e.target.value || undefined })}>
                  <option value="">— {t('common.none')}</option>
                  {seals.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {t(`sealtype.${s.type}`)}
                    </option>
                  ))}
                </select>
                <div style={{ width: 56, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                  {seal ? <SealView seal={seal} size={52} /> : <span className="muted small">—</span>}
                </div>
              </div>
            </Field>
          </Section>

          <Section title={t('character.secPortrait')}>
            <div className="form-grid">
              <Field label={t('character.portrait')} hint={t('character.portraitHint')} className="full">
                {c.portraitAssetId ? (
                  <div className="row">
                    <Portrait character={previewChar} assets={lib.assets} size={56} />
                    <span className="grow small truncate">{asset?.name ?? '—'}</span>
                    <button type="button" className="btn sm danger" onClick={() => set({ portraitAssetId: undefined })}>
                      <ImageOff /> {t('character.removePortrait')}
                    </button>
                  </div>
                ) : editable ? (
                  <Dropzone accept="image/png,image/jpeg,image/webp,image/svg+xml" onFiles={upload} label={uploading ? t('common.saving') : t('character.uploadPortrait')} />
                ) : (
                  <span className="muted small">—</span>
                )}
              </Field>
              <Field label={t('character.portraitSymbol')} className="full" hint={asset ? t('character.symbolHidden') : t(`symbol.${c.portraitSymbol}`)}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(34px, 1fr))', gap: 4, maxHeight: 136, overflowY: 'auto', padding: 2 }}>
                  {SYMBOLS.map((sy) => (
                    <button
                      key={sy.key}
                      type="button"
                      className={`btn icon sm ${c.portraitSymbol === sy.key ? 'primary' : 'ghost'}`}
                      title={t(`symbol.${sy.key}`)}
                      aria-label={t(`symbol.${sy.key}`)}
                      aria-pressed={c.portraitSymbol === sy.key}
                      onClick={() => set({ portraitSymbol: sy.key })}
                    >
                      <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true">
                        <SymbolGlyph symbol={sy.key} x={0} y={0} size={24} color="currentColor" strokeWidth={2} />
                      </svg>
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={t('character.portraitColor')} error={medColorErr}>
                <ColorInput value={c.portraitColor} onChange={(v) => set({ portraitColor: v })} />
              </Field>
              <Field label={t('house.palettes')}>
                <div className="row wrap gap-4">
                  {MEDALLIONS.map((m) => (
                    <button key={m} type="button" className={`btn xs icon ${c.portraitColor === m ? 'primary' : ''}`} title={m} aria-label={m} onClick={() => set({ portraitColor: m })}>
                      <span className="swatch" style={{ background: m }} />
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          </Section>
        </fieldset>
      </div>
    </Drawer>
  );
}

// ───────────── Page ─────────────

export function Characters() {
  const { t } = useI18n();
  const { can } = useSession();
  const run = useAction();
  const { contextMenu } = useFeedback();
  const settings = useSettings();
  const lib = useLib();
  const data = useLiveQuery(async (): Promise<CharData> => {
    const usage = new Map<string, Usage>();
    const bump = (id: string | undefined, k: keyof Usage) => {
      if (!id) return;
      const u = usage.get(id) ?? { projects: 0, templates: 0, fans: 0 };
      u[k]++;
      usage.set(id, u);
    };
    await db.projects.each((p) => bump(p.senderId, 'projects'));
    await db.templates.each((tp) => bump(tp.senderId, 'templates'));
    await db.recipients.each((r) => bump(r.characterId, 'fans'));
    const [characters, houses, seals] = await Promise.all([db.characters.toArray(), db.houses.toArray(), db.seals.toArray()]);
    return { characters, houses, seals, usage };
  }, []);
  const [q, setQ] = useState('');
  const [role, setRole] = useState<'all' | CharacterRole>('all');
  const [view, setView] = useState<'grid' | 'table'>('grid');
  const [editing, setEditing] = useState<{ character: Character; isNew: boolean } | null>(null);
  const [deleting, setDeleting] = useState<Character | null>(null);
  if (!data) return null;

  const editable = can('design.edit');
  const defaultId = settings.mail.defaultSenderId;
  const houseOf = (id?: string) => (id ? data.houses.find((h) => h.id === id) : undefined);
  const sealOf = (id?: string) => (id ? data.seals.find((s) => s.id === id) : undefined);
  const n = normalizeText(q);
  const list = data.characters
    .filter(
      (c) =>
        (role === 'all' || c.role === role) &&
        (!n || normalizeText(`${c.name} ${c.title} ${c.department} ${c.signOff} ${t(`charrole.${c.role}`)} ${houseOf(c.houseId)?.name ?? ''}`).includes(n)),
    )
    .sort(
      (a, b) =>
        Number(b.id === defaultId) - Number(a.id === defaultId) ||
        CHARACTER_ROLES.indexOf(a.role) - CHARACTER_ROLES.indexOf(b.role) ||
        a.name.localeCompare(b.name),
    );
  const countIn = (r: CharacterRole) => data.characters.filter((c) => c.role === r).length;

  const blank = (): Character => {
    const now = nowISO();
    return {
      id: uid(),
      name: '',
      role: role === 'all' ? 'professor' : role,
      title: '',
      department: '',
      signatureText: '',
      signatureFont: 'greatvibes',
      signatureColor: '#1b2a4a',
      portraitSymbol: 'quill',
      portraitColor: MEDALLIONS[data.characters.length % MEDALLIONS.length],
      writingStyle: 'warm',
      signOff: t('character.signoffSuggest.warm'),
      bio: '',
      createdAt: now,
      updatedAt: now,
    };
  };
  const saveCopy = async (c: Character) => {
    const now = nowISO();
    const copy: Character = { ...c, id: uid(), name: t('library.copyOf', { name: c.name }), createdAt: now, updatedAt: now };
    return run(() => saveRecord('characters', copy), t('library.duplicated'));
  };
  const setDefault = (c: Character) => run(() => updateSettings({ mail: { ...settings.mail, defaultSenderId: c.id } }, 'default sender'), t('character.defaultSet', { name: c.name }));
  const open = (c: Character) => setEditing({ character: c, isNew: false });
  const createNew = () => setEditing({ character: blank(), isNew: true });
  const menu = (c: Character) => [
    { label: editable ? t('common.edit') : t('common.open'), icon: <Pencil />, onClick: () => open(c) },
    ...(editable
      ? [
          { label: t('common.duplicate'), icon: <Copy />, onClick: () => void saveCopy(c) },
          { label: t('character.setDefault'), icon: <Star />, onClick: () => void setDefault(c), disabled: c.id === defaultId },
          { label: '', divider: true },
          { label: t('common.delete'), icon: <Trash2 />, danger: true, onClick: () => setDeleting(c) },
        ]
      : []),
  ];
  const actionButtons = (c: Character) =>
    editable ? (
      <>
        <button className="btn xs ghost icon" title={t('common.edit')} aria-label={t('common.edit')} onClick={() => open(c)}>
          <Pencil />
        </button>
        <button className="btn xs ghost icon" title={t('common.duplicate')} aria-label={t('common.duplicate')} onClick={() => void saveCopy(c)}>
          <Copy />
        </button>
        <button className="btn xs ghost icon" title={t('character.setDefault')} aria-label={t('character.setDefault')} disabled={c.id === defaultId} onClick={() => void setDefault(c)}>
          <Star />
        </button>
        <button className="btn xs ghost icon danger" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => setDeleting(c)}>
          <Trash2 />
        </button>
      </>
    ) : null;

  return (
    <div>
      <PageHeader
        eyebrow={t('navgroup.studio')}
        title={t('nav.characters')}
        sub={t('character.sub')}
        actions={
          <>
            <div className="btn-group">
              <button className={`btn icon ${view === 'table' ? 'active' : ''}`} onClick={() => setView('table')} aria-label={t('common.table')} title={t('common.table')}>
                <List />
              </button>
              <button className={`btn icon ${view === 'grid' ? 'active' : ''}`} onClick={() => setView('grid')} aria-label={t('common.grid')} title={t('common.grid')}>
                <LayoutGrid />
              </button>
            </div>
            <ExportMenu
              name={t('nav.characters')}
              build={() => ({
                head: [t('field.name'), t('character.title'), t('character.role'), t('character.department'), t('field.house'), t('character.writingStyle'), t('character.signOff'), t('character.signatureText'), t('nav.projects'), t('nav.templates'), t('character.default')],
                rows: list.map((c) => {
                  const u = data.usage.get(c.id);
                  return [c.name, c.title, t(`charrole.${c.role}`), c.department, houseOf(c.houseId)?.name ?? '', t(`writing.${c.writingStyle}`), c.signOff, c.signatureText, u?.projects ?? 0, u?.templates ?? 0, c.id === defaultId ? '✓' : ''];
                }),
              })}
            />
            {editable && (
              <button className="btn primary" onClick={createNew}>
                <Plus /> {t('character.new')}
              </button>
            )}
          </>
        }
      />

      <div className="issue mb-16" role="note" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}>
        <Info />
        <div className="grow">{t('character.originalNote')}</div>
      </div>

      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder={t('character.search')} />
      </div>
      <div className="row wrap gap-4 mb-16" role="tablist" aria-label={t('character.role')}>
        <button className={`btn sm ${role === 'all' ? 'primary' : 'ghost'}`} role="tab" aria-selected={role === 'all'} onClick={() => setRole('all')}>
          {t('common.all')} <span className={role === 'all' ? '' : 'muted'}>{data.characters.length}</span>
        </button>
        {CHARACTER_ROLES.map((r) => (
          <button key={r} className={`btn sm ${role === r ? 'primary' : 'ghost'}`} role="tab" aria-selected={role === r} onClick={() => setRole(r)}>
            {t(`charrole.${r}`)} <span className={role === r ? '' : 'muted'}>{countIn(r)}</span>
          </button>
        ))}
      </div>

      {!list.length ? (
        <EmptyState
          icon={<BookUser />}
          title={data.characters.length ? t('common.noResults') : t('character.empty')}
          text={data.characters.length ? undefined : t('character.emptyHint')}
          action={
            editable && !data.characters.length ? (
              <button className="btn primary" onClick={createNew}>
                <Plus /> {t('character.new')}
              </button>
            ) : undefined
          }
        />
      ) : view === 'table' ? (
        <DataTable
          rows={list}
          rowKey={(c) => c.id}
          onRowClick={open}
          onContextMenu={(c, e) => {
            e.preventDefault();
            contextMenu(e, menu(c));
          }}
          columns={[
            { key: 'portrait', header: '', width: 52, render: (c) => <Portrait character={c} assets={lib.assets} size={36} /> },
            {
              key: 'name',
              header: t('field.name'),
              sort: (c) => c.name,
              render: (c) => (
                <div className="col" style={{ gap: 2 }}>
                  <b>{c.name}</b>
                  <span className="muted small">{c.title}</span>
                </div>
              ),
            },
            { key: 'role', header: t('character.role'), sort: (c) => CHARACTER_ROLES.indexOf(c.role), render: (c) => t(`charrole.${c.role}`) },
            { key: 'dept', header: t('character.department'), sort: (c) => c.department, render: (c) => c.department || '—' },
            { key: 'house', header: t('field.house'), sort: (c) => houseOf(c.houseId)?.name ?? '', render: (c) => <HouseChip house={houseOf(c.houseId)} /> },
            { key: 'style', header: t('character.writingStyle'), sort: (c) => c.writingStyle, render: (c) => t(`writing.${c.writingStyle}`) },
            { key: 'sig', header: t('character.signature'), render: (c) => <SignaturePreview c={c} size={22} /> },
            { key: 'uses', header: t('character.uses'), className: 'num right', sort: (c) => usesOf(data.usage.get(c.id)), render: (c) => usesOf(data.usage.get(c.id)) },
            { key: 'default', header: '', render: (c) => (c.id === defaultId ? <Badge tone="success">{t('character.default')}</Badge> : null) },
            {
              key: 'actions',
              header: '',
              render: (c) => (
                <div className="row gap-4" onClick={(e) => e.stopPropagation()}>
                  {actionButtons(c)}
                </div>
              ),
            },
          ]}
        />
      ) : (
        <div className="grid grid-3">
          {list.map((c) => {
            const u = data.usage.get(c.id);
            const uses = usesOf(u);
            const isDefault = c.id === defaultId;
            const seal = sealOf(c.sealId);
            const house = houseOf(c.houseId);
            return (
              <div
                key={c.id}
                className="card"
                role="button"
                tabIndex={0}
                style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', borderColor: isDefault ? 'var(--accent)' : undefined }}
                onClick={() => open(c)}
                onKeyDown={(e: ReactKeyboardEvent) => e.key === 'Enter' && e.target === e.currentTarget && open(c)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  contextMenu(e, menu(c));
                }}
              >
                <div className="card-body col gap-12" style={{ flex: 1 }}>
                  <div className="row gap-12" style={{ alignItems: 'flex-start' }}>
                    <Portrait character={c} assets={lib.assets} size={64} />
                    <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
                      <b className="truncate" style={{ fontSize: 16 }}>
                        {c.name}
                      </b>
                      {c.title && <span className="small truncate">{c.title}</span>}
                      {c.department && <span className="muted tiny truncate">{c.department}</span>}
                    </div>
                    {seal && (
                      <span title={`${t('character.seal')}: ${seal.name}`} style={{ flex: 'none' }}>
                        <SealView seal={seal} size={42} />
                      </span>
                    )}
                  </div>
                  <div className="row wrap gap-4">
                    {isDefault && (
                      <Badge tone="success">
                        <Star size={11} /> {t('character.default')}
                      </Badge>
                    )}
                    <Badge tone="primary">{t(`charrole.${c.role}`)}</Badge>
                    <Badge tone="info">{t(`writing.${c.writingStyle}`)}</Badge>
                    {house && (
                      <Badge>
                        <HouseChip house={house} />
                      </Badge>
                    )}
                  </div>
                  <div style={{ ...PAPER, borderRadius: 8, padding: '8px 12px' }}>
                    {c.signOff && <div style={{ fontFamily: fontStack('garamond'), fontStyle: 'italic', fontSize: 14 }}>{c.signOff}</div>}
                    <SignaturePreview c={c} size={34} />
                    <div className="tiny" style={{ opacity: 0.65 }}>
                      {FONTS[c.signatureFont]?.label}
                    </div>
                  </div>
                  {c.bio && (
                    <p className="small muted" style={{ margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {c.bio}
                    </p>
                  )}
                  <span className="grow" />
                  <div className="row wrap gap-4" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <Badge tone={uses ? 'info' : 'neutral'} title={t('character.usage', { projects: u?.projects ?? 0, templates: u?.templates ?? 0 })}>
                      {t('character.usedIn', { count: uses })}
                    </Badge>
                    <span className="grow" />
                    {actionButtons(c)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <CharacterEditor
          key={editing.character.id}
          initial={editing.character}
          isNew={editing.isNew}
          data={data}
          onClose={() => setEditing(null)}
          onSaveCopy={async (c) => {
            const copy = await saveCopy(c);
            if (copy) setEditing({ character: copy, isNew: false });
          }}
          onDelete={(c) => {
            setEditing(null);
            setDeleting(c);
          }}
        />
      )}
      {deleting && <DeleteCharacterModal character={deleting} data={data} onClose={() => setDeleting(null)} />}
    </div>
  );
}
