/** Code 128 (subset B) barcode generator – used for tracking numbers and document references. */

export const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

/** Returns module widths (bar, space, bar, …) for the given text, including start, checksum, stop. */
export function code128B(text: string): number[] {
  const clean = Array.from(text)
    .map((ch) => (ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) <= 126 ? ch : '?'))
    .join('');
  const values = Array.from(clean).map((ch) => ch.charCodeAt(0) - 32);
  let checksum = 104;
  values.forEach((v, i) => (checksum += v * (i + 1)));
  checksum %= 103;
  const codes = [104, ...values, checksum, 106];
  return codes.flatMap((c) => CODE128_PATTERNS[c].split('').map(Number));
}

export function BarcodeArt({ value, w, h, color = '#111', showText = true }: { value: string; w: number; h: number; color?: string; showText?: boolean }) {
  const modules = code128B(value || ' ');
  const total = modules.reduce((a, b) => a + b, 0) + 20;
  const unit = w / total;
  const textH = showText ? Math.min(h * 0.28, 3.2) : 0;
  const barH = h - textH - (showText ? 0.6 : 0);
  let x = unit * 10;
  const bars: JSX.Element[] = [];
  modules.forEach((m, i) => {
    if (i % 2 === 0) bars.push(<rect key={i} x={x} y={0} width={m * unit} height={barH} fill={color} />);
    x += m * unit;
  });
  return (
    <g>
      <rect width={w} height={h} fill="#fff" opacity={0.0} />
      {bars}
      {showText && (
        <text x={w / 2} y={h - 0.3} textAnchor="middle" fontFamily="'Inter', monospace" fontSize={textH} fill={color} letterSpacing={textH * 0.15}>
          {value}
        </text>
      )}
    </g>
  );
}
