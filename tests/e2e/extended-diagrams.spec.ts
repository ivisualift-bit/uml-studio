import type { Page } from '@playwright/test';
import {
  addDiagram,
  byName,
  comparable,
  connect,
  edge,
  elementsOfKind,
  expect,
  exportDiagram,
  newProject,
  node,
  openFile,
  parseSvg,
  place,
  saveProject,
  selectEdge,
  snapshot,
  test,
} from './helpers';

/** Each extended diagram type: create, edit, persist (save → reopen) and export (spec §1.2 DoD). */
async function persistAndExport(page: Page, expectedTexts: string[], diagramName?: string) {
  const before = await snapshot(page);
  const saved = await saveProject(page);
  await page.reload();
  await openFile(page, saved.path);
  await expect(page.locator('[data-canvas]')).toBeVisible();
  if (diagramName)
    await page
      .locator(`[data-testid="explorer-item"][data-kind^="diagram:"][data-name="${diagramName}"]`)
      .dblclick();
  expect(comparable(await snapshot(page))).toEqual(comparable(before));
  const svg = await exportDiagram(page, 'svg');
  const parsed = await parseSvg(page, svg.bytes.toString('utf8'));
  for (const text of expectedTexts) expect(parsed.texts).toContain(text);
}

test('package diagram: packages, contained class ownership, «import» dependency', async ({ page }) => {
  await newProject(page, 'Packages');
  await addDiagram(page, 'package', 'Layers');
  await place(page, 'pkg.package', 250, 250, 'ui');
  await place(page, 'pkg.package', 650, 250, 'domain');
  await place(page, 'pkg.class', 650, 270, 'Order');
  await connect(page, 'pkg.import', 'ui', 'domain', { toTop: true });
  const doc = await snapshot(page);
  expect(byName(doc, 'Order').ownerId).toBe(byName(doc, 'domain').id);
  expect(elementsOfKind(doc, 'packageImport')[0]).toMatchObject({
    sourceId: byName(doc, 'ui').id,
    targetId: byName(doc, 'domain').id,
  });
  await expect(edge(page, 'packageImport').locator('text', { hasText: '«import»' })).toHaveCount(1);
  await persistAndExport(page, ['ui', 'domain', 'Order', '«import»']);
});

test('object diagram: instances typed by a class, slots from attributes, links', async ({ page }) => {
  await newProject(page, 'Objects');
  await addDiagram(page, 'class', 'Types');
  await place(page, 'class.class', 300, 200, 'Car');
  await node(page, 'Car').click();
  await page.getByTestId('add-attribute').click();
  await page.getByTestId('inline-editor').fill('- plate: String');
  await page.getByTestId('inline-editor').press('Enter');
  await addDiagram(page, 'object', 'Snapshot');
  await place(page, 'obj.instance', 300, 200, 'myCar');
  await place(page, 'obj.instance', 650, 200, 'garage');
  await node(page, 'myCar').click();
  await page.locator('select').filter({ hasText: 'Car (' }).first().selectOption({ label: 'Car (Class)' });
  // Add a slot defined by the classifier's attribute.
  await page.locator('select').filter({ hasText: 'plate' }).selectOption({ label: 'plate' });
  await connect(page, 'obj.link', 'myCar', 'garage');
  const doc = await snapshot(page);
  const instance = byName(doc, 'myCar') as unknown as {
    classifierId: string;
    slots: Array<{ name: string; definingFeatureId: string | null }>;
  };
  expect(instance.classifierId).toBe(byName(doc, 'Car').id);
  expect(instance.slots[0]).toMatchObject({ name: 'plate' });
  expect(instance.slots[0]!.definingFeatureId).not.toBeNull();
  expect(elementsOfKind(doc, 'link')).toHaveLength(1);
  await persistAndExport(page, ['myCar : Car', 'garage', 'plate = '], 'Snapshot');
});

test('component diagram: components, provided interface (ball), required (usage), assembly connector, port ownership', async ({
  page,
}) => {
  await newProject(page, 'Components');
  await addDiagram(page, 'component', 'System');
  await place(page, 'cmp.component', 250, 200, 'Orders');
  await place(page, 'cmp.component', 650, 200, 'Billing');
  await place(page, 'cmp.lollipop', 450, 420, 'IPayment');
  await place(page, 'cmp.port', 330, 200, 'api');
  await connect(page, 'cmp.realization', 'Billing', 'IPayment');
  await connect(page, 'cmp.usage', 'Orders', 'IPayment');
  await connect(page, 'cmp.assembly', 'Orders', 'Billing');
  const doc = await snapshot(page);
  expect(byName(doc, 'api').ownerId).toBe(byName(doc, 'Orders').id);
  expect(elementsOfKind(doc, 'connector')[0]).toMatchObject({ connectorKind: 'assembly' });
  // Realization towards a ball-notation interface is drawn as a plain solid line (no triangle).
  const realization = edge(page, 'realization');
  await expect(realization.locator('polygon')).toHaveCount(0);
  await persistAndExport(page, ['Orders', 'Billing', 'IPayment', '«use»']);
});

