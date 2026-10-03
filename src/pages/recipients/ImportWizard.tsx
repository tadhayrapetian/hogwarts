import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { parseCSV, toCSV } from '../../core/csv';
import { findMatchesFor, latinize } from '../../core/duplicates';
import { autoMapHeaders, IMPORT_FIELDS, IMPORT_TEMPLATE_HEADERS, rowToDraft, type ImportDraft, type ImportField } from '../../core/importMap';
import type { Recipient } from '../../core/types';
import { downloadBlob, readFileAsArrayBuffer, readFileAsText } from '../../core/util';
import { hasErrors } from '../../core/validation';
import { readXlsx, writeXlsx } from '../../core/xlsx';
import { db } from '../../db/db';
import { importRecipients, updateRecipient } from '../../db/services';
import { useSettings } from '../../app/data';
import { useAction, useFeedback } from '../../app/feedback';
import { useUI } from '../../app/ui';
import { useI18n } from '../../i18n';
import { Badge, Card, Dropzone, Field, IssueList, PageHeader, Progress, Toggle } from '../../ui/kit';
import { CountrySelect } from './RecipientForm';

type Action = 'import' | 'skip' | 'merge';
interface Row {
  draft: ImportDraft;
  matches: { record: Recipient; score: number }[];
  inFileDup?: number;
  action: Action;
  mergeInto?: string;
}

