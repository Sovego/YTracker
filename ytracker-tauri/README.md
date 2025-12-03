# YTracker Tauri Client

This workspace is the only runtime needed to build and ship YTracker. The React/Vite frontend talks
directly to a native Rust backend (no embedded Python, PyO3 bridge, or runtime bootstrapping).

## Prerequisites

- Rust stable toolchain compatible with Tauri 2.
- Node.js 20+.
- OS packages listed in the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for
  your platform (e.g., `libwebkit2gtk` on Linux).
- Optional: environment variables `YTRACKER_CLIENT_ID` and `YTRACKER_CLIENT_SECRET` for OAuth setup.

## Development workflow

```bash
cd ytracker-tauri
npm install
npm run tauri dev
```

If credentials are not pre-populated via environment variables, open **Settings → OAuth** and store
them using the built-in Stronghold vault. Tokens, org id, and org type are managed entirely in Rust.

## Building releases

```bash
cd ytracker-tauri
npm install
npm run tauri build
```

The resulting artifacts under `src-tauri/target/release/` contain the React bundle, native backend,
and updater metadata. No extra runtime assets are required.

## Automatic updates

YTracker ships with the [Tauri updater plugin](https://v2.tauri.app/plugin/updater/), so the app can
discover and install releases that you publish on GitHub. The update endpoint points to
`https://github.com/Sovego/YTracker/releases/latest/download/latest.json`, following the workflow
discussed in [tauri-apps/discussions/10206](https://github.com/orgs/tauri-apps/discussions/10206).

### Signing keys

All updater artifacts must be signed. Generate the key pair once and store it in a secure location:

```bash
npm run tauri signer generate -- -w ~/.tauri/ytracker.key
```

Export the private key when building release artifacts (dotenv files are ignored for this step):

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/ytracker.key)"
# optional when you protected the key
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="hunter2"
```

Set the matching public key as an environment variable before running the dev server or bundler so
the app can validate downloaded installers:

```bash
export TAURI_UPDATER_PUBKEY="<contents of the .pem public key>"
```

### Publishing a release

1. Configure the signing environment variables shown above.
2. Run `npm run tauri build -- --target <desired target>` to generate the platform bundles plus
	signed updater artifacts (`.sig`, `.app.tar.gz`, `.AppImage`, etc.).
3. Upload the binaries *and* the generated `latest.json` file to a GitHub Release. The default
	endpoint (`.../releases/latest/download/latest.json`) always points to the newest published
	release, so no additional hosting is required.
4. Make sure the release is neither a draft nor a pre-release; the updater only tracks published
	releases.

### In-app experience

- The backend checks for updates automatically after launch and emits an `updater://available` event
  when it finds a newer build.
- The Settings dialog now has an **Updates** card with a "Check for updates" button plus
  installation controls. Clicking **Install & Restart** downloads the release, verifies its
  signature, and relaunches the app once installation succeeds.
