import type { Page } from '@playwright/test';
import {
  addDiagram,
  byName,
  comparable,
  elementsOfKind,
  expect,
  exportDiagram,
  newProject,
  openFile,
  parseSvg,
  pngSize,
  saveProject,
  snapshot,
  test,
} from './helpers';

async function canvasBox(page: Page) {
  return (await page.getByTestId('sequence-canvas').boundingBox())!;
}

async function lifelineX(page: Page, name: string): Promise<number> {
  const box = (await page.locator(`[data-testid="seq-lifeline"][data-name="${name}"]`).boundingBox())!;
  return box.x + box.width / 2;
}

async function addLifeline(page: Page, toolId: string, x: number, name: string) {
  await page.getByTestId(`tool-${toolId}`).click();
  const box = await canvasBox(page);
  await page.mouse.click(box.x + x, box.y + 200);
  const editor = page.getByTestId('inline-editor');
  await editor.fill(name);
  await editor.press('Enter');
}

async function drawMessage(page: Page, toolId: string, from: string, to: string, y: number, label: string) {
  await page.getByTestId(`tool-${toolId}`).click();
  const box = await canvasBox(page);
  const x1 = await lifelineX(page, from);
  const x2 = await lifelineX(page, to);
  if (from === to) {
    await page.mouse.click(x1, box.y + y);
  } else {
    await page.mouse.move(x1, box.y + y);
    await page.mouse.down();
    await page.mouse.move((x1 + x2) / 2, box.y + y, { steps: 4 });
    await page.mouse.move(x2, box.y + y, { steps: 4 });
    await page.mouse.up();
  }
  const editor = page.getByTestId('inline-editor');
  await editor.fill(label);
  await editor.press('Enter');
}

function messageOrder(doc: Awaited<ReturnType<typeof snapshot>>): string[] {
  const diagram = Object.values(doc.diagrams).find((d) => d.kind === 'sequence')!;
  return Object.values(diagram.views)
    .filter((v) => v.kind === 'message')
    .sort((a, b) => (a.sendY as number) - (b.sendY as number) || a.id.localeCompare(b.id))
    .map((v) => doc.modelElements[v.elementId!]!.name);
}

