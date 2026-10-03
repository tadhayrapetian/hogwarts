import { useLiveQuery } from 'dexie-react-hooks';
import { Copy, Pencil, Plus, Shield, Trash2, Users } from 'lucide-react';
import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Character, House, Recipient, Seal } from '../core/types';
import { normalizeText, nowISO, uid } from '../core/util';
import { db } from '../db/db';
import { bulkUpdateRecipients, deleteRecord, saveRecord } from '../db/services';
import { useFmt, useSettings } from '../app/data';
import { useAction, useFeedback } from '../app/feedback';
import { useSession } from '../app/session';
import { useI18n } from '../i18n';
import { SYMBOLS, SymbolGlyph } from '../render/symbols';
import { CrestView, SchoolCrestView, SealView } from '../ui/art';
import { BarList, ChartCard } from '../ui/charts';
import { Badge, Card, ColorInput, Drawer, EmptyState, Field, Modal, PageHeader, Section } from '../ui/kit';
import { ExportMenu } from './shared/ExportMenu';

const HEX = /^#[0-9a-f]{6}$/i;
const PARCHMENT = { background: '#f1e6cc', backgroundImage: 'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.55), transparent 60%)', borderRadius: 12 };
const CREST_STYLES: House['crestStyle'][] = ['shield', 'round', 'banner'];
const COLOR_KEYS = ['primaryColor', 'secondaryColor', 'accentColor'] as const;
const COLOR_LABEL: Record<(typeof COLOR_KEYS)[number], string> = { primaryColor: 'house.primary', secondaryColor: 'house.secondary', accentColor: 'house.accent' };

const PALETTES: [string, string, string][] = [
  ['#7a1f1f', '#c9a227', '#f3e3c0'],
  ['#1f2f52', '#8f9db3', '#e4e9f1'],
  ['#23402a', '#9b7a3c', '#ecdba6'],
  ['#14505a', '#bfd9d3', '#f3ead2'],
  ['#7a2412', '#d98c1f', '#f6d38c'],
  ['#4a2545', '#c98b7a', '#f2dcd2'],
  ['#24316b', '#d9c27a', '#f5efdf'],
  ['#33393f', '#b26b3c', '#ead8c4'],
  ['#4a5a2a', '#c7b27a', '#f3ecd0'],
  ['#1a1a2a', '#6f8fb0', '#e8eef5'],
];

interface HouseData {
  houses: House[];
  seals: Seal[];
  recipients: Recipient[];
  characters: Character[];
}

const membersOf = (data: HouseData, id: string) => data.recipients.filter((r) => r.houseId === id && r.status !== 'anonymized');

// ───────────── Delete ─────────────

function DeleteHouseModal({ house, data, onClose, onDeleted }: { house: House; data: HouseData; onClose: () => void; onDeleted: () => void }) {
  const { t } = useI18n();
  const run = useAction();
  const [target, setTarget] = useState('');
  const members = data.recipients.filter((r) => r.houseId === house.id);
  const staff = data.characters.filter((c) => c.houseId === house.id);
  const others = data.houses.filter((h) => h.id !== house.id).sort((a, b) => a.name.localeCompare(b.name));
  const doDelete = async () => {
    const ok = await run(async () => {
      const next = target || undefined;
      if (members.length) await bulkUpdateRecipients(members.map((r) => r.id), () => ({ houseId: next }), 'House removed');
      for (const c of staff) await saveRecord('characters', { ...c, houseId: next });
      await deleteRecord('houses', house.id);
      return true;
    }, t('common.deleted'));
    if (ok) onDeleted();
  };
  return (
    <Modal
      title={t('house.deleteTitle', { name: house.name })}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn danger solid" onClick={doDelete}>
            <Trash2 /> {t('common.delete')}
          </button>
        </>
      }
    >
      <div className="row mb-16" style={{ alignItems: 'flex-start' }}>
        <CrestView house={house} height={90} />
        <p className="grow" style={{ marginTop: 0 }}>
          {t('house.deleteBody')}
        </p>
      </div>
      {members.length > 0 && <div className="issue warning mb-8">{t('house.deleteMembers', { count: members.length })}</div>}
      {staff.length > 0 && <div className="issue warning mb-8">{t('house.deleteStaff', { count: staff.length })}</div>}
      {(members.length > 0 || staff.length > 0) && (
        <Field label={t('house.moveTo')} hint={t('house.moveHint')}>
          <select className="select" value={target} onChange={(e) => setTarget(e.target.value)} autoFocus>
            <option value="">— {t('house.noHouse')}</option>
            {others.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </Field>
      )}
    </Modal>
  );
}

