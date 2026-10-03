import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ArrowRight, CheckCircle2, Printer, Upload, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { countryName } from '../core/countries';
import type { Template } from '../core/types';
import { addDays, normalizeText, toISODate } from '../core/util';
import { validateRecipient } from '../core/validation';
import { db } from '../db/db';
import { bulkUpdateRecipients, createBatch, createOrder, createProject, setProjectStage } from '../db/services';
import { useFmt } from '../app/data';
import { useFeedback } from '../app/feedback';
import { navigate } from '../app/router';
import { useI18n } from '../i18n';
import { Badge, Check, Field, Modal, Progress, SearchInput, Toggle } from '../ui/kit';
import { MultiTemplatePicker, TemplatePicker, useSampleCtx } from './shared/pickers';

export function BulkWizard({ initialIds, onClose }: { initialIds: string[]; onClose: () => void }) {
  const { t, lang } = useI18n();
  const fmt = useFmt();
  const { toast } = useFeedback();
  const ctx = useSampleCtx('bulk');
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialIds));
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [house, setHouse] = useState('');
  const [template, setTemplate] = useState<Template | undefined>();
  const [docIds, setDocIds] = useState<string[]>([]);
  const [createOrders, setCreateOrders] = useState(false);
  const [productId, setProductId] = useState('');
  const [dueDate, setDueDate] = useState(toISODate(addDays(new Date(), 14)));
  const [generate, setGenerate] = useState(true);
  const [makeBatch, setMakeBatch] = useState(true);
  const [skipInvalid, setSkipInvalid] = useState(true);
  const [addTag, setAddTag] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ projects: number; batchId?: string } | null>(null);
  const data = useLiveQuery(async () => ({ recipients: await db.recipients.toArray(), tags: await db.tags.toArray(), houses: await db.houses.toArray(), products: await db.products.toArray() }), []);
  const list = useMemo(() => {
    if (!data) return [];
    const n = normalizeText(q);
    return data.recipients
      .filter((r) => r.status === 'active' || r.status === 'prospect')
      .filter((r) => !tag || r.tagIds.includes(tag))
      .filter((r) => !house || r.houseId === house)
      .filter((r) => !n || normalizeText(`${r.firstName} ${r.lastName} ${r.code} ${r.city}`).includes(n))
      .sort((a, b) => a.lastName.localeCompare(b.lastName));
  }, [data, q, tag, house]);
  const chosen = useMemo(() => (data ? data.recipients.filter((r) => selected.has(r.id)) : []), [data, selected]);
  const checks = useMemo(() => chosen.map((r) => ({ r, issues: validateRecipient(r, { requireAddress: true }).filter((i) => i.level === 'error') })), [chosen]);
  const invalid = checks.filter((c) => c.issues.length);
  const targets = skipInvalid ? checks.filter((c) => !c.issues.length).map((c) => c.r) : chosen;

  const pickTemplate = (tp: Template) => {
    setTemplate(tp);
    setDocIds(tp.documentTemplateIds);
    const prod = data?.products.find((p) => p.templateId === tp.id);
    if (prod) setProductId(prod.id);
  };

  const run = async () => {
    if (!template) return;
    setProgress({ done: 0, total: targets.length });
    const ids: string[] = [];
    try {
      for (let i = 0; i < targets.length; i++) {
        const r = targets[i];
        let orderId: string | undefined;
        if (createOrders) {
          const prod = data?.products.find((p) => p.id === productId);
          const o = await createOrder({ recipientId: r.id, customerId: r.customerId, dueDate, items: prod ? [{ id: crypto.randomUUID(), productId: prod.id, name: prod.name, qty: 1, unitPrice: prod.price }] : [] });
          orderId = o.id;
        }
        const p = await createProject({ recipientId: r.id, orderId, templateId: template.id, documentTemplateIds: docIds, dueDate });
        ids.push(p.id);
        setProgress({ done: i + 1, total: targets.length });
      }
      if (generate) await setProjectStage(ids, 'generated');
      if (addTag) await bulkUpdateRecipients(targets.map((r) => r.id), (r) => ({ tagIds: Array.from(new Set([...r.tagIds, addTag])) }), 'Bulk generation tag');
      let batchId: string | undefined;
      if (makeBatch && ids.length) batchId = (await createBatch(ids, `${template.name} × ${ids.length}`)).id;
      setResult({ projects: ids.length, batchId });
      toast(t('bulk.done', { count: ids.length }));
    } catch (e) {
      toast(`${t('err.generic')}: ${(e as Error).message}`, 'error');
    } finally {
      setProgress(null);
    }
  };

  if (!data) return null;
  const steps = [t('bulk.step.recipients'), t('bulk.step.template'), t('bulk.step.options'), t('bulk.step.generate')];
  return (
    <Modal
      title={t('bulk.title')}
      sub={t('bulk.sub')}
      onClose={onClose}
      size="xl"
      initialFocus={false}
      footer={
        result ? (
          <>
            <button className="btn" onClick={onClose}>
              {t('common.close')}
            </button>
            {result.batchId && (
              <button className="btn primary" onClick={() => (onClose(), navigate(`/print/${result.batchId}`))}>
                <Printer /> {t('print.openBatch')}
              </button>
            )}
          </>
        ) : (
          <>
            <div className="left steps">
              {steps.map((s, i) => (
                <span key={s} className={`s ${i === step ? 'active' : i < step ? 'done' : ''}`}>
                  <span className="n">{i + 1}</span>
                  <span className="hide-mobile">{s}</span>
                </span>
              ))}
            </div>
            {step > 0 && (
              <button className="btn" disabled={!!progress} onClick={() => setStep(step - 1)}>
                <ArrowLeft /> {t('common.back')}
              </button>
            )}
            {step < 3 ? (
              <button className="btn primary" disabled={(step === 0 && !selected.size) || (step === 1 && !template)} onClick={() => setStep(step + 1)}>
                {t('common.next')} <ArrowRight />
              </button>
            ) : (
              <button className="btn accent lg" disabled={!!progress || !targets.length} onClick={run}>
                <Wand2 /> {t('bulk.generateN', { count: targets.length })}
              </button>
            )}
          </>
        )
      }
    >
      {result ? (
        <div className="empty">
          <CheckCircle2 />
          <h3>{t('bulk.doneTitle', { count: result.projects })}</h3>
          <p>{result.batchId ? t('bulk.doneBatch') : t('bulk.doneNoBatch')}</p>
          <a className="btn" href="#/production" onClick={onClose}>
            {t('nav.production')}
          </a>
        </div>
      ) : (
        <>
          {step === 0 && (
            <div className="col gap-12">
              <div className="toolbar" style={{ marginBottom: 0 }}>
                <SearchInput value={q} onChange={setQ} placeholder={t('common.search')} />
                <select className="select" style={{ width: 170 }} value={tag} onChange={(e) => setTag(e.target.value)} aria-label={t('field.tag')}>
                  <option value="">{t('field.tag')}: {t('common.all')}</option>
                  {data.tags.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
                <select className="select" style={{ width: 170 }} value={house} onChange={(e) => setHouse(e.target.value)} aria-label={t('field.house')}>
                  <option value="">{t('field.house')}: {t('common.all')}</option>
                  {data.houses.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
                <button className="btn sm" onClick={() => setSelected(new Set([...selected, ...list.map((r) => r.id)]))}>
                  {t('bulk.selectShown', { count: list.length })}
                </button>
                <button className="btn sm ghost" onClick={() => setSelected(new Set())}>
                  {t('common.clear')}
                </button>
                <a className="btn sm" href="#/recipients/import" onClick={onClose}>
                  <Upload /> {t('bulk.fromFile')}
                </a>
              </div>
              <div className="muted small">{t('common.selected', { count: selected.size })}</div>
              <div className="table-wrap" style={{ maxHeight: '52vh', overflow: 'auto' }}>
                <table className="table compact">
                  <tbody>
                    {list.map((r) => (
                      <tr
                        key={r.id}
                        className={`clickable ${selected.has(r.id) ? 'selected' : ''}`}
                        onClick={() => {
                          const n = new Set(selected);
                          if (n.has(r.id)) n.delete(r.id);
                          else n.add(r.id);
                          setSelected(n);
                        }}
                      >
                        <td className="check-cell">
                          <Check checked={selected.has(r.id)} onChange={() => undefined} />
                        </td>
                        <td>
                          <b>
                            {r.firstName} {r.lastName}
                          </b>
                        </td>
                        <td className="muted small">#{r.code}</td>
                        <td className="small">
                          {r.city}, {countryName(r.country, lang)}
                        </td>
                        <td className="small">{data.houses.find((h) => h.id === r.houseId)?.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {step === 1 && <TemplatePicker value={template?.id} onChange={pickTemplate} ctx={ctx} />}
          {step === 2 && (
            <div className="grid grid-2">
              <div className="col gap-12">
                <h3>{t('project.tab.documents')}</h3>
                <MultiTemplatePicker value={docIds} onChange={setDocIds} ctx={ctx} />
              </div>
              <div className="col gap-12">
                <Toggle checked={createOrders} onChange={setCreateOrders} label={t('bulk.createOrders')} />
                {createOrders && (
                  <Field label={t('order.product')}>
                    <select className="select" value={productId} onChange={(e) => setProductId(e.target.value)}>
                      <option value="">—</option>
                      {data.products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {fmt.money(p.price)}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field label={t('order.dueDate')}>
                  <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </Field>
                <Toggle checked={generate} onChange={setGenerate} label={t('bulk.generateDocs')} />
                <Toggle checked={makeBatch} onChange={setMakeBatch} label={t('bulk.makeBatch')} />
                <Field label={t('bulk.tagRecipients')}>
                  <select className="select" value={addTag} onChange={(e) => setAddTag(e.target.value)}>
                    <option value="">—</option>
                    {data.tags.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="col gap-16">
              <div className="grid grid-3">
                <div className="card stat">
                  <div className="label">{t('bulk.selected')}</div>
                  <div className="value">{chosen.length}</div>
                </div>
                <div className="card stat">
                  <div className="label">{t('bulk.needAttention')}</div>
                  <div className="value" style={{ color: invalid.length ? 'var(--warning)' : undefined }}>
                    {invalid.length}
                  </div>
                </div>
                <div className="card stat">
                  <div className="label">{t('bulk.willCreate')}</div>
                  <div className="value">{targets.length}</div>
                  <div className="delta">{t('bulk.perPackage', { docs: docIds.length + 1 })}</div>
                </div>
              </div>
              <Toggle checked={skipInvalid} onChange={setSkipInvalid} label={t('bulk.skipInvalid')} />
              {invalid.length > 0 && (
                <div className="table-wrap" style={{ maxHeight: 240, overflow: 'auto' }}>
                  <table className="table compact">
                    <tbody>
                      {invalid.map(({ r, issues }) => (
                        <tr key={r.id}>
                          <td>
                            <a href={`#/recipients/${r.id}?edit=1`} target="_blank" rel="noreferrer">
                              {r.firstName} {r.lastName}
                            </a>
                          </td>
                          <td>
                            {issues.map((i, k) => (
                              <Badge key={k} tone="warning">
                                {t(`val.${i.code}`, { ...(i.params ?? {}), field: i.field ? t(`fieldname.${i.field}`) : '' })}
                              </Badge>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="muted">
                {t('bulk.summary', { count: targets.length, template: template?.name ?? '', docs: docIds.length })}
              </div>
              {progress && (
                <div>
                  <Progress value={(progress.done / Math.max(1, progress.total)) * 100} />
                  <div className="muted small mt-8">
                    {progress.done} / {progress.total}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
