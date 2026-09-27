import { spawn, type ChildProcess } from 'node:child_process';
import { expect, test } from '@playwright/test';
import pg from 'pg';

// Server mode: the same UI against the Node server and a real Postgres, with password sign-in
// and live updates over Server-Sent Events. Needs DATABASE_URL and a server-mode build.
const url = process.env.DATABASE_URL;
test.skip(!url, 'DATABASE_URL not set');

const PORT = 8788;
const BASE = `http://localhost:${PORT}`;
let server: ChildProcess;

test.beforeAll(async () => {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
  server = spawn(process.execPath, ['apps/server/src/main.ts'], {
    env: { ...process.env, PORT: String(PORT), YARDLINE_DEMO_PASSWORD: 'e2e-password', YARDLINE_SEED_HISTORY: '1' },
    stdio: 'pipe',
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 30_000);
    server.stdout!.on('data', (d: Buffer) => {
      if (d.toString().includes('listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
});

test.afterAll(() => {
  server?.kill();
});

test('sign in, and see a colleague’s edit arrive over SSE', async ({ browser }) => {
  const rep = await (await browser.newContext()).newPage();
  await rep.goto(`${BASE}/quotes`);
  await expect(rep).toHaveURL(/\/login$/);
  await rep.getByLabel('Password').fill('wrong');
  await rep.getByRole('button', { name: 'Sign in' }).click();
  await expect(rep.getByText('Wrong email or password')).toBeVisible();
  await rep.getByLabel('Password').fill('e2e-password');
  await rep.getByRole('button', { name: 'Sign in' }).click();
  await expect(rep.getByRole('heading', { name: 'Quotes' })).toBeVisible();

  await rep.getByRole('button', { name: 'New quote' }).click();
  await rep.getByRole('dialog').getByLabel('Customer').selectOption({ label: 'Halton Basement Co. (contractor)' });
  await rep.getByRole('button', { name: 'Create quote' }).click();
  await rep.getByLabel('Materials list').fill('2x4 studs 92-5/8 x 80\n1/2 drywall 4x8 x 40');
  await rep.getByRole('button', { name: 'Match to catalog' }).click();
  await rep.getByRole('button', { name: /^Add 2 lines/ }).click();
  await expect(rep.getByText(/Live · v2/)).toBeVisible();
  const quoteUrl = rep.url();

  // Sam signs in on another browser and changes a quantity.
  const sam = await (await browser.newContext()).newPage();
  await sam.goto(`${BASE}/login`);
  await sam.getByLabel('Email').fill('sam@yardline.test');
  await sam.getByLabel('Password').fill('e2e-password');
  await sam.getByRole('button', { name: 'Sign in' }).click();
  await expect(sam.getByRole('heading', { name: /Good to see you, Sam/ })).toBeVisible();
  await sam.goto(quoteUrl);
  await sam.getByLabel(/Quantity of 1\/2" regular drywall/).fill('55');
  await sam.getByRole('button', { name: 'Save changes' }).click();
  await expect(sam.getByText(/Live · v3/)).toBeVisible();

  // Maya never reloads: the change arrives over the event stream.
  await expect(rep.getByText(/Live · v3/)).toBeVisible();
  await expect(rep.getByLabel(/Quantity of 1\/2" regular drywall/)).toHaveValue('55');
});
