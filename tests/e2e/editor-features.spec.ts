import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { addDiagram, byName, canvas, connect, elementsOfKind, expect, MOD, newProject, node, place, selectEdge, snapshot, test } from './helpers';

async function dragBy(page: Page, x: number, y: number, dx: number, dy: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 6 });
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
}

test('composite states own their substates; packages own dropped classes (explicit move)', async ({ page }) => {
  await newProject(page, 'Nesting');
  await addDiagram(page, 'stateMachine', 'Machine');
  await place(page, 'sm.composite', 400, 300, 'Active');
  await place(page, 'sm.state', 400, 330, 'Running');
  let doc = await snapshot(page);
  expect(byName(doc, 'Running').ownerId).toBe(byName(doc, 'Active').id);
  // Drag the substate out → owned by the state machine again.
  const box = (await node(page, 'Running').boundingBox())!;
  await dragBy(page, box.x + box.width / 2, box.y + box.height / 2, 330, 0);
  doc = await snapshot(page);
  expect(doc.modelElements[byName(doc, 'Running').ownerId as string]!.kind).toBe('stateMachine');

  await addDiagram(page, 'class', 'Packages');
  await place(page, 'class.package', 300, 250, 'billing');
  await place(page, 'class.class', 650, 250, 'Invoice');
  const invoice = (await node(page, 'Invoice').boundingBox())!;
  const pkg = (await node(page, 'billing').boundingBox())!;
  await dragBy(page, invoice.x + invoice.width / 2, invoice.y + invoice.height / 2, pkg.x + pkg.width / 2 - (invoice.x + invoice.width / 2), pkg.y + pkg.height / 2 + 10 - (invoice.y + invoice.height / 2));
  doc = await snapshot(page);
  expect(byName(doc, 'Invoice').ownerId).toBe(byName(doc, 'billing').id);
  // The explorer reflects the new ownership (Invoice nested under billing once expanded).
  await page.locator('[data-testid="explorer-item"][data-name="billing"]').click();
  await page.keyboard.press('ArrowRight');
  const items = page.getByTestId('explorer-item');
  const names = await items.evaluateAll((els) => els.map((e) => `${e.getAttribute('aria-level')}:${e.getAttribute('data-name')}`));
  expect(names.indexOf('3:Invoice')).toBe(names.indexOf('2:billing') + 1);
  // Undo restores the previous owner in one step.
  await canvas(page).focus();
  await page.keyboard.press(`${MOD}+z`);
  doc = await snapshot(page);
  expect(byName(doc, 'Invoice').ownerId).toBe(doc.rootModelId);
});

