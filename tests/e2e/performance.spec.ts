import { serializeProject } from '@/domain/serialization/projectFile';
import { ProjectBuilder } from '@/services/templates/builder';
import { expect, openFile, test, writeTemp } from './helpers';

function largeProjectText(): string {
  const b = new ProjectBuilder('Large', { idPrefix: 'large' });
  const d = b.diagram('class', 'Hundred');
  const views: string[] = [];
  for (let i = 0; i < 100; i += 1) {
    const n = b.node(d, 'class', `C${i}`, (i % 10) * 220, Math.floor(i / 10) * 170, { width: 160, height: 80 });
    b.attribute(n.elementId, `- value${i}: Integer`);
    views.push(n.viewId);
  }
  for (let i = 0; i < 100; i += 1) {
    b.connect(d, 'association', views[i]!, views[(i + 1) % 100]!);
    b.connect(d, 'dependency', views[i]!, views[(i + 11) % 100]!);
  }
  return serializeProject(b.build());
}

test('100 nodes / 200 edges: opens and drags responsively in the browser', async ({ page }) => {
  const file = await writeTemp('large.umls', largeProjectText());
  await page.goto('/');
  const start = Date.now();
  await openFile(page, file);
  await expect(page.locator('[data-testid="uml-node"]')).toHaveCount(100);
  const openMs = Date.now() - start;
  await expect(page.locator('[data-testid="uml-edge"]')).toHaveCount(200);

  const node = page.locator('[data-testid="uml-node"][data-name="C0"]');
  const box = (await node.boundingBox())!;
  const frames: number[] = [];
  await page.mouse.move(box.x + box.width / 2, box.y + 10);
  await page.mouse.down();
  for (let i = 1; i <= 20; i += 1) {
    const t0 = Date.now();
    await page.mouse.move(box.x + box.width / 2 + i * 6, box.y + 10 + i * 3);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    frames.push(Date.now() - t0);
  }
  await page.mouse.up();
  const median = frames.slice().sort((a, b) => a - b)[Math.floor(frames.length / 2)]!;
  console.log(`[perf-e2e] open+render ${openMs} ms, median drag frame ${median} ms (max ${Math.max(...frames)} ms)`);
  expect(openMs).toBeLessThan(10_000);
  expect(median).toBeLessThan(200);
});
