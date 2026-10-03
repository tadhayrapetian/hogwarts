import { useLiveQuery } from 'dexie-react-hooks';
import {
  Activity as ActivityIcon,
  Cake,
  CalendarClock,
  Check,
  FileText,
  FolderKanban,
  History,
  Home,
  Mail,
  MapPin,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  ShoppingBag,
  Star,
  StickyNote,
  Trash2,
  User,
  UserX,
  Wand2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { countryName, formatAddressLines } from '../../core/countries';
import { ADDRESS_LABELS, TASK_TYPES, type Address, type GeneratedDoc, type Project, type Recipient, type Task } from '../../core/types';
import { addDays, ageFromDob, daysUntilBirthday, toISODate } from '../../core/util';
import { validateAddress } from '../../core/validation';
import { db } from '../../db/db';
import { addNote, anonymizeRecipient, deleteNote, deleteRecipient, emptyAddress, saveTask, toggleTask, updateNote, updateRecipient } from '../../db/services';
import { useFmt, useProjectCtx } from '../../app/data';
import { useAction, useFeedback } from '../../app/feedback';
import { navigate, setQuery, useRoute } from '../../app/router';
import { useSession } from '../../app/session';
import { useUI } from '../../app/ui';
import { useI18n } from '../../i18n';
import { CrestView, HouseChip, LayoutView } from '../../ui/art';
import { Badge, Card, DataTable, EmptyState, Field, IssueList, Modal, StatusBadge, Stat, TagPill, Tabs, Toggle } from '../../ui/kit';
import { FilesPanel } from '../shared/FilesPanel';
import { AddressFields, RecipientForm } from './RecipientForm';

function OptionToggle({ label, onChange }: { label: string; onChange: (v: boolean) => void }) {
  const [v, setV] = useState(false);
  return <Toggle checked={v} onChange={(x) => (setV(x), onChange(x))} label={label} />;
}

export function AddressModal({ address, onSave, onClose }: { address: Address; onSave: (a: Address) => void; onClose: () => void }) {
  const { t, tEnum } = useI18n();
  const [a, setA] = useState(address);
  const issues = validateAddress(a);
  return (
    <Modal
      title={t('address.edit')}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" onClick={() => onSave(a)}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="form-grid mb-16">
        <Field label={t('address.label')}>
          <select className="select" value={a.label} onChange={(e) => setA({ ...a, label: e.target.value as Address['label'] })}>
            {ADDRESS_LABELS.map((l) => (
              <option key={l} value={l}>
                {tEnum('addressLabel', l)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('address.addressee')} hint={t('address.addresseeHint')}>
          <input className="input" value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} />
        </Field>
      </div>
      <AddressFields addr={a} onChange={setA} issues={issues} />
      <Field label={t('field.notes')} className="mt-16">
        <textarea className="textarea" rows={2} value={a.notes} onChange={(e) => setA({ ...a, notes: e.target.value })} />
      </Field>
    </Modal>
  );
}

export function AddressBookPanel({ recipient }: { recipient: Recipient }) {
  const { t, tEnum, lang } = useI18n();
  const { can } = useSession();
  const run = useAction();
  const { confirm } = useFeedback();
  const [editing, setEditing] = useState<Address | null>(null);
  const save = (a: Address) => {
    const exists = recipient.addresses.some((x) => x.id === a.id);
    const addresses = exists ? recipient.addresses.map((x) => (x.id === a.id ? a : x)) : [...recipient.addresses, a];
    run(() => updateRecipient(recipient.id, { addresses }, `Changed address of #${recipient.code}`), t('common.saved'));
    setEditing(null);
  };
  return (
    <div>
      <div className="row between mb-16">
        <div className="muted">{t('address.intro')}</div>
        {can('recipients.edit') && (
          <button className="btn primary sm" onClick={() => setEditing(emptyAddress('home', recipient.country))}>
            <Plus /> {t('address.add')}
          </button>
        )}
      </div>
      <div className="grid grid-3">
        {recipient.addresses.map((a) => {
          const isDefault = a.id === recipient.defaultAddressId;
          const issues = validateAddress(a);
          return (
            <Card key={a.id} className={isDefault ? 'paper' : ''}>
              <div className="row between">
                <Badge tone={isDefault ? 'accent' : 'neutral'}>
                  {isDefault && <Star />} {tEnum('addressLabel', a.label)}
                </Badge>
                {can('recipients.edit') && (
                  <div className="row gap-4">
                    {!isDefault && (
                      <button className="btn xs" onClick={() => run(() => updateRecipient(recipient.id, { defaultAddressId: a.id }, `Default mailing address of #${recipient.code} changed`), t('common.saved'))}>
                        {t('address.makeDefault')}
                      </button>
                    )}
                    <button className="btn icon xs ghost" onClick={() => setEditing(a)} aria-label={t('common.edit')}>
                      <Pencil />
                    </button>
                    {recipient.addresses.length > 1 && (
                      <button
                        className="btn icon xs ghost danger"
                        aria-label={t('common.delete')}
                        onClick={async () => {
                          if (await confirm({ title: t('address.deleteTitle'), danger: true, confirm: t('common.delete') }))
                            run(() => updateRecipient(recipient.id, { addresses: recipient.addresses.filter((x) => x.id !== a.id) }, `Removed an address of #${recipient.code}`), t('common.deleted'));
                        }}
                      >
                        <Trash2 />
                      </button>
                    )}
                  </div>
                )}
              </div>
              <pre style={{ fontFamily: 'var(--font-ui)', whiteSpace: 'pre-wrap', margin: '10px 0 0' }}>{formatAddressLines(a, `${recipient.firstName} ${recipient.lastName}`, lang).join('\n')}</pre>
              {a.notes && <div className="muted small mt-8">{a.notes}</div>}
              {issues.length > 0 && (
                <div className="mt-8">
                  <IssueList issues={issues} max={2} />
                </div>
              )}
            </Card>
          );
        })}
      </div>
      {editing && <AddressModal address={editing} onSave={save} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TaskModal({ recipientId, onClose }: { recipientId?: string; onClose: () => void }) {
  const { t, tEnum } = useI18n();
  const run = useAction();
  const [task, setTask] = useState<Partial<Task>>({ title: t('task.defaultTitle'), type: 'contact', dueDate: toISODate(addDays(new Date(), 7)), recipientId, notes: '' });
  return (
    <Modal
      title={t('task.schedule')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn primary"
            onClick={async () => {
              if (!task.title || !task.dueDate) return;
              await run(() => saveTask(task as Task), t('common.saved'));
              onClose();
            }}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={t('task.title')} className="full" required>
          <input className="input" value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} />
        </Field>
        <Field label={t('task.type')}>
          <select className="select" value={task.type} onChange={(e) => setTask({ ...task, type: e.target.value as Task['type'] })}>
            {TASK_TYPES.map((x) => (
              <option key={x} value={x}>
                {tEnum('task', x)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('task.due')} required>
          <input className="input" type="date" value={task.dueDate} onChange={(e) => setTask({ ...task, dueDate: e.target.value })} />
        </Field>
        <Field label={t('field.notes')} className="full">
          <textarea className="textarea" rows={2} value={task.notes} onChange={(e) => setTask({ ...task, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

export function TasksList({ tasks, showRecipient }: { tasks: Task[]; showRecipient?: boolean }) {
  const { t, tEnum } = useI18n();
  const fmt = useFmt();
  const today = toISODate(new Date());
  const recipients = useLiveQuery(() => (showRecipient ? db.recipients.bulkGet(tasks.map((x) => x.recipientId ?? '')) : Promise.resolve([])), [tasks, showRecipient]) ?? [];
  if (!tasks.length) return <div className="muted small">{t('task.none')}</div>;
  return (
    <div className="list">
      {tasks.map((task) => {
        const r = recipients.find((x) => x?.id === task.recipientId);
        const overdue = !task.done && task.dueDate < today;
        return (
          <div key={task.id} className="list-item">
            <button className={`btn icon xs ${task.done ? 'primary' : ''}`} onClick={() => toggleTask(task.id)} aria-label={t('task.toggle')}>
              {task.done && <Check />}
            </button>
            <div className="grow">
              <div style={{ textDecoration: task.done ? 'line-through' : undefined }}>{task.title}</div>
              <div className="muted tiny">
                {tEnum('task', task.type)}
                {r && (
                  <>
                    {' · '}
                    <a href={`#/recipients/${r.id}`}>
                      {r.firstName} {r.lastName}
                    </a>
                  </>
                )}
              </div>
            </div>
            <Badge tone={overdue ? 'danger' : task.dueDate === today ? 'warning' : 'neutral'}>{fmt.date(task.dueDate)}</Badge>
          </div>
        );
      })}
    </div>
  );
}

function ProjectEnvelopeCard({ project }: { project: Project }) {
  const ctx = useProjectCtx(project, `pe-${project.id.slice(0, 6)}`);
  const { t } = useI18n();
  if (!ctx) return null;
  return (
    <a className="thumb-card" href={`#/projects/${project.id}?tab=envelope`} style={{ textDecoration: 'none' }}>
      <div className="art">
        <LayoutView layout={project.envelope.front} ctx={ctx} width="100%" className="paper-shadow" />
      </div>
      <div className="title truncate">{project.name}</div>
      <div className="meta">
        {project.code} · {project.envelope.size} · <StatusBadge group="stage" value={project.stage} />
      </div>
      <span className="sr-only">{t('common.open')}</span>
    </a>
  );
}

function DocTextModal({ doc, onClose }: { doc: GeneratedDoc; onClose: () => void }) {
  const { t } = useI18n();
  const fmt = useFmt();
  return (
    <Modal title={doc.title} sub={`${doc.number} · ${fmt.dateTime(doc.createdAt)}`} onClose={onClose} size="lg" initialFocus={false}>
      <div className="muted small mb-8">{t('doc.frozenHint')}</div>
      <div className="card pad paper" style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-display)', fontSize: 17, lineHeight: 1.5 }}>
        {doc.text.replace(/\*\*/g, '').replace(/\*/g, '') || '—'}
      </div>
      <div className="row mt-16">
        <a className="btn" href={`#/projects/${doc.projectId}`}>
          {t('doc.openProject')}
        </a>
      </div>
    </Modal>
  );
}

export function RecipientProfile({ id }: { id: string }) {
  const { t, tEnum, lang } = useI18n();
  const fmt = useFmt();
  const route = useRoute();
  const { can } = useSession();
  const ui = useUI();
  const run = useAction();
  const { confirm, contextMenu } = useFeedback();
  const tab = route.query.get('tab') ?? 'overview';
  const [edit, setEdit] = useState(route.query.get('edit') === '1');
  const [taskModal, setTaskModal] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [docModal, setDocModal] = useState<GeneratedDoc | null>(null);
  const data = useLiveQuery(async () => {
    const r = await db.recipients.get(id);
    if (!r) return { r: null };
    const [house, customer, character, tags, orders, projects, documents, shipments, notes, tasks, activity, fileCount] = await Promise.all([
      r.houseId ? db.houses.get(r.houseId) : undefined,
      r.customerId ? db.customers.get(r.customerId) : undefined,
      r.characterId ? db.characters.get(r.characterId) : undefined,
      db.tags.toArray(),
      db.orders.where('recipientId').equals(id).reverse().sortBy('createdAt'),
      db.projects.where('recipientId').equals(id).reverse().sortBy('createdAt'),
      db.documents.where('recipientId').equals(id).reverse().sortBy('createdAt'),
      db.shipments.where('recipientId').equals(id).reverse().sortBy('createdAt'),
      db.notes.where('recipientId').equals(id).reverse().sortBy('createdAt'),
      db.tasks.where('recipientId').equals(id).sortBy('dueDate'),
      db.activity.where('recipientId').equals(id).reverse().sortBy('ts'),
      db.files.where('[ownerType+ownerId]').equals(['recipient', id]).count(),
    ]);
    return { r, house, customer, character, tags, orders, projects, documents, shipments, notes, tasks, activity, fileCount };
  }, [id]);

  const history = useMemo(() => {
    if (!data?.r) return [];
    const items = data.projects!.map((p) => {
      const sh = data.shipments!.filter((s) => s.projectId === p.id);
      return { at: p.createdAt, project: p, shipments: sh };
    });
    const orphan = data.shipments!.filter((s) => !s.projectId || !data.projects!.some((p) => p.id === s.projectId)).map((s) => ({ at: s.createdAt, project: undefined as Project | undefined, shipments: [s] }));
    return [...items, ...orphan].sort((a, b) => b.at.localeCompare(a.at));
  }, [data]);

  if (!data) return null;
  if (!data.r) return <EmptyState icon={<User />} title={t('recipient.notFound')} action={<a className="btn" href="#/recipients">{t('common.back')}</a>} />;
  const r = data.r;
  const { house, customer, character, tags = [], orders = [], projects = [], documents = [], shipments = [], notes = [], tasks = [], activity = [] } = data;
  const age = ageFromDob(r.dob) ?? r.age;
  const letters = documents.filter((d) => d.kind === 'letter' && d.status !== 'void');
  const docs = documents.filter((d) => d.kind === 'document' && d.status !== 'void');
  const sent = shipments.filter((s) => ['shipped', 'in_transit', 'out_for_delivery', 'delivered'].includes(s.status)).length;
  const nextTask = tasks.find((x) => !x.done);
  const bday = daysUntilBirthday(r.birthday);
  const addr = r.addresses.find((a) => a.id === r.defaultAddressId) ?? r.addresses[0];
  const canContact = can('recipients.contact');
  const anonymized = r.status === 'anonymized';

  const moreMenu = (e: React.MouseEvent) =>
    contextMenu(e, [
      { label: t('task.schedule'), icon: <CalendarClock />, onClick: () => setTaskModal(true) },
      ...(can('recipients.delete')
        ? [
            { divider: true, label: '' },
            {
              label: t('recipient.anonymize'),
              icon: <UserX />,
              danger: true,
              onClick: async () => {
                if (await confirm({ title: t('recipient.anonTitle'), body: t('recipient.anonBody'), danger: true, confirm: t('recipient.anonymize') })) run(() => anonymizeRecipient(r.id), t('recipient.anonymized'));
              },
            },
            {
              label: t('recipient.deleteAll'),
              icon: <Trash2 />,
              danger: true,
              onClick: async () => {
                let deleteOrders = false;
                const ok = await confirm({
                  title: t('recipient.deleteTitle', { name: `${r.firstName} ${r.lastName}` }),
                  body: (
                    <div className="col">
                      <span>{t('recipient.deleteBody')}</span>
                      <ul className="small">
                        <li>{t('recipient.deleteCounts', { projects: projects.length, docs: documents.length, shipments: shipments.length, notes: notes.length, files: data.fileCount ?? 0 })}</li>
                      </ul>
                      <OptionToggle onChange={(v) => (deleteOrders = v)} label={t('recipient.deleteOrdersToo', { count: orders.length })} />
                    </div>
                  ),
                  danger: true,
                  confirm: t('common.delete'),
                  typeToConfirm: r.code,
                });
                if (!ok) return;
                await run(() => deleteRecipient(r.id, { deleteOrders }), t('common.deleted'));
                navigate('/recipients');
              },
            },
          ]
        : []),
    ]);

  const tabs = [
    { key: 'overview', label: t('profile.tab.overview'), icon: <User /> },
    { key: 'letters', label: t('profile.tab.letters'), icon: <Mail />, count: letters.length },
    { key: 'orders', label: t('profile.tab.orders'), icon: <ShoppingBag />, count: orders.length },
    { key: 'history', label: t('profile.tab.history'), icon: <History />, count: history.length },
    { key: 'documents', label: t('profile.tab.documents'), icon: <FileText />, count: docs.length },
    { key: 'envelopes', label: t('profile.tab.envelopes'), icon: <Mail />, count: projects.length },
    { key: 'projects', label: t('profile.tab.projects'), icon: <FolderKanban />, count: projects.length },
    { key: 'addresses', label: t('profile.tab.addresses'), icon: <MapPin />, count: r.addresses.length },
    { key: 'notes', label: t('profile.tab.notes'), icon: <StickyNote />, count: notes.length },
    { key: 'activity', label: t('profile.tab.activity'), icon: <ActivityIcon /> },
    { key: 'files', label: t('profile.tab.files'), icon: <Paperclip />, count: data.fileCount },
  ];

  const kv = (pairs: [string, React.ReactNode][]) => (
    <dl className="kv">
      {pairs
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
    </dl>
  );

  return (
    <div>
      <div className="breadcrumb">
        <a href="#/recipients">{t('nav.recipients')}</a> › #{r.code}
      </div>
      <div className="profile-head">
        <div className="crest">{house ? <CrestView house={house} height={89} /> : <div className="avatar lg">{r.firstName.slice(0, 1)}</div>}</div>
        <div className="grow">
          <div className="code">
            {t('recipient.label')} #{r.code}
          </div>
          <h1>
            {r.firstName} {r.lastName}
            {r.preferredName && <span className="muted" style={{ fontSize: 20 }}> “{r.preferredName}”</span>}
          </h1>
          <div className="facts">
            {age !== undefined && (
              <span>
                <User /> {t('recipient.ageIs', { age })}
              </span>
            )}
            {(r.city || r.country) && (
              <span>
                <MapPin /> {[r.city, countryName(r.country, lang)].filter(Boolean).join(', ')}
              </span>
            )}
            {house && (
              <span>
                <HouseChip house={house} />
              </span>
            )}
            {bday !== undefined && (
              <span>
                <Cake /> {bday === 0 ? t('recipient.birthdayToday') : t('recipient.birthdayIn', { days: bday })}
              </span>
            )}
            <StatusBadge group="recipient" value={r.status} />
          </div>
          <div className="row wrap mt-8">
            {r.tagIds.map((tid) => {
              const tag = tags.find((x) => x.id === tid);
              return tag ? (
                <a key={tid} href={`#/recipients?tag=${tid}`}>
                  <TagPill name={tag.name} color={tag.color} />
                </a>
              ) : null;
            })}
          </div>
        </div>
        <div className="row wrap">
          {can('recipients.edit') && !anonymized && (
            <button className="btn" onClick={() => setEdit(true)}>
              <Pencil /> {t('common.edit')}
            </button>
          )}
          {can('orders.edit') && !anonymized && (
            <a className="btn" href={`#/orders?new=1&recipient=${r.id}`}>
              <ShoppingBag /> {t('order.new')}
            </a>
          )}
          {can('projects.edit') && !anonymized && (
            <button className="btn accent" onClick={() => ui.openPackageWizard({ recipientId: r.id })}>
              <Wand2 /> {t('package.create')}
            </button>
          )}
          <button className="btn icon" onClick={moreMenu} aria-label={t('common.more')}>
            <MoreHorizontal />
          </button>
        </div>
      </div>

      <div className="grid grid-4 mb-16">
        <Stat label={t('profile.lettersCreated')} value={letters.length} icon={<Mail />} />
        <Stat label={t('profile.lettersSent')} value={sent} icon={<Check />} />
        <Stat label={t('profile.lastLetter')} value={<span style={{ fontSize: 17 }}>{letters[0] ? fmt.date(letters[0].createdAt) : '—'}</span>} delta={letters[0]?.title} icon={<FileText />} />
        <Stat
          label={t('profile.nextContact')}
          value={<span style={{ fontSize: 17 }}>{nextTask ? fmt.date(nextTask.dueDate) : '—'}</span>}
          delta={nextTask ? nextTask.title : <button className="btn xs" onClick={() => setTaskModal(true)}>{t('task.schedule')}</button>}
          icon={<CalendarClock />}
        />
      </div>

      <Tabs tabs={tabs} value={tab} onChange={(k) => setQuery('tab', k === 'overview' ? null : k)} />

      {tab === 'overview' && (
        <div className="grid grid-3">
          <Card title={t('recipient.sec.personal')}>
            {kv([
              [t('field.firstName'), r.firstName],
              [t('field.lastName'), r.lastName],
              [t('field.preferredName'), r.preferredName],
              [t('field.dob'), canContact && r.dob ? fmt.date(r.dob) : undefined],
              [t('field.age'), age],
              [t('field.birthday'), r.birthday ? fmt.date(`2000-${r.birthday}`).replace(/\s?2000/, '') : undefined],
              [t('field.gender'), r.gender],
            ])}
          </Card>
          <Card title={t('recipient.sec.address')}>
            {addr ? <pre style={{ fontFamily: 'var(--font-ui)', whiteSpace: 'pre-wrap', margin: 0 }}>{formatAddressLines(addr, `${r.firstName} ${r.lastName}`, lang).join('\n')}</pre> : <span className="muted">—</span>}
            {addr && validateAddress(addr).length > 0 && (
              <div className="mt-8">
                <IssueList issues={validateAddress(addr)} />
              </div>
            )}
            <div className="mt-8">
              <a className="small" href={`#/recipients/${r.id}?tab=addresses`}>
                <Home size={13} /> {t('address.manage', { count: r.addresses.length })}
              </a>
            </div>
          </Card>
          <Card title={t('recipient.sec.contact')}>
            {canContact ? (
              kv([
                [t('field.guardianName'), r.guardianName],
                [t('field.guardianPhone'), r.guardianPhone && <a href={`tel:${r.guardianPhone}`}>{r.guardianPhone}</a>],
                [t('field.guardianEmail'), r.guardianEmail && <a href={`mailto:${r.guardianEmail}`}>{r.guardianEmail}</a>],
                [t('field.altContact'), r.altContact],
                [t('field.preferredContact'), tEnum('contact', r.preferredContact)],
                [t('field.customer'), customer && <a href={`#/customers/${customer.id}`}>{customer.name} · {customer.code}</a>],
              ])
            ) : (
              <div className="muted small">{t('privacy.masked')}</div>
            )}
          </Card>
          <Card title={t('recipient.sec.personalization')}>
            {kv([
              [t('field.house'), house?.name],
              [t('field.schoolYear'), r.schoolYear],
              [t('field.favoriteSubject'), r.favoriteSubject],
              [t('field.favoriteColor'), r.favoriteColor],
              [t('field.petName'), r.petName],
              [t('field.owlName'), r.owlName],
              [t('field.character'), character?.name],
              [t('field.favoriteCreature'), r.favoriteCreature],
              [t('field.interests'), r.interests],
              [t('field.specialOccasion'), r.specialOccasion && `${r.specialOccasion}${r.specialOccasionDate ? ` · ${fmt.date(r.specialOccasionDate)}` : ''}`],
            ])}
          </Card>
          <Card title={t('recipient.sec.mail')}>
            {kv([
              [t('field.deliveryInstructions'), r.deliveryInstructions],
              [t('field.mailingNotes'), r.mailingNotes],
            ]) }
            {!r.deliveryInstructions && !r.mailingNotes && <span className="muted small">—</span>}
          </Card>
          <Card title={t('recipient.sec.internal')}>
            {kv([
              [t('field.id'), `#${r.code}`],
              [t('field.customerId'), customer?.code],
              [t('field.dateAdded'), fmt.dateTime(r.createdAt)],
              [t('field.lastUpdated'), fmt.dateTime(r.updatedAt)],
              [t('field.createdBy'), r.createdBy],
              [t('field.lastContact'), fmt.date(r.lastContactAt)],
              [t('field.internalNotes'), r.notes],
            ])}
          </Card>
          <Card title={t('profile.recentMail')} className="span-2" actions={<a className="btn sm ghost" href={`#/recipients/${r.id}?tab=history`}>{t('common.viewAll')}</a>}>
            <MailHistory items={history.slice(0, 5)} />
          </Card>
          <Card title={t('profile.tasks')} actions={<button className="btn sm" onClick={() => setTaskModal(true)}><Plus /> {t('task.schedule')}</button>}>
            <TasksList tasks={tasks.filter((x) => !x.done).concat(tasks.filter((x) => x.done).slice(-3))} />
          </Card>
        </div>
      )}

      {tab === 'letters' && (
        <DataTable
          rows={letters}
          rowKey={(d) => d.id}
          onRowClick={setDocModal}
          columns={[
            { key: 'num', header: t('doc.number'), render: (d) => <span className="mono">{d.number}</span>, sort: (d) => d.number },
            { key: 'title', header: t('doc.title'), render: (d) => <b>{d.title}</b>, sort: (d) => d.title },
            { key: 'date', header: t('common.date'), render: (d) => fmt.date(d.createdAt), sort: (d) => d.createdAt },
            { key: 'status', header: t('field.status'), render: (d) => <StatusBadge group="doc" value={d.status} /> },
            { key: 'printed', header: t('doc.printedAt'), render: (d) => fmt.date(d.printedAt) || '—' },
            { key: 'proj', header: t('nav.projects'), render: (d) => <a href={`#/projects/${d.projectId}`} onClick={(e) => e.stopPropagation()}>{projects.find((p) => p.id === d.projectId)?.code}</a> },
          ]}
          empty={<EmptyState icon={<Mail />} title={t('profile.noLetters')} />}
        />
      )}

      {tab === 'documents' && (
        <DataTable
          rows={docs}
          rowKey={(d) => d.id}
          onRowClick={setDocModal}
          columns={[
            { key: 'num', header: t('doc.number'), render: (d) => <span className="mono">{d.number}</span> },
            { key: 'title', header: t('doc.title'), render: (d) => <b>{d.title}</b> },
            { key: 'type', header: t('doc.type'), render: (d) => (d.docType ? t(`doctype.${d.docType}`) : '—') },
            { key: 'date', header: t('common.date'), render: (d) => fmt.date(d.createdAt), sort: (d) => d.createdAt },
            { key: 'status', header: t('field.status'), render: (d) => <StatusBadge group="doc" value={d.status} /> },
          ]}
          empty={<EmptyState icon={<FileText />} title={t('profile.noDocuments')} />}
        />
      )}

      {tab === 'orders' && (
        <div>
          {can('orders.edit') && !anonymized && (
            <div className="row mb-16">
              <a className="btn primary sm" href={`#/orders?new=1&recipient=${r.id}`}>
                <Plus /> {t('order.new')}
              </a>
            </div>
          )}
          <DataTable
            rows={orders}
            rowKey={(o) => o.id}
            onRowClick={(o) => navigate(`/orders/${o.id}`)}
            columns={[
              { key: 'num', header: t('order.number'), render: (o) => <span className="mono">{o.number}</span>, sort: (o) => o.number },
              { key: 'date', header: t('common.date'), render: (o) => fmt.date(o.createdAt), sort: (o) => o.createdAt },
              { key: 'items', header: t('order.items'), render: (o) => o.items.map((i) => i.name).join(', ') },
              { key: 'total', header: t('order.total'), render: (o) => fmt.money(o.total, o.currency), sort: (o) => o.total, className: 'num right' },
              { key: 'status', header: t('field.status'), render: (o) => <StatusBadge group="order" value={o.status} /> },
              { key: 'pay', header: t('order.payment'), render: (o) => <StatusBadge group="payment" value={o.paymentStatus} /> },
            ]}
            empty={<EmptyState icon={<ShoppingBag />} title={t('profile.noOrders')} />}
          />
        </div>
      )}

      {tab === 'history' && (
        <Card>
          <MailHistory items={history} />
        </Card>
      )}

      {tab === 'envelopes' && (
        <div className="thumb-grid lg">
          {projects.map((p) => (
            <ProjectEnvelopeCard key={p.id} project={p} />
          ))}
          {!projects.length && <EmptyState icon={<Mail />} title={t('profile.noProjects')} />}
        </div>
      )}

      {tab === 'projects' && (
        <div>
          {can('projects.edit') && !anonymized && (
            <div className="row mb-16">
              <button className="btn primary sm" onClick={() => ui.openPackageWizard({ recipientId: r.id })}>
                <Wand2 /> {t('package.create')}
              </button>
            </div>
          )}
          <DataTable
            rows={projects}
            rowKey={(p) => p.id}
            onRowClick={(p) => navigate(`/projects/${p.id}`)}
            columns={[
              { key: 'code', header: t('project.code'), render: (p) => <span className="mono">{p.code}</span>, sort: (p) => p.code },
              { key: 'name', header: t('field.name'), render: (p) => <b>{p.name}</b>, sort: (p) => p.name },
              { key: 'stage', header: t('project.stage'), render: (p) => <StatusBadge group="stage" value={p.stage} />, sort: (p) => p.stage },
              { key: 'status', header: t('field.status'), render: (p) => (p.status === 'archived' ? <Badge>{t('common.archived')}</Badge> : null) },
              { key: 'date', header: t('common.created'), render: (p) => fmt.date(p.createdAt), sort: (p) => p.createdAt },
            ]}
            empty={<EmptyState icon={<FolderKanban />} title={t('profile.noProjects')} />}
          />
        </div>
      )}

      {tab === 'addresses' && <AddressBookPanel recipient={r} />}

      {tab === 'notes' && (
        <div className="grid grid-2">
          <Card title={t('note.add')}>
            <textarea className="textarea" rows={4} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder={t('note.placeholder')} />
            <div className="row mt-8">
              <span className="muted tiny grow">{t('recipient.minimizationHint')}</span>
              <button
                className="btn primary sm"
                disabled={!noteText.trim()}
                onClick={async () => {
                  await run(() => addNote(r.id, noteText.trim()), t('common.saved'));
                  setNoteText('');
                }}
              >
                {t('common.add')}
              </button>
            </div>
          </Card>
          <div className="col">
            {[...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned)).map((n) => (
              <div key={n.id} className={`card pad ${n.pinned ? 'paper' : ''}`}>
                <div style={{ whiteSpace: 'pre-wrap' }}>{n.text}</div>
                <div className="row mt-8">
                  <span className="muted tiny grow">
                    {n.createdBy} · {fmt.dateTime(n.createdAt)}
                  </span>
                  <button className={`btn icon xs ${n.pinned ? 'primary' : 'ghost'}`} onClick={() => updateNote(n.id, { pinned: !n.pinned })} title={t('note.pin')}>
                    <Pin />
                  </button>
                  <button
                    className="btn icon xs ghost danger"
                    title={t('common.delete')}
                    onClick={async () => {
                      if (await confirm({ title: t('note.deleteTitle'), danger: true, confirm: t('common.delete') })) run(() => deleteNote(n.id), t('common.deleted'));
                    }}
                  >
                    <Trash2 />
                  </button>
                </div>
              </div>
            ))}
            {!notes.length && <EmptyState icon={<StickyNote />} title={t('note.none')} />}
          </div>
        </div>
      )}

      {tab === 'activity' && (
        <Card>
          <div className="timeline">
            {activity.map((a) => (
              <div key={a.id} className="tl-item done">
                <div>
                  <b>{a.userName}</b> · {a.summary}
                </div>
                <div className="when">
                  {fmt.dateTime(a.ts)} · {tEnum('action', a.action)}
                  {a.fields?.length ? ` · ${a.fields.join(', ')}` : ''}
                </div>
              </div>
            ))}
            {!activity.length && <div className="muted">{t('activity.none')}</div>}
          </div>
        </Card>
      )}

      {tab === 'files' && <FilesPanel ownerType="recipient" ownerId={r.id} />}

      {edit && <RecipientForm recipient={r} onClose={() => (setEdit(false), setQuery('edit', null))} />}
      {taskModal && <TaskModal recipientId={r.id} onClose={() => setTaskModal(false)} />}
      {docModal && <DocTextModal doc={docModal} onClose={() => setDocModal(null)} />}
    </div>
  );
}

export function MailHistory({ items }: { items: { at: string; project?: Project; shipments: import('../../core/types').Shipment[] }[] }) {
  const { t } = useI18n();
  const fmt = useFmt();
  if (!items.length) return <div className="muted">{t('profile.noHistory')}</div>;
  return (
    <div className="timeline">
      {items.map((it, i) => {
        const s = it.shipments[0];
        const returned = s?.status === 'returned';
        return (
          <div key={i} className={`tl-item ${s?.status === 'delivered' ? 'done' : ''} ${returned ? 'danger' : ''}`}>
            <div className="when">{fmt.date(it.at)}</div>
            <div className="row wrap gap-4">
              {it.project ? (
                <a href={`#/projects/${it.project.id}`}>
                  <b>{it.project.name.split(' — ')[0]}</b>
                </a>
              ) : (
                <b>{s?.code}</b>
              )}
              {it.project && <StatusBadge group="stage" value={it.project.stage} />}
              {s && (
                <a href={`#/shipments?id=${s.id}`}>
                  <StatusBadge group="shipment" value={s.status} />
                </a>
              )}
              {s?.trackingNumber && <span className="mono muted small">{s.trackingNumber}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