test('notes, note links, bend points, label dragging and endpoint reconnection', async ({ page }) => {
  await newProject(page, 'Edges');
  await addDiagram(page, 'class', 'E');
  await place(page, 'class.class', 200, 200, 'A');
  await place(page, 'class.class', 650, 200, 'B');
  await place(page, 'class.class', 650, 480, 'C');
  await connect(page, 'class.association', 'A', 'B');
  await place(page, 'note', 200, 450);
  await page.getByTestId('inline-editor').fill('Remember the invariant');
  await page.getByTestId('inline-editor').press(`${MOD}+Enter`); // notes are multi-line
  await page.getByTestId('tool-noteLink').click();
  await page.locator('[data-testid="uml-node"][data-kind="note"]').click();
  await node(page, 'A').click();
  let doc = await snapshot(page);
  const views = () => Object.values(Object.values(doc.diagrams)[0]!.views);
  expect(views().filter((v) => v.kind === 'note')[0]).toMatchObject({ text: 'Remember the invariant' });
  expect(views().filter((v) => v.kind === 'noteLink')).toHaveLength(1);

  // Insert a bend point by dragging the segment midpoint handle.
  await selectEdge(page, 'association');
  const mid = (await page.getByTestId('edge-midpoint').first().boundingBox())!;
  await dragBy(page, mid.x + mid.width / 2, mid.y + mid.height / 2, 0, -80);
  doc = await snapshot(page);
  const assocEdge = views().find((v) => v.kind === 'edge')!;
  expect(assocEdge.waypoints as unknown[]).toHaveLength(1);

  // Set a role and drag its label; the offset persists.
  await page.getByTestId('targetEnd-role').fill('owner');
  await page.getByTestId('targetEnd-role').press('Enter');
  await selectEdge(page, 'association');
  const label = (await page.getByTestId('edge-label-targetRole').boundingBox())!;
  await dragBy(page, label.x + label.width / 2, label.y + label.height / 2, 25, -15);
  doc = await snapshot(page);
  expect((views().find((v) => v.kind === 'edge')!.labelOffsets as Record<string, { x: number; y: number }>).targetRole).toBeTruthy();

  // Reconnect the target end from B to C by dragging the endpoint handle.
  await selectEdge(page, 'association');
  const handle = (await page.getByTestId('edge-target-handle').boundingBox())!;
  const c = (await node(page, 'C').boundingBox())!;
  await dragBy(page, handle.x + handle.width / 2, handle.y + handle.height / 2, c.x + c.width / 2 - (handle.x + handle.width / 2), c.y + c.height / 2 - (handle.y + handle.height / 2));
  doc = await snapshot(page);
  const assoc = elementsOfKind(doc, 'association')[0]!;
  expect(assoc.targetId).toBe(byName(doc, 'C').id);

  // Reconnection resets bends; add one again, then double-click it to remove it.
  await selectEdge(page, 'association');
  const mid2 = (await page.getByTestId('edge-midpoint').first().boundingBox())!;
  await dragBy(page, mid2.x + mid2.width / 2, mid2.y + mid2.height / 2, 60, 0);
  doc = await snapshot(page);
  expect(views().find((v) => v.kind === 'edge')!.waypoints as unknown[]).toHaveLength(1);
  await page.getByTestId('edge-waypoint').first().dblclick();
  doc = await snapshot(page);
  expect(views().find((v) => v.kind === 'edge')!.waypoints as unknown[]).toHaveLength(0);
});

test('sequence: activation, create and destroy messages, found message, operand divider', async ({ page }) => {
  await newProject(page, 'Lifecycle');
  await addDiagram(page, 'sequence', 'Objects');
  const box = (await page.getByTestId('sequence-canvas').boundingBox())!;
  const addLifeline = async (x: number, name: string) => {
    await page.getByTestId('tool-seq.lifeline').click();
    await page.mouse.click(box.x + x, box.y + 200);
    await page.getByTestId('inline-editor').fill(name);
    await page.getByTestId('inline-editor').press('Enter');
  };
  await addLifeline(200, 'Factory');
  await addLifeline(500, 'Product');
  const lx = async (name: string) => {
    const b = (await page.locator(`[data-testid="seq-lifeline"][data-name="${name}"]`).boundingBox())!;
    return b.x + b.width / 2;
  };
  // Activation by dragging along the Factory lifeline.
  await page.getByTestId('tool-seq.activation').click();
  await dragBy(page, await lx('Factory'), box.y + 140, 0, 160);
  // Create message Factory → Product.
  await page.getByTestId('tool-seq.create').click();
  await dragBy(page, await lx('Factory'), box.y + 170, (await lx('Product')) - (await lx('Factory')), 0);
  await page.getByTestId('inline-editor').press('Escape');
  // Destroy later.
  await page.getByTestId('tool-seq.destroy').click();
  await dragBy(page, await lx('Factory'), box.y + 260, (await lx('Product')) - (await lx('Factory')), 0);
  await page.getByTestId('inline-editor').press('Escape');
  // Found message into Factory.
  await page.getByTestId('tool-seq.found').click();
  await page.mouse.click(await lx('Factory'), box.y + 120);
  await page.getByTestId('inline-editor').fill('start');
  await page.getByTestId('inline-editor').press('Enter');

  const doc = await snapshot(page);
  const sorts = elementsOfKind(doc, 'message').map((m) => m.sort).sort();
  expect(sorts).toEqual(['asynchronous', 'create', 'destroy']);
  expect(elementsOfKind(doc, 'message').find((m) => m.sort === 'asynchronous')).toMatchObject({ sourceLifelineId: null, targetLifelineId: byName(doc, 'Factory').id });
  const activation = Object.values(Object.values(doc.diagrams)[0]!.views).find((v) => v.kind === 'activation')!;
  expect((activation.endY as number) - (activation.startY as number)).toBeGreaterThan(100);
  // No validation errors (destroy is the last message on Product).
  await expect(page.locator('[data-testid="problem-item"][data-severity="error"]')).toHaveCount(0);

  // Opt fragment: add a second operand and drag its divider.
  await page.getByTestId('tool-fragment.opt').click();
  await page.mouse.click(box.x + 350, box.y + 330);
  await page.getByTestId('add-operands').click();
  await page.getByTestId('seq-fragment-tag').click();
  const divider = page.getByTestId('seq-operand-divider');
  await expect(divider).toHaveCount(1);
  const d = (await divider.boundingBox())!;
  const fragBefore = (await snapshot(page)).diagrams;
  await dragBy(page, d.x + d.width / 2, d.y + d.height / 2, 0, 30);
  const after = await snapshot(page);
  const fv = (x: typeof fragBefore) => Object.values(Object.values(x)[0]!.views).find((v) => v.kind === 'fragment')!.operandYs as Record<string, number>;
  expect(Object.values(fv(after.diagrams))[0]).toBeGreaterThan(Object.values(fv(fragBefore))[0]!);
});

