# Build and Runtime Configuration

This document explains configuration files that cannot be fully documented inline (for example JSON files).

## Frontend Build

- `package.json`
  - Defines scripts for dev/build/preview and Tauri integration.
- `vite.config.ts`
  - Frontend bundler config and Tauri host handling.
- `postcss.config.js`
  - PostCSS pipeline (`tailwindcss`, `autoprefixer`).
- `tailwind.config.js`
  - Tailwind content scanning and theme extension points.
- `tsconfig.json`, `tsconfig.node.json`
  - TypeScript compiler settings for app and tooling configs.

## Native Build and Runtime

- `src-tauri/Cargo.toml`
  - Native Rust crate metadata and dependencies.
- `src-tauri/build.rs`
  - Build-time env preparation and Tauri build wiring.
- `src-tauri/tauri.conf.json`
  - Tauri app identity, updater, packaging, and capability linkage.
- `src-tauri/capabilities/default.json`
  - Granted plugin/command capability scope.

## Operational Notes

- Run app commands from `ytracker-tauri/` workspace.
- Keep updater endpoint/public key changes in sync with release workflow docs.
- Treat changes in `tauri.conf.json` and capabilities as security-sensitive and review together.
