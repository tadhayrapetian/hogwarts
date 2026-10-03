import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';

// ───────────── Toasts ─────────────

type ToastKind = 'success' | 'error' | 'warning' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ConfirmOpts {
  title: string;
  body?: ReactNode;
  confirm?: string;
  danger?: boolean;
  /** Require the user to type this text to confirm (destructive actions). */
  typeToConfirm?: string;
}

interface CtxMenuItem {
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  divider?: boolean;
  disabled?: boolean;
}

interface FeedbackCtx {
  toast: (text: string, kind?: ToastKind) => void;
  confirm: (o: ConfirmOpts) => Promise<boolean>;
  prompt: (o: { title: string; label: string; initial?: string; confirm?: string }) => Promise<string | null>;
  contextMenu: (e: { clientX: number; clientY: number; preventDefault?: () => void }, items: CtxMenuItem[]) => void;
}

const Ctx = createContext<FeedbackCtx | null>(null);

let toastSeq = 0;

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<null | { kind: 'confirm' | 'prompt'; opts: ConfirmOpts & { label?: string; initial?: string }; resolve: (v: unknown) => void }>(null);
  const [menu, setMenu] = useState<null | { x: number; y: number; items: CtxMenuItem[] }>(null);
  const [typed, setTyped] = useState('');

  const toast = useCallback((text: string, kind: ToastKind = 'success') => {
    const id = ++toastSeq;
    setToasts((ts) => [...ts, { id, kind, text }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), kind === 'error' ? 6500 : 3800);
  }, []);
  const confirm = useCallback(
    (opts: ConfirmOpts) =>
      new Promise<boolean>((resolve) => {
        setTyped('');
        setDialog({ kind: 'confirm', opts, resolve: resolve as (v: unknown) => void });
      }),
    [],
  );
  const prompt = useCallback(
    (o: { title: string; label: string; initial?: string; confirm?: string }) =>
      new Promise<string | null>((resolve) => {
        setTyped(o.initial ?? '');
        setDialog({ kind: 'prompt', opts: { title: o.title, label: o.label, initial: o.initial, confirm: o.confirm }, resolve: resolve as (v: unknown) => void });
      }),
    [],
  );
  const contextMenu = useCallback<FeedbackCtx['contextMenu']>((e, items) => {
    e.preventDefault?.();
    const x = Math.min(e.clientX, window.innerWidth - 230);
    const y = Math.min(e.clientY, window.innerHeight - items.length * 34 - 20);
    setMenu({ x, y, items });
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', close);
    };
  }, [menu]);

  const close = (v: unknown) => {
    dialog?.resolve(v);
    setDialog(null);
  };

  const icon = (k: ToastKind) => (k === 'success' ? <CheckCircle2 /> : k === 'error' ? <XCircle /> : k === 'warning' ? <AlertTriangle /> : <Info />);
  const confirmDisabled = dialog?.kind === 'confirm' && !!dialog.opts.typeToConfirm && typed.trim() !== dialog.opts.typeToConfirm;

  return (
    <Ctx.Provider value={{ toast, confirm, prompt, contextMenu }}>
      {children}
      {createPortal(
        <>
          <div className="toasts" role="status" aria-live="polite">
            {toasts.map((x) => (
              <div key={x.id} className={`toast ${x.kind}`}>
                {icon(x.kind)}
                <span>{x.text}</span>
              </div>
            ))}
          </div>
          {dialog && (
            <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close(dialog.kind === 'confirm' ? false : null)}>
              <form
                className="modal"
                role="dialog"
                aria-modal="true"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (confirmDisabled) return;
                  close(dialog.kind === 'confirm' ? true : typed);
                }}
              >
                <div className="modal-head">
                  <h2>{dialog.opts.title}</h2>
                </div>
                <div className="modal-body">
                  {dialog.opts.body && <div className="ink2">{dialog.opts.body}</div>}
                  {dialog.kind === 'prompt' && (
                    <div className="field">
                      <label>{dialog.opts.label}</label>
                      <input className="input" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} />
                    </div>
                  )}
                  {dialog.kind === 'confirm' && dialog.opts.typeToConfirm && (
                    <div className="field mt-16">
                      <label>{t('common.typeToConfirm', { text: dialog.opts.typeToConfirm })}</label>
                      <input className="input" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} />
                    </div>
                  )}
                </div>
                <div className="modal-foot">
                  <button type="button" className="btn" onClick={() => close(dialog.kind === 'confirm' ? false : null)}>
                    {t('common.cancel')}
                  </button>
                  <button type="submit" className={`btn ${dialog.opts.danger ? 'danger solid' : 'primary'}`} disabled={confirmDisabled} autoFocus={dialog.kind === 'confirm' && !dialog.opts.typeToConfirm}>
                    {dialog.opts.confirm ?? t('common.confirm')}
                  </button>
                </div>
              </form>
            </div>
          )}
          {menu && (
            <div className="ctx-menu" style={{ left: menu.x, top: Math.max(8, menu.y) }} role="menu" onClick={(e) => e.stopPropagation()}>
              {menu.items.map((it, i) =>
                it.divider ? (
                  <hr key={i} />
                ) : (
                  <button
                    key={i}
                    role="menuitem"
                    className={it.danger ? 'danger' : ''}
                    disabled={it.disabled}
                    onClick={() => {
                      setMenu(null);
                      it.onClick?.();
                    }}
                  >
                    {it.icon}
                    {it.label}
                  </button>
                ),
              )}
            </div>
          )}
        </>,
        document.body,
      )}
    </Ctx.Provider>
  );
}

export function useFeedback(): FeedbackCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useFeedback outside provider');
  return c;
}

/** Runs an async action, shows a toast on success/failure. */
export function useAction() {
  const { toast } = useFeedback();
  const { t } = useI18n();
  const busy = useRef(false);
  return useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      if (busy.current) return undefined;
      busy.current = true;
      try {
        const r = await fn();
        if (success) toast(success, 'success');
        return r;
      } catch (e) {
        const code = (e as { code?: string }).code;
        const params = (e as { params?: Record<string, string | number> }).params;
        console.error(e);
        toast(code ? t(`err.${code}`, params) : `${t('err.generic')}: ${(e as Error).message}`, 'error');
        return undefined;
      } finally {
        busy.current = false;
      }
    },
    [toast, t],
  );
}
