import type { PrintPage } from './imposition';

/** Paginated table report (A4 landscape) rendered as SVG pages → PDF export or print. */
export function tableReportPages(title: string, subtitle: string, head: string[], rows: (string | number)[][]): PrintPage[] {
  const W = 297;
  const H = 210;
  const margin = 12;
  const rowH = 6.2;
  const headerH = 22;
  const perPage = Math.floor((H - margin * 2 - headerH - 8) / rowH);
  const usable = W - margin * 2;
  // Column widths proportional to content length (capped).
  const weights = head.map((h, i) => Math.min(40, Math.max(h.length, ...rows.slice(0, 200).map((r) => String(r[i] ?? '').length))) + 2);
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / total) * usable);
  const maxChars = widths.map((w) => Math.floor(w / 1.55));
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);
  const pageCount = Math.max(1, Math.ceil(rows.length / perPage));
  const pages: PrintPage[] = [];
  for (let p = 0; p < pageCount; p++) {
    const slice = rows.slice(p * perPage, p * perPage + perPage);
    const render = () => (
      <g fontFamily="'Inter', 'Noto Serif Armenian', sans-serif">
        <rect width={W} height={H} fill="#fff" />
        <text x={margin} y={margin + 6} fontSize={7} fontWeight={700} fill="#3b2a1a" fontFamily="'Cinzel', 'Cormorant Garamond', serif">
          {title}
        </text>
        <text x={margin} y={margin + 12} fontSize={3.2} fill="#777">
          {subtitle}
        </text>
        <text x={W - margin} y={margin + 12} fontSize={3.2} fill="#777" textAnchor="end">
          {p + 1} / {pageCount}
        </text>
        <rect x={margin} y={margin + headerH - 5} width={usable} height={rowH} fill="#efe7d6" />
        {head.map((h, i) => (
          <text key={i} x={margin + widths.slice(0, i).reduce((a, b) => a + b, 0) + 1.5} y={margin + headerH - 0.6} fontSize={3} fontWeight={700} fill="#5a4630">
            {cut(h.toUpperCase(), maxChars[i])}
          </text>
        ))}
        {slice.map((r, ri) => {
          const y = margin + headerH + 1 + (ri + 1) * rowH;
          return (
            <g key={ri}>
              {ri % 2 === 1 && <rect x={margin} y={y - rowH + 1.6} width={usable} height={rowH} fill="#faf6ee" />}
              {r.map((c, i) => (
                <text key={i} x={margin + widths.slice(0, i).reduce((a, b) => a + b, 0) + 1.5} y={y} fontSize={3.1} fill="#222">
                  {cut(String(c ?? ''), maxChars[i])}
                </text>
              ))}
            </g>
          );
        })}
      </g>
    );
    pages.push({
      section: 'report',
      title,
      w: W,
      h: H,
      placements: [{ item: { id: `p${p}`, label: title, w: W, h: H, render }, x: 0, y: 0, w: W, h: H, rotated: false }],
      marks: { crop: false, cut: false, fold: false, safe: false, bleed: 0 },
    });
  }
  return pages;
}