// ───────────── Editor ─────────────

function HouseEditor({
  initial,
  isNew,
  data,
  onClose,
  onSaveCopy,
  onDelete,
}: {
  initial: House;
  isNew: boolean;
  data: HouseData;
  onClose: () => void;
  onSaveCopy: (h: House) => void;
  onDelete: (h: House) => void;
}) {
  const { t } = useI18n();
  const { can } = useSession();
  const run = useAction();
  const { confirm } = useFeedback();
  const [h, setH] = useState<House>(initial);
  const set = (p: Partial<House>) => setH((x) => ({ ...x, ...p }));
  const editable = can('design.edit');
  const dirty = JSON.stringify(h) !== JSON.stringify(initial);
  const nameTaken = !!h.name.trim() && data.houses.some((o) => o.id !== h.id && normalizeText(o.name) === normalizeText(h.name));
  const nameErr = !h.name.trim() ? t('library.nameRequired') : nameTaken ? t('house.nameTaken') : undefined;
  const colorErr = (k: (typeof COLOR_KEYS)[number]) => (HEX.test(h[k]) ? undefined : t('house.colorInvalid'));
  const valid = !nameErr && COLOR_KEYS.every((k) => HEX.test(h[k]));
  const seals = [...data.seals].sort((a, b) => a.name.localeCompare(b.name));
  const seal = h.sealId ? data.seals.find((s) => s.id === h.sealId) : undefined;
  const members = isNew ? [] : membersOf(data, h.id).sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
  const staff = isNew ? [] : data.characters.filter((c) => c.houseId === h.id);
  const previewHouse: House = { ...h, name: h.name.trim() || t('house.newName'), primaryColor: HEX.test(h.primaryColor) ? h.primaryColor : initial.primaryColor, secondaryColor: HEX.test(h.secondaryColor) ? h.secondaryColor : initial.secondaryColor, accentColor: HEX.test(h.accentColor) ? h.accentColor : initial.accentColor };

  const close = async () => {
    if (dirty && editable && !(await confirm({ title: t('library.discardTitle'), body: t('library.discardBody'), confirm: t('library.discard'), danger: true }))) return;
    onClose();
  };
  const save = async () => {
    const saved = await run(() => saveRecord('houses', { ...h, name: h.name.trim(), motto: h.motto.trim(), description: h.description.trim() }), t('common.saved'));
    if (saved) onClose();
  };

  return (
    <Drawer
      wide
      title={isNew ? t('house.new') : h.name || t('house.edit')}
      sub={isNew ? t('house.newSub') : t('house.members', { count: members.length })}
      onClose={close}
      footer={
        <>
          {editable && !isNew && (
            <>
              <button className="btn danger" onClick={() => onDelete(initial)}>
                <Trash2 /> {t('common.delete')}
              </button>
              <button className="btn" disabled={!valid} onClick={() => onSaveCopy(h)}>
                <Copy /> {t('common.duplicate')}
              </button>
            </>
          )}
          <span className="grow" />
          <button className="btn" onClick={close}>
            {editable ? t('common.cancel') : t('common.close')}
          </button>
          {editable && (
            <button className="btn primary" disabled={!valid || (!dirty && !isNew)} onClick={save}>
              {t('common.save')}
            </button>
          )}
        </>
      }
    >
      {!editable && <div className="issue warning mb-16">{t('library.readOnly')}</div>}
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="col gap-16">
          <div style={{ ...PARCHMENT, minHeight: 280, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, gap: 10, color: '#3a2a1a' }}>
            <CrestView house={previewHouse} height={230} />
            {h.motto.trim() && <div style={{ fontStyle: 'italic', fontFamily: 'var(--font-display)', fontSize: 18, textAlign: 'center' }}>“{h.motto.trim()}”</div>}
          </div>
          <Field label={t('house.crestStyle')}>
            <div className="grid grid-3" style={{ gap: 8 }}>
              {CREST_STYLES.map((cs) => (
                <button
                  key={cs}
                  type="button"
                  className={`thumb-card ${h.crestStyle === cs ? 'selected' : ''}`}
                  aria-pressed={h.crestStyle === cs}
                  disabled={!editable}
                  onClick={() => set({ crestStyle: cs })}
                >
                  <div className="art" style={{ aspectRatio: '1 / 1' }}>
                    <CrestView house={{ ...previewHouse, crestStyle: cs }} height={78} showName={false} />
                  </div>
                  <div className="title center">{t(`house.style.${cs}`)}</div>
                </button>
              ))}
            </div>
          </Field>
          <Field
            label={t('house.seal')}
            hint={
              <a href="#/studio/seals">{t('house.manageSeals')}</a>
            }
          >
            <div className="row">
              <select className="select grow" value={h.sealId ?? ''} disabled={!editable} onChange={(e) => set({ sealId: e.target.value || undefined })}>
                <option value="">— {t('common.none')}</option>
                {seals.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {t(`sealtype.${s.type}`)}
                  </option>
                ))}
              </select>
              <div style={{ width: 64, height: 68, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                {seal ? <SealView seal={seal} size={60} /> : <span className="muted small">—</span>}
              </div>
            </div>
          </Field>
        </div>

        <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <Section title={t('house.secIdentity')}>
            <div className="form-grid">
              <Field label={t('field.name')} required error={nameErr} className="full">
                <input className="input" value={h.name} onChange={(e) => set({ name: e.target.value })} autoFocus={isNew} maxLength={40} />
              </Field>
              <Field label={t('house.motto')} className="full">
                <input className="input" value={h.motto} onChange={(e) => set({ motto: e.target.value })} maxLength={80} />
              </Field>
              <Field label={t('house.description')} className="full">
                <textarea className="textarea" rows={3} value={h.description} onChange={(e) => set({ description: e.target.value })} />
              </Field>
            </div>
          </Section>

          <Section title={t('el.symbol')}>
            <Field hint={t(`symbol.${h.symbol}`)}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(34px, 1fr))', gap: 4, maxHeight: 172, overflowY: 'auto', padding: 2 }}>
                {SYMBOLS.map((sy) => (
                  <button
                    key={sy.key}
                    type="button"
                    className={`btn icon sm ${h.symbol === sy.key ? 'primary' : 'ghost'}`}
                    title={t(`symbol.${sy.key}`)}
                    aria-label={t(`symbol.${sy.key}`)}
                    aria-pressed={h.symbol === sy.key}
                    onClick={() => set({ symbol: sy.key })}
                  >
                    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true">
                      <SymbolGlyph symbol={sy.key} x={0} y={0} size={24} color="currentColor" strokeWidth={2} />
                    </svg>
                  </button>
                ))}
              </div>
            </Field>
          </Section>

          <Section title={t('house.colors')}>
            <div className="form-grid">
              {COLOR_KEYS.map((k) => (
                <Field key={k} label={t(COLOR_LABEL[k])} error={colorErr(k)} className={k === 'accentColor' ? 'full' : ''}>
                  <ColorInput value={h[k]} onChange={(v) => set({ [k]: v } as Partial<House>)} />
                </Field>
              ))}
              <Field label={t('house.palettes')} className="full">
                <div className="row wrap gap-4">
                  {PALETTES.map(([p, s, a], i) => {
                    const on = p === h.primaryColor && s === h.secondaryColor && a === h.accentColor;
                    return (
                      <button
                        key={i}
                        type="button"
                        className={`btn sm ${on ? 'primary' : ''}`}
                        title={t('house.applyPalette')}
                        aria-label={`${t('house.applyPalette')} ${i + 1}`}
                        onClick={() => set({ primaryColor: p, secondaryColor: s, accentColor: a })}
                      >
                        {[p, s, a].map((c) => (
                          <span key={c} className="swatch" style={{ background: c }} />
                        ))}
                      </button>
                    );
                  })}
                </div>
              </Field>
            </div>
          </Section>
        </fieldset>
      </div>

      {!isNew && (
        <Section icon={<Users />} title={`${t('house.membersTitle')} · ${members.length}`}>
          {!members.length ? (
            <div className="muted small">{t('house.noMembers')}</div>
          ) : can('recipients.view') ? (
            <div className="list">
              {members.slice(0, 12).map((r) => (
                <a key={r.id} className="list-item" href={`#/recipients/${r.id}`}>
                  <b className="grow truncate">
                    {r.firstName} {r.lastName}
                  </b>
                  {r.schoolYear !== undefined && <span className="muted small">{t('field.schoolYear')} {r.schoolYear}</span>}
                  <span className="muted small mono">#{r.code}</span>
                </a>
              ))}
              <div className="list-item">
                {members.length > 12 && <span className="muted small">{t('house.moreMembers', { count: members.length - 12 })}</span>}
                <span className="grow" />
                <a className="small" href={`#/recipients?house=${h.id}`}>
                  {t('house.viewRecipients')}
                </a>
              </div>
            </div>
          ) : (
            <div className="muted small">{t('house.members', { count: members.length })}</div>
          )}
          {staff.length > 0 && (
            <div className="mt-16">
              <h4 className="mb-8">{t('house.staff')}</h4>
              <div className="row wrap gap-4">
                {staff.map((c) => (
                  <a key={c.id} className="tag" href="#/characters">
                    {c.name}
                    {c.title ? ` · ${c.title}` : ''}
                  </a>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}
    </Drawer>
  );
}

// ───────────── Page ─────────────

export function Houses() {
  const { t } = useI18n();
  const fmt = useFmt();
  const { can } = useSession();
  const run = useAction();
  const { contextMenu } = useFeedback();
  const settings = useSettings();
  const data = useLiveQuery(async (): Promise<HouseData> => {
    const [houses, seals, recipients, characters] = await Promise.all([db.houses.toArray(), db.seals.toArray(), db.recipients.toArray(), db.characters.toArray()]);
    return { houses, seals, recipients, characters };
  }, []);
  const [editing, setEditing] = useState<{ house: House; isNew: boolean } | null>(null);
  const [deleting, setDeleting] = useState<House | null>(null);
  if (!data) return null;

  const editable = can('design.edit');
  const houseIds = new Set(data.houses.map((h) => h.id));
  const counts = new Map<string, number>();
  let unsorted = 0;
  for (const r of data.recipients) {
    if (r.status === 'anonymized') continue;
    if (r.houseId && houseIds.has(r.houseId)) counts.set(r.houseId, (counts.get(r.houseId) ?? 0) + 1);
    else unsorted++;
  }
  const sorted = [...counts.values()].reduce((s, n) => s + n, 0);
  const list = [...data.houses].sort((a, b) => a.name.localeCompare(b.name));
  const sealOf = (h: House) => (h.sealId ? data.seals.find((s) => s.id === h.sealId) : undefined);
  const motto = (settings.company.motto ?? '').trim();
  const distribution = [...data.houses.map((h) => ({ key: h.id, label: h.name, value: counts.get(h.id) ?? 0 })), { key: 'none', label: t('house.noHouse'), value: unsorted }];
  const distRows = [...distribution].sort((a, b) => b.value - a.value);

  const blank = (): House => {
    const used = new Set(data.houses.map((h) => h.primaryColor.toLowerCase()));
    const [p, s, a] = PALETTES.find(([pp]) => !used.has(pp)) ?? PALETTES[0];
    const now = nowISO();
    return { id: uid(), name: '', symbol: 'star', primaryColor: p, secondaryColor: s, accentColor: a, motto: '', description: '', crestStyle: 'shield', createdAt: now, updatedAt: now };
  };
  const copyName = (name: string) => {
    let n = t('library.copyOf', { name });
    let i = 2;
    while (data.houses.some((h) => normalizeText(h.name) === normalizeText(n))) n = `${t('library.copyOf', { name })} ${i++}`;
    return n;
  };
  const saveCopy = async (h: House) => {
    const now = nowISO();
    const copy: House = { ...h, id: uid(), name: copyName(h.name.trim()), createdAt: now, updatedAt: now };
    return run(() => saveRecord('houses', copy), t('library.duplicated'));
  };
  const open = (h: House) => setEditing({ house: h, isNew: false });
  const createNew = () => setEditing({ house: blank(), isNew: true });
  const menu = (h: House) => [
    { label: editable ? t('common.edit') : t('common.open'), icon: <Pencil />, onClick: () => open(h) },
    ...(editable
      ? [
          { label: t('common.duplicate'), icon: <Copy />, onClick: () => void saveCopy(h) },
          { label: '', divider: true },
          { label: t('common.delete'), icon: <Trash2 />, danger: true, onClick: () => setDeleting(h) },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        eyebrow={t('navgroup.studio')}
        title={t('nav.houses')}
        sub={t('house.sub')}
        actions={
          <>
            <ExportMenu
              name={t('nav.houses')}
              build={() => ({
                head: [t('field.name'), t('el.symbol'), t('house.primary'), t('house.secondary'), t('house.accent'), t('house.motto'), t('house.crestStyle'), t('house.seal'), t('house.membersTitle')],
                rows: list.map((h) => [h.name, t(`symbol.${h.symbol}`), h.primaryColor, h.secondaryColor, h.accentColor, h.motto, t(`house.style.${h.crestStyle}`), sealOf(h)?.name ?? '', counts.get(h.id) ?? 0]),
              })}
            />
            {editable && (
              <button className="btn primary" onClick={createNew}>
                <Plus /> {t('house.new')}
              </button>
            )}
          </>
        }
      />

      <div className="grid grid-3 mb-16" style={{ alignItems: 'start' }}>
        <Card title={t('house.schoolCrest')} sub={settings.company.schoolName || undefined}>
          <div className="col gap-12" style={{ alignItems: 'center' }}>
            <div style={{ ...PARCHMENT, width: '100%', display: 'flex', justifyContent: 'center', padding: 16 }}>
              <SchoolCrestView houses={data.houses} motto={motto} height={200} />
            </div>
            {motto ? (
              <div className="center" style={{ fontStyle: 'italic', fontFamily: 'var(--font-display)', fontSize: 17 }}>
                “{motto}”
              </div>
            ) : (
              can('settings.edit') && (
                <a className="small" href="#/settings">
                  {t('house.setMotto')}
                </a>
              )
            )}
            {data.houses.length > 4 && (
              <div className="muted small center">
                {t('house.crestFirstFour', {
                  names: data.houses
                    .slice(0, 4)
                    .map((h) => h.name)
                    .join(', '),
                })}
              </div>
            )}
            <dl className="kv" style={{ width: '100%' }}>
              <dt>{t('nav.houses')}</dt>
              <dd className="num">{fmt.num(data.houses.length)}</dd>
              <dt>{t('house.sorted')}</dt>
              <dd className="num">{fmt.num(sorted)}</dd>
              <dt>{t('house.noHouse')}</dt>
              <dd className="num">{fmt.num(unsorted)}</dd>
            </dl>
          </div>
        </Card>
        <div className="span-2">
          <ChartCard title={t('house.distribution')} sub={t('house.distributionSub')} table={{ head: [t('field.house'), t('nav.recipients')], rows: distRows.map((x) => [x.label, x.value]) }}>
            {sorted + unsorted > 0 ? (
              <BarList
                items={distribution}
                max={distribution.length}
                colorIndex={1}
                format={(v) => fmt.num(v)}
                onClick={(key) => {
                  const h = data.houses.find((x) => x.id === key);
                  if (h) open(h);
                }}
              />
            ) : (
              <div className="empty">{t('house.noRecipients')}</div>
            )}
          </ChartCard>
        </div>
      </div>

      {list.length ? (
        <div className="grid grid-2">
          {list.map((h) => {
            const seal = sealOf(h);
            const count = counts.get(h.id) ?? 0;
            return (
              <div
                key={h.id}
                className="card"
                role="button"
                tabIndex={0}
                style={{ cursor: 'pointer', overflow: 'hidden' }}
                onClick={() => open(h)}
                onKeyDown={(e: ReactKeyboardEvent) => e.key === 'Enter' && e.target === e.currentTarget && open(h)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  contextMenu(e, menu(h));
                }}
              >
                <div style={{ height: 6, background: `linear-gradient(90deg, ${h.primaryColor}, ${h.secondaryColor}, ${h.accentColor})` }} />
                <div className="card-body row gap-16" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 'none', background: 'var(--surface-2)', borderRadius: 10, padding: 8 }}>
                    <CrestView house={h} height={150} />
                  </div>
                  <div className="col grow" style={{ minWidth: 0 }}>
                    <div className="row" style={{ alignItems: 'flex-start' }}>
                      <div className="grow">
                        <h2 className="truncate">{h.name}</h2>
                        {h.motto && <div style={{ fontStyle: 'italic' }}>“{h.motto}”</div>}
                      </div>
                      {seal && (
                        <span title={`${t('house.seal')}: ${seal.name}`} style={{ flex: 'none' }}>
                          <SealView seal={seal} size={48} />
                        </span>
                      )}
                    </div>
                    <div className="row wrap gap-12">
                      {COLOR_KEYS.map((k) => (
                        <span key={k} className="row gap-4" title={t(COLOR_LABEL[k])}>
                          <span className="swatch" style={{ background: h[k], width: 18, height: 18 }} />
                          <span className="mono tiny muted">{h[k]}</span>
                        </span>
                      ))}
                    </div>
                    {h.description && (
                      <p className="small" style={{ margin: 0 }}>
                        {h.description}
                      </p>
                    )}
                    <div className="row wrap" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <a className="small row gap-4" href={`#/recipients?house=${h.id}`} title={t('house.viewRecipients')}>
                        <Users size={14} /> {t('house.members', { count })}
                      </a>
                      <Badge>{t(`house.style.${h.crestStyle}`)}</Badge>
                      <span className="grow" />
                      {editable && (
                        <>
                          <button className="btn xs ghost icon" title={t('common.edit')} aria-label={t('common.edit')} onClick={() => open(h)}>
                            <Pencil />
                          </button>
                          <button className="btn xs ghost icon" title={t('common.duplicate')} aria-label={t('common.duplicate')} onClick={() => void saveCopy(h)}>
                            <Copy />
                          </button>
                          <button className="btn xs ghost icon danger" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => setDeleting(h)}>
                            <Trash2 />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<Shield />}
          title={t('house.empty')}
          text={t('house.emptyHint')}
          action={
            editable ? (
              <button className="btn primary" onClick={createNew}>
                <Plus /> {t('house.new')}
              </button>
            ) : undefined
          }
        />
      )}

      {editing && (
        <HouseEditor
          key={editing.house.id}
          initial={editing.house}
          isNew={editing.isNew}
          data={data}
          onClose={() => setEditing(null)}
          onSaveCopy={async (h) => {
            const copy = await saveCopy(h);
            if (copy) setEditing({ house: copy, isNew: false });
          }}
          onDelete={(h) => {
            setEditing(null);
            setDeleting(h);
          }}
        />
      )}
      {deleting && <DeleteHouseModal house={deleting} data={data} onClose={() => setDeleting(null)} onDeleted={() => setDeleting(null)} />}
    </div>
  );
}
