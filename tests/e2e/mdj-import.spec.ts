import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { byName, expect, newProject, node, snapshot, test } from './helpers';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/mdj');

async function pickFile(page: Page, trigger: Locator, file: string) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), trigger.click()]);
  await chooser.setFiles(path.join(FIXTURES, file));
  await expect(page.getByTestId('mdj-import-dialog')).toBeVisible();
}

test('experimental .mdj import from the start screen: report, then a new unsaved project', async ({
  page,
}) => {
  await page.goto('/');
  await pickFile(page, page.getByTestId('start-import-mdj'), 'class-model.mdj');
  await expect(page.getByTestId('mdj-import-summary')).toContainText(
    '14 model elements, 1 diagrams and 15 views',
  );
  await expect(page.getByTestId('mdj-unsupported').locator('[data-type="UMLSequenceDiagram"]')).toContainText(
    '1',
  );
  await page.getByTestId('mdj-open').click();

  await expect(page.locator('[data-canvas]')).toBeVisible();
  await expect(page.locator('[data-testid="uml-node"]')).toHaveCount(9); // 8 element views + 1 note
  await expect(node(page, 'Customer')).toContainText('placeOrder');
  await expect(page.locator('[data-testid="uml-edge"]')).toHaveCount(6); // 5 relationships + 1 note link
  const doc = await snapshot(page);
  expect(byName(doc, 'Customer').ownerId).toBe(byName(doc, 'domain').id);
  // Unsaved until the user saves a .umls copy.
  await expect(page.getByTestId('dirty-indicator')).toHaveAttribute('data-dirty', 'true');
});

test('experimental .mdj import from the File menu: a non-StarUML file is rejected, the open project is untouched', async ({
  page,
}) => {
  await newProject(page, 'Keep me');
  const before = await snapshot(page);
  await page.getByTestId('menubar-file').click();
  await pickFile(page, page.getByTestId('menu-file.importMdj'), 'README.md');
  await expect(page.getByTestId('mdj-import-error')).toHaveAttribute('data-code', 'invalidJson');
  await page.getByTestId('mdj-import-dialog').getByRole('button', { name: 'Close' }).last().click();
  await expect(page.getByTestId('mdj-import-dialog')).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
});
