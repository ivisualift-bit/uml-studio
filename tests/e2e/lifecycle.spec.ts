import {
  addDiagram,
  comparable,
  expect,
  MOD,
  newProject,
  node,
  openFileDiscardingChanges,
  place,
  snapshot,
  test,
  writeTemp,
} from './helpers';

test('E2E-007 recovery: unsaved work is snapshotted, offered after relaunch, restored intact and still dirty', async ({
  page,
}) => {
  await newProject(page, 'Unsaved Work');
  await addDiagram(page, 'class', 'Draft');
  await place(page, 'class.class', 300, 200, 'Recovered');
  const before = await snapshot(page);
  await expect(page.getByTestId('dirty-indicator')).toHaveAttribute('data-dirty', 'true');
  await page.waitForTimeout(2600); // debounce (~1.5 s) + IndexedDB write

  await page.reload(); // simulated relaunch / crash
  await expect(page.getByTestId('recovery-dialog')).toBeVisible();
  await expect(page.getByTestId('recovery-item')).toContainText('Unsaved Work');
  await page.getByTestId('recovery-restore').click();
  await expect(node(page, 'Recovered')).toBeVisible();
  expect(comparable(await snapshot(page))).toEqual(comparable(before));
  await expect(page.getByTestId('dirty-indicator')).toHaveAttribute('data-dirty', 'true');
});

test('E2E-008 malformed input: corrupt JSON, newer schema, duplicate IDs and dangling references are rejected; current project intact', async ({
  page,
}) => {
  await newProject(page, 'Precious');
  await addDiagram(page, 'class', 'Keep');
  await place(page, 'class.class', 300, 200, 'KeepMe');
  const original = await snapshot(page);
  const valid = JSON.stringify(original);

  const newer = JSON.parse(valid);
  newer.schemaVersion = 42;
  const dupKey = valid
    .replace('"modelElements": {', '"modelElements": {')
    .replace(
      /"modelElements":\{"([^"]+)":/,
      (_m, id: string) => `"modelElements":{"${id}":{"kind":"class"},"${id}":`,
    );
  const dangling = JSON.parse(valid);
  const diagram = Object.values(dangling.diagrams)[0] as { views: Record<string, { elementId?: string }> };
  Object.values(diagram.views)[0]!.elementId = 'missing-element';

  const cases: Array<[string, string, string]> = [
    ['corrupt.umls', '{"format":"uml-studio-project", "schemaVersion": 1, "modelElements": {', 'invalidJson'],
    ['newer.umls', JSON.stringify(newer), 'newerVersion'],
    ['duplicate.umls', dupKey, 'duplicateKeys'],
    ['dangling.umls', JSON.stringify(dangling), 'integrity'],
    ['not-a-project.umls', '{"hello":"world"}', 'notAProject'],
  ];
  for (const [name, content, code] of cases) {
    const file = await writeTemp(name, content);
    await openFileDiscardingChanges(page, file);
    await expect(page.getByTestId('load-error-dialog')).toBeVisible();
    await expect(page.getByTestId('load-error-message')).toHaveAttribute('data-code', code);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('load-error-dialog')).toBeHidden();
    expect(comparable(await snapshot(page)), `${name} must not change the open project`).toEqual(
      comparable(original),
    );
    await expect(node(page, 'KeepMe')).toBeVisible();
  }
});

test('E2E-009 keyboard: shortcuts create/duplicate/delete/undo/redo; text fields keep their keystrokes', async ({
  page,
}) => {
  await newProject(page, 'Keys');
  await addDiagram(page, 'class', 'K');
  await place(page, 'class.class', 300, 200, 'Person');
  await node(page, 'Person').click();
  await page.locator('[data-canvas]').focus();

  await page.keyboard.press(`${MOD}+d`);
  await expect(page.locator('[data-testid="uml-node"][data-kind="class"]')).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-testid="uml-node"][data-kind="class"]')).toHaveCount(1);
  await page.keyboard.press(`${MOD}+z`);
  await expect(page.locator('[data-testid="uml-node"][data-kind="class"]')).toHaveCount(2);
  await page.keyboard.press(`${MOD}+Shift+z`);
  await expect(page.locator('[data-testid="uml-node"][data-kind="class"]')).toHaveCount(1);

  // Menus work and reflect shortcuts.
  await page.getByTestId('menubar-edit').click();
  await expect(page.getByTestId('menu-edit.undo')).toBeVisible();
  await page.getByTestId('menu-edit.undo').click();
  await expect(page.locator('[data-testid="uml-node"][data-kind="class"]')).toHaveCount(2);

  // Typing in an inspector field: a, +, -, Backspace, Delete and Mod+A stay in the field.
  await node(page, 'Person2').click(); // the duplicate got a unique name and sits on top
  const name = page.getByTestId('prop-name');
  await name.click();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.type('a+b-cz');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Delete');
  await expect(name).toHaveValue('a+b-');
  await expect(page.locator('[data-testid="uml-node"][data-kind="class"]')).toHaveCount(2); // nothing deleted
  await expect(page.locator('[data-testid="uml-node"][data-selected="true"]')).toHaveCount(1); // Mod+A did not select all
  await name.press('Enter');
  await expect(node(page, 'a+b-')).toBeVisible();

  // Keyboard-only creation via the command palette.
  await page.keyboard.press(`${MOD}+k`);
  await page.getByTestId('command-palette-input').fill('new diagram');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('new-diagram-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
});