test('E2E-004 sequence: lifelines, sync/reply/self messages, alt fragment, reorder by dragging, resize, save/reopen, SVG+PNG', async ({
  page,
}) => {
  await newProject(page, 'Checkout');
  await addDiagram(page, 'sequence', 'Request flow');
  await addLifeline(page, 'seq.actorLifeline', 160, 'User');
  await addLifeline(page, 'seq.lifeline', 420, 'Frontend');
  await addLifeline(page, 'seq.lifeline', 680, 'API');

  await drawMessage(page, 'seq.sync', 'Frontend', 'API', 200, 'request(data)');
  await drawMessage(page, 'seq.reply', 'API', 'Frontend', 250, 'response');
  await drawMessage(page, 'seq.self', 'API', 'API', 300, 'validate()');

  let doc = await snapshot(page);
  const sorts = Object.fromEntries(elementsOfKind(doc, 'message').map((m) => [m.name, m.sort]));
  expect(sorts).toEqual({ request: 'synchronous', response: 'reply', validate: 'synchronous' });
  const request = byName(doc, 'request');
  expect(request).toMatchObject({
    arguments: 'data',
    sourceLifelineId: byName(doc, 'Frontend').id,
    targetLifelineId: byName(doc, 'API').id,
  });
  expect(byName(doc, 'validate')).toMatchObject({
    sourceLifelineId: byName(doc, 'API').id,
    targetLifelineId: byName(doc, 'API').id,
  });
  expect(messageOrder(doc)).toEqual(['request', 'response', 'validate']);

  // alt fragment drawn around the exchange, guards edited in the inspector.
  await page.getByTestId('tool-fragment.alt').click();
  const box = await canvasBox(page);
  await page.mouse.move(box.x + 330, box.y + 170);
  await page.mouse.down();
  await page.mouse.move(box.x + 600, box.y + 260, { steps: 5 });
  await page.mouse.move(box.x + 820, box.y + 360, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('[data-testid="seq-fragment"][data-operator="alt"]')).toHaveCount(1);
  const guards = page.getByTestId('operands-row');
  await expect(guards).toHaveCount(2);
  await guards.nth(0).locator('input').fill('valid');
  await guards.nth(0).locator('input').press('Enter');
  doc = await snapshot(page);
  const fragment = elementsOfKind(doc, 'combinedFragment')[0] as unknown as {
    operator: string;
    operands: Array<{ guard: string }>;
  };
  expect(fragment.operator).toBe('alt');
  expect(fragment.operands.map((o) => o.guard)).toEqual(['valid', 'else']);

  // Drag "request" down below "response": time order changes; lifelines untouched.
  const requestLine = page.locator(
    '[data-testid="seq-message"][data-name="request"] polyline[data-hit-kind="message"]',
  );
  const r = (await requestLine.boundingBox())!;
  const cy = r.y + r.height / 2;
  await page.mouse.move(r.x + r.width / 2, cy);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width / 2, cy + 40, { steps: 6 });
  await page.mouse.move(r.x + r.width / 2, cy + 70, { steps: 6 });
  await page.mouse.up();
  doc = await snapshot(page);
  expect(messageOrder(doc)).toEqual(['response', 'request', 'validate']);
  const lifelinesBefore = Object.values(Object.values(doc.diagrams)[0]!.views)
    .filter((v) => v.kind === 'lifeline')
    .map((v) => v.x);

  // Moving a lifeline horizontally preserves message order.
  const head = page.locator('[data-testid="seq-lifeline"][data-name="User"] rect').first();
  const h = (await head.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 60, h.y + h.height / 2, { steps: 6 });
  await page.mouse.up();
  doc = await snapshot(page);
  expect(messageOrder(doc)).toEqual(['response', 'request', 'validate']);
  expect(
    Object.values(Object.values(doc.diagrams)[0]!.views)
      .filter((v) => v.kind === 'lifeline')
      .map((v) => v.x),
  ).not.toEqual(lifelinesBefore);

  // Resize the fragment from its corner handle.
  await page.getByTestId('seq-fragment-tag').click();
  const handle = page.getByTestId('seq-fragment-resize');
  const hb = (await handle.boundingBox())!;
  const heightBefore = Object.values(Object.values(doc.diagrams)[0]!.views).find(
    (v) => v.kind === 'fragment',
  )!.height as number;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 40, hb.y + 50, { steps: 6 });
  await page.mouse.up();
  doc = await snapshot(page);
  expect(
    Object.values(Object.values(doc.diagrams)[0]!.views).find((v) => v.kind === 'fragment')!.height as number,
  ).toBeGreaterThan(heightBefore);

  // Save, reopen and compare.
  const saved = await saveProject(page);
  await page.reload();
  await openFile(page, saved.path);
  await expect(page.locator('[data-testid="seq-lifeline"]')).toHaveCount(3);
  expect(comparable(await snapshot(page))).toEqual(comparable(doc));

  const svg = await exportDiagram(page, 'svg');
  const parsed = await parseSvg(page, svg.bytes.toString('utf8'));
  for (const text of [
    'User',
    'Frontend',
    'API',
    'request(data)',
    'response',
    'validate()',
    'alt',
    '[valid]',
    '[else]',
  ])
    expect(parsed.texts).toContain(text);
  expect(parsed.dashed).toBeGreaterThanOrEqual(4); // 3 dashed lifelines + dashed reply (+ operand divider)
  expect(parsed.polygons).toBeGreaterThan(1); // filled synchronous arrowheads + fragment tag
  const png = await exportDiagram(page, 'png');
  expect(pngSize(png.bytes).width).toBeGreaterThan(400);
});
