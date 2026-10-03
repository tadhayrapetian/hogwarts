import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, MapPin, Pencil, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { countryName } from '../core/countries';
import { ADDRESS_LABELS, type Address, type Recipient } from '../core/types';
import { normalizeText } from '../core/util';
import { validateAddress } from '../core/validation';
import { db } from '../db/db';
import { updateRecipient } from '../db/services';
import { useAction } from '../app/feedback';
import { navigate } from '../app/router';
import { useSession } from '../app/session';
import { useI18n } from '../i18n';
import { Badge, DataTable, EmptyState, Field, PageHeader, SearchInput } from '../ui/kit';
import { AddressModal } from './recipients/RecipientProfile';
import { ExportMenu } from './shared/ExportMenu';

interface Row {
  key: string;
  r: Recipient;
  a: Address;
  isDefault: boolean;
  issues: number;
}

export function AddressBook() {
  const { t, tEnum, lang } = useI18n();
  const { can } = useSession();
  const run = useAction();
  const recipients = useLiveQuery(() => db.recipients.toArray(), []);
  const [q, setQ] = useState('');
  const [label, setLabel] = useState('');
  const [country, setCountry] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const rows = useMemo<Row[]>(() => {
    if (!recipients) return [];
    const n = normalizeText(q);
    return recipients
      .filter((r) => r.status !== 'anonymized')
      .flatMap((r) => r.addresses.map((a) => ({ key: `${r.id}:${a.id}`, r, a, isDefault: a.id === r.defaultAddressId, issues: validateAddress(a).length })))
      .filter((x) => !label || x.a.label === label)
      .filter((x) => !country || x.a.country === country)
      .filter((x) => !onlyIssues || x.issues > 0)
      .filter((x) => !n || normalizeText(`${x.r.firstName} ${x.r.lastName} ${x.r.code} ${x.a.name} ${x.a.line1} ${x.a.line2} ${x.a.city} ${x.a.postalCode} ${x.a.region} ${countryName(x.a.country, lang)}`).includes(n));
  }, [recipients, q, label, country, onlyIssues, lang]);
  if (!recipients) return null;
  const countries = Array.from(new Set(recipients.flatMap((r) => r.addresses.map((a) => a.country)).filter(Boolean))).sort();
  return (
    <div>
      <PageHeader
        eyebrow={t('navgroup.crm')}
        title={t('nav.addresses')}
        sub={t('address.bookSub', { count: rows.length })}
        actions={
          <ExportMenu
            name={t('nav.addresses')}
            build={() => ({
              head: [t('field.id'), t('field.name'), t('address.label'), t('address.addressee'), t('field.address'), t('field.apartment'), t('field.city'), t('field.region'), t('field.postalCode'), t('field.country'), t('address.default')],
              rows: rows.map((x) => [x.r.code, `${x.r.firstName} ${x.r.lastName}`, tEnum('addressLabel', x.a.label), x.a.name, x.a.line1, x.a.line2, x.a.city, x.a.region, x.a.postalCode, countryName(x.a.country, lang), x.isDefault ? '✓' : '']),
            })}
          />
        }
      />
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder={t('address.search')} />
        <Field>
          <select className="select" value={label} onChange={(e) => setLabel(e.target.value)} aria-label={t('address.label')}>
            <option value="">{t('address.allLabels')}</option>
            {ADDRESS_LABELS.map((l) => (
              <option key={l} value={l}>
                {tEnum('addressLabel', l)}
              </option>
            ))}
          </select>
        </Field>
        <select className="select" style={{ width: 200 }} value={country} onChange={(e) => setCountry(e.target.value)} aria-label={t('field.country')}>
          <option value="">{t('common.allCountries')}</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {countryName(c, lang)}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> {t('address.onlyIssues')}
        </label>
      </div>
      <DataTable
        rows={rows}
        rowKey={(x) => x.key}
        onRowClick={(x) => navigate(`/recipients/${x.r.id}?tab=addresses`)}
        columns={[
          { key: 'who', header: t('nav.recipients'), render: (x) => <b>{x.r.firstName} {x.r.lastName}</b>, sort: (x) => `${x.r.lastName} ${x.r.firstName}` },
          {
            key: 'label',
            header: t('address.label'),
            render: (x) => (
              <Badge tone={x.isDefault ? 'accent' : 'neutral'}>
                {x.isDefault && <Star />}
                {tEnum('addressLabel', x.a.label)}
              </Badge>
            ),
            sort: (x) => x.a.label,
          },
          { key: 'addr', header: t('field.address'), render: (x) => <span>{[x.a.name, x.a.line1, x.a.line2].filter(Boolean).join(', ') || <span className="muted">—</span>}</span> },
          { key: 'city', header: t('field.city'), render: (x) => x.a.city, sort: (x) => x.a.city },
          { key: 'postal', header: t('field.postalCode'), render: (x) => <span className="mono">{x.a.postalCode}</span> },
          { key: 'country', header: t('field.country'), render: (x) => countryName(x.a.country, lang), sort: (x) => x.a.country },
          {
            key: 'ok',
            header: t('field.status'),
            render: (x) => (x.issues ? <Badge tone="warning">{t('address.issues', { count: x.issues })}</Badge> : <Badge tone="success"><CheckCircle2 /> OK</Badge>),
            sort: (x) => x.issues,
          },
          {
            key: 'act',
            header: '',
            className: 'actions-cell',
            render: (x) =>
              can('recipients.edit') ? (
                <button className="btn icon xs ghost" onClick={(e) => (e.stopPropagation(), setEditing(x))} aria-label={t('common.edit')}>
                  <Pencil />
                </button>
              ) : null,
          },
        ]}
        empty={<EmptyState icon={<MapPin />} title={t('common.noResults')} />}
      />
      {editing && (
        <AddressModal
          address={editing.a}
          onClose={() => setEditing(null)}
          onSave={(a) => {
            run(() => updateRecipient(editing.r.id, { addresses: editing.r.addresses.map((x) => (x.id === a.id ? a : x)) }, `Changed address of #${editing.r.code}`), t('common.saved'));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
