# Documentation Standards

This repository documents product source with two layers:

1. **In-code docs**
   - TypeScript/TSX: JSDoc on exported hooks, components, interfaces, and utility functions.
   - Rust: module docs (`//!`) and command/type docs (`///`) for bridge and API surfaces.
2. **Module guides**
   - Markdown docs in this folder covering architecture, contracts, and configuration.

## Scope

Included in this pass:
- Frontend source: `src/`
- Native source: `src-tauri/src/`
- API crate source: `src-tauri/crates/ytracker_api/src/`
- Build/config source files that support comments (`*.ts`, `*.js`, `*.rs`, `Cargo.toml`)
- Runtime/build configuration documented in markdown when inline comments are not valid JSON.

Excluded from inline documentation:
- Generated/build artifacts (`src-tauri/target/`, generated schemas)
- Lockfiles (`package-lock.json`)

## Contracts to keep stable

- Native timer event: `timer-tick`
- Native updater event: `updater://available`
- Frontend config fan-out event: `ytracker:config-updated`

## Maintenance rule

When changing a bridge command or event contract, update docs in the same PR:
- Rust command in `src-tauri/src/lib.rs`
- TypeScript wrapper/hook in `src/hooks/useBridge.ts`
- Contract documentation in `docs/contracts.md`

## Rust audit baseline (required)

All future Rust documentation audits should use the Rust API Guidelines documentation chapter as the baseline:
- https://rust-lang.github.io/api-guidelines/documentation.html

For audit reports, check at least the following:
- Public APIs have rustdoc comments that explain purpose and behavior, not only restate names.
- Docs include intent and usage expectations for commands, constructors, and mutating methods.
- Examples are added where behavior is non-obvious or misuse is likely.
- Panics, error conditions, and important invariants are documented when relevant.
- Safety and security-sensitive behavior is explicitly documented where applicable.
- Link-related rustdoc quality (`intra-doc links`, references, and readability) is reviewed.

Audit output should include:
- Coverage counts (`scanned`, `documented`, `missing`) by crate/module.
- Priority-ranked missing-doc symbol list with file and line links.
- Guideline compliance notes referencing the checklist above.
