import { useState } from 'react';
import { foldedSize } from '../../core/defaults';
import type { Project } from '../../core/types';
import { useI18n } from '../../i18n';
import type { RenderCtx } from '../../render/context';
import { EnvelopeOpenArt, flapTip } from '../../render/envelope';
import { LayoutContent } from '../../render/LayoutSVG';
import { EnvelopeBackView, LayoutView } from '../../ui/art';
import { Tabs } from '../../ui/kit';

/** Photo-like previews of the finished mail package on a writing desk. */
export function RealisticPreview({ project, ctx }: { project: Project; ctx: RenderCtx }) {
  const { t } = useI18n();
  const [view, setView] = useState('closed');
  const env = project.envelope;
  const L = project.letter;
  const [, fh] = foldedSize(L.w, L.h, project.fold);
  const peekW = env.front.w * 0.88;
  const peekH = (peekW / L.w) * fh;
  const flapH = flapTip(env.flap, env.back.w, env.back.h)[1];
  const doc = project.documents[0];
  return (
    <div>
      <Tabs
        pill
        value={view}
        onChange={setView}
        tabs={[
          { key: 'closed', label: t('preview.closed') },
          { key: 'back', label: t('preview.back') },
          { key: 'opened', label: t('preview.opened') },
          { key: 'letter', label: t('preview.letter') },
          { key: 'package', label: t('preview.package') },
        ]}
      />
      <div className="desk mt-16">
        {view === 'closed' && <LayoutView layout={env.front} ctx={{ ...ctx, editor: false }} className="single" style={{ width: '86%', height: 'auto' }} />}
        {view === 'back' && <EnvelopeBackView env={env} ctx={{ ...ctx, editor: false }} width="86%" style={{ filter: 'drop-shadow(0 14px 30px rgba(0,0,0,.5))' }} />}
        {view === 'opened' && (
          <div style={{ width: '70%' }} className="single">
            <EnvelopeOpenArt
              env={env}
              ctx={{ ...ctx, editor: false, idPrefix: `${ctx.idPrefix}-open` }}
              letterPeek={
                <svg x={(env.front.w - peekW) / 2} y={-flapH * 0.55} width={peekW} height={peekH} viewBox={`0 0 ${L.w} ${fh}`} preserveAspectRatio="xMidYMin slice" overflow="hidden">
                  <LayoutContent layout={L} ctx={{ ...ctx, editor: false, idPrefix: `${ctx.idPrefix}-peek` }} />
                </svg>
              }
            />
          </div>
        )}
        {view === 'letter' && <LayoutView layout={L} ctx={{ ...ctx, editor: false }} className="single" style={{ height: 620, width: 'auto', maxWidth: '100%' }} />}
        {view === 'package' && (
          <div style={{ position: 'relative', width: '100%', height: 560 }}>
            <div className="item" style={{ left: '4%', top: '2%', width: '42%', transform: 'rotate(-4deg)' }}>
              <LayoutView layout={L} ctx={{ ...ctx, editor: false }} width="100%" />
            </div>
            {doc && (
              <div className="item" style={{ right: '4%', top: '4%', width: doc.layout.w > doc.layout.h ? '40%' : '24%', transform: 'rotate(5deg)' }}>
                <LayoutView layout={doc.layout} ctx={{ ...ctx, editor: false }} width="100%" />
              </div>
            )}
            <div className="item" style={{ left: '30%', top: '46%', width: '52%', transform: 'rotate(-2deg)' }}>
              <LayoutView layout={env.front} ctx={{ ...ctx, editor: false }} width="100%" />
            </div>
            {project.documents[1] && (
              <div className="item" style={{ left: '6%', bottom: '4%', width: '20%', transform: 'rotate(8deg)' }}>
                <LayoutView layout={project.documents[1].layout} ctx={{ ...ctx, editor: false }} width="100%" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
