import {
  addDiagram,
  byName,
  comparable,
  connect,
  edge,
  elementsOfKind,
  expect,
  exportDiagram,
  MOD,
  newProject,
  node,
  openFile,
  parseSvg,
  place,
  saveProject,
  selectEdge,
  setInspectorField,
  snapshot,
  test,
} from './helpers';

test('E2E-001 full class round trip: create, edit, connect, export SVG, save, reopen, undo/redo', async ({
  page,
}) => {
  await newProject(page, 'University');
  await addDiagram(page, 'class', 'Domain');

  await place(page, 'class.class', 300, 120, 'Person');
  await place(page, 'class.class', 300, 380, 'Student');
  await place(page, 'class.class', 700, 380, 'Course');

  // Person.name : String (quick-add button + inline UML text)
  await node(page, 'Person').click();
  await page.getByTestId('add-attribute').click();
  await page.getByTestId('inline-editor').fill('- name: String');
  await page.getByTestId('inline-editor').press('Enter');

  await node(page, 'Student').click();
  await page.getByTestId('add-attribute').click();
  await page.getByTestId('inline-editor').fill('- studentId: String');
  await page.getByTestId('inline-editor').press('Enter');
  await node(page, 'Student').click();
  await page.getByTestId('add-operation').click();
  await page.getByTestId('inline-editor').fill('+ enroll(course: Course): void');
  await page.getByTestId('inline-editor').press('Enter');

  let doc = await snapshot(page);
  const student = byName(doc, 'Student') as unknown as {
    attributes: Array<{ name: string; type: string }>;
    operations: Array<{
      name: string;
      returnType: string;
      parameters: Array<{ name: string; type: string; typeElementId: string | null }>;
    }>;
  };
  expect(student.attributes.map((a) => `${a.name}:${a.type}`)).toEqual(['studentId:String']);
  expect(student.operations[0]).toMatchObject({ name: 'enroll', returnType: 'void' });
  expect(student.operations[0]!.parameters[0]).toMatchObject({
    name: 'course',
    type: 'Course',
    typeElementId: byName(doc, 'Course').id,
  });

  // Student → Person generalization, Student — Course association with end multiplicities
  await connect(page, 'class.generalization', 'Student', 'Person');
  await connect(page, 'class.association', 'Student', 'Course');
  await expect(edge(page, 'generalization')).toHaveCount(1);
  await expect(edge(page, 'association')).toHaveCount(1);
  await selectEdge(page, 'association');
  await setInspectorField(page, 'sourceEnd-multiplicity', '0..*');
  await setInspectorField(page, 'targetEnd-multiplicity', '1..*');

  doc = await snapshot(page);
  const gen = elementsOfKind(doc, 'generalization')[0]!;
  expect(gen).toMatchObject({ sourceId: byName(doc, 'Student').id, targetId: byName(doc, 'Person').id });
  const assoc = elementsOfKind(doc, 'association')[0]!;
  expect(assoc).toMatchObject({ sourceEnd: { multiplicity: '0..*' }, targetEnd: { multiplicity: '1..*' } });

  // Canvas shows both multiplicities
  const assocEdge = edge(page, 'association');
  await expect(assocEdge.locator('text', { hasText: '0..*' })).toHaveCount(1);
  await expect(assocEdge.locator('text', { hasText: '1..*' })).toHaveCount(1);

  // SVG export contains classes, labels and the generalization triangle.
  const svg = await exportDiagram(page, 'svg');
  const parsed = await parseSvg(page, svg.bytes.toString('utf8'));
  for (const text of [
    'Person',
    'Student',
    'Course',
    '- name: String',
    '+ enroll(course: Course): void',
    '0..*',
    '1..*',
  ])
    expect(parsed.texts).toContain(text);
  expect(parsed.polygons).toBeGreaterThan(0);

  // Save → reload → reopen: identical semantics and geometry.
  const before = await snapshot(page);
  const saved = await saveProject(page);
  await expect(page.getByTestId('dirty-indicator')).toHaveAttribute('data-dirty', 'false');
  await page.reload();
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await openFile(page, saved.path);
  await expect(node(page, 'Student')).toBeVisible();
  const reopened = await snapshot(page);
  expect(comparable(reopened)).toEqual(comparable(before));

  // Undo two steps, redo two: identical identifiers and geometry.
  await node(page, 'Course').click();
  await page.locator('[data-canvas]').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1300); // separate history entries (nudge merge window)
  await page.keyboard.press('Shift+ArrowDown');
  const edited = await snapshot(page);
  await page.keyboard.press(`${MOD}+z`);
  await page.keyboard.press(`${MOD}+z`);
  expect(comparable(await snapshot(page))).toEqual(comparable(reopened));
  await page.keyboard.press(`${MOD}+Shift+z`);
  await page.keyboard.press(`${MOD}+Shift+z`);
  expect(comparable(await snapshot(page))).toEqual(comparable(edited));
});

