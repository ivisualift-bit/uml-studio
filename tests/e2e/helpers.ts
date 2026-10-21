import { expect, test as base, type Download, type Locator, type Page } from '@playwright/test';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Tests use the browser fallback (download + <input type=file>) so file round-trips are fully
 * automatable; the File System Access pickers are native dialogs Playwright cannot drive.
 */
export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      delete w.showOpenFilePicker;
      delete w.showSaveFilePicker;
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await use(page);
    expect(errors, 'uncaught page errors').toEqual([]);
  },
});
export { expect };

export const MOD = 'ControlOrMeta';

export interface ProjectJson {
  rootModelId: string;
  modelElements: Record<string, { id: string; kind: string; name: string; ownerId: string | null; [k: string]: unknown }>;
  diagrams: Record<string, { id: string; kind: string; name: string; views: Record<string, { id: string; kind: string; elementId?: string; [k: string]: unknown }> }>;
}

export async function snapshot(page: Page): Promise<ProjectJson> {
  const text = await page.evaluate(() => (window as unknown as { umlStudio: { snapshot(): string | null } }).umlStudio.snapshot());
  if (!text) throw new Error('No open project');
  return JSON.parse(text) as ProjectJson;
}

export function elementsOfKind(doc: ProjectJson, kind: string) {
  return Object.values(doc.modelElements).filter((e) => e.kind === kind);
}

export function byName(doc: ProjectJson, name: string) {
  const el = Object.values(doc.modelElements).find((e) => e.name === name);
  if (!el) throw new Error(`Element "${name}" not found`);
  return el;
}

export async function newProject(page: Page, name = 'E2E Project'): Promise<void> {
  await page.goto('/');
  await page.getByTestId('start-new').click();
  await page.getByTestId('project-name-input').fill(name);
  await page.getByTestId('create-project').click();
  await expect(page.getByTestId('workspace')).toBeVisible();
}

export async function addDiagram(page: Page, kind: string, name?: string): Promise<void> {
  await page.getByTestId('explorer-add-diagram').click();
  await page.getByTestId(`diagram-kind-${kind}`).click();
  if (name) await page.getByTestId('diagram-name-input').fill(name);
  await page.getByTestId('create-diagram').click();
  await expect(page.getByTestId('new-diagram-dialog')).toBeHidden();
}

export function canvas(page: Page): Locator {
  return page.locator('[data-canvas]');
}

/** Click a toolbox tool, then the canvas at (x, y) relative to the canvas; optionally type a name. */
export async function place(page: Page, toolId: string, x: number, y: number, name?: string): Promise<void> {
  await page.getByTestId(`tool-${toolId}`).click();
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.click(box.x + x, box.y + y);
  if (name !== undefined) {
    const editor = page.getByTestId('inline-editor');
    await expect(editor).toBeVisible();
    await editor.fill(name);
    await editor.press('Enter');
    await expect(editor).toBeHidden();
  }
}

export function node(page: Page, name: string): Locator {
  return page.locator(`[data-testid="uml-node"][data-name=${JSON.stringify(name)}]`);
}

export function edge(page: Page, kind: string): Locator {
  return page.locator(`[data-testid="uml-edge"][data-kind="${kind}"]`);
}

/** Two-click connection. Containers whose centre is covered by children are clicked near their top. */
export async function connect(page: Page, toolId: string, from: string, to: string, options: { fromTop?: boolean; toTop?: boolean } = {}): Promise<void> {
  await page.getByTestId(`tool-${toolId}`).click();
  await node(page, from).click(options.fromTop ? { position: { x: 12, y: 8 } } : undefined);
  await node(page, to).click(options.toTop ? { position: { x: 12, y: 8 } } : undefined);
}