export function ImportWizard() {
  const { t } = useI18n();
  const settings = useSettings();
  const run = useAction();
  const { toast } = useFeedback();
  const ui = useUI();
  const houses = useLiveQuery(() => db.houses.toArray(), []) ?? [];
  const tags = useLiveQuery(() => db.tags.toArray(), []) ?? [];
  const [step, setStep] = useState(1);
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<string[][]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<(ImportField | '')[]>([]);
  const [defaultCountry, setDefaultCountry] = useState('');
  const [extraTag, setExtraTag] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<'all' | 'errors' | 'duplicates' | 'ok'>('all');
  const [done, setDone] = useState<{ created: Recipient[]; merged: number; skipped: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const headers = hasHeader ? table[0] ?? [] : (table[0] ?? []).map((_, i) => `Column ${i + 1}`);
  const body = hasHeader ? table.slice(1) : table;

  const onFile = async (f: File) => {
    try {
      let tbl: string[][] = [];
      if (/\.xlsx$/i.test(f.name)) tbl = readXlsx(await readFileAsArrayBuffer(f))[0]?.rows ?? [];
      else if (/\.json$/i.test(f.name)) {
        const data = JSON.parse(await readFileAsText(f));
        const arr: Record<string, unknown>[] = Array.isArray(data) ? data : data.recipients ?? [];
        const keys = Array.from(new Set(arr.flatMap((o) => Object.keys(o))));
        tbl = [keys, ...arr.map((o) => keys.map((k) => (o[k] === undefined || o[k] === null ? '' : String(o[k]))))];
      } else tbl = parseCSV(await readFileAsText(f));
      if (tbl.length < 1) throw new Error(t('import.emptyFile'));
      setTable(tbl);
      setFileName(f.name);
      setMapping(autoMapHeaders(tbl[0]));
      setStep(2);
    } catch (e) {
      toast(`${t('import.readError')}: ${(e as Error).message}`, 'error');
    }
  };

  const validate = async () => {
    setBusy(true);
    const existing = await db.recipients.toArray();
    const drafts = body.map((r, i) => rowToDraft(r, mapping, i + (hasHeader ? 2 : 1), { houses, defaultCountry: defaultCountry || undefined, storeFullDob: settings.privacy.storeFullDob, collectGender: settings.privacy.collectGender }));
    const seen = new Map<string, number>();
    const out: Row[] = drafts.map((d, i) => {
      const matches = findMatchesFor(d.recipient as Recipient, existing).map((m) => ({ record: m.record, score: m.score }));
      const key = `${latinize(d.recipient.firstName)}|${latinize(d.recipient.lastName)}|${d.recipient.dob ?? d.recipient.birthday ?? ''}|${d.recipient.addresses[0]?.postalCode ?? ''}`;
      const prev = seen.get(key);
      if (prev === undefined) seen.set(key, i);
      const err = hasErrors(d.issues.filter((x) => x.field === 'firstName' || x.field === 'lastName' || x.code === 'invalid_country'));
      return {
        draft: d,
        matches,
        inFileDup: prev !== undefined ? drafts[prev].rowIndex : undefined,
        action: err || prev !== undefined || (matches[0]?.score ?? 0) >= 85 ? 'skip' : 'import',
        mergeInto: matches[0]?.record.id,
      };
    });
    setRows(out);
    setBusy(false);
    setStep(3);
  };

  const counts = useMemo(
    () => ({
      total: rows.length,
      errors: rows.filter((r) => hasErrors(r.draft.issues)).length,
      warnings: rows.filter((r) => !hasErrors(r.draft.issues) && r.draft.issues.length).length,
      duplicates: rows.filter((r) => r.matches.length || r.inFileDup).length,
      import: rows.filter((r) => r.action === 'import').length,
      merge: rows.filter((r) => r.action === 'merge').length,
      skip: rows.filter((r) => r.action === 'skip').length,
    }),
    [rows],
  );

  const doImport = async () => {
    setBusy(true);
    const res = await run(async () => {
      const toCreate = rows.filter((r) => r.action === 'import').map((r) => ({ recipient: r.draft.recipient, tagNames: r.draft.tagNames }));
      const created = await importRecipients(toCreate, extraTag ? [extraTag] : []);
      let merged = 0;
      for (const r of rows.filter((x) => x.action === 'merge' && x.mergeInto)) {
        const target = await db.recipients.get(r.mergeInto!);
        if (!target) continue;
        const patch: Partial<Recipient> = {};
        const src = r.draft.recipient as unknown as Record<string, unknown>;
        for (const k of ['preferredName', 'dob', 'age', 'birthday', 'guardianName', 'guardianPhone', 'guardianEmail', 'houseId', 'schoolYear', 'favoriteSubject', 'favoriteColor', 'petName', 'owlName', 'favoriteCreature', 'interests', 'specialOccasion']) {
          const v = src[k];
          if (v !== undefined && v !== '' && (target as unknown as Record<string, unknown>)[k] !== v) (patch as Record<string, unknown>)[k] = v;
        }
        const a = r.draft.recipient.addresses[0];
        if (a?.line1 && !target.addresses.some((x) => latinize(x.line1) === latinize(a.line1) && x.postalCode === a.postalCode)) patch.addresses = [...target.addresses, { ...a, label: 'alternative' }];
        await updateRecipient(target.id, patch, `Merged import row into #${target.code}`);
        merged++;
      }
      return { created, merged, skipped: counts.skip };
    }, t('import.done'));
    setBusy(false);
    if (res) {
      setDone(res);
      setStep(4);
    }
  };

  const downloadTemplate = (fmt: 'csv' | 'xlsx') => {
    const sample = ['Alex', 'Smith', '', '2015-10-14', '12 Larkspur Lane', 'Flat 3', 'London', '', 'NW1 6XE', 'United Kingdom', 'Morgan Smith', 'morgan@example.com', '+44 7700 900123', houses[0]?.name ?? '', '1', 'Biscuit', 'Hazel', 'Astronomy', 'New Student'];
    if (fmt === 'csv') downloadBlob(new Blob([toCSV([IMPORT_TEMPLATE_HEADERS, sample])], { type: 'text/csv' }), 'recipients-template.csv');
    else downloadBlob(new Blob([writeXlsx([{ name: 'Recipients', rows: [IMPORT_TEMPLATE_HEADERS, sample] }]) as BlobPart]), 'recipients-template.xlsx');
  };

  const shown = rows.filter((r) =>
    filter === 'all' ? true : filter === 'errors' ? hasErrors(r.draft.issues) : filter === 'duplicates' ? r.matches.length || r.inFileDup : !r.draft.issues.length && !r.matches.length,
  );

  const steps = [t('import.step.upload'), t('import.step.map'), t('import.step.validate'), t('import.step.done')];

  return (
    <div>
      <PageHeader crumbs={[{ label: t('nav.recipients'), href: '#/recipients' }, { label: t('common.import') }]} title={t('import.title')} sub={t('import.sub')} />
      <div className="steps mb-16">
        {steps.map((s, i) => (
          <span key={s} className={`s ${step === i + 1 ? 'active' : step > i + 1 ? 'done' : ''}`}>
            <span className="n">{i + 1}</span>
            {s}
          </span>
        ))}
      </div>

      {step === 1 && (
        <div className="grid grid-2">
          <Card title={t('import.upload')}>
            <Dropzone accept=".csv,.tsv,.txt,.xlsx,.json" onFiles={(f) => onFile(f[0])} label={t('import.dropLabel')} />
            <div className="muted small mt-8">{t('import.formats')}</div>
          </Card>
          <Card title={t('import.template')}>
            <p className="muted">{t('import.templateHint')}</p>
            <div className="row">
              <button className="btn" onClick={() => downloadTemplate('csv')}>
                <Download /> CSV
              </button>
              <button className="btn" onClick={() => downloadTemplate('xlsx')}>
                <FileSpreadsheet /> XLSX
              </button>
            </div>
            <div className="muted tiny mt-16">{IMPORT_TEMPLATE_HEADERS.join(' · ')}</div>
          </Card>
        </div>
      )}

      {step === 2 && (
        <Card title={t('import.mapTitle', { file: fileName, count: body.length })}>
          <div className="row wrap mb-16 gap-16">
            <Toggle checked={hasHeader} onChange={setHasHeader} label={t('import.hasHeader')} />
            <Field label={t('import.defaultCountry')}>
              <CountrySelect value={defaultCountry} onChange={setDefaultCountry} />
            </Field>
            <Field label={t('import.addTag')}>
              <select className="select" value={extraTag} onChange={(e) => setExtraTag(e.target.value)}>
                <option value="">—</option>
                {tags.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>{t('import.column')}</th>
                  <th>{t('import.sample')}</th>
                  <th>{t('import.mapsTo')}</th>
                </tr>
              </thead>
              <tbody>
                {headers.map((h, i) => (
                  <tr key={i}>
                    <td>
                      <b>{h}</b>
                    </td>
                    <td className="muted small truncate" style={{ maxWidth: 260 }}>
                      {body.slice(0, 3).map((r) => r[i]).filter(Boolean).join(' · ')}
                    </td>
                    <td style={{ width: 260 }}>
                      <select className={`select sm ${mapping[i] ? '' : ''}`} value={mapping[i] ?? ''} onChange={(e) => setMapping(mapping.map((m, j) => (j === i ? (e.target.value as ImportField | '') : m)))}>
                        <option value="">— {t('import.ignore')}</option>
                        {IMPORT_FIELDS.map((f) => (
                          <option key={f} value={f} disabled={mapping.includes(f) && mapping[i] !== f}>
                            {t(`importfield.${f}`)}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!mapping.includes('firstName') && !mapping.includes('fullName') && <div className="issue warning mt-8">{t('import.needName')}</div>}
          <div className="row mt-16">
            <button className="btn" onClick={() => setStep(1)}>
              {t('common.back')}
            </button>
            <span className="grow" />
            <button className="btn primary" disabled={busy || (!mapping.includes('firstName') && !mapping.includes('fullName'))} onClick={validate}>
              {t('import.validate')}
            </button>
          </div>
        </Card>
      )}

      {step === 3 && (
        <div className="col gap-16">
          <div className="grid grid-4">
            <Card>
              <div className="muted small">{t('import.rows')}</div>
              <div style={{ fontSize: 24, fontWeight: 600 }}>{counts.total}</div>
            </Card>
            <Card>
              <div className="muted small">{t('import.withErrors')}</div>
              <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--danger)' }}>{counts.errors}</div>
            </Card>
            <Card>
              <div className="muted small">{t('import.possibleDuplicates')}</div>
              <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--warning)' }}>{counts.duplicates}</div>
            </Card>
            <Card>
              <div className="muted small">{t('import.willImport')}</div>
              <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--success)' }}>
                {counts.import} <span className="small muted">+ {counts.merge} {t('import.merge')}</span>
              </div>
            </Card>
          </div>
          <div className="row wrap">
            <div className="tabs pill">
              {(['all', 'errors', 'duplicates', 'ok'] as const).map((k) => (
                <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>
                  {t(`import.filter.${k}`)}
                </button>
              ))}
            </div>
            <span className="grow" />
            <button className="btn sm" onClick={() => setRows(rows.map((r) => (hasErrors(r.draft.issues) ? r : { ...r, action: r.matches.length || r.inFileDup ? r.action : 'import' })))}>
              {t('import.includeValid')}
            </button>
          </div>
          <div className="table-wrap" style={{ maxHeight: '55vh', overflow: 'auto' }}>
            <table className="table compact">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('field.name')}</th>
                  <th>{t('field.location')}</th>
                  <th>{t('import.checks')}</th>
                  <th>{t('import.duplicates')}</th>
                  <th>{t('import.action')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 500).map((r) => {
                  const idx = rows.indexOf(r);
                  const d = r.draft.recipient;
                  return (
                    <tr key={idx}>
                      <td className="muted">{r.draft.rowIndex}</td>
                      <td>
                        <b>
                          {d.firstName} {d.lastName}
                        </b>
                        <div className="muted tiny">{d.dob ?? d.birthday ?? ''}</div>
                      </td>
                      <td className="small">
                        {[d.addresses[0]?.line1, d.addresses[0]?.postalCode, d.addresses[0]?.city, d.addresses[0]?.country].filter(Boolean).join(', ')}
                      </td>
                      <td style={{ maxWidth: 320 }}>{r.draft.issues.length ? <IssueList issues={r.draft.issues} max={2} /> : <Badge tone="success">OK</Badge>}</td>
                      <td className="small">
                        {r.inFileDup && <Badge tone="warning">{t('import.dupInFile', { row: r.inFileDup })}</Badge>}
                        {r.matches.slice(0, 1).map((m) => (
                          <div key={m.record.id}>
                            <Badge tone="warning">{t('dup.score', { score: m.score })}</Badge>{' '}
                            <a href={`#/recipients/${m.record.id}`} target="_blank" rel="noreferrer">
                              {m.record.firstName} {m.record.lastName} #{m.record.code}
                            </a>
                          </div>
                        ))}
                      </td>
                      <td style={{ width: 150 }}>
                        <select className="select sm" value={r.action} onChange={(e) => setRows(rows.map((x, j) => (j === idx ? { ...x, action: e.target.value as Action } : x)))}>
                          <option value="import" disabled={hasErrors(r.draft.issues.filter((x) => x.field === 'firstName' || x.field === 'lastName'))}>
                            {t('import.act.import')}
                          </option>
                          <option value="skip">{t('import.act.skip')}</option>
                          {r.matches.length > 0 && <option value="merge">{t('import.act.merge')}</option>}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="row">
            <button className="btn" onClick={() => setStep(2)}>
              {t('common.back')}
            </button>
            <span className="grow" />
            <span className="muted small">{t('import.summary', { import: counts.import, merge: counts.merge, skip: counts.skip })}</span>
            <button className="btn primary" disabled={busy || counts.import + counts.merge === 0} onClick={doImport}>
              <Upload /> {t('import.confirm', { count: counts.import + counts.merge })}
            </button>
          </div>
          {busy && <Progress value={50} />}
        </div>
      )}

      {step === 4 && done && (
        <Card>
          <div className="empty">
            <CheckCircle2 />
            <h3>{t('import.doneTitle')}</h3>
            <p>{t('import.doneBody', { created: done.created.length, merged: done.merged, skipped: done.skipped })}</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <a className="btn" href="#/recipients">
                {t('nav.recipients')}
              </a>
              {done.created.length > 0 && (
                <button className="btn accent" onClick={() => ui.openBulkWizard(done.created.map((r) => r.id))}>
                  {t('bulk.generateFor', { count: done.created.length })}
                </button>
              )}
              <button className="btn ghost" onClick={() => (setStep(1), setRows([]), setDone(null))}>
                {t('import.another')}
              </button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
