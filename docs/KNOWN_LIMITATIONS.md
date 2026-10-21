# Known limitations

## Platform and packaging

- **The desktop app has never been compiled.** Rust is not installed on the development machine, so
  `pnpm tauri dev` / `pnpm tauri build` were not run and `src-tauri/src/lib.rs` is unverified. To
  build it, install Rust with rustup, then run `pnpm tauri build`.
- No code signing or notarization: macOS Gatekeeper blocks the first launch of a local build.
- In Safari and Firefox (no File System Access API), Save downloads a new copy and cannot overwrite
  the file you opened.
- E2E tests run in headless Chromium only. Firefox, WebKit and the Tauri webview were not tested.
- Accessibility (screen readers, full keyboard-only diagram editing) has not been audited.

## Diagrams

- Timing and Interaction Overview diagrams are planned only (see
  [DIAGRAM_CAPABILITIES.md](DIAGRAM_CAPABILITIES.md)).
- The eight extended diagrams are partial: they have a notation subset, few validation rules and
  one smoke E2E each.
- There is no automatic layout. Edge labels on very short edges can overlap the end labels.
- Communication diagrams are not synchronized with sequence diagrams.

## Import and export

- The **StarUML `.mdj` import is experimental.** It covers the class, use case and package subset
  only and was tested only against hand-written fixtures, never against files saved by StarUML. No
  compatibility is claimed. Unsupported constructs are listed in the import report, and StarUML IDs
  are replaced. There is no `.mdj` export.
- There is no XMI, no JPEG, no HTML documentation export and no reverse engineering from source code.
- PDF export is always a single page, scaled to fit. The page number is always "1 / 1". Text outside
  WinAnsi (e.g. CJK, Cyrillic) makes the PDF fall back to an embedded image, and the dialog says so.
- Mermaid/PlantUML export is lossy and limited to class, use case (PlantUML only), sequence, activity
  and state diagrams. The dialog lists what was dropped.
- Generated code is skeletons only (no method bodies). Python drops parameters that would follow a
  defaulted one and emits a warning.

## Data

- Unknown fields in a `.umls` file are dropped on load. Only `extensions` is preserved.
- Projects are limited to 25 MB. Performance was measured up to about 500 elements and a
  100-node / 200-edge diagram.
- Recovery snapshots live in this browser profile's IndexedDB. They are not backups.

## Licensing

- `package.json` and `Cargo.toml` declare MIT as a placeholder, and there is no `LICENSE` file. The
  owner must choose the license.