/** Select an edge by clicking the middle of its interaction path. */
export async function selectEdge(page: Page, kind: string, index = 0): Promise<void> {
  const path = edge(page, kind).nth(index).locator('path.react-flow__edge-interaction');
  const d = await path.getAttribute('d');
  const nums = (d ?? '').match(/-?\d+(\.\d+)?/g)!.map(Number);
  // Midpoint of the first segment, in flow coordinates → screen via the element's bounding box.
  const box = (await path.boundingBox())!;
  const [x1, y1, x2, y2] = nums as [number, number, number, number];
  const minX = Math.min(...nums.filter((_, i) => i % 2 === 0));
  const minY = Math.min(...nums.filter((_, i) => i % 2 === 1));
  const maxX = Math.max(...nums.filter((_, i) => i % 2 === 0));
  const maxY = Math.max(...nums.filter((_, i) => i % 2 === 1));
  const sx = box.width / Math.max(1, maxX - minX || 1);
  const sy = box.height / Math.max(1, maxY - minY || 1);
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  await page.mouse.click(box.x + (maxX === minX ? box.width / 2 : (mx - minX) * sx), box.y + (maxY === minY ? box.height / 2 : (my - minY) * sy));
}

export async function setInspectorField(page: Page, testId: string, value: string): Promise<void> {
  const field = page.getByTestId(testId);
  await field.fill(value);
  await field.press('Enter');
}

export async function saveDownload(download: Download): Promise<{ path: string; text: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'umls-e2e-'));
  const file = path.join(dir, download.suggestedFilename());
  await download.saveAs(file);
  return { path: file, text: await readFile(file, 'utf8') };
}

/** Save via Mod+S (browser fallback = download). */
export async function saveProject(page: Page): Promise<{ path: string; text: string }> {
  await canvasOrBody(page).focus();
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press(`${MOD}+s`)]);
  return saveDownload(download);
}

function canvasOrBody(page: Page): Locator {
  return page.locator('[data-canvas], [data-testid="start-screen"], body').first();
}

/** Open a .umls file through File → Open (browser fallback file input). */
export async function openFile(page: Page, filePath: string): Promise<void> {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press(`${MOD}+o`)]);
  await chooser.setFiles(filePath);
}

/** Open while the current project has unsaved changes: answer "Don't Save" to proceed. */
export async function openFileDiscardingChanges(page: Page, filePath: string): Promise<void> {
  await page.keyboard.press(`${MOD}+o`);
  await expect(page.getByTestId('unsaved-dialog')).toBeVisible();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('unsaved-discard').click()]);
  await chooser.setFiles(filePath);
}

export async function writeTemp(name: string, text: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'umls-e2e-'));
  const file = path.join(dir, name);
  await writeFile(file, text, 'utf8');
  return file;
}

/** Comparable semantic + view content (timestamps and viewports excluded). */
export function comparable(doc: ProjectJson): unknown {
  const diagrams = Object.fromEntries(Object.entries(doc.diagrams).map(([id, d]) => [id, { ...d, viewport: undefined }]));
  return { modelElements: doc.modelElements, diagrams };
}

export async function exportDiagram(page: Page, format: 'svg' | 'png' | 'pdf' | 'json', options: (page: Page) => Promise<void> = async () => undefined) {
  await page.keyboard.press(`${MOD}+Shift+e`);
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await page.getByTestId(`export-format-${format}`).click();
  await options(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-run').click()]);
  const dir = await mkdtemp(path.join(tmpdir(), 'umls-export-'));
  const file = path.join(dir, download.suggestedFilename());
  await download.saveAs(file);
  return { file, bytes: await readFile(file) };
}

/** Parse SVG text in the browser; throws when not well-formed. Returns text contents. */
export async function parseSvg(page: Page, svg: string): Promise<{ texts: string[]; polygons: number; dashed: number; viewBox: string | null }> {
  return page.evaluate((source) => {
    const dom = new DOMParser().parseFromString(source, 'image/svg+xml');
    const error = dom.getElementsByTagName('parsererror')[0];
    if (error) throw new Error(`Invalid SVG: ${error.textContent}`);
    return {
      texts: [...dom.getElementsByTagName('text')].map((t) => t.textContent ?? ''),
      polygons: dom.getElementsByTagName('polygon').length,
      dashed: dom.querySelectorAll('[stroke-dasharray]').length,
      viewBox: dom.documentElement.getAttribute('viewBox'),
    };
  }, svg);
}

export function pngSize(bytes: Buffer): { width: number; height: number } {
  const signature = bytes.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') throw new Error('Not a PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
