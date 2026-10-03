import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, EyeOff, GitMerge, Undo2, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { countryName } from '../../core/countries';
import { findDuplicates, pairKey, type DuplicateMatch } from '../../core/duplicates';
import type { Recipient } from '../../core/types';
import { db } from '../../db/db';
import { mergeRecipients, setDuplicateDecision } from '../../db/services';
import { useFmt } from '../../app/data';
import { useAction } from '../../app/feedback';
import { useI18n } from '../../i18n';
import { Badge, Card, EmptyState, Modal, PageHeader, Tabs } from '../../ui/kit';

const FIELDS: (keyof Recipient)[] = ['firstName', 'lastName', 'preferredName', 'dob', 'birthday', 'guardianName', 'guardianEmail', 'guardianPhone', 'petName', 'owlName', 'favoriteSubject', 'houseId', 'schoolYear'];

function addrLine(r: Recipient, lang: string) {
  const a = r.addresses.find((x) => x.id === r.defaultAddressId) ?? r.addresses[0];
  return a ? [a.line1, a.line2, a.postalCode, a.city, countryName(a.country, lang)].filter(Boolean).join(', ') : '';
}

function MergeModal({ a, b, onClose }: { a: Recipient; b: Recipient; onClose: () => void }) {
  const { t } = useI18n();
  const run = useAction();
  const [primary, setPrimary] = useState<'a' | 'b'>(a.createdAt <= b.createdAt ? 'a' : 'b');
  const P = primary === 'a' ? a : b;
  const S = primary === 'a' ? b : a;
  const conflicts = FIELDS.filter((f) => P[f] && S[f] && P[f] !== S[f]);
  const [choice, setChoice] = useState<Record<string, 'p' | 's'>>({});
  const merge = async () => {
    const values: Partial<Recipient> = {};
    for (const f of conflicts) if (choice[f] === 's') (values as Record<string, unknown>)[f] = S[f];
    await run(() => mergeRecipients(P.id, S.id, values), t('dup.merged'));
    onClose();
  };
  return (
    <Modal
      title={t('dup.mergeTitle')}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" onClick={merge}>
            <GitMerge /> {t('dup.merge')}
          </button>
        </>
      }
    >
      <p className="muted">{t('dup.mergeHint')}</p>
      <div className="row mb-16">
        <b>{t('dup.keepRecord')}:</b>
        <div className="tabs pill">
          <button className={primary === 'a' ? 'active' : ''} onClick={() => setPrimary('a')}>
            #{a.code}
          </button>
          <button className={primary === 'b' ? 'active' : ''} onClick={() => setPrimary('b')}>
            #{b.code}
          </button>
        </div>
      </div>
      {conflicts.length ? (
        <div className="table-wrap">
          <table className="table compact">
            <thead>
              <tr>
                <th>{t('dup.field')}</th>
                <th>#{P.code}</th>
                <th>#{S.code}</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map((f) => (
                <tr key={f}>
                  <td>{t(`fieldname.${f}`)}</td>
                  {(['p', 's'] as const).map((k) => (
                    <td key={k}>
                      <label className="check">
                        <input type="radio" name={f} checked={(choice[f] ?? 'p') === k} onChange={() => setChoice({ ...choice, [f]: k })} />
                        {String((k === 'p' ? P : S)[f] ?? '')}
                      </label>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="issue warning" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
          <CheckCircle2 /> {t('dup.noConflicts')}
        </div>
      )}
      <div className="muted small mt-16">{t('dup.mergeEffects')}</div>
    </Modal>
  );
}

export function Duplicates() {
  const { t, lang } = useI18n();
  const fmt = useFmt();
  const run = useAction();
  const [tab, setTab] = useState('open');
  const [merging, setMerging] = useState<[Recipient, Recipient] | null>(null);
  const data = useLiveQuery(async () => ({ recipients: await db.recipients.toArray(), decisions: await db.duplicateDecisions.toArray(), houses: await db.houses.toArray() }), []);
  const pairs = useMemo<DuplicateMatch[]>(() => {
    if (!data) return [];
    return findDuplicates(
      data.recipients.filter((r) => r.status !== 'anonymized'),
      new Set(data.decisions.map((d) => d.key)),
    );
  }, [data]);
  if (!data) return null;
  const byId = new Map(data.recipients.map((r) => [r.id, r]));
  const show = (r: Recipient, other: Recipient, f: keyof Recipient) => {
    let v = r[f] as unknown;
    if (f === 'houseId') v = data.houses.find((h) => h.id === v)?.name;
    const o = f === 'houseId' ? data.houses.find((h) => h.id === other[f])?.name : other[f];
    const diff = v && o && v !== o;
    return <span style={{ color: diff ? 'var(--danger)' : undefined, fontWeight: diff ? 600 : undefined }}>{v ? String(v) : <span className="muted">—</span>}</span>;
  };
  return (
    <div>
      <PageHeader crumbs={[{ label: t('nav.recipients'), href: '#/recipients' }, { label: t('dup.title') }]} title={t('dup.title')} sub={t('dup.sub')} />
      <Tabs
        tabs={[
          { key: 'open', label: t('dup.open'), count: pairs.length },
          { key: 'reviewed', label: t('dup.reviewed'), count: data.decisions.length },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'open' &&
        (pairs.length ? (
          <div className="col gap-16">
            {pairs.map((p) => {
              const a = byId.get(p.a)!;
              const b = byId.get(p.b)!;
              return (
                <Card
                  key={pairKey(p.a, p.b)}
                  title={
                    <span className="row">
                      {t('dup.possible')} <Badge tone={p.score >= 85 ? 'danger' : 'warning'}>{t('dup.score', { score: p.score })}</Badge>
                    </span>
                  }
                  sub={p.reasons.map((r) => t(`dupreason.${r}`)).join(' · ')}
                  actions={
                    <>
                      <button className="btn sm primary" onClick={() => setMerging([a, b])}>
                        <GitMerge /> {t('dup.merge')}
                      </button>
                      <button className="btn sm" onClick={() => run(() => setDuplicateDecision(a.id, b.id, 'keep_both'), t('dup.keptBoth'))}>
                        <Users /> {t('dup.keepBoth')}
                      </button>
                      <button className="btn sm ghost" onClick={() => run(() => setDuplicateDecision(a.id, b.id, 'ignore'), t('dup.ignored'))}>
                        <EyeOff /> {t('dup.ignore')}
                      </button>
                    </>
                  }
                >
                  <div className="table-wrap">
                    <table className="table compact">
                      <thead>
                        <tr>
                          <th />
                          <th>
                            <a href={`#/recipients/${a.id}`}>#{a.code}</a> <span className="muted">· {fmt.date(a.createdAt)}</span>
                          </th>
                          <th>
                            <a href={`#/recipients/${b.id}`}>#{b.code}</a> <span className="muted">· {fmt.date(b.createdAt)}</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {FIELDS.filter((f) => a[f] || b[f]).map((f) => (
                          <tr key={f}>
                            <td className="muted small">{t(`fieldname.${f}`)}</td>
                            <td>{show(a, b, f)}</td>
                            <td>{show(b, a, f)}</td>
                          </tr>
                        ))}
                        <tr>
                          <td className="muted small">{t('field.address')}</td>
                          <td>{addrLine(a, lang)}</td>
                          <td>{addrLine(b, lang)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={<CheckCircle2 />} title={t('dup.none')} text={t('dup.noneHint')} />
        ))}
      {tab === 'reviewed' && (
        <Card>
          {data.decisions.length ? (
            <div className="list">
              {data.decisions.map((d) => {
                const [x, y] = d.key.split('|').map((id) => byId.get(id));
                return (
                  <div key={d.key} className="list-item">
                    <Badge tone={d.decision === 'keep_both' ? 'success' : 'neutral'}>{t(`dup.decision.${d.decision}`)}</Badge>
                    <span className="grow">
                      {x ? `${x.firstName} ${x.lastName} #${x.code}` : '—'} ↔ {y ? `${y.firstName} ${y.lastName} #${y.code}` : '—'}
                    </span>
                    <span className="muted small">
                      {d.by} · {fmt.date(d.at)}
                    </span>
                    <button className="btn sm ghost" onClick={() => db.duplicateDecisions.delete(d.key)}>
                      <Undo2 /> {t('dup.undo')}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="muted">{t('dup.noDecisions')}</div>
          )}
        </Card>
      )}
      {merging && <MergeModal a={merging[0]} b={merging[1]} onClose={() => setMerging(null)} />}
    </div>
  );
}
