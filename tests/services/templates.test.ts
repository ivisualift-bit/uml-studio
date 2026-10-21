import { describe, expect, it } from 'vitest';
import { instantiateTemplate, TEMPLATES } from '@/services/templates/templates';
import { checkIntegrity } from '@/domain/services/integrity';
import { collectDeclaredIds } from '@/domain/services/cloneAndRemap';
import { parseProjectText, serializeProject } from '@/domain/serialization/projectFile';
import { validateProject } from '@/domain/validation/rules';
import { renderDiagramSvg } from '@/diagrams/render/diagramSvg';
import { sequentialIds } from '@/domain/ids';

describe('templates', () => {
  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s builds a valid, error-free, round-trippable project', (_id, template) => {
    const doc = template.build();
    expect(checkIntegrity(doc)).toEqual([]);
    const errors = validateProject(doc).filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
    const parsed = parseProjectText(serializeProject(doc));
    expect(parsed.ok).toBe(true);
    expect(Object.keys(doc.diagrams)).toHaveLength(1);
    for (const diagramId of Object.keys(doc.diagrams)) {
      const { svg } = renderDiagramSvg(doc, diagramId);
      expect(svg).toContain('<svg');
    }
  });

  it('instantiates with fresh identifiers every time', () => {
    const a = instantiateTemplate('library', sequentialIds('a'), new Date());
    const b = instantiateTemplate('library', sequentialIds('b'), new Date());
    const idsA = new Set(collectDeclaredIds(a));
    expect(collectDeclaredIds(b).some((id) => idsA.has(id))).toBe(false);
    expect(checkIntegrity(b)).toEqual([]);
  });
});
