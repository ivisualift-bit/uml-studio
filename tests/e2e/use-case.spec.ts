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
  place,
  pngSize,
  saveProject,
  snapshot,
  test,
} from './helpers';

test('E2E-003 use case: actor, boundary, association, include with correct direction, save/reopen, PNG', async ({
  page,
}) => {
  await newProject(page, 'Enrollment');
  await addDiagram(page, 'useCase', 'Registration');
  await place(page, 'uc.subject', 520, 300, 'University');
  await place(page, 'uc.useCase', 520, 220, 'Enroll');
  await place(page, 'uc.useCase', 520, 400, 'Authenticate');
  await place(page, 'uc.actor', 180, 300, 'Student');

  await connect(page, 'uc.association', 'Student', 'Enroll');
  await connect(page, 'uc.include', 'Enroll', 'Authenticate');

  const doc = await snapshot(page);
  const include = elementsOfKind(doc, 'include')[0]!;
  expect(include).toMatchObject({
    sourceId: byName(doc, 'Enroll').id,
    targetId: byName(doc, 'Authenticate').id,
  });
  // The boundary is a visual container only: use cases stay owned by the model.
  const boundaryView = Object.values(Object.values(doc.diagrams)[0]!.views).find(
    (v) => v.elementId === byName(doc, 'University').id,
  )!;
  const enrollView = Object.values(Object.values(doc.diagrams)[0]!.views).find(
    (v) => v.elementId === byName(doc, 'Enroll').id,
  )!;
  expect(enrollView.containerViewId).toBe(boundaryView.id);
  expect(byName(doc, 'Enroll').ownerId).toBe(doc.rootModelId);

  // «include» label and the open arrowhead tip on Authenticate (the included use case).
  const includeEdge = edge(page, 'include');
  await expect(includeEdge.locator('text', { hasText: '«include»' })).toHaveCount(1);
  const arrowTip = await includeEdge.locator('polyline').evaluateAll((lines) => {
    // The open-arrow marker is a 3-point polyline; its middle point is the tip.
    const marker = lines.find((l) => (l.getAttribute('points') ?? '').trim().split(/\s+/).length === 3);
    const tip = marker?.getAttribute('points')?.trim().split(/\s+/)[1]?.split(',').map(Number);
    const svg = (marker as SVGGraphicsElement | undefined)?.ownerSVGElement;
    if (!tip || !svg || !marker) return null;
    const point = svg.createSVGPoint();
    point.x = tip[0]!;
    point.y = tip[1]!;
    const screen = point.matrixTransform((marker as SVGGraphicsElement).getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  });
  const authBox = (await node(page, 'Authenticate').boundingBox())!;
  expect(arrowTip).not.toBeNull();
  expect(arrowTip!.x).toBeGreaterThanOrEqual(authBox.x - 2);
  expect(arrowTip!.x).toBeLessThanOrEqual(authBox.x + authBox.width + 2);
  expect(arrowTip!.y).toBeGreaterThanOrEqual(authBox.y - 2);
  expect(arrowTip!.y).toBeLessThanOrEqual(authBox.y + authBox.height / 2 + 2); // enters from above

  const saved = await saveProject(page);
  await page.reload();
  await openFile(page, saved.path);
  await expect(node(page, 'Authenticate')).toBeVisible();
  expect(comparable(await snapshot(page))).toEqual(comparable(doc));

  const png = await exportDiagram(page, 'png');
  const size = pngSize(png.bytes);
  expect(size.width).toBeGreaterThan(300);
  expect(size.height).toBeGreaterThan(200);
});
