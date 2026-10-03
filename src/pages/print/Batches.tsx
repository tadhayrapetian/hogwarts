import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Printer } from 'lucide-react';
import { useState } from 'react';
import { db } from '../../db/db';
import { createBatch } from '../../db/services';
import { useFmt } from '../../app/data';
import { useAction } from '../../app/feedback';
import { navigate } from '../../app/router';
import { useSession } from '../../app/session';
import { useI18n } from '../../i18n';
import { Check, DataTable, EmptyState, Modal, PageHeader, StatusBadge } from '../../ui/kit';

function NewBatchModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const run = useAction();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const data = useLiveQuery(async () => ({
    projects: await db.projects.where('status').equals('active').filter((p) => !p.batchId && ['approved', 'generated', 'created'].includes(p.stage)).toArray(),
    recipients: await db.recipients.toArray(),
  }), []);
  return (
    <Modal
      title={t('print.newBatch')}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn primary"
            disabled={!sel.size}
            onClick={async () => {
              const b = await run(() => createBatch(Array.from(sel), name || undefined), t('print.batchCreated'));
              if (b) {
                onClose();
                navigate(`/print/${b.id}`);
              }
            }}
          >
            {t('print.createWith', { count: sel.size })}
          </button>
        </>
      }
    >
      <input className="input mb-16" placeholder={t('print.batchName')} value={name} onChange={(e) => setName(e.target.value)} />
      <div className="row mb-8">
        <button className="btn xs" onClick={() => setSel(new Set(data?.projects.map((p) => p.id)))}>
          {t('common.selectAll')}
        </button>
        <span className="muted small">{t('print.unbatched', { count: data?.projects.length ?? 0 })}</span>
      </div>
      <div className="list" style={{ maxHeight: '50vh', overflow: 'auto' }}>
        {data?.projects.map((p) => {
          const r = data.recipients.find((x) => x.id === p.recipientId);
          return (
            <label key={p.id} className="list-item" style={{ cursor: 'pointer' }}>
              <Check
                checked={sel.has(p.id)}
                onChange={(v) => {
                  const n = new Set(sel);
                  if (v) n.add(p.id);
                  else n.delete(p.id);
                  setSel(n);
                }}
              />
              <span className="grow">
                <b>{r ? `${r.firstName} ${r.lastName}` : '—'}</b> <span className="muted small">· {p.name.split(' — ')[0]} · {p.code}</span>
              </span>
              <StatusBadge group="stage" value={p.stage} />
            </label>
          );
        })}
        {!data?.projects.length && <div className="muted">{t('print.nothingToBatch')}</div>}
      </div>
    </Modal>
  );
}

export function Batches() {
  const { t } = useI18n();
  const fmt = useFmt();
  const { can } = useSession();
  const [creating, setCreating] = useState(false);
  const batches = useLiveQuery(() => db.batches.orderBy('createdAt').reverse().toArray(), []);
  if (!batches) return null;
  return (
    <div>
      <PageHeader
        eyebrow={t('navgroup.operations')}
        title={t('nav.print')}
        sub={t('print.sub')}
        actions={
          can('print') && (
            <button className="btn primary" onClick={() => setCreating(true)}>
              <Plus /> {t('print.newBatch')}
            </button>
          )
        }
      />
      <DataTable
        rows={batches}
        rowKey={(b) => b.id}
        onRowClick={(b) => navigate(`/print/${b.id}`)}
        columns={[
          { key: 'code', header: t('print.batch'), render: (b) => <span className="mono">{b.code}</span>, sort: (b) => b.code },
          { key: 'name', header: t('field.name'), render: (b) => <b>{b.name}</b> },
          { key: 'n', header: t('nav.projects'), render: (b) => b.projectIds.length, className: 'num right', sort: (b) => b.projectIds.length },
          { key: 'paper', header: t('print.paper'), render: (b) => `${b.settings.paper} · ${b.settings.resolution} dpi` },
          { key: 'status', header: t('field.status'), render: (b) => <StatusBadge group="batch" value={b.status} /> },
          { key: 'created', header: t('common.created'), render: (b) => fmt.date(b.createdAt), sort: (b) => b.createdAt },
          { key: 'printed', header: t('print.printedAt'), render: (b) => fmt.date(b.printedAt) || '—' },
        ]}
        empty={<EmptyState icon={<Printer />} title={t('print.empty')} text={t('print.emptyHint')} />}
      />
      {creating && <NewBatchModal onClose={() => setCreating(false)} />}
    </div>
  );
}
