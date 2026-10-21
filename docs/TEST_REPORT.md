# Test report

Run on 2026-10-21 on an Apple M2 Pro with macOS 26.6, Node 22.13.1, pnpm 9.15.9, Playwright 1.64.1
(headless Chromium) and Xcode Command Line Tools (no full Xcode, no Rust).

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm format:check` | ✅ all files formatted |
| `pnpm typecheck` | ✅ 0 errors (strict, `noUncheckedIndexedAccess`) |
| `pnpm lint` | ✅ 0 errors, 0 warnings |
| `pnpm test` | ✅ 11 files, **121 / 121 passed** |
| `pnpm build` | ✅ built (harmless Rollup "annotation" warnings from zod) |
| `pnpm test:e2e` | ✅ **28 / 28 passed** against the production build |
| `pnpm tauri dev` / `pnpm tauri build` | ⛔ **not run**: Rust/Cargo not installed |

No test is skipped, and no assertion was weakened to make a run pass.

## Unit tests (Vitest)

| File | Covers |
| --- | --- |
| `domain/commands.test.ts` | command engine atomicity, schema and integrity rejection, history and merge, model/view separation, delete cascades, relationship rules, reconnect, z-order |
| `domain/containment-sequence.test.ts` | swimlane partitions, composite-state ownership, ports/parts, visual-only boundary, sequence ordering, cascades, operand dividers |
| `domain/serialization.test.ts` | lossless and deterministic round trip, BOM, malformed/newer/duplicate/dangling input, size and depth limits, migrations, extensions preserved |
| `domain/validation.test.ts`, `domain/notation.test.ts`, `domain/clone.test.ts` | validation rules, UML text parsing and formatting, ID remapping, copy/paste |
| `diagrams/render.test.ts` | text metrics, node and edge notation, label placement, SVG well-formedness and escaping, sequence layout |
| `services/templates.test.ts` | all 9 templates are valid, error-free, round-trip, and get fresh IDs |
| `services/codegen.test.ts` | TypeScript type-checks, Java parses, Python passes `ast.parse` |
| `services/mdjImport.test.ts` | experimental `.mdj` import against hand-written fixtures and hostile input |
| `services/performance.test.ts` | timing ceilings (below) |

## E2E tests (Playwright)

E2E-001 class round trip · E2E-002 shared element across diagrams · E2E-003 use case · E2E-004
sequence · E2E-005 activity · E2E-006 state machine · E2E-007 crash recovery · E2E-008 malformed
files · E2E-009 keyboard shortcuts · E2E-010/010b export robustness (SVG/PNG/PDF, non-Latin PDF
fallback) · 6 editor-feature tests (containment, notes and bends, sequence extras, copy/paste and
problems, codegen and text export, language and theme) · 8 extended-diagram smoke tests · 2 `.mdj`
import tests · 1 browser performance test.

## Performance (M2 Pro; numbers vary between runs)

- 100 nodes / 200 edges: layout per drag frame about 3–6 ms, move commit about 4–6 ms, SVG export
  about 5–35 ms (cold).
- 501 elements (676 KiB): save 8 ms, open and full validation about 20 ms.
- Browser, same 100/200 diagram: open and render about 150–190 ms, median drag frame about 34–38 ms
  in headless Chromium (Playwright overhead included).

## Not tested

The Tauri desktop app (not compiled), Firefox, Safari/WebKit, real StarUML-produced `.mdj` files,
screen readers.
