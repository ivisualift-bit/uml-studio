import { describe, expect, it } from 'vitest';
import { parseProjectText, serializeProject } from '@/domain/serialization/projectFile';
import { migrateToCurrent, type Migration } from '@/domain/serialization/migrations';
import { scanJson } from '@/domain/serialization/jsonScan';
import { addNode, connect, withDiagram } from '../helpers';

function sampleDoc() {
  const f = withDiagram('class');
  const a = addNode(f, f.diagramId, { kind: 'class', name: 'Élève' }, 10, 20);
  const b = addNode(f, f.diagramId, { kind: 'class', name: 'Cours <&>' }, 300, 20);
  connect(f, f.diagramId, 'association', a.viewId, b.viewId);
  return f.doc;
}

describe('project serialization', () => {
  it('round-trips losslessly and deterministically', () => {
    const doc = sampleDoc();
    const text = serializeProject(doc);
    const parsed = parseProjectText(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc).toEqual(doc);
    expect(serializeProject(parsed.doc)).toBe(text);
  });

  it('preserves namespaced extension data verbatim and drops unknown fields', () => {
    const raw = JSON.parse(serializeProject(sampleDoc())) as Record<string, unknown>;
    const extensions = { 'acme.tool:layout': { seed: 7, hints: ['a', null, true] } };
    raw.extensions = extensions;
    raw.unknownTopLevel = 'dropped';
    const parsed = parseProjectText(JSON.stringify(raw));
    if (!parsed.ok) throw new Error(parsed.error.details.join('; '));
    expect(parsed.doc.extensions).toEqual(extensions);
    expect('unknownTopLevel' in parsed.doc).toBe(false);
    const again = parseProjectText(serializeProject(parsed.doc));
    expect(again.ok && again.doc.extensions).toEqual(extensions);
  });

  it('accepts a UTF-8 BOM', () => {
    const parsed = parseProjectText(`\uFEFF${serializeProject(sampleDoc())}`);
    expect(parsed.ok).toBe(true);
  });

  it('rejects malformed JSON', () => {
    const result = parseProjectText('{"format": "uml-studio-project", ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalidJson');
  });

  it('rejects non-project JSON', () => {
    const result = parseProjectText('{"hello": "world"}');
    expect(!result.ok && result.error.code).toBe('notAProject');
  });

  it('rejects newer schema versions without touching anything', () => {
    const raw = JSON.parse(serializeProject(sampleDoc()));
    raw.schemaVersion = 99;
    const result = parseProjectText(JSON.stringify(raw));
    expect(!result.ok && result.error.code).toBe('newerVersion');
    expect(!result.ok && result.error.version).toBe(99);
  });

  it('rejects duplicate JSON keys (hidden duplicate IDs)', () => {
    const text = serializeProject(sampleDoc());
    const raw = JSON.parse(text);
    const firstId = Object.keys(raw.modelElements)[1] as string;
    const duplicated = text.replace(
      `"${firstId}": {`,
      `"${firstId}": {"kind":"class"},\n    "${firstId}": {`,
    );
    const result = parseProjectText(duplicated);
    expect(!result.ok && result.error.code).toBe('duplicateKeys');
  });

  it('rejects duplicate identifiers across records', () => {
    const raw = JSON.parse(serializeProject(sampleDoc()));
    const diagram = Object.values(raw.diagrams)[0] as { views: Record<string, { id: string }> };
    const [firstViewKey] = Object.keys(diagram.views);
    const elementId = Object.keys(raw.modelElements)[1] as string;
    // Re-key a view with an element id → duplicate id across elements and views.
    const view = diagram.views[firstViewKey!]!;
    delete diagram.views[firstViewKey!];
    view.id = elementId;
    diagram.views[elementId] = view;
    const result = parseProjectText(JSON.stringify(raw));
    expect(result.ok).toBe(false);
  });

  it('rejects dangling references', () => {
    const raw = JSON.parse(serializeProject(sampleDoc()));
    const assoc = Object.values(raw.modelElements).find(
      (e) => (e as { kind: string }).kind === 'association',
    ) as { targetId: string };
    assoc.targetId = 'does-not-exist';
    const result = parseProjectText(JSON.stringify(raw));
    expect(!result.ok && result.error.code).toBe('integrity');
  });

  it('rejects schema violations with readable paths', () => {
    const raw = JSON.parse(serializeProject(sampleDoc()));
    const cls = Object.values(raw.modelElements).find((e) => (e as { kind: string }).kind === 'class') as {
      isAbstract: unknown;
    };
    cls.isAbstract = 'yes';
    const result = parseProjectText(JSON.stringify(raw));
    expect(!result.ok && result.error.code).toBe('schema');
    expect(!result.ok && result.error.details.join(' ')).toContain('modelElements');
  });

  it('enforces the size limit', () => {
    const result = parseProjectText('x'.repeat(2048), { maxBytes: 1024 });
    expect(!result.ok && result.error.code).toBe('tooLarge');
  });

  it('bounds nesting depth', () => {
    const deep = `${'['.repeat(500)}${']'.repeat(500)}`;
    const result = parseProjectText(deep);
    expect(!result.ok && result.error.code).toBe('tooDeep');
  });
});

describe('json scanner', () => {
  it('detects duplicates only within the same object, including escaped keys', () => {
    expect(scanJson('{"a":1,"b":{"a":2}}').duplicateKeys).toEqual([]);
    expect(scanJson('{"a":1,"\\u0061":2}').duplicateKeys).toEqual(['a']);
    expect(scanJson('[{"a":1},{"a":1}]').duplicateKeys).toEqual([]);
    expect(scanJson('{"s":"{\\"a\\":1,\\"a\\":2}"}').duplicateKeys).toEqual([]);
  });
});

describe('migrations', () => {
  const steps: Migration[] = [
    {
      from: 0,
      to: 1,
      description: 'rename title → name',
      migrate: (raw) => ({ ...raw, name: raw.title, title: undefined }),
    },
  ];
  it('applies a chain of injected migrations', () => {
    const result = migrateToCurrent({ schemaVersion: 0, title: 'Old' }, steps, 1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.raw).toMatchObject({ schemaVersion: 1, name: 'Old' });
      expect(result.applied).toHaveLength(1);
    }
  });
  it('reports gaps and newer versions', () => {
    expect(migrateToCurrent({ schemaVersion: 0 }, [], 1)).toMatchObject({ ok: false, reason: 'gap' });
    expect(migrateToCurrent({ schemaVersion: 3 }, steps, 1)).toMatchObject({ ok: false, reason: 'newer' });
    expect(migrateToCurrent({ schemaVersion: 'x' }, steps, 1)).toMatchObject({
      ok: false,
      reason: 'unknown-version',
    });
  });
});
