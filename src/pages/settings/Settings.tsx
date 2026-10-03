import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  Bell,
  Building2,
  Database,
  Download,
  ExternalLink,
  FileJson,
  Globe,
  HardDrive,
  Info,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  Package,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Tags,
  Trash2,
  Truck,
  Undo2,
  Upload,
  User as UserIcon,
  UserPlus,
  UserX,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { DEFAULT_ROLE_PERMISSIONS, ROLE_KEYS } from '../../core/permissions';
import { formatDocumentNumber } from '../../core/template';
import {
  CURRENCIES,
  DATE_FORMATS,
  PAPER_KINDS,
  PERMISSIONS,
  PRODUCT_CATEGORIES,
  type AppSettings,
  type Carrier,
  type DateFormat,
  type Lang,
  type NotificationSettings,
  type PaperKind,
  type Permission,
  type Product,
  type ProductCategory,
  type Recipient,
  type RoleKey,
  type Tag,
  type Template,
  type User,
} from '../../core/types';
import {
  addMonths,
  clone,
  countBy,
  diffDays,
  downloadBlob,
  formatBytes,
  formatDate,
  formatDateTime,
  formatMoney,
  normalizeText,
  nowISO,
  readFileAsDataURL,
  readFileAsText,
  todayISO,
  uid,
} from '../../core/util';
import { isValidEmail } from '../../core/validation';
import { passwordProblems, PBKDF2_ITERATIONS, verifyPassword } from '../../db/auth';
import { BackupError, backupSummary, exportDatabase, isEncryptedBackup, parseBackup, restoreDatabase } from '../../db/backup';
import { db } from '../../db/db';
import { loadDemoWorkspace } from '../../db/seed';
import {
  anonymizeRecipient,
  clearAllData,
  createUser,
  deleteRecord,
  deleteTag,
  deleteUser,
  getSettings,
  restoreNotifications,
  saveAsset,
  saveRecord,
  saveTag,
  setUserPassword,
  updateSettings,
  updateUser,
} from '../../db/services';
import { useFmt, useSettings } from '../../app/data';
import { useAction, useFeedback } from '../../app/feedback';
import { setQuery, useRoute } from '../../app/router';
import { useSession } from '../../app/session';
import { LANGS, useI18n } from '../../i18n';
import {
  Avatar,
  Badge,
  Card,
  ColorInput,
  DataTable,
  Drawer,
  Dropzone,
  EmptyState,
  Field,
  Modal,
  NumberInput,
  PageHeader,
  Progress,
  Stat,
  StatusBadge,
  TagPill,
  Tabs,
  Toggle,
  type TabDef,
} from '../../ui/kit';
import { PrintSettingsForm } from '../print/BatchDetail';
import { ExportMenu } from '../shared/ExportMenu';
import { EnvelopePicker, LibraryPicker, MultiTemplatePicker, useSampleCtx } from '../shared/pickers';

// ───────────── Helpers ─────────────

const DEMO_USERS = ['editor', 'production', 'viewer'];
const DEMO_PASSWORD = 'owlpost2026';
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const TAG_COLORS = ['#7b2d26', '#a33a2f', '#c26a2a', '#b08d57', '#6b4a2b', '#2f6b4f', '#3f7f8c', '#4b6a99', '#1b2a4a', '#8e5aa8', '#6b6b6b'];

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function generatePassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const a = new Uint32Array(10);
  crypto.getRandomValues(a);
  return Array.from(a, (n, i) => (i % 4 === 3 ? digits[n % digits.length] : letters[n % letters.length])).join('');
}

