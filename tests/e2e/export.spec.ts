import {
  addDiagram,
  connect,
  expect,
  exportDiagram,
  newProject,
  parseSvg,
  place,
  pngSize,
  test,
} from './helpers';

test('E2E-010 export robustness: accents, <, &, long labels, dashed edge and diamond → valid SVG, PNG and PDF', async ({
  page,
}) => {
  await newProject(page, 'Exports');
  await addDiagram(page, 'class', 'Tricky <&> "names"');
  await place(page, 'class.class', 250, 200, 'Élève <&> "Test"');
  await place(page, 'class.class', 700, 200, 'AVeryLongClassNameThatMustStillFitItsBox');
  await place(page, 'class.class', 250, 450, 'Dépendance');
  await connect(page, 'class.composition', 'Élève <&> "Test"', 'AVeryLongClassNameThatMustStillFitItsBox');
  await connect(page, 'class.dependency', 'Dépendance', 'Élève <&> "Test"');

  const svg = await exportDiagram(page, 'svg');
  const text = svg.bytes.toString('utf8');
  expect(text.startsWith('<?xml')).toBe(true);
  expect(text).toContain('&lt;&amp;&gt;');
  const parsed = await parseSvg(page, text);
  expect(parsed.texts).toContain('Élève <&> "Test"');
  expect(parsed.texts).toContain('AVeryLongClassNameThatMustStillFitItsBox');
  expect(parsed.dashed).toBeGreaterThan(0); // dependency
  expect(parsed.polygons).toBeGreaterThan(0); // composition diamond
  // The viewBox encloses the long class (no clipping).
  const [, , width] = parsed.viewBox!.split(' ').map(Number) as [number, number, number, number];
  expect(width).toBeGreaterThan(600);

  for (const scale of ['1', '2'] as const) {
    const png = await exportDiagram(page, 'png', async (p) => {
      await p.getByTestId('export-scale').selectOption(scale);
    });
    const size = pngSize(png.bytes);
    expect(size.width).toBeGreaterThan(Number(scale) * 500);
    expect(size.height).toBeGreaterThan(100);
  }

  const pdf = await exportDiagram(page, 'pdf');
  const head = pdf.bytes.subarray(0, 5).toString('latin1');
  expect(head).toBe('%PDF-');
  const body = pdf.bytes.toString('latin1');
  expect(body).toContain('%%EOF');
  expect(body).toMatch(/\/Type\s*\/Page\b/);
});

test('E2E-010b PDF with non-Latin text falls back to an embedded image and says so', async ({ page }) => {
  await newProject(page, 'Arabic');
  await addDiagram(page, 'class', 'عربي');
  await place(page, 'class.class', 300, 200, 'مرحبا');
  const pdf = await exportDiagram(page, 'pdf');
  expect(pdf.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(pdf.bytes.toString('latin1')).toMatch(/\/Subtype\s*\/Image/);
  await expect(page.getByTestId('toast').filter({ hasText: /image/i })).toBeVisible();
});
