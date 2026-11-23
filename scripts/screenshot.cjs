/**
 * Vizuelna provjera: snimi ekran radnog prostora i izmjeri visine panela.
 *   npm run shot -- ime-shotka "?session=<id>"
 * Traži APP_PW u okruženju i pokrenut dev server.
 */
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');

(async () => {
  fs.mkdirSync('shots', { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  const login = await fetch(`http://localhost:${process.env.SHOT_PORT ?? '3000'}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.APP_PW }),
  });
  const raw = (login.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('giga_auth='));
  if (!raw) throw new Error('login failed: ' + login.status);
  const value = raw.split(';')[0].split('=').slice(1).join('=');
  await page.setCookie({ name: 'giga_auth', value, domain: 'localhost', path: '/' });
  await page.goto(`http://localhost:${process.env.SHOT_PORT ?? '3000'}/${(process.argv[3] ?? '')}`, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForSelector('section.panel', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));
  const data = await page.evaluate(() => {
    const info = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        height: Math.round(r.height),
        scrollH: el.scrollHeight,
        clientH: el.clientHeight,
        overflowY: cs.overflowY,
        flex: cs.flex,
      };
    };
    const grid = document.querySelector('.grid.grid-cols-12');
    const cols = [...(grid ? grid.children : [])];
    const panels = [...document.querySelectorAll('section.panel')];
    const rail = cols[2];
    const railRoot = rail?.querySelector(':scope > div') ?? null;
    const cards = railRoot ? [...railRoot.children] : [];
    return {
      viewportH: window.innerHeight,
      grid: info(grid),
      columns: cols.map((c, i) => ({ i, ...info(c) })),
      panels: panels.map((p, i) => ({ i, title: (p.querySelector('h2')?.textContent || '').slice(0, 28), ...info(p) })),
      railRoot: info(railRoot),
      railCards: cards.map((c, i) => ({ i, title: (c.textContent || '').slice(0, 22), ...info(c) })),
    };
  });
  console.log(JSON.stringify(data, null, 2));
  await page.screenshot({ path: `shots/${process.argv[2] ?? 'page'}-desk.png` });
  await page.setViewport({ width: 420, height: 820 });
  await new Promise((r) => setTimeout(r, 1500));
  const mobile = await page.evaluate(() => {
    const panels = [...document.querySelectorAll('section.panel')].map((el) => {
      const r = el.getBoundingClientRect();
      return { title: (el.querySelector('h2')?.textContent || '').slice(0, 24), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) };
    });
    return { viewportH: window.innerHeight, panels };
  });
  console.log(JSON.stringify(mobile, null, 2));
  await page.screenshot({ path: `shots/${process.argv[2] ?? 'page'}-mobile.png` });
  await browser.close();
})();