/** Reads an image and scales it down so the logo stays small in the offline database. */
async function prepareImage(file: File, maxPx: number): Promise<{ dataUrl: string; mime: string; width: number; height: number }> {
  const url = await readFileAsDataURL(file);
  const img = new Image();
  img.src = url;
  await img.decode().catch(() => undefined);
  const w = img.naturalWidth || maxPx;
  const h = img.naturalHeight || maxPx;
  if (file.type === 'image/svg+xml' || Math.max(w, h) <= maxPx) return { dataUrl: url, mime: file.type, width: w, height: h };
  const scale = maxPx / Math.max(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return { dataUrl: url, mime: file.type, width: w, height: h };
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const mime = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  return { dataUrl: canvas.toDataURL(mime, 0.9), mime, width: canvas.width, height: canvas.height };
}

function Note({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' | 'error' }) {
  if (tone === 'info')
    return (
      <div className="issue" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}>
        <Info />
        <div className="grow">{children}</div>
      </div>
    );
  return (
    <div className={`issue ${tone}`}>
      <AlertTriangle />
      <div className="grow">{children}</div>
    </div>
  );
}

/** Local edits on top of a live source object; edits that match the source again are dropped automatically. */
function useEdits<T extends object>(source: T) {
  const [edits, setEdits] = useState<Partial<T>>({});
  useEffect(() => {
    setEdits((e) => {
      const keys = Object.keys(e) as (keyof T)[];
      const left = keys.filter((k) => !sameValue(e[k], source[k]));
      if (left.length === keys.length) return e;
      const next: Partial<T> = {};
      for (const k of left) next[k] = e[k];
      return next;
    });
  }, [source]);
  const draft = useMemo<T>(() => ({ ...source, ...edits }), [source, edits]);
  const dirty = (Object.keys(edits) as (keyof T)[]).some((k) => !sameValue(edits[k], source[k]));
  const set = useCallback((p: Partial<T>) => setEdits((e) => ({ ...e, ...p })), []);
  const reset = useCallback(() => setEdits({}), []);
  return { draft, edits, dirty, set, reset };
}

type SectionKey = 'company' | 'mail' | 'print' | 'regional' | 'defaults' | 'notifications' | 'privacy';

/** Draft of one settings section; saving merges the edits into the latest stored section. */
function useSection<K extends SectionKey>(key: K) {
  const { t } = useI18n();
  const run = useAction();
  const settings = useSettings();
  const e = useEdits<AppSettings[K]>(settings[key]);
  const { edits } = e;
  const save = () =>
    run(async () => {
      const s = await getSettings();
      const patch: Partial<AppSettings> = {};
      (patch as Record<string, unknown>)[key] = { ...s[key], ...edits };
      await updateSettings(patch, key);
    }, t('common.saved'));
  return { ...e, settings, save };
}

function SaveBar({ dirty, blocked, onSave, onReset }: { dirty: boolean; blocked?: boolean; onSave: () => void; onReset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="row" style={{ position: 'sticky', bottom: 0, zIndex: 3, padding: '12px 0', marginTop: 4, background: 'var(--bg)', borderTop: '1px solid var(--border)' }}>
      <span className="muted small grow">{dirty ? t('settings.unsaved') : t('common.allSaved')}</span>
      {dirty && (
        <button className="btn" onClick={onReset}>
          <Undo2 /> {t('settings.discardChanges')}
        </button>
      )}
      <button className="btn primary" disabled={!dirty || blocked} onClick={onSave}>
        <Save /> {t('settings.saveChanges')}
      </button>
    </div>
  );
}

// ───────────── Account ─────────────

function AccountTab() {
  const { t, lang, setLang } = useI18n();
  const { user, settings, logout, lock } = useSession();
  const fmt = useFmt();
  const run = useAction();
  const [name, setName] = useState(user?.displayName ?? '');
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [pwError, setPwError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(user?.displayName ?? ''), [user?.displayName]);
  if (!user) return null;
  const minutes = settings?.privacy.autoLockMinutes ?? 20;

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwError('');
    const problems = passwordProblems(pw);
    if (problems.length) return setPwError(t(`auth.${problems[0]}`));
    if (pw !== pw2) return setPwError(t('auth.pwMismatch'));
    setBusy(true);
    try {
      if (!(await verifyPassword(user, cur))) return setPwError(t('settings.account.wrongPassword'));
      const ok = await run(async () => {
        await setUserPassword(user.id, pw, false);
        return true;
      }, t('settings.account.passwordChanged'));
      if (ok) {
        setCur('');
        setPw('');
        setPw2('');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-2">
      {user.mustChangePassword && (
        <div className="span-all">
          <Note tone="warning">{t('settings.account.mustChange')}</Note>
        </div>
      )}
      <Card title={t('settings.account.profile')}>
        <div className="row gap-12 mb-16">
          <Avatar name={user.displayName || user.username} size="lg" />
          <div className="grow">
            <b>{user.displayName}</b>
            <div className="muted small">
              @{user.username} · {t(`role.${user.role}`)}
            </div>
          </div>
        </div>
        <dl className="kv mb-16">
          <dt>{t('settings.lastLogin')}</dt>
          <dd>{fmt.dateTime(user.lastLoginAt) || t('settings.never')}</dd>
          <dt>{t('common.created')}</dt>
          <dd>{fmt.date(user.createdAt)}</dd>
        </dl>
        <Field label={t('settings.displayName')}>
          <div className="row">
            <input className="input grow" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            <button
              className="btn primary"
              disabled={!name.trim() || name.trim() === user.displayName}
              onClick={() => run(() => updateUser(user.id, { displayName: name.trim() }), t('common.saved'))}
            >
              <Save /> {t('common.save')}
            </button>
          </div>
        </Field>
      </Card>
      <Card title={t('settings.account.changePassword')}>
        <form className="col gap-12" onSubmit={changePassword}>
          <Field label={t('settings.account.currentPassword')}>
            <input className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
          </Field>
          <Field label={t('settings.account.newPassword')} hint={t('auth.pwRules')}>
            <input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
          </Field>
          <Field label={t('auth.passwordRepeat')}>
            <input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
          </Field>
          {pwError && <div className="issue error">{pwError}</div>}
          <div className="row">
            <span className="grow" />
            <button className="btn primary" type="submit" disabled={busy || !cur || !pw || !pw2}>
              <KeyRound /> {busy ? t('common.saving') : t('settings.account.updatePassword')}
            </button>
          </div>
        </form>
      </Card>
      <Card title={t('settings.account.language')}>
        <Field hint={t('settings.account.languageHint')}>
          <select className="select" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
        <h4 className="mt-16 mb-8">{t('settings.account.theme')}</h4>
        <p className="muted small">{t('settings.account.themeHint')}</p>
      </Card>
      <Card title={t('settings.account.session')}>
        <p className="muted small mb-16">{minutes > 0 ? t('settings.account.sessionHint', { minutes }) : t('settings.account.sessionNoLock')}</p>
        <div className="row">
          <button className="btn" onClick={lock}>
            <Lock /> {t('auth.lockNow')}
          </button>
          <button className="btn danger" onClick={() => logout()}>
            <LogOut /> {t('auth.signOut')}
          </button>
        </div>
      </Card>
    </div>
  );
}

// ───────────── Company ─────────────

function CompanyTab() {
  const { t } = useI18n();
  const run = useAction();
  const { toast } = useFeedback();
  const { draft, set, dirty, save, reset } = useSection('company');
  const logo = useLiveQuery(() => (draft.logoAssetId ? db.assets.get(draft.logoAssetId) : undefined), [draft.logoAssetId]);
  const [uploading, setUploading] = useState(false);
  const emailErr = draft.email && !isValidEmail(draft.email) ? t('val.email_invalid') : undefined;

  const upload = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast(t('settings.company.notImage'), 'error');
    if (f.size > MAX_LOGO_BYTES) return toast(t('err.file_too_large', { max: '5 MB' }), 'error');
    setUploading(true);
    await run(async () => {
      const img = await prepareImage(f, 800);
      const a = await saveAsset(f.name, img.dataUrl, img.mime, img.width, img.height);
      set({ logoAssetId: a.id });
    });
    setUploading(false);
  };

  return (
    <div className="grid grid-2">
      <Card title={t('settings.company.identity')}>
        <div className="form-grid">
          <Field label={t('settings.company.systemName')} hint={t('settings.company.systemNameHint')} className="full">
            <input className="input" value={draft.systemName} onChange={(e) => set({ systemName: e.target.value })} />
          </Field>
          <Field label={t('settings.company.name')} className="full">
            <input className="input" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label={t('settings.company.schoolName')}>
            <input className="input" value={draft.schoolName} onChange={(e) => set({ schoolName: e.target.value })} />
          </Field>
          <Field label={t('settings.company.motto')}>
            <input className="input" value={draft.motto} onChange={(e) => set({ motto: e.target.value })} />
          </Field>
        </div>
      </Card>
      <Card title={t('settings.company.contact')}>
        <div className="form-grid">
          <Field label={t('field.email')} error={emailErr}>
            <input className="input" type="email" value={draft.email} onChange={(e) => set({ email: e.target.value })} />
          </Field>
          <Field label={t('field.phone')}>
            <input className="input" value={draft.phone} onChange={(e) => set({ phone: e.target.value })} />
          </Field>
          <Field label={t('settings.company.website')} className="full">
            <input className="input" type="url" value={draft.website} onChange={(e) => set({ website: e.target.value })} placeholder="https://" />
          </Field>
          <Field label={t('settings.company.address')} className="full">
            <textarea className="textarea" rows={4} value={draft.address} onChange={(e) => set({ address: e.target.value })} />
          </Field>
        </div>
      </Card>
      <Card title={t('settings.company.logo')} sub={t('settings.company.logoHint')} className="span-all">
        <div className="row gap-16 top">
          {logo && (
            <div className="col" style={{ alignItems: 'flex-start' }}>
              <div className="card pad flat" style={{ background: 'var(--surface-2)' }}>
                <img src={logo.dataUrl} alt={t('settings.company.logo')} style={{ display: 'block', maxHeight: 110, maxWidth: 260, objectFit: 'contain' }} />
              </div>
              <button className="btn sm danger" onClick={() => set({ logoAssetId: undefined })}>
                <Trash2 /> {t('settings.company.removeLogo')}
              </button>
            </div>
          )}
          <div className="grow">
            <Dropzone accept="image/png,image/jpeg,image/webp,image/svg+xml" onFiles={upload} label={uploading ? t('common.saving') : t('settings.company.uploadLogo')} />
          </div>
        </div>
      </Card>
      <div className="span-all">
        <SaveBar dirty={dirty} blocked={!!emailErr} onSave={save} onReset={reset} />
      </div>
    </div>
  );
}

// ───────────── Mail ─────────────

function MailTab() {
  const { t } = useI18n();
  const { draft, set, dirty, save, reset, settings } = useSection('mail');
  const characters = useLiveQuery(() => db.characters.orderBy('name').toArray(), []);
  const templates = useLiveQuery(() => db.templates.where('kind').equals('letter').filter((x) => !x.archived).toArray(), []);
  const pattern = draft.documentNumberFormat ?? '';
  const example = formatDocumentNumber(pattern, 184, '000184');
  const hasSeq = /\{N+\}|\{SEQ\}/.test(pattern);
  const prefix = draft.orderPrefix || 'HM';
  const year = new Date().getFullYear();
  const tokens: [string, string][] = [
    ['{YYYY}', t('settings.mail.tokenYYYY')],
    ['{YY}', t('settings.mail.tokenYY')],
    ['{MM}', t('settings.mail.tokenMM')],
    ['{NNNNN}', t('settings.mail.tokenN')],
    ['{SEQ}', t('settings.mail.tokenSEQ')],
    ['{CODE}', t('settings.mail.tokenCODE')],
  ];
  return (
    <div className="grid grid-2">
      <Card title={t('settings.mail.delivery')}>
        <div className="form-grid">
          <Field label={t('settings.mail.returnAddress')} hint={t('settings.mail.returnAddressHint')} className="full">
            <textarea className="textarea" rows={3} value={draft.returnAddress} onChange={(e) => set({ returnAddress: e.target.value })} />
          </Field>
          <Field label={t('settings.mail.defaultCarrier')} className="full">
            <select className="select" value={draft.defaultCarrierId} onChange={(e) => set({ defaultCarrierId: e.target.value })}>
              {!settings.carriers.some((c) => c.id === draft.defaultCarrierId) && <option value={draft.defaultCarrierId}>— {t('common.none')}</option>}
              {settings.carriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.active ? '' : ` (${t('settings.inactive')})`}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('settings.mail.defaultSender')} hint={t('settings.mail.defaultSenderHint')} className="full">
            <select className="select" value={draft.defaultSenderId ?? ''} onChange={(e) => set({ defaultSenderId: e.target.value || undefined })}>
              <option value="">— {t('common.none')}</option>
              {(characters ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.title ? ` · ${c.title}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('settings.mail.defaultTemplate')} hint={t('settings.mail.defaultTemplateHint')} className="full">
            <select className="select" value={draft.defaultLetterTemplateId ?? ''} onChange={(e) => set({ defaultLetterTemplateId: e.target.value || undefined })}>
              <option value="">— {t('common.none')}</option>
              {(templates ?? []).map((tp) => (
                <option key={tp.id} value={tp.id}>
                  {tp.name} · {tp.language.toUpperCase()}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>
      <Card title={t('settings.mail.numbering')}>
        <div className="form-grid">
          <Field
            label={t('settings.mail.docFormat')}
            className="full"
            error={!pattern.trim() ? t('settings.required') : undefined}
            warning={pattern.trim() && !hasSeq ? t('settings.mail.noSeq') : undefined}
          >
            <input className="input mono" value={pattern} onChange={(e) => set({ documentNumberFormat: e.target.value })} />
          </Field>
          <div className="full row">
            <span className="muted small">{t('common.example')}:</span>
            <b className="mono">{example || '—'}</b>
          </div>
          <div className="full">
            <div className="muted small mb-8">{t('settings.mail.tokens')}</div>
            <div className="col gap-4">
              {tokens.map(([tok, label]) => (
                <div key={tok} className="row">
                  <button type="button" className="var-chip" title={t('settings.mail.insertToken')} onClick={() => set({ documentNumberFormat: pattern + tok })}>
                    {tok}
                  </button>
                  <span className="small muted">{label}</span>
                </div>
              ))}
            </div>
          </div>
          <Field label={t('settings.mail.orderPrefix')} hint={t('settings.mail.orderPrefixHint', { example: `${prefix}-${year}-001842` })} className="full">
            <input className="input mono" value={draft.orderPrefix} maxLength={12} onChange={(e) => set({ orderPrefix: e.target.value.replace(/\s+/g, '') })} />
          </Field>
        </div>
      </Card>
      <div className="span-all">
        <SaveBar dirty={dirty} blocked={!pattern.trim()} onSave={save} onReset={reset} />
      </div>
    </div>
  );
}

// ───────────── Print ─────────────

function PrintTab() {
  const { t } = useI18n();
  const { draft, set, dirty, save, reset } = useSection('print');
  return (
    <Card title={t('settings.print.title')} sub={t('settings.print.hint')}>
      <PrintSettingsForm s={draft} onChange={set} />
      <SaveBar dirty={dirty} onSave={save} onReset={reset} />
    </Card>
  );
}

// ───────────── Regional ─────────────

function RegionalTab() {
  const { t, locale } = useI18n();
  const { draft, set, dirty, save, reset } = useSection('regional');
  const now = new Date();
  return (
    <div className="grid grid-2">
      <Card title={t('settings.tab.regional')}>
        <div className="form-grid">
          <Field label={t('settings.regional.currency')} hint={t('settings.regional.currencyHint')} className="full">
            <select className="select" value={draft.currency} onChange={(e) => set({ currency: e.target.value })}>
              {!(CURRENCIES as readonly string[]).includes(draft.currency) && <option value={draft.currency}>{draft.currency}</option>}
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c} — {formatMoney(1234.5, c, locale)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('settings.regional.dateFormat')} className="full">
            <select className="select" value={draft.dateFormat} onChange={(e) => set({ dateFormat: e.target.value as DateFormat })}>
              {DATE_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f} — {formatDate(now, f, locale)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('settings.regional.language')} hint={t('settings.regional.languageHint')} className="full">
            <select className="select" value={draft.language} onChange={(e) => set({ language: e.target.value as Lang })}>
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>
      <Card title={t('settings.regional.preview')}>
        <dl className="kv">
          <dt>{t('settings.regional.currency')}</dt>
          <dd className="num">{formatMoney(1234.5, draft.currency, locale)}</dd>
          <dt>{t('settings.regional.dateFormat')}</dt>
          <dd>{formatDate(now, draft.dateFormat, locale)}</dd>
          <dt>{t('settings.regional.dateTime')}</dt>
          <dd>{formatDateTime(now.toISOString(), draft.dateFormat, locale)}</dd>
          <dt>{t('settings.regional.language')}</dt>
          <dd>{LANGS.find((l) => l.code === draft.language)?.label ?? draft.language}</dd>
        </dl>
      </Card>
      <div className="span-all">
        <SaveBar dirty={dirty} onSave={save} onReset={reset} />
      </div>
    </div>
  );
}

// ───────────── Design defaults ─────────────

function DefaultsTab() {
  const { t } = useI18n();
  const { draft, set, dirty, save, reset } = useSection('defaults');
  const ctx = useSampleCtx('settings-env');
  const envCount = useLiveQuery(() => db.envelopes.count(), []);
  return (
    <div className="col gap-16">
      <Card
        title={t('settings.defaults.envelope')}
        sub={t('settings.defaults.envelopeHint')}
        actions={
          draft.envelopeId ? (
            <button className="btn sm" onClick={() => set({ envelopeId: undefined })}>
              {t('common.clear')}
            </button>
          ) : undefined
        }
      >
        {envCount === 0 ? <EmptyState title={t('settings.defaults.noEnvelopes')} /> : <EnvelopePicker value={draft.envelopeId} onChange={(e) => set({ envelopeId: e.id })} ctx={ctx} />}
      </Card>
      <Card title={t('settings.defaults.paper')} sub={t('settings.defaults.paperHint')}>
        <select className="select" style={{ maxWidth: 320 }} value={draft.paper} onChange={(e) => set({ paper: e.target.value as PaperKind })}>
          {PAPER_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`paper.${k}`)}
            </option>
          ))}
        </select>
      </Card>
      <Card title={t('settings.defaults.stamp')}>
        <LibraryPicker kind="stamp" value={draft.stampId} onChange={(id) => set({ stampId: id })} />
      </Card>
      <Card title={t('settings.defaults.postmark')}>
        <LibraryPicker kind="postmark" value={draft.postmarkId} onChange={(id) => set({ postmarkId: id })} />
      </Card>
      <Card title={t('settings.defaults.seal')}>
        <LibraryPicker kind="seal" value={draft.sealId} onChange={(id) => set({ sealId: id })} />
      </Card>
      <SaveBar dirty={dirty} onSave={save} onReset={reset} />
    </div>
  );
}

// ───────────── Notifications ─────────────

type DaysFlag = 'birthdayDays' | 'unprintedDays' | 'unshippedDays';
type BoolFlag = Exclude<keyof NotificationSettings, DaysFlag>;

function NotificationsTab() {
  const { t } = useI18n();
  const run = useAction();
  const { draft, set, dirty, save, reset } = useSection('notifications');
  const dismissed = useLiveQuery(() => db.dismissals.count(), []);
  const rows: { flag: BoolFlag; label: string; hint: string; days?: DaysFlag; daysLabel?: string }[] = [
    { flag: 'newOrder', label: t('settings.notif.newOrder'), hint: t('settings.notif.newOrderHint') },
    { flag: 'overdue', label: t('settings.notif.overdue'), hint: t('settings.notif.overdueHint') },
    { flag: 'lowStock', label: t('settings.notif.lowStock'), hint: t('settings.notif.lowStockHint') },
    { flag: 'birthdays', label: t('settings.notif.birthdays'), hint: t('settings.notif.birthdaysHint'), days: 'birthdayDays', daysLabel: t('settings.notif.daysBefore') },
    { flag: 'unprinted', label: t('settings.notif.unprinted'), hint: t('settings.notif.unprintedHint'), days: 'unprintedDays', daysLabel: t('settings.notif.afterDays') },
    { flag: 'unshipped', label: t('settings.notif.unshipped'), hint: t('settings.notif.unshippedHint'), days: 'unshippedDays', daysLabel: t('settings.notif.afterDays') },
    { flag: 'returned', label: t('settings.notif.returned'), hint: t('settings.notif.returnedHint') },
    { flag: 'missingAddress', label: t('settings.notif.missingAddress'), hint: t('settings.notif.missingAddressHint') },
    { flag: 'invalidPostal', label: t('settings.notif.invalidPostal'), hint: t('settings.notif.invalidPostalHint') },
  ];
  return (
    <div className="col gap-16">
      <Card title={t('settings.tab.notifications')} sub={t('settings.notif.intro')}>
        <div className="list">
          {rows.map((r) => (
            <div key={r.flag} className="list-item" style={{ alignItems: 'center' }}>
              <Toggle checked={draft[r.flag]} onChange={(v) => set({ [r.flag]: v } as Partial<NotificationSettings>)} />
              <div className="grow" style={{ opacity: draft[r.flag] ? 1 : 0.6 }}>
                <b>{r.label}</b>
                <div className="muted small">{r.hint}</div>
              </div>
              {r.days && (
                <div className="row gap-4">
                  <span className="muted small nowrap">{r.daysLabel}</span>
                  <div style={{ width: 84 }}>
                    <NumberInput
                      className="input sm"
                      value={draft[r.days]}
                      min={0}
                      max={365}
                      onChange={(v) => set({ [r.days as DaysFlag]: Math.max(0, Math.min(365, Math.round(v ?? 0))) } as Partial<NotificationSettings>)}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <SaveBar dirty={dirty} onSave={save} onReset={reset} />
      </Card>
      <Card title={t('settings.notif.dismissedTitle')}>
        <div className="row">
          <span className="grow muted small">{t('settings.notif.dismissedCount', { count: dismissed ?? 0 })}</span>
          <button className="btn" disabled={!dismissed} onClick={() => run(() => restoreNotifications(), t('settings.notif.restored'))}>
            <RotateCcw /> {t('settings.notif.restore')}
          </button>
        </div>
      </Card>
    </div>
  );
}

// ───────────── Privacy & security ─────────────

function RetentionReview({ months }: { months: number }) {
  const { t } = useI18n();
  const fmt = useFmt();
  const run = useAction();
  const { confirm } = useFeedback();
  const { can } = useSession();
  const recipients = useLiveQuery(() => db.recipients.where('status').anyOf('active', 'paused', 'archived').toArray(), []);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const rows = useMemo(() => {
    if (!recipients) return [];
    const cutoff = addMonths(new Date(), -Math.max(1, months || 1)).toISOString();
    return recipients
      .map((r) => ({ r, last: [r.lastContactAt ?? '', r.updatedAt ?? ''].sort().pop() ?? '' }))
      .filter((x) => x.last < cutoff)
      .sort((a, b) => a.last.localeCompare(b.last));
  }, [recipients, months]);
  if (!recipients) return null;
  const selected = rows.filter((x) => sel.has(x.r.id)).map((x) => x.r);
  const canAnon = can('recipients.delete');

  const anonymize = async (list: Recipient[]) => {
    if (!list.length) return;
    const ok = await confirm({ title: t('recipient.bulkAnonTitle', { count: list.length }), body: t('recipient.anonBody'), danger: true, confirm: t('recipient.anonymize') });
    if (!ok) return;
    await run(async () => {
      for (const r of list) await anonymizeRecipient(r.id);
    }, t('recipient.anonymized'));
    setSel(new Set());
  };

  return (
    <Card
      title={t('settings.privacy.review')}
      sub={t('settings.privacy.reviewSub', { months, count: rows.length })}
      actions={
        canAnon && rows.length ? (
          <button className="btn danger" disabled={!selected.length} onClick={() => anonymize(selected)}>
            <UserX /> {t('settings.privacy.anonymizeSelected')}
            {selected.length ? ` (${selected.length})` : ''}
          </button>
        ) : undefined
      }
    >
      {!rows.length ? (
        <EmptyState icon={<ShieldCheck />} title={t('settings.privacy.reviewEmpty')} />
      ) : (
        <DataTable
          compact
          rows={rows}
          rowKey={(x) => x.r.id}
          selected={canAnon ? sel : undefined}
          onSelect={canAnon ? setSel : undefined}
          pageSize={15}
          columns={[
            {
              key: 'name',
              header: t('field.name'),
              sort: (x) => `${x.r.lastName} ${x.r.firstName}`,
              render: (x) => (
                <a href={`#/recipients/${x.r.id}`}>
                  {x.r.firstName} {x.r.lastName}
                </a>
              ),
            },
            { key: 'code', header: t('field.id'), sort: (x) => x.r.code, render: (x) => <span className="mono">#{x.r.code}</span> },
            { key: 'status', header: t('field.status'), sort: (x) => x.r.status, render: (x) => <StatusBadge group="recipient" value={x.r.status} /> },
            { key: 'city', header: t('field.city'), sort: (x) => x.r.city, render: (x) => x.r.city || '—' },
            { key: 'last', header: t('settings.privacy.lastActivity'), sort: (x) => x.last, render: (x) => fmt.date(x.last) || '—' },
          ]}
        />
      )}
    </Card>
  );
}

