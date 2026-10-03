import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ChevronLeft, ChevronRight, Search, Upload, X, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Issue } from '../core/validation';
import { compareValues } from '../core/util';
import { useI18n } from '../i18n';

// ───────────── Layout ─────────────

export function PageHeader({ eyebrow, title, sub, actions, crumbs }: { eyebrow?: string; title: ReactNode; sub?: ReactNode; actions?: ReactNode; crumbs?: { label: string; href?: string }[] }) {
  return (
    <div className="page-head">
      <div className="grow">
        {crumbs && (
          <div className="breadcrumb">
            {crumbs.map((c, i) => (
              <span key={i} className="row gap-4">
                {c.href ? <a href={c.href}>{c.label}</a> : <span>{c.label}</span>}
                {i < crumbs.length - 1 && <ChevronRight size={13} />}
              </span>
            ))}
          </div>
        )}
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, sub, actions, children, className = '', bodyClass = 'card-body', style }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; bodyClass?: string; style?: CSSProperties }) {
  return (
    <section className={`card ${className}`} style={style}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h3>{title}</h3>}
            {sub && <div className="sub">{sub}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, icon, delta, tone, href }: { label: string; value: ReactNode; icon?: ReactNode; delta?: ReactNode; tone?: 'up' | 'down'; href?: string }) {
  return (
    <div className="card stat">
      <div className="label">
        {icon}
        {label}
      </div>
      <div className="value">{value}</div>
      {delta && <div className={`delta ${tone ?? ''}`}>{delta}</div>}
      {href && <a className="cover" href={href} aria-label={label} />}
    </div>
  );
}

export function Section({ icon, title, children, actions }: { icon?: ReactNode; title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="form-section">
      <h3>
        {icon}
        <span className="grow">{title}</span>
        {actions}
      </h3>
      {children}
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action && <div className="mt-8">{action}</div>}
    </div>
  );
}

// ───────────── Overlays ─────────────

function useEscape(onClose: () => void) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
}

