import { useLiveQuery } from 'dexie-react-hooks';
import { Download, Eye, File, FileImage, FileText, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FILE_CATEGORIES, type FileOwnerType, type FileRec } from '../../core/types';
import { downloadBlob, formatBytes } from '../../core/util';
import { db } from '../../db/db';
import { addFile, deleteFile, MAX_FILE_SIZE } from '../../db/services';
import { useFmt } from '../../app/data';
import { useAction, useFeedback } from '../../app/feedback';
import { useSession } from '../../app/session';
import { useI18n } from '../../i18n';
import { Dropzone, EmptyState, Modal } from '../../ui/kit';

function FilePreview({ file, onClose }: { file: FileRec; onClose: () => void }) {
  const [url, setUrl] = useState<string>('');
  const [text, setText] = useState<string>('');
  useEffect(() => {
    const u = URL.createObjectURL(file.blob);
    setUrl(u);
    if (file.mime.startsWith('text/') || file.mime === 'application/json') file.blob.text().then(setText);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <Modal title={file.name} sub={`${file.mime} · ${formatBytes(file.size)}`} onClose={onClose} size="xl" initialFocus={false}>
      {file.mime.startsWith('image/') && url && <img src={url} alt={file.name} style={{ maxWidth: '100%', maxHeight: '70vh', display: 'block', margin: '0 auto' }} />}
      {file.mime === 'application/pdf' && url && <iframe src={url} title={file.name} style={{ width: '100%', height: '70vh', border: 0 }} />}
      {text && <pre style={{ whiteSpace: 'pre-wrap', maxHeight: '70vh', overflow: 'auto' }}>{text}</pre>}
      {!file.mime.startsWith('image/') && file.mime !== 'application/pdf' && !text && (
        <EmptyState icon={<File />} title={file.name} action={<button className="btn" onClick={() => downloadBlob(file.blob, file.name)}><Download /> Download</button>} />
      )}
    </Modal>
  );
}

function Thumb({ file }: { file: FileRec }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!file.mime.startsWith('image/')) return;
    const u = URL.createObjectURL(file.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  if (url) return <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6 }} />;
  if (file.mime === 'application/pdf' || file.mime.startsWith('text/')) return <FileText size={40} color="var(--accent)" />;
  if (file.mime.startsWith('image/')) return <FileImage size={40} color="var(--accent)" />;
  return <File size={40} color="var(--accent)" />;
}

export function FilesPanel({ ownerType, ownerId }: { ownerType: FileOwnerType; ownerId: string }) {
  const { t } = useI18n();
  const fmt = useFmt();
  const { can } = useSession();
  const run = useAction();
  const { confirm } = useFeedback();
  const [category, setCategory] = useState<string>('');
  const [preview, setPreview] = useState<FileRec | null>(null);
  const files = useLiveQuery(() => db.files.where('[ownerType+ownerId]').equals([ownerType, ownerId]).reverse().sortBy('createdAt'), [ownerType, ownerId]) ?? [];
  const shown = category ? files.filter((f) => f.category === category) : files;
  return (
    <div className="col gap-16">
      {can('files.edit') && (
        <Dropzone
          multiple
          label={t('files.drop', { max: formatBytes(MAX_FILE_SIZE) })}
          onFiles={(list) =>
            run(async () => {
              for (const f of list) await addFile(ownerType, ownerId, f);
            }, t('files.uploaded', { count: list.length }))
          }
        />
      )}
      <div className="row wrap">
        <div className="tabs pill">
          <button className={!category ? 'active' : ''} onClick={() => setCategory('')}>
            {t('common.all')} ({files.length})
          </button>
          {FILE_CATEGORIES.map((c) => (
            <button key={c} className={category === c ? 'active' : ''} onClick={() => setCategory(c)}>
              {t(`filecat.${c}`)} ({files.filter((f) => f.category === c).length})
            </button>
          ))}
        </div>
      </div>
      {!shown.length ? (
        <EmptyState icon={<File />} title={t('files.empty')} />
      ) : (
        <div className="thumb-grid">
          {shown.map((f) => (
            <div key={f.id} className="thumb-card" onClick={() => setPreview(f)}>
              <div className="art">
                <Thumb file={f} />
              </div>
              <div className="title truncate" title={f.name}>
                {f.name}
              </div>
              <div className="meta">
                {formatBytes(f.size)} · {fmt.date(f.createdAt)}
              </div>
              <div className="row" onClick={(e) => e.stopPropagation()}>
                <select
                  className="select sm"
                  value={f.category}
                  disabled={!can('files.edit')}
                  onChange={(e) => db.files.update(f.id, { category: e.target.value as FileRec['category'] })}
                  aria-label={t('files.category')}
                >
                  {FILE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`filecat.${c}`)}
                    </option>
                  ))}
                </select>
                <button className="btn icon sm ghost" onClick={() => setPreview(f)} title={t('common.preview')}>
                  <Eye />
                </button>
                <button className="btn icon sm ghost" onClick={() => downloadBlob(f.blob, f.name)} title={t('common.download')}>
                  <Download />
                </button>
                {can('files.edit') && (
                  <button
                    className="btn icon sm ghost danger"
                    title={t('common.delete')}
                    onClick={async () => {
                      if (await confirm({ title: t('files.deleteTitle', { name: f.name }), danger: true, confirm: t('common.delete') })) run(() => deleteFile(f.id), t('common.deleted'));
                    }}
                  >
                    <Trash2 />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {preview && <FilePreview file={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