function PrivacyTab() {
  const { t } = useI18n();
  const fmt = useFmt();
  const { draft, set, dirty, save, reset } = useSection('privacy');
  const points = [
    t('settings.privacy.how.minimisation'),
    t('settings.privacy.how.passwords', { iterations: fmt.num(PBKDF2_ITERATIONS) }),
    t('settings.privacy.how.local'),
    t('settings.privacy.how.audit'),
    t('settings.privacy.how.anonymize'),
  ];
  return (
    <div className="grid grid-2">
      <Card title={t('settings.privacy.dataCollection')}>
        <div className="col gap-16">
          <div>
            <Toggle checked={draft.collectGender} onChange={(v) => set({ collectGender: v })} label={<b>{t('settings.privacy.collectGender')}</b>} />
            <div className="muted small mt-8">{t('settings.privacy.collectGenderHint')}</div>
          </div>
          <div>
            <Toggle checked={draft.storeFullDob} onChange={(v) => set({ storeFullDob: v })} label={<b>{t('settings.privacy.storeFullDob')}</b>} />
            <div className="muted small mt-8">{t('settings.privacy.storeFullDobHint')}</div>
          </div>
        </div>
      </Card>
      <Card title={t('settings.privacy.security')}>
        <div className="form-grid">
          <Field label={t('settings.privacy.autoLock')} hint={t('settings.privacy.autoLockHint')}>
            <NumberInput value={draft.autoLockMinutes} min={0} max={480} onChange={(v) => set({ autoLockMinutes: Math.max(0, Math.min(480, Math.round(v ?? 0))) })} />
          </Field>
          <Field label={t('settings.privacy.retention')} hint={t('settings.privacy.retentionHint')}>
            <NumberInput value={draft.retentionMonths} min={1} max={240} onChange={(v) => set({ retentionMonths: Math.max(1, Math.min(240, Math.round(v ?? 1))) })} />
          </Field>
        </div>
      </Card>
      <div className="span-all">
        <SaveBar dirty={dirty} onSave={save} onReset={reset} />
      </div>
      <Card title={t('settings.privacy.howTitle')} className="span-all">
        <div className="list">
          {points.map((p, i) => (
            <div key={i} className="list-item" style={{ alignItems: 'flex-start' }}>
              <ShieldCheck size={16} style={{ color: 'var(--success)', flex: 'none', marginTop: 2 }} />
              <span className="ink2">{p}</span>
            </div>
          ))}
        </div>
      </Card>
      <div className="span-all">
        <RetentionReview months={draft.retentionMonths} />
      </div>
    </div>
  );
}

