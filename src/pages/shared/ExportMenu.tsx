import { Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAction } from '../../app/feedback';
import { useSession } from '../../app/session';
import { useI18n } from '../../i18n';
import { exportTable, type DataFormat } from './exporters';

export function ExportMenu({ name, build, label, formats = ['csv', 'xlsx', 'json', 'pdf', 'print'] }: { name: string; build: () => { head: string[]; rows: (string | number)[][]; json?: unknown }; label?: string; formats?: DataFormat[] }) {
  const { t } = useI18n();
  const { can } = useSession();
  const run = useAction();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [open]);
  if (!can('data.export')) return null;
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="btn" onClick={() => setOpen(!open)} aria-haspopup="menu">
        <Download /> {label ?? t('common.export')}
      </button>
      {open && (
        <div className="ctx-menu" style={{ position: 'absolute', top: 40, right: 0 }}>
          {formats.map((f) => (
            <button
              key={f}
              onClick={() => {
                setOpen(false);
                const { head, rows, json } = build();
                run(() => exportTable(f, name, head, rows, json), f === 'print' ? undefined : t('common.exported'));
              }}
            >
              {t(`format.${f}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
