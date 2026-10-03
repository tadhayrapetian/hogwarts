import { useLiveQuery } from 'dexie-react-hooks';
import { Contact, Heart, Home, Lock, Mail, User } from 'lucide-react';
import { useMemo, useState } from 'react';
import { COUNTRY_CODES, countryName, postalExample } from '../../core/countries';
import { findMatchesFor } from '../../core/duplicates';
import { CONTACT_METHODS, RECIPIENT_STATUSES, type Address, type Recipient } from '../../core/types';
import { ageFromDob, clone } from '../../core/util';
import { hasErrors, validateRecipient, type Issue } from '../../core/validation';
import { db } from '../../db/db';
import { createRecipient, emptyAddress, newRecipientDraft, saveCustomer, updateRecipient } from '../../db/services';
import { useAction, useFeedback } from '../../app/feedback';
import { navigate } from '../../app/router';
import { useSession } from '../../app/session';
import { useSettings } from '../../app/data';
import { useI18n } from '../../i18n';
import { Field, Modal, NumberInput, Section, TagPill } from '../../ui/kit';

type Draft = Omit<Recipient, 'id' | 'code' | 'createdAt' | 'updatedAt' | 'createdBy'> & { id?: string };

export function CountrySelect({ value, onChange, invalid }: { value: string; onChange: (v: string) => void; invalid?: boolean }) {
  const { t, lang } = useI18n();
  const options = useMemo(() => COUNTRY_CODES.map((c) => ({ c, n: countryName(c, lang) })).sort((a, b) => a.n.localeCompare(b.n, lang)), [lang]);
  return (
    <select className={`select ${invalid ? 'invalid' : ''}`} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— {t('common.select')}</option>
      {options.map((o) => (
        <option key={o.c} value={o.c}>
          {o.n}
        </option>
      ))}
    </select>
  );
}

export function AddressFields({ addr, onChange, issues, prefix = 'address' }: { addr: Address; onChange: (a: Address) => void; issues: Issue[]; prefix?: string }) {
  const { t } = useI18n();
  const err = (f: string) => {
    const i = issues.find((x) => x.field === `${prefix}.${f}`);
    return i ? t(`val.${i.code}`, { ...(i.params ?? {}), field: '' }) : undefined;
  };
  const set = (p: Partial<Address>) => onChange({ ...addr, ...p });
  return (
    <div className="form-grid">
      <Field label={t('field.country')} required error={err('country')}>
        <CountrySelect value={addr.country} onChange={(v) => set({ country: v })} invalid={!!err('country')} />
      </Field>
      <Field label={t('field.region')}>
        <input className="input" value={addr.region} onChange={(e) => set({ region: e.target.value })} />
      </Field>
      <Field label={t('field.city')} required error={err('city')}>
        <input className={`input ${err('city') ? 'invalid' : ''}`} value={addr.city} onChange={(e) => set({ city: e.target.value })} />
      </Field>
      <Field label={t('field.postalCode')} required error={err('postalCode')} hint={postalExample(addr.country) ? `${t('common.example')}: ${postalExample(addr.country)}` : undefined}>
        <input className={`input ${err('postalCode') ? 'invalid' : ''}`} value={addr.postalCode} onChange={(e) => set({ postalCode: e.target.value })} />
      </Field>
      <Field label={t('field.address')} required error={err('line1')} className="full">
        <input className={`input ${err('line1') ? 'invalid' : ''}`} value={addr.line1} onChange={(e) => set({ line1: e.target.value })} placeholder={t('field.addressPlaceholder')} />
      </Field>
      <Field label={t('field.apartment')}>
        <input className="input" value={addr.line2} onChange={(e) => set({ line2: e.target.value })} />
      </Field>
      <Field label={t('field.addressExtra')}>
        <input className="input" value={addr.extra} onChange={(e) => set({ extra: e.target.value })} />
      </Field>
    </div>
  );
}