test('deployment diagram: device, nested execution environment, artifact, communication path, «deploy»', async ({
  page,
}) => {
  await newProject(page, 'Deployment');
  await addDiagram(page, 'deployment', 'Prod');
  await place(page, 'dep.node', 450, 250, 'Server');
  await place(page, 'dep.env', 450, 260, 'JVM');
  await place(page, 'dep.device', 150, 250, 'Laptop');
  await place(page, 'dep.artifact', 800, 450, 'app.jar');
  await connect(page, 'dep.path', 'Laptop', 'Server', { toTop: true });
  await connect(page, 'dep.deployment', 'app.jar', 'JVM', { toTop: true });
  const doc = await snapshot(page);
  expect(byName(doc, 'JVM')).toMatchObject({
    nodeKind: 'executionEnvironment',
    ownerId: byName(doc, 'Server').id,
  });
  expect(byName(doc, 'Laptop')).toMatchObject({ nodeKind: 'device' });
  await expect(edge(page, 'deployment').locator('text', { hasText: '«deploy»' })).toHaveCount(1);
  await persistAndExport(page, ['Server', 'JVM', '«device»', 'app.jar', '«deploy»']);
});

test('composite structure: structured class with parts and ports joined by a connector', async ({ page }) => {
  await newProject(page, 'Structure');
  await addDiagram(page, 'compositeStructure', 'Car internals');
  await place(page, 'cs.class', 450, 300, 'Car');
  await place(page, 'cs.part', 360, 320, 'engine');
  await place(page, 'cs.part', 560, 320, 'wheels');
  await connect(page, 'cs.connector', 'engine', 'wheels');
  await node(page, 'wheels').click();
  await page.getByTestId('prop-name').fill('wheels');
  const doc = await snapshot(page);
  expect(byName(doc, 'engine').ownerId).toBe(byName(doc, 'Car').id);
  expect(byName(doc, 'wheels').ownerId).toBe(byName(doc, 'Car').id);
  expect(elementsOfKind(doc, 'connector')).toHaveLength(1);
  await persistAndExport(page, ['Car', 'engine', 'wheels']);
});

test('communication diagram: lifelines linked by a connector carrying numbered messages', async ({
  page,
}) => {
  await newProject(page, 'Communication');
  await addDiagram(page, 'communication', 'Ordering');
  await place(page, 'com.lifeline', 250, 250, 'client');
  await place(page, 'com.lifeline', 650, 250, 'server');
  await connect(page, 'com.link', 'client', 'server');
  await selectEdge(page, 'connector');
  await page.getByTestId('add-comm-message').click();
  const row = page.getByTestId('comm-message-row').first();
  await row.locator('input').nth(1).fill('placeOrder()');
  await row.locator('input').nth(1).press('Enter');
  const doc = await snapshot(page);
  const connector = elementsOfKind(doc, 'connector')[0] as unknown as {
    messages: Array<{ sequence: string; name: string }>;
  };
  expect(connector.messages[0]).toMatchObject({ sequence: '1', name: 'placeOrder()' });
  await expect(edge(page, 'connector').locator('text', { hasText: '1: placeOrder()' })).toHaveCount(1);
  await persistAndExport(page, ['client', 'server', '1: placeOrder()']);
});

test('profile diagram: stereotype with tag definition extends a metaclass; applied stereotype renders on a class', async ({
  page,
}) => {
  await newProject(page, 'Profiles');
  await addDiagram(page, 'profile', 'Persistence');
  await place(page, 'pro.stereotype', 250, 200, 'Entity');
  await place(page, 'pro.metaclass', 650, 200, 'Class');
  await connect(page, 'pro.extension', 'Entity', 'Class');
  await node(page, 'Entity').click();
  await page.getByTestId('add-tagDefinitions').click();
  await addDiagram(page, 'class', 'Model');
  await place(page, 'class.class', 300, 200, 'Customer');
  await node(page, 'Customer').click();
  await page.locator('select').filter({ hasText: '«Entity»' }).selectOption({ label: '«Entity»' });
  await expect(node(page, 'Customer').locator('text', { hasText: '«Entity»' })).toHaveCount(1);
  const doc = await snapshot(page);
  expect(elementsOfKind(doc, 'extension')[0]).toMatchObject({
    sourceId: byName(doc, 'Entity').id,
    targetId: byName(doc, 'Class').id,
  });
  expect(
    (byName(doc, 'Customer') as unknown as { appliedStereotypes: Array<{ stereotypeId: string }> })
      .appliedStereotypes[0]!.stereotypeId,
  ).toBe(byName(doc, 'Entity').id);
  await persistAndExport(page, ['Customer', '«Entity»'], 'Model');
});

test('information flow diagram: «flow» between classifiers conveying an information item', async ({
  page,
}) => {
  await newProject(page, 'Flows');
  await addDiagram(page, 'informationFlow', 'Data');
  await place(page, 'if.actor', 200, 250, 'Customer');
  await place(page, 'if.class', 650, 250, 'Shop');
  await place(page, 'if.item', 420, 450, 'Payment');
  await connect(page, 'if.flow', 'Customer', 'Shop');
  await selectEdge(page, 'informationFlow');
  await page.getByText('Payment (Information Item)').click();
  const doc = await snapshot(page);
  expect(
    (elementsOfKind(doc, 'informationFlow')[0] as unknown as { conveyedIds: string[] }).conveyedIds,
  ).toEqual([byName(doc, 'Payment').id]);
  await expect(edge(page, 'informationFlow').locator('text', { hasText: 'Payment' })).toHaveCount(1);
  await persistAndExport(page, ['Customer', 'Shop', '«flow»']);
});