// ───────────── Users ─────────────

function NewUserModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const run = useAction();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<RoleKey>('editor');
  const [pw, setPw] = useState(generatePassword);
  const [mustChange, setMustChange] = useState(true);
  const userErr = username && !/^[a-z0-9._-]{3,32}$/i.test(username.trim()) ? t('auth.usernameInvalid') : undefined;
  const problems = passwordProblems(pw);
  const pwErr = problems.length ? t(`auth.${problems[0]}`) : undefined;
  const valid = !!username.trim() && !userErr && !pwErr;
  const submit = async () => {
    const u = await run(() => createUser(username.trim(), displayName.trim() || username.trim(), role, pw, mustChange), t('settings.users.created'));
    if (u) onClose();
  };
  return (
    <Modal
      title={t('settings.users.new')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={!valid} onClick={submit}>
            <UserPlus /> {t('settings.users.create')}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={t('auth.username')} required error={userErr}>
          <input className="input" value={username} autoComplete="off" onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label={t('settings.displayName')}>
          <input className="input" value={displayName} maxLength={80} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label={t('settings.role')} hint={t('settings.users.roleHint')} className="full">
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as RoleKey)}>
            {ROLE_KEYS.map((r) => (
              <option key={r} value={r}>
                {t(`role.${r}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('settings.users.tempPassword')} required error={pwErr} hint={t('auth.pwRules')} className="full">
          <div className="row">
            <input className="input mono grow" value={pw} autoComplete="new-password" onChange={(e) => setPw(e.target.value)} />
            <button type="button" className="btn" onClick={() => setPw(generatePassword())}>
              <RotateCcw /> {t('settings.users.generate')}
            </button>
          </div>
        </Field>
        <div className="full">
          <Toggle checked={mustChange} onChange={setMustChange} label={t('settings.users.mustChange')} />
          <div className="muted small mt-8">{t('settings.users.mustChangeHint')}</div>
        </div>
      </div>
    </Modal>
  );
}

function UsersTab() {
  const { t } = useI18n();
  const fmt = useFmt();
  const run = useAction();
  const { confirm, prompt, toast } = useFeedback();
  const { user: me } = useSession();
  const users = useLiveQuery(() => db.users.orderBy('username').toArray(), []);
  const [creating, setCreating] = useState(false);
  const [weak, setWeak] = useState<string[]>([]);
  const demoUsers = (users ?? []).filter((u) => DEMO_USERS.includes(u.username));
  const demoKey = demoUsers.map((u) => `${u.id}:${u.passwordHash}`).join('|');
  useEffect(() => {
    let alive = true;
    Promise.all(demoUsers.map(async (u) => ((await verifyPassword(u, DEMO_PASSWORD)) ? u.username : ''))).then((r) => {
      if (alive) setWeak(r.filter(Boolean));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoKey]);
  if (!users) return null;

  const rename = async (u: User) => {
    const name = await prompt({ title: t('settings.users.rename'), label: t('settings.displayName'), initial: u.displayName });
    if (name === null || !name.trim() || name.trim() === u.displayName) return;
    await run(() => updateUser(u.id, { displayName: name.trim() }), t('common.saved'));
  };
  const resetPassword = async (u: User) => {
    const pw = await prompt({ title: t('settings.users.resetTitle', { name: u.displayName || u.username }), label: t('settings.users.newPassword'), initial: generatePassword() });
    if (pw === null) return;
    const problems = passwordProblems(pw);
    if (problems.length) return toast(t(`auth.${problems[0]}`), 'error');
    await run(() => setUserPassword(u.id, pw, true), t('settings.users.passwordReset'));
  };
  const remove = async (u: User) => {
    if (await confirm({ title: t('settings.users.deleteTitle', { name: u.username }), body: t('settings.users.deleteBody'), danger: true, confirm: t('common.delete') }))
      await run(() => deleteUser(u.id), t('common.deleted'));
  };

  return (
    <div className="col gap-16">
      {weak.length > 0 && <Note tone="warning">{t('settings.users.demoWarning', { names: weak.join(', '), password: DEMO_PASSWORD })}</Note>}
      <div className="toolbar">
        <span className="muted small grow">{t('settings.users.intro')}</span>
        <button className="btn primary" onClick={() => setCreating(true)}>
          <UserPlus /> {t('settings.users.new')}
        </button>
      </div>
      <DataTable
        rows={users}
        rowKey={(u) => u.id}
        initialSort={{ key: 'user', dir: 'asc' }}
        columns={[
          {
            key: 'user',
            header: t('auth.username'),
            sort: (u) => u.username,
            render: (u) => (
              <div className="row">
                <Avatar name={u.displayName || u.username} />
                <div className="grow">
                  <b>{u.displayName}</b>
                  <div className="muted small mono">@{u.username}</div>
                </div>
                {u.id === me?.id && <Badge tone="primary">{t('settings.users.you')}</Badge>}
                {u.mustChangePassword && <Badge tone="warning">{t('settings.users.mustChange')}</Badge>}
              </div>
            ),
          },
          {
            key: 'role',
            header: t('settings.role'),
            sort: (u) => ROLE_KEYS.indexOf(u.role),
            render: (u) => (
              <select
                className="select sm"
                value={u.role}
                disabled={u.id === me?.id}
                onChange={(e) => run(() => updateUser(u.id, { role: e.target.value as RoleKey }), t('common.saved'))}
              >
                {ROLE_KEYS.map((r) => (
                  <option key={r} value={r}>
                    {t(`role.${r}`)}
                  </option>
                ))}
              </select>
            ),
          },
          {
            key: 'active',
            header: t('settings.active'),
            sort: (u) => (u.active ? 1 : 0),
            render: (u) => <Toggle checked={u.active} disabled={u.id === me?.id} onChange={(v) => run(() => updateUser(u.id, { active: v }), t('common.saved'))} />,
          },
          {
            key: 'login',
            header: t('settings.lastLogin'),
            sort: (u) => u.lastLoginAt ?? '',
            render: (u) => (u.lastLoginAt ? fmt.dateTime(u.lastLoginAt) : <span className="muted">{t('settings.never')}</span>),
          },
          { key: 'created', header: t('common.created'), sort: (u) => u.createdAt, render: (u) => fmt.date(u.createdAt) },
          {
            key: 'actions',
            header: '',
            className: 'actions-cell',
            render: (u) => (
              <div className="row gap-4">
                <button className="btn icon sm ghost" title={t('settings.users.rename')} aria-label={t('settings.users.rename')} onClick={() => rename(u)}>
                  <Pencil />
                </button>
                <button
                  className="btn icon sm ghost"
                  title={t('settings.users.resetPassword')}
                  aria-label={t('settings.users.resetPassword')}
                  disabled={u.id === me?.id}
                  onClick={() => resetPassword(u)}
                >
                  <KeyRound />
                </button>
                <button className="btn icon sm ghost danger" title={t('common.delete')} aria-label={t('common.delete')} disabled={u.id === me?.id} onClick={() => remove(u)}>
                  <Trash2 />
                </button>
              </div>
            ),
          },
        ]}
      />
      <p className="muted small">{t('settings.users.selfHint')}</p>
      {creating && <NewUserModal onClose={() => setCreating(false)} />}
    </div>
  );
}

// ───────────── Roles ─────────────

function RolesTab() {
  const { t } = useI18n();
  const run = useAction();
  const { confirm } = useFeedback();
  const { user: me } = useSession();
  const settings = useSettings();
  const users = useLiveQuery(() => db.users.toArray(), []);
  const roles = settings.roles;
  const perms = (r: RoleKey): Permission[] => (r === 'admin' ? [...PERMISSIONS] : (roles?.[r] ?? DEFAULT_ROLE_PERMISSIONS[r]));
  const has = (r: RoleKey, p: Permission) => perms(r).includes(p);
  const isDefault = ROLE_KEYS.every((r) => r === 'admin' || sameValue([...perms(r)].sort(), [...DEFAULT_ROLE_PERMISSIONS[r]].sort()));
  const userCount = countBy(users ?? [], (u) => u.role);

  const toggle = (r: RoleKey, p: Permission, on: boolean) =>
    run(async () => {
      const s = await getSettings();
      const cur = new Set(s.roles?.[r] ?? DEFAULT_ROLE_PERMISSIONS[r]);
      if (on) cur.add(p);
      else cur.delete(p);
      await updateSettings({ roles: { ...s.roles, [r]: PERMISSIONS.filter((x) => cur.has(x)) } }, 'roles');
    });
  const resetAll = async () => {
    if (await confirm({ title: t('settings.roles.resetTitle'), body: t('settings.roles.resetBody'), confirm: t('settings.roles.reset') }))
      await run(() => updateSettings({ roles: clone(DEFAULT_ROLE_PERMISSIONS) }, 'roles'), t('common.saved'));
  };

  return (
    <div className="col gap-16">
      <div className="toolbar">
        <span className="muted small grow">{t('settings.roles.intro')}</span>
        <button className="btn" disabled={isDefault} onClick={resetAll}>
          <RotateCcw /> {t('settings.roles.reset')}
        </button>
      </div>
      <div className="table-wrap">
        <table className="table compact">
          <thead>
            <tr>
              <th>{t('settings.roles.permission')}</th>
              {ROLE_KEYS.map((r) => (
                <th key={r} className="center" style={{ width: 120 }}>
                  <div>{t(`role.${r}`)}</div>
                  <div className="muted tiny row gap-4" style={{ justifyContent: 'center', textTransform: 'none', letterSpacing: 0 }}>
                    <Users size={11} /> {userCount[r] ?? 0}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((p) => (
              <tr key={p}>
                <td>
                  <div>{t(`perm.${p}`)}</div>
                  <div className="muted tiny mono">{p}</div>
                </td>
                {ROLE_KEYS.map((r) => {
                  const selfLock = !!me && me.role !== 'admin' && me.role === r && p === 'users.manage';
                  return (
                    <td key={r} className="center">
                      <label className="check" style={{ justifyContent: 'center' }}>
                        <input
                          type="checkbox"
                          checked={has(r, p)}
                          disabled={r === 'admin' || selfLock}
                          aria-label={`${t(`role.${r}`)} · ${t(`perm.${p}`)}`}
                          onChange={(e) => toggle(r, p, e.target.checked)}
                        />
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">{t('settings.roles.adminHint')}</p>
    </div>
  );
}

// ───────────── Tags ─────────────

function TagModal({ tag, existing, onClose }: { tag?: Tag; existing: Tag[]; onClose: () => void }) {
  const { t } = useI18n();
  const run = useAction();
  const [name, setName] = useState(tag?.name ?? '');
  const [color, setColor] = useState(tag?.color ?? TAG_COLORS[existing.length % TAG_COLORS.length]);
  const taken = !!name.trim() && existing.some((x) => x.id !== tag?.id && normalizeText(x.name) === normalizeText(name));
  const colorOk = /^#[0-9a-f]{6}$/i.test(color);
  const valid = !!name.trim() && !taken && colorOk;
  const submit = async () => {
    const saved = await run(() => saveTag({ id: tag?.id, name: name.trim(), color }), t('common.saved'));
    if (saved) onClose();
  };
  return (
    <Modal
      title={tag ? t('settings.tags.edit') : t('settings.tags.new')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={!valid} onClick={submit}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="col gap-16">
        <Field label={t('field.name')} required error={taken ? t('settings.tags.nameTaken') : undefined}>
          <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && valid && submit()} />
        </Field>
        <Field label={t('editor.color')} error={!colorOk ? t('settings.tags.colorInvalid') : undefined}>
          <ColorInput value={color} onChange={setColor} />
        </Field>
        <div className="row wrap gap-4">
          {TAG_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="swatch"
              aria-label={c}
              title={c}
              onClick={() => setColor(c)}
              style={{ background: c, width: 24, height: 24, cursor: 'pointer', outline: c.toLowerCase() === color.toLowerCase() ? '2px solid var(--primary)' : undefined, outlineOffset: 2 }}
            />
          ))}
        </div>
        <div className="row">
          <span className="muted small">{t('common.preview')}:</span>
          <TagPill name={name.trim() || '…'} color={colorOk ? color : '#999999'} />
        </div>
      </div>
    </Modal>
  );
}

function TagsTab() {
  const { t } = useI18n();
  const run = useAction();
  const { confirm } = useFeedback();
  const data = useLiveQuery(async () => {
    const tags = await db.tags.orderBy('name').toArray();
    const counts = await Promise.all(tags.map((tg) => db.recipients.where('tagIds').equals(tg.id).count()));
    return tags.map((tag, i) => ({ tag, count: counts[i] }));
  }, []);
  const [editing, setEditing] = useState<Tag | null | undefined>(undefined);
  if (!data) return null;
  const remove = async (tag: Tag, count: number) => {
    if (await confirm({ title: t('settings.tags.deleteTitle', { name: tag.name }), body: t('settings.tags.deleteBody', { count }), danger: true, confirm: t('common.delete') }))
      await run(() => deleteTag(tag.id), t('common.deleted'));
  };
  return (
    <div className="col gap-16">
      <div className="toolbar">
        <span className="muted small grow">{t('settings.tags.intro')}</span>
        <button className="btn primary" onClick={() => setEditing(null)}>
          <Plus /> {t('settings.tags.new')}
        </button>
      </div>
      <DataTable
        rows={data}
        rowKey={(x) => x.tag.id}
        onRowClick={(x) => setEditing(x.tag)}
        initialSort={{ key: 'name', dir: 'asc' }}
        columns={[
          { key: 'name', header: t('field.name'), sort: (x) => x.tag.name.toLowerCase(), render: (x) => <TagPill name={x.tag.name} color={x.tag.color} /> },
          {
            key: 'color',
            header: t('editor.color'),
            render: (x) => (
              <span className="row gap-4">
                <span className="swatch" style={{ background: x.tag.color }} />
                <span className="mono muted">{x.tag.color}</span>
              </span>
            ),
          },
          {
            key: 'count',
            header: t('nav.recipients'),
            sort: (x) => x.count,
            className: 'num right',
            render: (x) =>
              x.count ? (
                <a href={`#/recipients?tag=${x.tag.id}`} onClick={(e) => e.stopPropagation()}>
                  {x.count}
                </a>
              ) : (
                <span className="muted">0</span>
              ),
          },
          {
            key: 'actions',
            header: '',
            className: 'actions-cell',
            render: (x) => (
              <div className="row gap-4" onClick={(e) => e.stopPropagation()}>
                <button className="btn icon sm ghost" title={t('common.edit')} aria-label={t('common.edit')} onClick={() => setEditing(x.tag)}>
                  <Pencil />
                </button>
                <button className="btn icon sm ghost danger" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => remove(x.tag, x.count)}>
                  <Trash2 />
                </button>
              </div>
            ),
          },
        ]}
        empty={<EmptyState icon={<Tags />} title={t('settings.tags.empty')} />}
      />
      {editing !== undefined && <TagModal tag={editing ?? undefined} existing={data.map((x) => x.tag)} onClose={() => setEditing(undefined)} />}
    </div>
  );
}