export function RecipientForm({ recipient, onClose, onSaved, stay }: { recipient?: Recipient; onClose: () => void; onSaved?: (r: Recipient) => void; stay?: boolean }) {
  const { t, tEnum } = useI18n();
  const settings = useSettings();
  const { can } = useSession();
  const run = useAction();
  const { confirm } = useFeedback();
  const houses = useLiveQuery(() => db.houses.toArray(), []) ?? [];
  const characters = useLiveQuery(() => db.characters.toArray(), []) ?? [];
  const tags = useLiveQuery(() => db.tags.toArray(), []) ?? [];
  const customers = useLiveQuery(() => db.customers.orderBy('name').toArray(), []) ?? [];
  const [d, setD] = useState<Draft>(() => (recipient ? clone(recipient) : newRecipientDraft()));
  const [touched, setTouched] = useState(false);
  const canContact = can('recipients.contact');
  const homeIdx = Math.max(0, d.addresses.findIndex((a) => a.id === d.defaultAddressId));
  const home = d.addresses[homeIdx] ?? emptyAddress();
  const issues = useMemo(() => validateRecipient(d), [d]);
  const err = (f: string) => {
    if (!touched) return undefined;
    const i = issues.find((x) => x.field === f && x.level === 'error');
    return i ? t(`val.${i.code}`, { ...(i.params ?? {}), field: '' }) : undefined;
  };
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const setHome = (a: Address) => {
    const addresses = [...d.addresses];
    if (!addresses.length) {
      addresses.push(a);
      set({ addresses, defaultAddressId: a.id });
    } else {
      addresses[homeIdx] = a;
      set({ addresses });
    }
  };
  const age = ageFromDob(d.dob) ?? d.age;

  const save = async () => {
    setTouched(true);
    if (hasErrors(issues.filter((i) => !i.field?.startsWith('address')))) return;
    if (issues.some((i) => i.field?.startsWith('address') && i.level === 'error' && i.code === 'postal_invalid')) {
      const ok = await confirm({ title: t('recipient.addressWarnTitle'), body: t('recipient.addressWarnBody'), confirm: t('common.saveAnyway') });
      if (!ok) return;
    }
    if (!recipient) {
      const all = await db.recipients.toArray();
      const matches = findMatchesFor(d as Recipient, all);
      if (matches.length) {
        const ok = await confirm({
          title: t('dup.possibleTitle'),
          body: (
            <div className="col">
              <span>{t('dup.possibleBody')}</span>
              {matches.slice(0, 5).map((m) => (
                <div key={m.record.id} className="card pad flat">
                  <b>
                    {m.record.firstName} {m.record.lastName}
                  </b>{' '}
                  · #{m.record.code} · {m.record.city} · {t('dup.score', { score: m.score })}
                </div>
              ))}
            </div>
          ),
          confirm: t('dup.createAnyway'),
        });
        if (!ok) return;
      }
    }
    const data = { ...d };
    if (!settings.privacy.storeFullDob && data.dob) {
      data.age = ageFromDob(data.dob);
      data.birthday = data.dob.slice(5);
      data.dob = undefined;
    }
    if (!settings.privacy.collectGender) data.gender = undefined;
    const saved = await run(async () => (recipient ? updateRecipient(recipient.id, data) : createRecipient(data)), recipient ? t('common.saved') : t('recipient.created'));
    if (saved) {
      onSaved?.(saved);
      onClose();
      if (!recipient && !stay) navigate(`/recipients/${saved.id}`);
    }
  };

  const createCustomerFromGuardian = async () => {
    if (!d.guardianName.trim()) return;
    const c = await run(() => saveCustomer({ name: d.guardianName, email: d.guardianEmail, phone: d.guardianPhone }), t('customer.created'));
    if (c) set({ customerId: c.id });
  };

  return (
    <Modal
      title={recipient ? t('recipient.edit', { name: `${recipient.firstName} ${recipient.lastName}` }) : t('recipient.new')}
      sub={recipient ? `#${recipient.code}` : t('recipient.newSub')}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <div className="left muted small">{touched && issues.length > 0 && t('recipient.issuesCount', { count: issues.length })}</div>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" onClick={save}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <Section icon={<User />} title={t('recipient.sec.personal')}>
        <div className="form-grid cols-3">
          <Field label={t('field.firstName')} required error={err('firstName')}>
            <input className={`input ${err('firstName') ? 'invalid' : ''}`} value={d.firstName} onChange={(e) => set({ firstName: e.target.value })} autoFocus />
          </Field>
          <Field label={t('field.lastName')} required error={err('lastName')}>
            <input className={`input ${err('lastName') ? 'invalid' : ''}`} value={d.lastName} onChange={(e) => set({ lastName: e.target.value })} />
          </Field>
          <Field label={t('field.preferredName')}>
            <input className="input" value={d.preferredName} onChange={(e) => set({ preferredName: e.target.value })} />
          </Field>
          {settings.privacy.storeFullDob && canContact ? (
            <Field label={t('field.dob')} error={err('dob')} hint={age !== undefined ? t('recipient.ageIs', { age }) : undefined}>
              <input className="input" type="date" value={d.dob ?? ''} max={new Date().toISOString().slice(0, 10)} onChange={(e) => set({ dob: e.target.value || undefined, birthday: e.target.value ? e.target.value.slice(5) : d.birthday })} />
            </Field>
          ) : (
            <Field label={t('field.age')} error={err('age')}>
              <NumberInput value={d.age} min={0} max={120} onChange={(v) => set({ age: v })} />
            </Field>
          )}
          {(!settings.privacy.storeFullDob || !d.dob) && (
            <Field label={t('field.birthday')} hint={t('field.birthdayHint')} error={err('birthday')}>
              <input className="input" placeholder="MM-DD" value={d.birthday ?? ''} onChange={(e) => set({ birthday: e.target.value || undefined })} />
            </Field>
          )}
          {settings.privacy.collectGender && (
            <Field label={t('field.gender')}>
              <input className="input" value={d.gender ?? ''} onChange={(e) => set({ gender: e.target.value })} />
            </Field>
          )}
        </div>
      </Section>
      <Section icon={<Home />} title={t('recipient.sec.address')}>
        <AddressFields addr={home} onChange={setHome} issues={touched ? issues : []} />
        {d.addresses.length > 1 && <div className="muted small mt-8">{t('recipient.moreAddresses', { count: d.addresses.length - 1 })}</div>}
      </Section>
      {canContact && (
        <Section icon={<Contact />} title={t('recipient.sec.contact')}>
          <div className="form-grid">
            <Field label={t('field.guardianName')}>
              <input className="input" value={d.guardianName} onChange={(e) => set({ guardianName: e.target.value })} />
            </Field>
            <Field label={t('field.preferredContact')}>
              <select className="select" value={d.preferredContact} onChange={(e) => set({ preferredContact: e.target.value as Recipient['preferredContact'] })}>
                {CONTACT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {tEnum('contact', m)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('field.guardianPhone')} error={err('guardianPhone')}>
              <input className={`input ${err('guardianPhone') ? 'invalid' : ''}`} type="tel" value={d.guardianPhone} onChange={(e) => set({ guardianPhone: e.target.value })} />
            </Field>
            <Field label={t('field.guardianEmail')} error={err('guardianEmail')}>
              <input className={`input ${err('guardianEmail') ? 'invalid' : ''}`} type="email" value={d.guardianEmail} onChange={(e) => set({ guardianEmail: e.target.value })} />
            </Field>
            <Field label={t('field.altContact')} className="full">
              <input className="input" value={d.altContact} onChange={(e) => set({ altContact: e.target.value })} />
            </Field>
          </div>
        </Section>
      )}
      <Section icon={<Mail />} title={t('recipient.sec.mail')}>
        <div className="form-grid">
          <Field label={t('field.deliveryInstructions')}>
            <textarea className="textarea" rows={2} value={d.deliveryInstructions} onChange={(e) => set({ deliveryInstructions: e.target.value })} />
          </Field>
          <Field label={t('field.mailingNotes')}>
            <textarea className="textarea" rows={2} value={d.mailingNotes} onChange={(e) => set({ mailingNotes: e.target.value })} />
          </Field>
        </div>
      </Section>
      <Section icon={<Heart />} title={t('recipient.sec.personalization')}>
        <div className="form-grid cols-3">
          <Field label={t('field.house')}>
            <select className="select" value={d.houseId ?? ''} onChange={(e) => set({ houseId: e.target.value || undefined })}>
              <option value="">—</option>
              {houses.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('field.schoolYear')}>
            <NumberInput value={d.schoolYear} min={1} max={12} onChange={(v) => set({ schoolYear: v })} />
          </Field>
          <Field label={t('field.character')}>
            <select className="select" value={d.characterId ?? ''} onChange={(e) => set({ characterId: e.target.value || undefined })}>
              <option value="">—</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('field.favoriteSubject')}>
            <input className="input" value={d.favoriteSubject} onChange={(e) => set({ favoriteSubject: e.target.value })} />
          </Field>
          <Field label={t('field.favoriteColor')}>
            <input className="input" value={d.favoriteColor} onChange={(e) => set({ favoriteColor: e.target.value })} />
          </Field>
          <Field label={t('field.favoriteCreature')}>
            <input className="input" value={d.favoriteCreature} onChange={(e) => set({ favoriteCreature: e.target.value })} />
          </Field>
          <Field label={t('field.petName')}>
            <input className="input" value={d.petName} onChange={(e) => set({ petName: e.target.value })} />
          </Field>
          <Field label={t('field.owlName')}>
            <input className="input" value={d.owlName} onChange={(e) => set({ owlName: e.target.value })} />
          </Field>
          <Field label={t('field.interests')}>
            <input className="input" value={d.interests} onChange={(e) => set({ interests: e.target.value })} />
          </Field>
          <Field label={t('field.specialOccasion')}>
            <input className="input" value={d.specialOccasion} onChange={(e) => set({ specialOccasion: e.target.value })} />
          </Field>
          <Field label={t('field.specialOccasionDate')}>
            <input className="input" type="date" value={d.specialOccasionDate ?? ''} onChange={(e) => set({ specialOccasionDate: e.target.value || undefined })} />
          </Field>
        </div>
      </Section>
      <Section icon={<Lock />} title={t('recipient.sec.internal')}>
        <div className="form-grid">
          <Field label={t('field.status')}>
            <select className="select" value={d.status} onChange={(e) => set({ status: e.target.value as Recipient['status'] })}>
              {RECIPIENT_STATUSES.filter((s) => s !== 'anonymized').map((s) => (
                <option key={s} value={s}>
                  {tEnum('recipient', s)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('field.customer')}>
            <div className="row">
              <select className="select" value={d.customerId ?? ''} onChange={(e) => set({ customerId: e.target.value || undefined })}>
                <option value="">—</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.code}
                  </option>
                ))}
              </select>
              {!d.customerId && canContact && d.guardianName.trim() && (
                <button type="button" className="btn sm" onClick={createCustomerFromGuardian} title={t('customer.fromGuardian')}>
                  +
                </button>
              )}
            </div>
          </Field>
          <Field label={t('field.tags')} className="full">
            <div className="row wrap">
              {d.tagIds.map((id) => {
                const tag = tags.find((x) => x.id === id);
                return tag ? <TagPill key={id} name={tag.name} color={tag.color} onRemove={() => set({ tagIds: d.tagIds.filter((x) => x !== id) })} /> : null;
              })}
              <select className="select sm" style={{ width: 180 }} value="" onChange={(e) => e.target.value && set({ tagIds: [...d.tagIds, e.target.value] })}>
                <option value="">+ {t('tag.add')}</option>
                {tags
                  .filter((x) => !d.tagIds.includes(x.id))
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
            </div>
          </Field>
          <Field label={t('field.internalNotes')} className="full" hint={t('recipient.minimizationHint')}>
            <textarea className="textarea" rows={2} value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </div>
      </Section>
    </Modal>
  );
}