test('copy/paste across diagrams clones semantics; problems panel navigates to the element', async ({ page }) => {
  await newProject(page, 'Clipboard');
  await addDiagram(page, 'class', 'First');
  await place(page, 'class.class', 250, 200, 'Account');
  await place(page, 'class.class', 600, 200, 'Owner');
  await connect(page, 'class.association', 'Account', 'Owner');
  await canvas(page).focus();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press(`${MOD}+c`);
  await addDiagram(page, 'class', 'Second');
  await canvas(page).focus();
  await page.keyboard.press(`${MOD}+v`);
  await expect(page.locator('[data-testid="uml-node"][data-kind="class"]')).toHaveCount(2);
  const doc = await snapshot(page);
  expect(elementsOfKind(doc, 'class').map((c) => c.name).sort()).toEqual(['Account', 'Account2', 'Owner', 'Owner2']);
  expect(elementsOfKind(doc, 'association')).toHaveLength(2);

  // Create an error (self-inheritance is impossible from the UI; use an inheritance cycle).
  await connect(page, 'class.generalization', 'Account2', 'Owner2');
  await connect(page, 'class.generalization', 'Owner2', 'Account2');
  const problem = page.locator('[data-testid="problem-item"][data-code="inheritanceCycle"]').first();
  await expect(problem).toBeVisible();
  await page.locator('[data-testid="diagram-tab"]', { hasText: 'First' }).click();
  await problem.click();
  await expect(page.locator('[data-testid="diagram-tab"][aria-selected="true"]')).toContainText('Second');
  await expect(page.locator('[data-testid="uml-node"][data-selected="true"]')).toHaveCount(1);
});

test('code generation produces a zip of skeletons; text export offers PlantUML', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('start-template-library').click();
  await expect(node(page, 'Book')).toBeVisible();
  await page.getByTestId('menubar-file').click();
  await page.getByTestId('menu-file.codegen').click();
  await expect(page.getByTestId('codegen-dialog')).toBeVisible();
  await page.getByTestId('codegen-language').selectOption('java');
  await expect(page.getByTestId('codegen-preview')).toContainText('public');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('codegen-download').click()]);
  const zipPath = await download.path();
  const files = unzipSync(new Uint8Array(await readFile(zipPath!)));
  expect(Object.keys(files)).toContain('Book.java');
  expect(strFromU8(files['Book.java']!)).toContain('public class Book');
  expect(strFromU8(files['README-GENERATED.txt']!)).toMatch(/skeleton|stub/i);

  await page.getByTestId('menubar-file').click();
  await page.getByTestId('menu-file.exportText').click();
  await expect(page.getByTestId('text-export-output')).toHaveValue(/@startuml[\s\S]*class "Book"[\s\S]*@enduml/);
  await page.getByTestId('text-export-format').selectOption('mermaid');
  await expect(page.getByTestId('text-export-output')).toHaveValue(/^classDiagram/);
});

test('language switch and theme switch apply immediately', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('start-template-ticket').click();
  await page.keyboard.press(`${MOD}+,`);
  await page.getByTestId('settings-language').selectOption('fr');
  await page.getByTestId('settings-theme').selectOption('dark');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('menubar-file')).toHaveText('Fichier');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
});
