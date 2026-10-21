import type { ProjectDocument } from '@/domain/schemas/project';
import { generateJava } from './java';
import { extractModel, type GenerationResult } from './model';
import { generatePython } from './python';
import { generateTypeScript } from './typescript';

export type CodegenLanguage = 'typescript' | 'java' | 'python';

export function generateCode(
  doc: ProjectDocument,
  language: CodegenLanguage,
  options: { dataclasses?: boolean } = {},
): GenerationResult {
  const model = extractModel(doc);
  switch (language) {
    case 'typescript':
      return generateTypeScript(model);
    case 'java':
      return generateJava(model);
    case 'python':
      return generatePython(model, options);
    default:
      return { files: [], warnings: [] };
  }
}

export type { GenerationResult, GeneratedFile } from './model';
