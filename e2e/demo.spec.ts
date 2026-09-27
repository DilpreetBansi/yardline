import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page) {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: /Good to see you/ })).toBeVisible({ timeout: 60_000 });
}

async function newQuote(page: Page, customer: string, job: string) {
  await page.getByRole('button', { name: 'New quote' }).first().click();
  await page.getByRole('dialog').getByLabel('Customer').selectOption({ label: customer });
  await page.getByRole('dialog').getByLabel('Job name').fill(job);
  await page.getByRole('button', { name: 'Create quote' }).click();
  await expect(page.getByText(/^Q-\d{4}-\d{4}$/).first()).toBeVisible();
}

async function pasteAndAdd(page: Page, text: string) {
  await page.getByLabel('Materials list').fill(text);
  await page.getByRole('button', { name: 'Match to catalog' }).click();
  const add = page.getByRole('button', { name: /^Add \d+ lines? to/ });
  await expect(add).toBeEnabled();
  await add.click();
  await expect(page.getByRole('heading', { name: /^Lines/ })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await boot(page);
  // Start every test from the same seeded data.
  await page.getByRole('button', { name: 'Reset data' }).click();
  await expect(page.getByText('Demo data restored')).toBeVisible({ timeout: 60_000 });
});

test('paste a list, send it, accept it as the customer in another tab, and order it', async ({ page, context }) => {
  await newQuote(page, 'Credit River Decks (contractor)', 'E2E deck');
  await pasteAndAdd(page, "PT 4x4x10 - 6\n2x8x12 pressure treated x 14\n2x8 joist hangers (14)\n10 bags concrete 30kg\nmisc hardware");

  const lines = page.locator('table.data tbody tr');
  await expect(lines).toHaveCount(4); // "misc hardware" had no match and was left out
  await expect(page.getByText('4x4 x 10\' Pressure Treated post')).toBeVisible();
  const total = page.locator('.totals .row.total .num');
  await expect(total).not.toHaveText('$0.00');

  // Change a quantity and save: the version goes up and the totals follow.
  const before = await total.innerText();
  await page.getByLabel(/Quantity of 2x8 x 12'/).fill('20');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(/Live · v3/)).toBeVisible();
  await expect(total).not.toHaveText(before);

  await page.getByRole('button', { name: 'Send to customer' }).click();
  const link = await page.getByLabel('Customer link').inputValue();
  expect(link).toContain('#/share/');
  await page.getByRole('button', { name: 'Done' }).click();

  // The customer opens the link in a second tab (same browser, same in-browser server).
  const customer = await context.newPage();
  await customer.goto(link);
  await expect(customer.getByRole('heading', { name: /^Quote Q-/ })).toBeVisible({ timeout: 60_000 });
  await expect(customer.locator('.totals .row.total .num')).toHaveText(await total.innerText());
  await customer.getByLabel('Type your name to accept').fill('Tom Kowalski');
  await customer.getByRole('button', { name: 'Accept quote' }).click();
  await expect(customer.getByText(/Accepted by Tom Kowalski/)).toBeVisible();

  // The rep's tab updates on its own.
  await expect(page.getByText(/Accepted by Tom Kowalski/)).toBeVisible();
  await page.getByRole('button', { name: 'Turn into an order' }).click();
  await expect(page.getByText(/Order SO-\d{4}-\d{5} created/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Order SO-/ })).toBeVisible();

  await page.getByRole('link', { name: 'Orders' }).click();
  await expect(page.getByRole('cell', { name: 'Credit River Decks' }).first()).toBeVisible();
});

test('a stale edit is refused and explained', async ({ page, context }) => {
  await newQuote(page, 'Maple & Stone Renovations (contractor)', 'E2E conflict');
  await pasteAndAdd(page, '40 2x4x8 SPF');
  const url = page.url();

  const other = await context.newPage();
  await other.goto(url);
  await expect(other.getByLabel(/Quantity of 2x4 x 8'/)).toBeVisible({ timeout: 60_000 });

  // Both start editing v2. The first save wins.
  await page.getByLabel(/Quantity of 2x4 x 8'/).fill('55');
  await other.getByLabel(/Quantity of 2x4 x 8'/).fill('10');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(/Live · v3/)).toBeVisible();

  await expect(other.getByText('This quote changed while you were editing.')).toBeVisible();
  await other.getByRole('button', { name: /Load the latest/ }).click();
  await expect(other.getByLabel(/Quantity of 2x4 x 8'/)).toHaveValue('55');
});

test('a discount past the rep limit waits for the manager', async ({ page }) => {
  await newQuote(page, 'Northline Framing Ltd. (pro)', 'E2E approval');
  await pasteAndAdd(page, '10 bags concrete 30kg');
  await page.getByLabel(/Extra discount on Concrete/).fill('15');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Needs a manager')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send to customer' })).toBeDisabled();

  await page.getByLabel('Signed in as').selectOption({ label: 'Sam Okafor · Branch manager' });
  await page.getByRole('button', { name: /Approve pricing/ }).click();
  await expect(page.getByText(/Pricing approved by Sam Okafor/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send to customer' })).toBeEnabled();
});

test('catalog search is fuzzy', async ({ page }) => {
  await page.getByRole('link', { name: /Catalog/ }).click();
  await page.getByLabel('Search products').fill('doug fir 2x10');
  await expect(page.locator('table.data tbody tr').first()).toContainText('2x10');
  await expect(page.locator('table.data tbody tr').first()).toContainText('Douglas Fir');
});
