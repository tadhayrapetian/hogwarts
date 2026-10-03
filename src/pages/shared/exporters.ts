import { toCSV } from '../../core/csv';
import { downloadBlob, safeFileName, todayISO } from '../../core/util';
import { writeXlsx } from '../../core/xlsx';
import { audit } from '../../db/services';
import { exportPages, printPages } from '../../render/export';
import { tableReportPages } from '../../render/reports';

export type DataFormat = 'csv' | 'xlsx' | 'json' | 'pdf' | 'print';

/** Exports a table of rows in any supported format and records it in the audit log. */
export async function exportTable(format: DataFormat, name: string, head: string[], rows: (string | number)[][], json?: unknown) {
  const file = `${safeFileName(name)}-${todayISO()}`;
  if (format === 'csv') downloadBlob(new Blob([toCSV([head, ...rows])], { type: 'text/csv;charset=utf-8' }), `${file}.csv`);
  else if (format === 'xlsx')
    downloadBlob(new Blob([writeXlsx([{ name, rows: [head, ...rows] }]) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${file}.xlsx`);
  else if (format === 'json') downloadBlob(new Blob([JSON.stringify(json ?? rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]]))), null, 2)], { type: 'application/json' }), `${file}.json`);
  else if (format === 'pdf') await exportPages(tableReportPages(name, `${rows.length} · ${new Date().toLocaleString()}`, head, rows), 'pdf', 150, file);
  else if (format === 'print') await printPages(tableReportPages(name, `${rows.length} · ${new Date().toLocaleString()}`, head, rows));
  await audit('export', 'report', `Exported ${rows.length} row(s) of ${name} as ${format.toUpperCase()}`);
}
