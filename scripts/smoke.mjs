/**
 * Browser smoke test: runs the built app (npm run preview) in headless Chromium, performs first-run setup
 * with the demo workspace, then opens every section and reports console errors / failed renders.
 * Usage: node scripts/smoke.mjs [baseUrl] [outDir]
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? 'smoke-out';
mkdirSync(out, { recursive: true });
const executablePath = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${m.type()}] ${page.url()} :: ${m.text().slice(0, 400)}`);
});
page.on('pageerror', (e) => problems.push(`[pageerror] ${page.url()} :: ${e.message}\n${(e.stack ?? '').split('\n').slice(0, 4).join('\n')}`));

await page.goto(base);
await page.waitForSelector('.auth-card', { timeout: 20000 });
// First-run setup with demo workspace.
const pw = page.locator('input[type="password"]');
await pw.nth(0).fill('Admin2026!');
await pw.nth(1).fill('Admin2026!');
await page.locator('button.btn.primary.lg').click();
await page.waitForSelector('.shell', { timeout: 60000 });
await page.waitForTimeout(1500);

const routes = (process.env.ROUTES ?? [
  'dashboard', 'mailroom', 'analytics', 'recipients', 'recipients/duplicates', 'recipients/import', 'customers', 'addresses',
  'orders', 'projects', 'production', 'print', 'shipments', 'templates', 'templates?kind=document', 'studio/envelopes',
  'studio/stamps', 'studio/postmarks', 'studio/seals', 'houses', 'characters', 'inventory', 'suppliers', 'activity',
  'settings', 'settings?tab=company', 'settings?tab=mail', 'settings?tab=print', 'settings?tab=regional', 'settings?tab=defaults',
  'settings?tab=notifications', 'settings?tab=privacy', 'settings?tab=users', 'settings?tab=roles', 'settings?tab=tags',
  'settings?tab=products', 'settings?tab=carriers', 'settings?tab=data',
].join(',')).split(',');

const results = [];
for (const r of routes) {
  const before = problems.length;
  await page.evaluate((h) => (window.location.hash = `#/${h}`), r);
  await page.waitForTimeout(900);
  const text = (await page.locator('main').innerText().catch(() => '')).slice(0, 120).replace(/\s+/g, ' ');
  const missingKeys = await page.evaluate(() => {
    const t = document.querySelector('main')?.innerText ?? '';
    return Array.from(new Set(t.match(/\b[a-z]+(?:\.[a-zA-Z_]+){1,3}\b/g) ?? [])).filter((x) => !/\.(com|example|am|ru|uk|org)$/.test(x)).slice(0, 10);
  });
  await page.screenshot({ path: `${out}/${r.replace(/[^a-z0-9]+/gi, '_')}.png`, fullPage: false });
  results.push({ route: r, ok: problems.length === before && text.length > 0, text, missingKeys });
}

// Deep pages: first recipient profile tabs, first project tabs, first batch, first order.
const firstHref = async (sel) => page.locator(sel).first().getAttribute('href').catch(() => null);
await page.evaluate(() => (window.location.hash = '#/recipients'));
await page.waitForTimeout(800);
await page.locator('table.table tbody tr').first().click();
await page.waitForTimeout(800);
const recipientUrl = page.url();
for (const tab of ['overview', 'letters', 'orders', 'history', 'documents', 'envelopes', 'projects', 'addresses', 'notes', 'activity', 'files']) {
  const before = problems.length;
  await page.goto(recipientUrl.split('?')[0] + (tab === 'overview' ? '' : `?tab=${tab}`));
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/recipient_${tab}.png` });
  results.push({ route: `recipient:${tab}`, ok: problems.length === before });
}
await page.evaluate(() => (window.location.hash = '#/projects'));
await page.waitForTimeout(800);
await page.locator('table.table tbody tr').first().click();
await page.waitForTimeout(1000);
const projectUrl = page.url();
for (const tab of ['overview', 'letter', 'envelope', 'postage', 'documents', 'print', 'shipping', 'preview', 'files']) {
  const before = problems.length;
  await page.goto(projectUrl.split('?')[0] + (tab === 'overview' ? '' : `?tab=${tab}`));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/project_${tab}.png` });
  results.push({ route: `project:${tab}`, ok: problems.length === before });
}
for (const [list, label] of [['#/print', 'batch'], ['#/orders', 'order'], ['#/templates', 'template']]) {
  const before = problems.length;
  await page.evaluate((h) => (window.location.hash = h), list);
  await page.waitForTimeout(800);
  const target = page.locator('table.table tbody tr, .thumb-card').first();
  await target.click().catch(() => undefined);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/detail_${label}.png` });
  results.push({ route: `detail:${label}`, ok: problems.length === before, url: page.url() });
}
void firstHref;
console.log(JSON.stringify({ results, problems }, null, 1));
await browser.close();
