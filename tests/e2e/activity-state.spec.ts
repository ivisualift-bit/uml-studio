import { addDiagram, byName, comparable, connect, edge, elementsOfKind, expect, exportDiagram, newProject, node, openFile, parseSvg, place, saveProject, selectEdge, setInspectorField, snapshot, test } from './helpers';

test('E2E-005 activity: guarded decision, swimlanes, move an action between lanes keeps flows, save/reopen/export', async ({ page }) => {
  await newProject(page, 'Loans');
  await addDiagram(page, 'activity', 'Approval');
  await place(page, 'act.partition', 250, 330, 'Customer');
  await place(page, 'act.partition', 490, 330, 'Bank');
  await place(page, 'act.initial', 250, 130);
  await place(page, 'act.action', 250, 200, 'Submit');
  await place(page, 'act.decision', 250, 280);
  await place(page, 'act.action', 200, 370, 'Approve');
  await place(page, 'act.action', 300, 450, 'Reject');
  await place(page, 'act.merge', 250, 520);
  await place(page, 'act.final', 250, 570);

  let doc = await snapshot(page);
  const controls = elementsOfKind(doc, 'controlNode');
  const kinds = (k: string) => controls.find((c) => c.nodeKind === k)!;
  const viewOf = (elementId: string) => Object.values(Object.values(doc.diagrams)[0]!.views).find((v) => v.elementId === elementId)!;
  const nodeAt = async (elementId: string) => page.locator(`[data-testid="uml-node"][data-element-id="${elementId}"]`);

  const flows: Array<[string, string]> = [
    [kinds('initial').id, byName(doc, 'Submit').id],
    [byName(doc, 'Submit').id, kinds('decision').id],
    [kinds('decision').id, byName(doc, 'Approve').id],
    [kinds('decision').id, byName(doc, 'Reject').id],
    [byName(doc, 'Approve').id, kinds('merge').id],
    [byName(doc, 'Reject').id, kinds('merge').id],
    [kinds('merge').id, kinds('activityFinal').id],
  ];
  for (const [from, to] of flows) {
    await page.getByTestId('tool-act.controlFlow').click();
    await (await nodeAt(from)).click();
    await (await nodeAt(to)).click();
  }
  await expect(edge(page, 'controlFlow')).toHaveCount(7);
  await selectEdge(page, 'controlFlow', 2);
  await setInspectorField(page, 'prop-guard', 'amount <= limit');
  await selectEdge(page, 'controlFlow', 3);
  await setInspectorField(page, 'prop-guard', '[amount > limit]');
  doc = await snapshot(page);
  const guards = elementsOfKind(doc, 'controlFlow').map((f) => f.guard).filter(Boolean).sort();
  expect(guards).toEqual(['amount <= limit', 'amount > limit']);
  await expect(edge(page, 'controlFlow').locator('text', { hasText: '[amount <= limit]' })).toHaveCount(1);

  // Lane membership is semantic (partitionId) and follows the action when moved between lanes.
  const reject = byName(doc, 'Reject');
  expect(reject.partitionId).toBe(byName(doc, 'Customer').id);
  const rejectBox = (await node(page, 'Reject').boundingBox())!;
  await page.mouse.move(rejectBox.x + rejectBox.width / 2, rejectBox.y + rejectBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(rejectBox.x + rejectBox.width / 2 + 100, rejectBox.y + rejectBox.height / 2, { steps: 8 });
  await page.mouse.move(rejectBox.x + rejectBox.width / 2 + 220, rejectBox.y + rejectBox.height / 2, { steps: 8 });
  await page.mouse.up();
  doc = await snapshot(page);
  expect(byName(doc, 'Reject').partitionId).toBe(byName(doc, 'Bank').id);
  expect(viewOf(byName(doc, 'Reject').id).containerViewId).toBe(viewOf(byName(doc, 'Bank').id).id);
  // Flows still attached to the moved action.
  const rejectFlows = elementsOfKind(doc, 'controlFlow').filter((f) => f.sourceId === reject.id || f.targetId === reject.id);
  expect(rejectFlows).toHaveLength(2);
  const edgeViews = Object.values(Object.values(doc.diagrams)[0]!.views).filter((v) => v.kind === 'edge');
  expect(edgeViews).toHaveLength(7);

  const saved = await saveProject(page);
  await page.reload();
  await openFile(page, saved.path);
  await expect(node(page, 'Reject')).toBeVisible();
  expect(comparable(await snapshot(page))).toEqual(comparable(doc));
  const svg = await exportDiagram(page, 'svg');
  const parsed = await parseSvg(page, svg.bytes.toString('utf8'));
  for (const text of ['Customer', 'Bank', 'Submit', 'Approve', 'Reject', '[amount <= limit]', '[amount > limit]']) expect(parsed.texts).toContain(text);
});

test('E2E-006 state machine: transitions with trigger [guard] / effect, rename, no dead references after reopen, export', async ({ page }) => {
  await newProject(page, 'Publishing');
  await addDiagram(page, 'stateMachine', 'Article');
  await place(page, 'sm.initial', 100, 250);
  await place(page, 'sm.state', 250, 250, 'Draft');
  await place(page, 'sm.state', 480, 250, 'Published');
  await place(page, 'sm.state', 680, 250, 'Archived');
  await place(page, 'sm.final', 830, 250);
  let doc = await snapshot(page);
  const initial = elementsOfKind(doc, 'pseudostate')[0]!;
  const final = elementsOfKind(doc, 'finalState')[0]!;
  const nodeAt = (id: string) => page.locator(`[data-testid="uml-node"][data-element-id="${id}"]`);
  await page.getByTestId('tool-sm.transition').click();
  await nodeAt(initial.id).click();
  await node(page, 'Draft').click();
  await connect(page, 'sm.transition', 'Draft', 'Published');
  await connect(page, 'sm.transition', 'Published', 'Archived');
  await page.getByTestId('tool-sm.transition').click();
  await node(page, 'Archived').click();
  await nodeAt(final.id).click();
  await expect(edge(page, 'transition')).toHaveCount(4);

  await selectEdge(page, 'transition', 1);
  await setInspectorField(page, 'prop-trigger', 'publish');
  await setInspectorField(page, 'prop-guard', 'approved');
  await setInspectorField(page, 'prop-effect', 'notifySubscribers');
  await expect(edge(page, 'transition').locator('text', { hasText: 'publish [approved] / notifySubscribers' })).toHaveCount(1);

  // Rename a state inline (double-click).
  await node(page, 'Draft').dblclick();
  await page.getByTestId('inline-editor').fill('Editing');
  await page.getByTestId('inline-editor').press('Enter');
  await expect(node(page, 'Editing')).toBeVisible();

  doc = await snapshot(page);
  const t = elementsOfKind(doc, 'transition').find((x) => x.trigger === 'publish')!;
  expect(t).toMatchObject({ guard: 'approved', effect: 'notifySubscribers', sourceId: byName(doc, 'Editing').id, targetId: byName(doc, 'Published').id });
  await expect(page.getByTestId('problem-item').and(page.locator('[data-severity="error"]'))).toHaveCount(0);

  const saved = await saveProject(page);
  await page.reload();
  await openFile(page, saved.path);
  await expect(node(page, 'Editing')).toBeVisible();
  const reopened = await snapshot(page);
  expect(comparable(reopened)).toEqual(comparable(doc));
  for (const tr of elementsOfKind(reopened, 'transition')) {
    expect(reopened.modelElements[tr.sourceId as string]).toBeDefined();
    expect(reopened.modelElements[tr.targetId as string]).toBeDefined();
  }
  const svg = await exportDiagram(page, 'svg');
  const parsed = await parseSvg(page, svg.bytes.toString('utf8'));
  expect(parsed.texts).toContain('publish [approved] / notifySubscribers');
  expect(parsed.texts).toContain('Editing');
});
