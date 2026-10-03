import { KeyRound, Lock, LogIn, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { defaultSettings } from '../core/defaults';
import type { Lang } from '../core/types';
import { passwordProblems } from '../db/auth';
import { db } from '../db/db';
import { loadDemoWorkspace, loadStarterLibrary } from '../db/seed';
import { audit, createUser } from '../db/services';
import { LANGS, useI18n } from '../i18n';
import { Field, Toggle } from '../ui/kit';
import { useSession } from './session';

export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <svg className="brand-mark" viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <defs>
        <radialGradient id="bm-wax" cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor="#d0574a" />
          <stop offset="1" stopColor="#6e1f19" />
        </radialGradient>
      </defs>
      <rect x="6" y="14" width="52" height="36" rx="3" fill="#f3e3c0" />
      <path d="M6 16 L32 36 L58 16" fill="none" stroke="#8a6a35" strokeWidth="2.2" />
      <circle cx="32" cy="38" r="10" fill="url(#bm-wax)" />
      <path d="M28.4 36.6c0-2 1.6-3.4 3.6-3.4s3.6 1.4 3.6 3.4v1.8c0 2.2-1.6 3.8-3.6 3.8s-3.6-1.6-3.6-3.8z" fill="none" stroke="#f4c27a" strokeWidth="1.1" />
      <circle cx="30.6" cy="36.4" r=".8" fill="#f4c27a" />
      <circle cx="33.4" cy="36.4" r=".8" fill="#f4c27a" />
    </svg>
  );
}

function LangSwitch() {
  const { lang, setLang } = useI18n();
  return (
    <select className="select sm" style={{ width: 130 }} value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label="Language">
      {LANGS.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}

export function SetupScreen() {
  const { t, lang } = useI18n();
  const { refresh, signInAs } = useSession();
  const [name, setName] = useState('Administrator');
  const [username, setUsername] = useState('admin');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [demo, setDemo] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const problems = passwordProblems(pw);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (problems.length) return setError(t(`auth.${problems[0]}`));
    if (pw !== pw2) return setError(t('auth.pwMismatch'));
    if (!/^[a-z0-9._-]{3,32}$/i.test(username)) return setError(t('auth.usernameInvalid'));
    setBusy(true);
    try {
      if (demo) await loadDemoWorkspace();
      else await loadStarterLibrary();
      const s = (await db.settings.get('app')) ?? defaultSettings();
      await db.settings.put({ ...s, regional: { ...s.regional, language: lang } });
      const admin = await createUser(username, name, 'admin', pw);
      if (demo) {
        await createUser('editor', 'Eleanor Editor', 'editor', 'owlpost2026');
        await createUser('production', 'Percy Production', 'production', 'owlpost2026');
        await createUser('viewer', 'Violet Viewer', 'viewer', 'owlpost2026');
      }
      await audit('create', 'workspace', demo ? 'Created demo workspace' : 'Created empty workspace');
      await signInAs(admin);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <form className="auth-card wide" onSubmit={submit}>
        <div className="brand-line">
          <BrandMark size={46} />
          <div className="grow">
            <div className="brand-name">HOGWARTS MAIL</div>
            <div className="muted small">{t('app.tagline')}</div>
          </div>
          <LangSwitch />
        </div>
        <h1 style={{ fontSize: 28 }}>{t('setup.title')}</h1>
        <p className="muted">{t('setup.intro')}</p>
        <div className="form-grid mt-16">
          <Field label={t('setup.adminName')} className="full">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label={t('auth.username')}>
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
          </Field>
          <div />
          <Field label={t('auth.password')} hint={t('auth.pwRules')}>
            <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required />
          </Field>
          <Field label={t('auth.passwordRepeat')}>
            <input className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required />
          </Field>
          <div className="full card pad flat" style={{ background: 'var(--surface-2)' }}>
            <Toggle checked={demo} onChange={setDemo} label={<b>{t('setup.loadDemo')}</b>} />
            <div className="muted small mt-8">{demo ? t('setup.demoHint') : t('setup.emptyHint')}</div>
          </div>
        </div>
        {error && <div className="issue error mt-16">{error}</div>}
        <div className="row mt-24">
          <span className="muted tiny grow">{t('setup.privacy')}</span>
          <button className="btn primary lg" disabled={busy}>
            <Sparkles /> {busy ? t('setup.creating') : t('setup.create')}
          </button>
        </div>
      </form>
    </div>
  );
}

export function LoginScreen() {
  const { t } = useI18n();
  const { login } = useSession();
  const [username, setUsername] = useState('');
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="auth">
      <form
        className="auth-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          const ok = await login(username, pw);
          setBusy(false);
          if (!ok) setError(t('auth.invalid'));
        }}
      >
        <div className="brand-line">
          <BrandMark size={46} />
          <div className="grow">
            <div className="brand-name">HOGWARTS MAIL</div>
            <div className="muted small">{t('app.tagline')}</div>
          </div>
          <LangSwitch />
        </div>
        <h1 style={{ fontSize: 28 }}>{t('auth.signIn')}</h1>
        <div className="col gap-12 mt-16">
          <Field label={t('auth.username')}>
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
          </Field>
          <Field label={t('auth.password')}>
            <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required />
          </Field>
          {error && <div className="issue error">{error}</div>}
          <button className="btn primary lg" disabled={busy}>
            <LogIn /> {t('auth.signIn')}
          </button>
          <div className="muted tiny">{t('auth.localNote')}</div>
        </div>
      </form>
    </div>
  );
}

export function LockScreen() {
  const { t } = useI18n();
  const { unlock, logout, user } = useSession();
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  return (
    <div className="auth">
      <form
        className="auth-card"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!(await unlock(pw))) setError(t('auth.invalid'));
        }}
      >
        <div className="row gap-12">
          <Lock size={28} color="var(--accent)" />
          <div>
            <h2>{t('auth.locked')}</h2>
            <div className="muted small">{t('auth.lockedHint', { name: user?.displayName ?? '' })}</div>
          </div>
        </div>
        <div className="col gap-12 mt-16">
          <Field label={t('auth.password')}>
            <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="current-password" />
          </Field>
          {error && <div className="issue error">{error}</div>}
          <div className="row">
            <button type="button" className="btn ghost" onClick={logout}>
              {t('auth.switchUser')}
            </button>
            <span className="grow" />
            <button className="btn primary">
              <KeyRound /> {t('auth.unlock')}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