test('E2E-002 shared semantic entity across two diagrams: rename syncs, view delete keeps model, model delete cleans up', async ({
  page,
}) => {
  await newProject(page, 'Shop');
  await addDiagram(page, 'class', 'Diagram A');
  await place(page, 'class.class', 300, 200, 'Customer');
  await place(page, 'class.class', 650, 200, 'Order');
  await connect(page, 'class.association', 'Customer', 'Order');

  await addDiagram(page, 'class', 'Diagram B');
  // Drag the existing Customer from the explorer onto diagram B → a second VIEW of the same element.
  const item = page.locator('[data-testid="explorer-item"][data-name="Customer"]');
  await item.dragTo(page.locator('[data-canvas]'), { targetPosition: { x: 300, y: 250 } });
  await expect(node(page, 'Customer')).toHaveCount(1);
  let doc = await snapshot(page);
  expect(elementsOfKind(doc, 'class').filter((c) => c.name === 'Customer')).toHaveLength(1);
  const customerId = byName(doc, 'Customer').id;
  const views = Object.values(doc.diagrams).flatMap((d) =>
    Object.values(d.views).filter((v) => v.elementId === customerId),
  );
  expect(views).toHaveLength(2);

  // Rename in the inspector → both diagrams update.
  await node(page, 'Customer').click();
  await setInspectorField(page, 'prop-name', 'Client');
  await expect(node(page, 'Client')).toBeVisible();
  await page.locator('[data-testid="diagram-tab"]', { hasText: 'Diagram A' }).click();
  await expect(node(page, 'Client')).toBeVisible();

  // Delete the view in A → B and the model keep the element.
  await node(page, 'Client').click();
  await page.keyboard.press('Delete');
  await expect(node(page, 'Client')).toHaveCount(0);
  doc = await snapshot(page);
  expect(doc.modelElements[customerId]).toBeDefined();
  // The association survives (both ends still exist in the model).
  expect(elementsOfKind(doc, 'association')).toHaveLength(1);
  await page.locator('[data-testid="diagram-tab"]', { hasText: 'Diagram B' }).click();
  await expect(node(page, 'Client')).toBeVisible();
  await expect(page.locator('[data-testid="explorer-item"][data-name="Client"]')).toBeVisible();

  // Delete from the model (explorer context menu) → views and relationships cleaned everywhere.
  await page.locator('[data-testid="explorer-item"][data-name="Client"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Delete from Model/i }).click();
  await expect(page.getByTestId('delete-impact')).toContainText('1 relationship');
  await page.getByTestId('confirm-delete-model').click();
  doc = await snapshot(page);
  expect(doc.modelElements[customerId]).toBeUndefined();
  expect(elementsOfKind(doc, 'association')).toHaveLength(0);
  expect(
    Object.values(doc.diagrams)
      .flatMap((d) => Object.values(d.views))
      .some((v) => v.elementId === customerId),
  ).toBe(false);
  await expect(node(page, 'Client')).toHaveCount(0);
});