// ───────────── Products ─────────────

function ProductDrawer({ product, products, templates, onClose }: { product?: Product; products: Product[]; templates: Template[]; onClose: () => void }) {
  const { t } = useI18n();
  const fmt = useFmt();
  const run = useAction();
  const { confirm } = useFeedback();
  const ctx = useSampleCtx('settings-prod');
  const [p, setP] = useState<Product>(() =>
    product
      ? { ...clone(product), documentTemplateIds: product.documentTemplateIds ?? [] }
      : { id: uid(), sku: '', name: '', description: '', category: 'package', price: 0, documentTemplateIds: [], active: true, createdAt: nowISO() },
  );
  const set = (patch: Partial<Product>) => setP((x) => ({ ...x, ...patch }));
  const skuTaken = !!p.sku.trim() && products.some((x) => x.id !== p.id && x.sku.trim().toLowerCase() === p.sku.trim().toLowerCase());
  const valid = !!p.name.trim() && p.price >= 0 && !skuTaken;
  const letters = templates.filter((x) => x.kind === 'letter' && (!x.archived || x.id === p.templateId));
  const docs = templates.filter((x) => x.kind === 'document' && (!x.archived || x.id === p.templateId));

  const save = async () => {
    const saved = await run(() => saveRecord('products', { ...p, sku: p.sku.trim(), name: p.name.trim(), description: p.description.trim() }), t('common.saved'));
    if (saved) onClose();
  };
  const remove = async () => {
    if (!product) return;
    const orders = await db.orders.toArray();
    const count = orders.reduce((n, o) => n + o.items.filter((i) => i.productId === product.id).length, 0);
    if (!(await confirm({ title: t('settings.products.deleteTitle', { name: product.name }), body: t('settings.products.deleteBody', { count }), danger: true, confirm: t('common.delete') })))
      return;
    const ok = await run(async () => {
      await deleteRecord('products', product.id);
      return true;
    }, t('common.deleted'));
    if (ok) onClose();
  };

  return (
    <Drawer
      wide
      title={product ? product.name : t('settings.products.new')}
      sub={product?.sku}
      onClose={onClose}
      footer={
        <>
          {product && (
            <button className="btn danger" onClick={remove}>
              <Trash2 /> {t('common.delete')}
            </button>
          )}
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={!valid} onClick={save}>
            <Save /> {t('common.save')}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={t('settings.products.sku')} error={skuTaken ? t('settings.products.skuTaken') : undefined}>
          <input className="input mono" value={p.sku} maxLength={40} onChange={(e) => set({ sku: e.target.value })} />
        </Field>
        <Field label={t('settings.products.category')}>
          <select className="select" value={p.category} onChange={(e) => set({ category: e.target.value as ProductCategory })}>
            {PRODUCT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`prodcat.${c}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('field.name')} required className="full">
          <input className="input" value={p.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} autoFocus={!product} />
        </Field>
        <Field label={t('settings.products.description')} className="full">
          <textarea className="textarea" rows={3} value={p.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <Field label={`${t('settings.products.price')} (${fmt.currency})`}>
          <NumberInput value={p.price} min={0} step={0.01} onChange={(v) => set({ price: Math.max(0, v ?? 0) })} />
        </Field>
        <div className="field" style={{ justifyContent: 'flex-end' }}>
          <Toggle checked={p.active} onChange={(v) => set({ active: v })} label={t('settings.products.active')} />
        </div>
        <Field label={t('settings.products.template')} hint={t('settings.products.templateHint')} className="full">
          <select className="select" value={p.templateId ?? ''} onChange={(e) => set({ templateId: e.target.value || undefined })}>
            <option value="">— {t('common.none')}</option>
            {letters.length > 0 && (
              <optgroup label={t('template.letters')}>
                {letters.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </optgroup>
            )}
            {docs.length > 0 && (
              <optgroup label={t('template.documents')}>
                {docs.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>
      </div>
      <h4 className="mt-24 mb-8">
        {t('settings.products.documents')} {p.documentTemplateIds.length > 0 && <Badge tone="accent">{p.documentTemplateIds.length}</Badge>}
      </h4>
      <p className="muted small mb-8">{t('settings.products.documentsHint')}</p>
      <MultiTemplatePicker value={p.documentTemplateIds} onChange={(ids) => set({ documentTemplateIds: ids })} ctx={ctx} />
    </Drawer>
  );
}

function ProductsTab() {
  const { t } = useI18n();
  const fmt = useFmt();
  const data = useLiveQuery(async () => ({ products: await db.products.toArray(), templates: await db.templates.toArray() }), []);
  const [editing, setEditing] = useState<Product | null | undefined>(undefined);
  if (!data) return null;
  const tplName = new Map(data.templates.map((x) => [x.id, x.name]));
  return (
    <div className="col gap-16">
      <div className="toolbar">
        <span className="muted small grow">{t('settings.products.intro')}</span>
        <ExportMenu
          name={t('settings.tab.products')}
          formats={['csv', 'xlsx', 'json']}
          build={() => ({
            head: [t('settings.products.sku'), t('field.name'), t('settings.products.category'), t('settings.products.price'), t('settings.products.template'), t('settings.active')],
            rows: data.products.map((p) => [p.sku, p.name, t(`prodcat.${p.category}`), p.price, p.templateId ? (tplName.get(p.templateId) ?? '') : '', p.active ? '✓' : '']),
          })}
        />
        <button className="btn primary" onClick={() => setEditing(null)}>
          <Plus /> {t('settings.products.new')}
        </button>
      </div>
      <DataTable
        rows={data.products}
        rowKey={(p) => p.id}
        onRowClick={(p) => setEditing(p)}
        initialSort={{ key: 'name', dir: 'asc' }}
        columns={[
          { key: 'sku', header: t('settings.products.sku'), sort: (p) => p.sku, render: (p) => <span className="mono">{p.sku || '—'}</span> },
          {
            key: 'name',
            header: t('field.name'),
            sort: (p) => p.name.toLowerCase(),
            render: (p) => (
              <div style={{ maxWidth: 360 }}>
                <b>{p.name}</b>
                {p.description && <div className="muted small truncate">{p.description}</div>}
              </div>
            ),
          },
          { key: 'cat', header: t('settings.products.category'), sort: (p) => p.category, render: (p) => <Badge>{t(`prodcat.${p.category}`)}</Badge> },
          { key: 'price', header: t('settings.products.price'), sort: (p) => p.price, className: 'num right', render: (p) => fmt.money(p.price) },
          {
            key: 'tpl',
            header: t('settings.products.template'),
            sort: (p) => (p.templateId ? (tplName.get(p.templateId) ?? '') : ''),
            render: (p) => (
              <span>
                {p.templateId ? (tplName.get(p.templateId) ?? '—') : '—'}
                {p.documentTemplateIds?.length ? <span className="muted small"> +{p.documentTemplateIds.length}</span> : null}
              </span>
            ),
          },
          {
            key: 'active',
            header: t('settings.active'),
            sort: (p) => (p.active ? 1 : 0),
            render: (p) => (p.active ? <Badge tone="success">{t('settings.active')}</Badge> : <Badge>{t('settings.inactive')}</Badge>),
          },
        ]}
        empty={<EmptyState icon={<Package />} title={t('settings.products.empty')} />}
      />
      {editing !== undefined && <ProductDrawer product={editing ?? undefined} products={data.products} templates={data.templates} onClose={() => setEditing(undefined)} />}
    </div>
  );
}

// ───────────── Carriers ─────────────

interface CarrierRow extends Carrier {
  servicesText: string;
}

const toRows = (cs: Carrier[]): CarrierRow[] => cs.map((c) => ({ ...c, services: [...c.services], servicesText: c.services.join(', ') }));
const fromRows = (rows: CarrierRow[]): Carrier[] =>
  rows.map((r) => ({
    id: r.id,
    name: r.name.trim(),
    trackingUrl: r.trackingUrl.trim(),
    services: r.servicesText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    active: r.active,
  }));
const carrierSig = (cs: Carrier[]) => JSON.stringify(cs.map((c) => [c.id, c.name, c.trackingUrl, c.services, c.active]));

function CarriersTab() {
  const { t } = useI18n();
  const run = useAction();
  const { confirm } = useFeedback();
  const settings = useSettings();
  const usage = useLiveQuery(async () => countBy(await db.shipments.toArray(), (s) => s.carrierId), []);
  const [draft, setDraft] = useState<CarrierRow[] | null>(null);
  const rows = draft ?? toRows(settings.carriers);
  const dirty = draft !== null && carrierSig(fromRows(draft)) !== carrierSig(settings.carriers);
  useEffect(() => {
    if (draft && carrierSig(fromRows(draft)) === carrierSig(settings.carriers)) setDraft(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.carriers]);
  const invalid = rows.some((r) => !r.name.trim());

  const update = (id: string, patch: Partial<CarrierRow>) => setDraft(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const add = () => setDraft([...rows, { id: uid(), name: t('settings.carriers.newName'), trackingUrl: '', services: [], servicesText: '', active: true }]);
  const remove = async (r: CarrierRow) => {
    const count = usage?.[r.id] ?? 0;
    if (count && !(await confirm({ title: t('settings.carriers.removeTitle', { name: r.name }), body: t('settings.carriers.removeBody', { count }), danger: true, confirm: t('settings.carriers.remove') })))
      return;
    setDraft(rows.filter((x) => x.id !== r.id));
  };
  const save = () =>
    run(async () => {
      const carriers = fromRows(rows);
      const s = await getSettings();
      const patch: Partial<AppSettings> = { carriers };
      if (!carriers.some((c) => c.id === s.mail.defaultCarrierId)) patch.mail = { ...s.mail, defaultCarrierId: carriers.find((c) => c.active)?.id ?? carriers[0]?.id ?? '' };
      await updateSettings(patch, 'carriers');
    }, t('common.saved'));

  return (
    <div className="col gap-16">
      <Note>{t('settings.carriers.intro')}</Note>
      {rows.map((r) => {
        const testUrl = /^https?:\/\//i.test(r.trackingUrl.trim()) && r.trackingUrl.includes('{tracking}') ? r.trackingUrl.trim().replace(/\{tracking\}/g, 'TEST123456789') : '';
        return (
          <div key={r.id} className="card pad" style={{ opacity: r.active ? 1 : 0.75 }}>
            <div className="row wrap mb-16">
              <Truck size={16} style={{ color: 'var(--accent)' }} />
              <b className="grow">{r.name.trim() || '—'}</b>
              {settings.mail.defaultCarrierId === r.id && <Badge tone="primary">{t('settings.carriers.isDefault')}</Badge>}
              <span className="muted small">
                {t('nav.shipments')}: {usage?.[r.id] ?? 0}
              </span>
              <Toggle checked={r.active} onChange={(v) => update(r.id, { active: v })} label={t('settings.active')} />
              <button className="btn icon sm ghost danger" title={t('settings.carriers.remove')} aria-label={t('settings.carriers.remove')} onClick={() => remove(r)}>
                <Trash2 />
              </button>
            </div>
            <div className="form-grid">
              <Field label={t('settings.carriers.name')} required error={!r.name.trim() ? t('settings.required') : undefined}>
                <input className="input" value={r.name} maxLength={80} onChange={(e) => update(r.id, { name: e.target.value })} />
              </Field>
              <Field label={t('settings.carriers.services')} hint={t('settings.carriers.servicesHint')}>
                <input className="input" value={r.servicesText} placeholder="Standard, Express" onChange={(e) => update(r.id, { servicesText: e.target.value })} />
              </Field>
              <Field
                label={t('settings.carriers.trackingUrl')}
                className="full"
                hint={t('settings.carriers.trackingHint', { token: '{tracking}' })}
                warning={r.trackingUrl.trim() && !r.trackingUrl.includes('{tracking}') ? t('settings.carriers.urlNoToken', { token: '{tracking}' }) : undefined}
              >
                <div className="row">
                  <input
                    className="input mono grow"
                    value={r.trackingUrl}
                    placeholder="https://example.com/track?id={tracking}"
                    onChange={(e) => update(r.id, { trackingUrl: e.target.value })}
                  />
                  {testUrl && (
                    <a className="btn" href={testUrl} target="_blank" rel="noreferrer" title={testUrl}>
                      <ExternalLink /> {t('settings.carriers.test')}
                    </a>
                  )}
                </div>
              </Field>
            </div>
          </div>
        );
      })}
      {!rows.length && <EmptyState icon={<Truck />} title={t('settings.carriers.empty')} />}
      <div>
        <button className="btn" onClick={add}>
          <Plus /> {t('settings.carriers.add')}
        </button>
      </div>
      <SaveBar dirty={dirty} blocked={invalid} onSave={save} onReset={() => setDraft(null)} />
    </div>
  );
}

// ───────────── Backup & data ─────────────

type BackupPayload = Awaited<ReturnType<typeof parseBackup>>;

function DataTab() {
  const { t } = useI18n();
  const fmt = useFmt();
  const run = useAction();
  const { confirm, toast } = useFeedback();
  const { can, refresh, logout } = useSession();
  const settings = useSettings();
  const counts = useLiveQuery(async () => {
    const [recipients, customers, orders, projects, documents, shipments, templates, inventory, files, users, activity] = await Promise.all([
      db.recipients.count(),
      db.customers.count(),
      db.orders.count(),
      db.projects.count(),
      db.documents.count(),
      db.shipments.count(),
      db.templates.count(),
      db.inventory.count(),
      db.files.count(),
      db.users.count(),
      db.activity.count(),
    ]);
    return { recipients, customers, orders, projects, documents, shipments, templates, inventory, files, users, activity };
  }, []);
  const [storage, setStorage] = useState<{ usage?: number; quota?: number; persisted?: boolean } | null>(null);
  const [remind, setRemind] = useState<number | undefined>(settings.backup.remindDays);
  const [encrypt, setEncrypt] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [withActivity, setWithActivity] = useState(true);
  const [file, setFile] = useState<{ name: string; text: string; encrypted: boolean } | null>(null);
  const [payload, setPayload] = useState<BackupPayload | null>(null);
  const [restorePw, setRestorePw] = useState('');
  const [restoreErr, setRestoreErr] = useState('');
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [busy, setBusy] = useState(false);

  const loadStorage = useCallback(async () => {
    const out: { usage?: number; quota?: number; persisted?: boolean } = {};
    try {
      const est = await navigator.storage?.estimate?.();
      out.usage = est?.usage;
      out.quota = est?.quota;
    } catch {
      /* not supported */
    }
    try {
      out.persisted = await navigator.storage?.persisted?.();
    } catch {
      /* not supported */
    }
    setStorage(out);
  }, []);
  useEffect(() => {
    loadStorage();
  }, [loadStorage, counts]);
  useEffect(() => setRemind(settings.backup.remindDays), [settings.backup.remindDays]);

  const last = settings.backup.lastBackupAt;
  const age = last ? diffDays(new Date(), new Date(last)) : undefined;
  const due = age === undefined || age >= settings.backup.remindDays;
  const exportPwErr = encrypt && pw && pw.length < 8 ? t('auth.pw_short') : encrypt && pw2 && pw !== pw2 ? t('auth.pwMismatch') : undefined;
  const canExport = !encrypt || (pw.length >= 8 && pw === pw2);

  const requestPersist = async () => {
    try {
      const ok = await navigator.storage?.persist?.();
      toast(ok ? t('settings.data.persistedYes') : t('settings.data.persistDenied'), ok ? 'success' : 'warning');
    } catch {
      toast(t('settings.data.persistDenied'), 'warning');
    }
    loadStorage();
  };
  const doExport = async () => {
    setBusy(true);
    await run(async () => {
      const blob = await exportDatabase({ password: encrypt ? pw : undefined, includeActivity: withActivity });
      downloadBlob(blob, `hmms-backup-${todayISO()}.json`);
    }, t('settings.data.exported'));
    setBusy(false);
  };
  const errText = (e: unknown) => (e instanceof BackupError ? t(`backup.err.${e.message}`) : `${t('err.generic')}: ${(e as Error).message}`);
  const pick = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setPayload(null);
    setRestoreErr('');
    setRestorePw('');
    try {
      const text = await readFileAsText(f);
      const encrypted = isEncryptedBackup(text);
      setFile({ name: f.name, text, encrypted });
      if (!encrypted) setPayload(await parseBackup(text));
    } catch (e) {
      setRestoreErr(errText(e));
    }
  };
  const decrypt = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setRestoreErr('');
    try {
      setPayload(await parseBackup(file.text, restorePw));
    } catch (err) {
      setRestoreErr(errText(err));
    } finally {
      setBusy(false);
    }
  };
  const doRestore = async () => {
    if (!payload) return;
    const ok = await confirm({
      title: t('settings.data.restoreConfirmTitle'),
      body: mode === 'replace' ? t('settings.data.restoreConfirmReplace') : t('settings.data.restoreConfirmMerge'),
      danger: mode === 'replace',
      confirm: t('settings.data.restoreBtn'),
      typeToConfirm: mode === 'replace' ? 'RESTORE' : undefined,
    });
    if (!ok) return;
    setBusy(true);
    const done = await run(async () => {
      await restoreDatabase(payload, mode);
      await refresh();
      return true;
    }, t('settings.data.restored'));
    setBusy(false);
    if (done) {
      setFile(null);
      setPayload(null);
    }
  };
  const resetDemo = async () => {
    if (!(await confirm({ title: t('settings.data.resetDemo'), body: t('settings.data.resetDemoBody'), danger: true, confirm: t('settings.data.resetDemo'), typeToConfirm: 'DEMO' }))) return;
    setBusy(true);
    await run(async () => {
      const savedUsers = await db.users.toArray();
      await db.transaction('rw', db.tables, async () => {
        await loadDemoWorkspace();
        await db.users.bulkPut(savedUsers);
      });
      await refresh();
    }, t('settings.data.demoLoaded'));
    setBusy(false);
  };
  const deleteAll = async () => {
    if (!(await confirm({ title: t('settings.data.deleteAll'), body: t('settings.data.deleteAllBody'), danger: true, confirm: t('settings.data.deleteAll'), typeToConfirm: 'DELETE' }))) return;
    await run(async () => {
      await logout();
      await clearAllData();
      await refresh();
    }, t('settings.data.deleted'));
  };

  const summary = payload ? backupSummary(payload).filter((x) => x.count > 0) : [];
  const pct = storage?.usage !== undefined && storage.quota ? (storage.usage / storage.quota) * 100 : undefined;

  return (
    <div className="col gap-16">
      <div className="grid grid-4">
        <Stat label={t('nav.recipients')} value={fmt.num(counts?.recipients ?? 0)} href="#/recipients" />
        <Stat label={t('nav.orders')} value={fmt.num(counts?.orders ?? 0)} href="#/orders" />
        <Stat label={t('nav.projects')} value={fmt.num(counts?.projects ?? 0)} href="#/projects" />
        <Stat label={t('nav.shipments')} value={fmt.num(counts?.shipments ?? 0)} href="#/shipments" />
      </div>
      <div className="grid grid-2">
        <Card title={t('settings.data.storage')} actions={<HardDrive size={18} style={{ color: 'var(--accent)' }} />}>
          <dl className="kv mb-16">
            <dt>{t('settings.data.used')}</dt>
            <dd className="num">{storage?.usage !== undefined ? formatBytes(storage.usage) : t('settings.data.unknown')}</dd>
            <dt>{t('settings.data.quota')}</dt>
            <dd className="num">{storage?.quota ? formatBytes(storage.quota) : t('settings.data.unknown')}</dd>
            <dt>{t('settings.data.persisted')}</dt>
            <dd>
              {storage?.persisted === undefined ? (
                t('settings.data.unknown')
              ) : storage.persisted ? (
                <Badge tone="success">{t('settings.data.persistedYes')}</Badge>
              ) : (
                <span className="col gap-4" style={{ alignItems: 'flex-start' }}>
                  <span className="muted small">{t('settings.data.persistedNo')}</span>
                  <button className="btn sm" onClick={requestPersist}>
                    <ShieldCheck /> {t('settings.data.requestPersist')}
                  </button>
                </span>
              )}
            </dd>
          </dl>
          {pct !== undefined && <Progress value={Math.max(1, pct)} />}
          <h4 className="mt-16 mb-8">{t('settings.data.records')}</h4>
          {counts && (
            <dl className="kv">
              <dt>{t('nav.customers')}</dt>
              <dd className="num">{fmt.num(counts.customers)}</dd>
              <dt>{t('settings.data.documents')}</dt>
              <dd className="num">{fmt.num(counts.documents)}</dd>
              <dt>{t('nav.templates')}</dt>
              <dd className="num">{fmt.num(counts.templates)}</dd>
              <dt>{t('nav.inventory')}</dt>
              <dd className="num">{fmt.num(counts.inventory)}</dd>
              <dt>{t('settings.data.files')}</dt>
              <dd className="num">{fmt.num(counts.files)}</dd>
              <dt>{t('settings.tab.users')}</dt>
              <dd className="num">{fmt.num(counts.users)}</dd>
              <dt>{t('nav.activity')}</dt>
              <dd className="num">{fmt.num(counts.activity)}</dd>
            </dl>
          )}
        </Card>
        <Card title={t('settings.data.backup')}>
          <dl className="kv mb-16">
            <dt>{t('settings.data.lastBackup')}</dt>
            <dd>{last ? fmt.dateTime(last) : t('settings.never')}</dd>
          </dl>
          {due && (
            <div className="mb-16">
              <Note tone="warning">{t('settings.data.backupDue', { days: settings.backup.remindDays })}</Note>
            </div>
          )}
          <Field label={t('settings.data.remindDays')}>
            <div className="row">
              <div style={{ width: 110 }}>
                <NumberInput value={remind} min={1} max={365} onChange={setRemind} />
              </div>
              <button
                className="btn"
                disabled={!remind || remind < 1 || remind === settings.backup.remindDays}
                onClick={() =>
                  run(async () => {
                    const s = await getSettings();
                    await updateSettings({ backup: { ...s.backup, remindDays: Math.round(remind ?? 7) } }, 'backup');
                  }, t('common.saved'))
                }
              >
                <Save /> {t('common.save')}
              </button>
            </div>
          </Field>
          <div className="mt-16">
            <Note>{t('settings.data.tablesHint')}</Note>
          </div>
        </Card>
        {can('data.export') && (
          <Card title={t('settings.data.exportTitle')} sub={t('settings.data.exportHint')}>
            <div className="col gap-12">
              <Toggle checked={withActivity} onChange={setWithActivity} label={t('settings.data.includeActivity')} />
              <div>
                <Toggle checked={encrypt} onChange={setEncrypt} label={t('settings.data.encrypt')} />
                <div className="muted small mt-8">{t('settings.data.encryptHint')}</div>
              </div>
              {encrypt && (
                <div className="form-grid">
                  <Field label={t('auth.password')} error={exportPwErr}>
                    <input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
                  </Field>
                  <Field label={t('auth.passwordRepeat')}>
                    <input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
                  </Field>
                </div>
              )}
              <div className="row">
                <span className="grow" />
                <button className="btn primary" disabled={busy || !canExport} onClick={doExport}>
                  <Download /> {busy ? t('common.saving') : t('settings.data.exportBtn')}
                </button>
              </div>
            </div>
          </Card>
        )}
        {can('data.import') && (
          <Card title={t('settings.data.restoreTitle')} sub={t('settings.data.restoreHint')}>
            <div className="col gap-12">
              <Dropzone accept=".json,application/json" onFiles={pick} label={file ? file.name : t('settings.data.chooseFile')} />
              {file?.encrypted && !payload && (
                <form className="col gap-8" onSubmit={decrypt}>
                  <Note>{t('settings.data.encrypted')}</Note>
                  <div className="row">
                    <input
                      className="input grow"
                      type="password"
                      autoComplete="off"
                      value={restorePw}
                      placeholder={t('auth.password')}
                      onChange={(e) => setRestorePw(e.target.value)}
                    />
                    <button className="btn primary" type="submit" disabled={busy || !restorePw}>
                      <KeyRound /> {t('settings.data.unlock')}
                    </button>
                  </div>
                </form>
              )}
              {restoreErr && <div className="issue error">{restoreErr}</div>}
              {payload && (
                <>
                  <div className="row">
                    <FileJson size={16} style={{ color: 'var(--accent)' }} />
                    <b className="grow">{t('settings.data.backupFrom', { date: fmt.dateTime(payload.exportedAt) || payload.exportedAt })}</b>
                  </div>
                  <div className="table-wrap" style={{ maxHeight: 220, overflowY: 'auto' }}>
                    <table className="table compact">
                      <thead>
                        <tr>
                          <th>{t('settings.data.table')}</th>
                          <th className="right">{t('settings.data.count')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.map((x) => (
                          <tr key={x.table}>
                            <td className="mono">{x.table}</td>
                            <td className="num right">{fmt.num(x.count)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Field label={t('settings.data.mode')}>
                    <div className="col gap-4">
                      {(['merge', 'replace'] as const).map((m) => (
                        <label key={m} className="check">
                          <input type="radio" name="restore-mode" checked={mode === m} onChange={() => setMode(m)} />
                          {m === 'merge' ? t('settings.data.modeMerge') : t('settings.data.modeReplace')}
                        </label>
                      ))}
                    </div>
                  </Field>
                  <div className="row">
                    <button
                      className="btn"
                      onClick={() => {
                        setFile(null);
                        setPayload(null);
                      }}
                    >
                      {t('common.cancel')}
                    </button>
                    <span className="grow" />
                    <button className={`btn ${mode === 'replace' ? 'danger solid' : 'primary'}`} disabled={busy} onClick={doRestore}>
                      <Upload /> {t('settings.data.restoreBtn')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </Card>
        )}
      </div>
      <Card title={t('settings.data.danger')}>
        <div className="list">
          <div className="list-item">
            <div className="grow">
              <b>{t('settings.data.resetDemo')}</b>
              <div className="muted small">{t('settings.data.resetDemoHint')}</div>
            </div>
            <button className="btn danger" disabled={busy} onClick={resetDemo}>
              <RotateCcw /> {t('settings.data.resetDemo')}
            </button>
          </div>
          <div className="list-item">
            <div className="grow">
              <b>{t('settings.data.deleteAll')}</b>
              <div className="muted small">{t('settings.data.deleteAllHint')}</div>
            </div>
            <button className="btn danger solid" disabled={busy} onClick={deleteAll}>
              <Trash2 /> {t('settings.data.deleteAll')}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ───────────── Page ─────────────

export function Settings() {
  const { t } = useI18n();
  const { can } = useSession();
  const route = useRoute();
  const all: (TabDef & { perm?: Permission })[] = [
    { key: 'account', label: t('settings.tab.account'), icon: <UserIcon /> },
    { key: 'company', label: t('settings.tab.company'), icon: <Building2 />, perm: 'settings.edit' },
    { key: 'mail', label: t('settings.tab.mail'), icon: <Mail />, perm: 'settings.edit' },
    { key: 'print', label: t('settings.tab.print'), icon: <Printer />, perm: 'settings.edit' },
    { key: 'regional', label: t('settings.tab.regional'), icon: <Globe />, perm: 'settings.edit' },
    { key: 'defaults', label: t('settings.tab.defaults'), icon: <SlidersHorizontal />, perm: 'settings.edit' },
    { key: 'notifications', label: t('settings.tab.notifications'), icon: <Bell />, perm: 'settings.edit' },
    { key: 'privacy', label: t('settings.tab.privacy'), icon: <ShieldCheck />, perm: 'settings.edit' },
    { key: 'users', label: t('settings.tab.users'), icon: <Users />, perm: 'users.manage' },
    { key: 'roles', label: t('settings.tab.roles'), icon: <KeyRound />, perm: 'users.manage' },
    { key: 'tags', label: t('settings.tab.tags'), icon: <Tags />, perm: 'settings.edit' },
    { key: 'products', label: t('settings.tab.products'), icon: <Package />, perm: 'settings.edit' },
    { key: 'carriers', label: t('settings.tab.carriers'), icon: <Truck />, perm: 'settings.edit' },
    { key: 'data', label: t('settings.tab.data'), icon: <Database />, perm: 'settings.edit' },
  ];
  const tabs = all.filter((x) => !x.perm || can(x.perm));
  const requested = route.query.get('tab') ?? 'account';
  const tab = tabs.some((x) => x.key === requested) ? requested : 'account';
  return (
    <div>
      <PageHeader eyebrow={t('navgroup.system')} title={t('nav.settings')} sub={t('settings.sub')} />
      <Tabs tabs={tabs.map(({ key, label, icon }) => ({ key, label, icon }))} value={tab} onChange={(k) => setQuery('tab', k === 'account' ? null : k)} />
      {tab === 'account' && <AccountTab />}
      {tab === 'company' && <CompanyTab />}
      {tab === 'mail' && <MailTab />}
      {tab === 'print' && <PrintTab />}
      {tab === 'regional' && <RegionalTab />}
      {tab === 'defaults' && <DefaultsTab />}
      {tab === 'notifications' && <NotificationsTab />}
      {tab === 'privacy' && <PrivacyTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'roles' && <RolesTab />}
      {tab === 'tags' && <TagsTab />}
      {tab === 'products' && <ProductsTab />}
      {tab === 'carriers' && <CarriersTab />}
      {tab === 'data' && <DataTab />}
    </div>
  );
}
