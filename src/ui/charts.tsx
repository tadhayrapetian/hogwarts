import { Table2, BarChart3 } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n';

/**
 * Lightweight SVG charts following the validated chart spec: thin marks with 4px rounded
 * data-ends, hairline gridlines, one axis, legend for ≥2 series, hover tooltips, and a
 * table view for every chart.
 */

export const SERIES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * exp;
}

function ticks(max: number, n = 4): number[] {
  const m = niceMax(max);
  return Array.from({ length: n + 1 }, (_, i) => (m / n) * i);
}

/** Path for a bar with 4px rounded top corners and a square base. */
function barPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x} ${y + h} V${y + rr} Q${x} ${y} ${x + rr} ${y} H${x + w - rr} Q${x + w} ${y} ${x + w} ${y + rr} V${y + h} Z`;
}

function hbarPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (w <= 0) return '';
  const rr = Math.min(r, h / 2, w);
  return `M${x} ${y} H${x + w - rr} Q${x + w} ${y} ${x + w} ${y + rr} V${y + h - rr} Q${x + w} ${y + h} ${x + w - rr} ${y + h} H${x} Z`;
}

interface Tip {
  x: number;
  y: number;
  title: string;
  rows: { color: string; label: string; value: string }[];
}

function TipBox({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>
      <div className="t">{tip.title}</div>
      {tip.rows.map((r, i) => (
        <div className="r" key={i}>
          <i style={{ background: r.color }} />
          {r.label && <span>{r.label}:</span>}
          <b className="num">{r.value}</b>
        </div>
      ))}
    </div>
  );
}

export interface Series {
  key: string;
  label: string;
  values: number[];
}

export function Legend({ series }: { series: { label: string }[] }) {
  if (series.length < 2) return null;
  return (
    <div className="legend">
      {series.map((s, i) => (
        <span key={s.label}>
          <i style={{ background: SERIES[i % SERIES.length] }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** Vertical columns: one or more series (grouped). */
export function ColumnChart({ labels, series, height = 220, format = (v) => String(v) }: { labels: string[]; series: Series[]; height?: number; format?: (v: number) => string }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const W = 640;
  const H = height;
  const padL = 44;
  const padB = 26;
  const padT = 10;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const tks = ticks(max);
  const top = tks[tks.length - 1];
  const band = (W - padL) / Math.max(1, labels.length);
  const groupW = Math.min(band * 0.7, 24 * series.length + 2 * (series.length - 1));
  const barW = Math.min(24, (groupW - 2 * (series.length - 1)) / series.length);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top);
  const step = Math.ceil(labels.length / 12);
  return (
    <div className="chart" ref={ref} onMouseLeave={() => setTip(null)}>
      <Legend series={series} />
      <svg viewBox={`0 0 ${W} ${H}`} role="img">
        <g className="grid">
          {tks.map((t) => (
            <line key={t} x1={padL} x2={W} y1={y(t)} y2={y(t)} />
          ))}
        </g>
        <g className="axis">
          {tks.map((t) => (
            <text key={t} x={padL - 8} y={y(t) + 4} textAnchor="end">
              {format(t)}
            </text>
          ))}
          {labels.map((l, i) =>
            i % step === 0 ? (
              <text key={i} x={padL + band * i + band / 2} y={H - 8} textAnchor="middle">
                {l}
              </text>
            ) : null,
          )}
        </g>
        <line className="baseline" x1={padL} x2={W} y1={y(0)} y2={y(0)} />
        {labels.map((l, i) => {
          const gx = padL + band * i + (band - (barW * series.length + 2 * (series.length - 1))) / 2;
          return (
            <g key={i}>
              {series.map((s, si) => {
                const v = s.values[i] ?? 0;
                const x = gx + si * (barW + 2);
                return <path key={s.key} d={barPath(x, y(v), barW, y(0) - y(v))} fill={SERIES[si % SERIES.length]} />;
              })}
              <rect
                x={padL + band * i}
                y={padT}
                width={band}
                height={H - padT - padB}
                fill="transparent"
                onMouseMove={(e) => {
                  const rect = ref.current!.getBoundingClientRect();
                  setTip({
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                    title: l,
                    rows: series.map((s, si) => ({ color: SERIES[si % SERIES.length], label: series.length > 1 ? s.label : '', value: format(s.values[i] ?? 0) })),
                  });
                }}
              />
            </g>
          );
        })}
      </svg>
      <TipBox tip={tip} />
    </div>
  );
}

/** Line chart with crosshair tooltip; 2px lines, end markers with surface ring. */
export function LineChart({ labels, series, height = 220, format = (v) => String(v), area }: { labels: string[]; series: Series[]; height?: number; format?: (v: number) => string; area?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const W = 640;
  const H = height;
  const padL = 44;
  const padR = 12;
  const padB = 26;
  const padT = 10;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const tks = ticks(max);
  const top = tks[tks.length - 1];
  const n = Math.max(1, labels.length - 1);
  const x = (i: number) => padL + ((W - padL - padR) * i) / n;
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top);
  const step = Math.ceil(labels.length / 12);
  const tip: Tip | null =
    hover === null
      ? null
      : {
          x: (x(hover) / W) * (ref.current?.clientWidth ?? W),
          y: (Math.min(...series.map((s) => y(s.values[hover] ?? 0))) / H) * (ref.current?.querySelector('svg')?.clientHeight ?? H) + (series.length > 1 ? 28 : 0),
          title: labels[hover],
          rows: series.map((s, si) => ({ color: SERIES[si % SERIES.length], label: series.length > 1 ? s.label : '', value: format(s.values[hover] ?? 0) })),
        };
  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}>
      <Legend series={series} />
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const i = Math.round(((px - padL) / (W - padL - padR)) * n);
          setHover(Math.max(0, Math.min(labels.length - 1, i)));
        }}
      >
        <g className="grid">
          {tks.map((t) => (
            <line key={t} x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} />
          ))}
        </g>
        <g className="axis">
          {tks.map((t) => (
            <text key={t} x={padL - 8} y={y(t) + 4} textAnchor="end">
              {format(t)}
            </text>
          ))}
          {labels.map((l, i) =>
            i % step === 0 ? (
              <text key={i} x={x(i)} y={H - 8} textAnchor="middle">
                {l}
              </text>
            ) : null,
          )}
        </g>
        <line className="baseline" x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} />
        {series.map((s, si) => {
          const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
          const color = SERIES[si % SERIES.length];
          return (
            <g key={s.key}>
              {area && <polygon points={`${x(0)},${y(0)} ${pts} ${x(s.values.length - 1)},${y(0)}`} fill={color} opacity={0.1} />}
              <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={x(s.values.length - 1)} cy={y(s.values[s.values.length - 1] ?? 0)} r={4} fill={color} stroke="var(--chart-surface)" strokeWidth={2} />
            </g>
          );
        })}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={y(0)} stroke="var(--chart-axis)" strokeWidth={1} />
            {series.map((s, si) => (
              <circle key={s.key} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4} fill={SERIES[si % SERIES.length]} stroke="var(--chart-surface)" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      <TipBox tip={tip} />
    </div>
  );
}

/** Horizontal bars, sorted by value, labels on the left and value at the bar tip. */
export function BarList({ items, format = (v) => String(v), max: maxItems = 8, colorIndex = 0, onClick }: { items: { label: string; value: number; key?: string }[]; format?: (v: number) => string; max?: number; colorIndex?: number; onClick?: (key: string) => void }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const data = useMemo(() => [...items].sort((a, b) => b.value - a.value).slice(0, maxItems), [items, maxItems]);
  const W = 640;
  const rowH = 30;
  const labelW = 170;
  const H = data.length * rowH + 4;
  const max = Math.max(1, ...data.map((d) => d.value));
  const scale = (W - labelW - 60) / max;
  return (
    <div className="chart" ref={ref} onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img">
        {data.map((d, i) => {
          const y0 = i * rowH + 4;
          const bh = Math.min(18, rowH - 8);
          const w = Math.max(d.value > 0 ? 2 : 0, d.value * scale);
          return (
            <g
              key={d.key ?? d.label}
              style={{ cursor: onClick ? 'pointer' : undefined }}
              onClick={() => onClick?.(d.key ?? d.label)}
              onMouseMove={(e) => {
                const rect = ref.current!.getBoundingClientRect();
                setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, title: d.label, rows: [{ color: SERIES[colorIndex], label: '', value: format(d.value) }] });
              }}
            >
              <rect x={0} y={y0 - 2} width={W} height={rowH} fill="transparent" />
              <text className="label" x={labelW - 10} y={y0 + bh / 2 + 4} textAnchor="end">
                {d.label.length > 24 ? `${d.label.slice(0, 23)}…` : d.label}
              </text>
              <path d={hbarPath(labelW, y0, w, bh)} fill={SERIES[colorIndex]} />
              <text className="value-label" x={labelW + w + 6} y={y0 + bh / 2 + 4}>
                {format(d.value)}
              </text>
            </g>
          );
        })}
        <line className="baseline" x1={labelW} x2={labelW} y1={0} y2={H} />
      </svg>
      <TipBox tip={tip} />
    </div>
  );
}

/** Wraps a chart with a title and a chart/table toggle (table view = accessibility relief). */
export function ChartCard({ title, sub, children, table, actions }: { title: string; sub?: string; children: ReactNode; table: { head: string[]; rows: (string | number)[][] }; actions?: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  const { t } = useI18n();
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h3>{title}</h3>
          {sub && <div className="sub">{sub}</div>}
        </div>
        <div className="row">
          {actions}
          <button className="btn ghost icon sm" onClick={() => setAsTable(!asTable)} title={asTable ? t('chart.showChart') : t('chart.showTable')} aria-label={asTable ? t('chart.showChart') : t('chart.showTable')}>
            {asTable ? <BarChart3 /> : <Table2 />}
          </button>
        </div>
      </div>
      <div className="card-body">
        {asTable ? (
          <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
            <table className="table compact">
              <thead>
                <tr>
                  {table.head.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j} className={j > 0 ? 'num right' : ''}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
