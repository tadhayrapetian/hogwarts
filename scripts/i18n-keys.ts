/** CLI: npx vite-node scripts/i18n-keys.ts [--json] [--missing] */
import { en } from '../src/i18n/en';
import { hy } from '../src/i18n/hy';
import { ru } from '../src/i18n/ru';
import { collectKeys } from './i18n-extract';

const { keys: all, unresolved } = collectKeys();

const args = process.argv.slice(2);
if (args.includes('--json')) {
  console.log(JSON.stringify({ keys: all, unresolved }, null, 1));
} else if (args.includes('--missing')) {
  const report = (name: string, d: Record<string, string>) => {
    const miss = all.filter((k) => d[k] === undefined && d[`${k}_other`] === undefined);
    console.log(`${name}: ${miss.length} missing`);
    if (miss.length) console.log(miss.join('\n'));
  };
  report('en', en);
  report('ru', ru);
  report('hy', hy);
  if (unresolved.length) console.log('UNRESOLVED dynamic prefixes:', JSON.stringify(unresolved, null, 1));
} else {
  console.log(`${all.length} keys, ${unresolved.length} unresolved dynamic prefixes`);
  if (unresolved.length) console.log(JSON.stringify(unresolved, null, 1));
}