export function Modal({ title, sub, onClose, children, footer, size, initialFocus = true }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'lg' | 'xl'; initialFocus?: boolean }) {
  useEscape(onClose);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!initialFocus) return;
    const el = ref.current?.querySelector<HTMLElement>('input, select, textarea, button.primary');
    el?.focus();
  }, [initialFocus]);
  const down = useRef(false);
  return createPortal(
    <div
      className="overlay"
      onMouseDown={(e) => (down.current = e.target === e.currentTarget)}
      onMouseUp={(e) => {
        if (down.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`modal ${size ?? ''}`} role="dialog" aria-modal="true" ref={ref}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {sub && <div className="muted small mt-8">{sub}</div>}
          </div>
          <button className="btn ghost icon sm" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ title, sub, onClose, children, footer, wide }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEscape(onClose);
  return createPortal(
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className={`drawer ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="grow">
            <h2>{title}</h2>
            {sub && <div className="muted small mt-8">{sub}</div>}
          </div>
          <button className="btn ghost icon sm" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="modal-body" style={{ flex: 1 }}>
          {children}
        </div>
        {footer && <div className="modal-foot" style={{ borderRadius: 0 }}>{footer}</div>}
      </aside>
    </>,
    document.body,
  );
}

// ───────────── Navigation ─────────────

export interface TabDef {
  key: string;
  label: string;
  icon?: ReactNode;
  count?: number;
}

export function Tabs({ tabs, value, onChange, pill }: { tabs: TabDef[]; value: string; onChange: (k: string) => void; pill?: boolean }) {
  return (
    <div className={`tabs ${pill ? 'pill' : ''}`} role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} className={value === t.key ? 'active' : ''} onClick={() => onChange(t.key)} type="button">
          {t.icon}
          {t.label}
          {t.count !== undefined && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ───────────── Form controls ─────────────

export function Field({ label, required, hint, error, warning, children, className = '' }: { label?: ReactNode; required?: boolean; hint?: ReactNode; error?: string; warning?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`field ${className}`}>
      {label && (
        <label>
          {label}
          {required && <span className="req">*</span>}
        </label>
      )}
      {children}
      {error ? <div className="err">{error}</div> : warning ? <div className="warn">{warning}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className="toggle" style={disabled ? { opacity: 0.5 } : undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      {label && <span>{label}</span>}
    </label>
  );
}

export function Check({ checked, onChange, label, indeterminate }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; indeterminate?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <label className="check" onClick={(e) => e.stopPropagation()}>
      <input ref={ref} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Range({ value, onChange, min, max, step = 1, format }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; format?: (v: number) => string }) {
  return (
    <div className="range-row">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="val">{format ? format(value) : value}</span>
    </div>
  );
}

export function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const safe = /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
  return (
    <div className="color-row">
      <input className="input" type="color" value={safe} onChange={(e) => onChange(e.target.value)} />
      <input className="input sm mono" value={value} onChange={(e) => onChange(e.target.value)} maxLength={9} />
    </div>
  );
}

export function NumberInput({ value, onChange, min, max, step = 1, className = 'input', placeholder }: { value: number | undefined; onChange: (v: number | undefined) => void; min?: number; max?: number; step?: number; className?: string; placeholder?: string }) {
  return (
    <input
      className={className}
      type="number"
      value={value ?? ''}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
    />
  );
}

export function SearchInput({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <div className="global-search" style={{ maxWidth: 360 }}>
      <Search />
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} type="search" />
    </div>
  );
}

export function Dropzone({ onFiles, accept, multiple, label }: { onFiles: (files: File[]) => void; accept?: string; multiple?: boolean; label?: ReactNode }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { t } = useI18n();
  return (
    <div
      className={`dropzone ${over ? 'over' : ''}`}
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
    >
      <Upload />
      <div>{label ?? t('common.dropFiles')}</div>
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

// ───────────── Status ─────────────

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent' | 'primary';

export function Badge({ tone = 'neutral', children, dot, title }: { tone?: Tone; children: ReactNode; dot?: boolean; title?: string }) {
  return (
    <span className={`badge ${tone} ${dot ? 'dot' : ''}`} title={title}>
      {children}
    </span>
  );
}

const TONES: Record<string, Record<string, Tone>> = {
  order: { new: 'info', confirmed: 'info', in_production: 'warning', ready_to_print: 'accent', printed: 'accent', packed: 'primary', shipped: 'primary', delivered: 'success', cancelled: 'danger', archived: 'neutral' },
  payment: { unpaid: 'danger', partial: 'warning', paid: 'success', refunded: 'neutral' },
  production: { not_started: 'neutral', in_progress: 'warning', done: 'success' },
  orderShipping: { not_shipped: 'neutral', partially: 'warning', shipped: 'primary', delivered: 'success', returned: 'danger' },
  shipment: { preparing: 'neutral', label_created: 'info', shipped: 'primary', in_transit: 'primary', out_for_delivery: 'accent', delivered: 'success', returned: 'danger' },
  stage: { created: 'neutral', approved: 'info', generated: 'accent', printed: 'warning', cut: 'warning', folded: 'warning', packed: 'primary', ready: 'success' },
  recipient: { active: 'success', prospect: 'info', paused: 'warning', archived: 'neutral', anonymized: 'neutral' },
  batch: { draft: 'neutral', ready: 'info', printed: 'accent', completed: 'success' },
  doc: { generated: 'info', printed: 'success', void: 'neutral' },
};

export function StatusBadge({ group, value }: { group: keyof typeof TONES | string; value: string | undefined }) {
  const { tEnum } = useI18n();
  if (!value) return null;
  return (
    <Badge tone={TONES[group]?.[value] ?? 'neutral'} dot>
      {tEnum(group, value)}
    </Badge>
  );
}

export function IssueList({ issues, max }: { issues: Issue[]; max?: number }) {
  const { t } = useI18n();
  const list = max ? issues.slice(0, max) : issues;
  return (
    <div className="col gap-4">
      {list.map((i, k) => (
        <div key={k} className={`issue ${i.level}`}>
          {i.level === 'error' ? <XCircle /> : <AlertTriangle />}
          <div className="grow">
            {t(`val.${i.code}`, { ...(i.params ?? {}), field: i.field ? t(`fieldname.${i.field}`) : '' })}
            {i.subject && <span className="muted small"> · {i.subject}</span>}
          </div>
          {i.href && (
            <a className="small" href={i.href}>
              {t('common.fix')}
            </a>
          )}
        </div>
      ))}
      {max && issues.length > max && <div className="muted small">+{issues.length - max}</div>}
    </div>
  );
}

export function ReadyBanner({ issues }: { issues: Issue[] }) {
  const { t } = useI18n();
  const errors = issues.filter((i) => i.level === 'error').length;
  if (!issues.length)
    return (
      <div className="ready-banner ok">
        <CheckCircle2 /> {t('print.readyForPrint')}
      </div>
    );
  return (
    <div className={`ready-banner ${errors ? 'err' : 'bad'}`}>
      <AlertTriangle /> {t('print.itemsNeedAttention', { count: issues.length })}
    </div>
  );
}

export function Avatar({ name, color, size }: { name: string; color?: string; size?: 'lg' }) {
  const ini = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => Array.from(p)[0]?.toUpperCase())
    .join('');
  return (
    <span className={`avatar ${size ?? ''}`} style={{ background: color }} aria-hidden="true">
      {ini}
    </span>
  );
}

export function TagPill({ name, color, onRemove }: { name: string; color: string; onRemove?: () => void }) {
  return (
    <span className="tag">
      <i style={{ background: color }} />
      {name}
      {onRemove && (
        <button onClick={onRemove} aria-label="remove" type="button">
          <X size={12} />
        </button>
      )}
    </span>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="progress">
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

// ───────────── Data table ─────────────

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  sort?: (row: T) => unknown;
  className?: string;
  width?: number | string;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  selected,
  onSelect,
  onContextMenu,
  pageSize = 25,
  initialSort,
  empty,
  compact,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (r: T) => string;
  onRowClick?: (r: T) => void;
  selected?: Set<string>;
  onSelect?: (s: Set<string>) => void;
  onContextMenu?: (r: T, e: ReactMouseEvent) => void;
  pageSize?: number;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  empty?: ReactNode;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [sort, setSort] = useState(initialSort);
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const s = [...rows].sort((a, b) => compareValues(col.sort!(a), col.sort!(b)));
    return sort.dir === 'desc' ? s.reverse() : s;
  }, [rows, sort, columns]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  useEffect(() => {
    if (page >= pages) setPage(0);
  }, [pages, page]);
  const view = sorted.slice(page * pageSize, page * pageSize + pageSize);
  const allSelected = !!selected && rows.length > 0 && rows.every((r) => selected.has(rowKey(r)));
  const someSelected = !!selected && rows.some((r) => selected.has(rowKey(r)));
  return (
    <div>
      <div className="table-wrap">
        <table className={`table ${compact ? 'compact' : ''}`}>
          <thead>
            <tr>
              {selected && onSelect && (
                <th className="check-cell">
                  <Check
                    checked={allSelected}
                    indeterminate={!allSelected && someSelected}
                    onChange={(v) => onSelect(v ? new Set(rows.map(rowKey)) : new Set())}
                  />
                </th>
              )}
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`${c.sort ? 'sortable' : ''} ${c.className ?? ''}`}
                  style={{ width: c.width }}
                  onClick={() => c.sort && setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'asc' }))}
                  aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  <span className="row gap-4" style={{ display: 'inline-flex' }}>
                    {c.header}
                    {sort?.key === c.key && (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map((r) => {
              const k = rowKey(r);
              const isSel = selected?.has(k);
              return (
                <tr
                  key={k}
                  className={`${onRowClick ? 'clickable' : ''} ${isSel ? 'selected' : ''}`}
                  onClick={() => onRowClick?.(r)}
                  onContextMenu={onContextMenu ? (e) => onContextMenu(r, e) : undefined}
                >
                  {selected && onSelect && (
                    <td className="check-cell">
                      <Check
                        checked={!!isSel}
                        onChange={(v) => {
                          const n = new Set(selected);
                          if (v) n.add(k);
                          else n.delete(k);
                          onSelect(n);
                        }}
                      />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td key={c.key} className={c.className}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {!view.length && (
              <tr>
                <td colSpan={columns.length + (selected ? 1 : 0)}>{empty ?? <div className="empty">{t('common.noResults')}</div>}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {sorted.length > pageSize && (
        <div className="pager">
          <span>{t('common.showing', { from: page * pageSize + 1, to: Math.min(sorted.length, (page + 1) * pageSize), total: sorted.length })}</span>
          <div className="row">
            <button className="btn sm icon" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="previous">
              <ChevronLeft />
            </button>
            <span className="num">
              {page + 1} / {pages}
            </span>
            <button className="btn sm icon" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="next">
              <ChevronRight />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
