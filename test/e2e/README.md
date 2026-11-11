# End-to-end tests

These tests run Stacks inside real Obsidian, using [WebdriverIO](https://webdriver.io) and [wdio-obsidian-service](https://jesse-r-s-hines.github.io/wdio-obsidian-service/wdio-obsidian-service/README.html). The unit tests (`npm test`) use an in-memory stand-in for Obsidian and stay the fast check. These tests cover what the stand-in can't: Obsidian's own file watcher, metadata cache, editor, dialogs, Bases and the mobile UI.

## Running them

```sh
npm run build              # the tests load the built main.js
npm run test:e2e           # desktop (minAppVersion and latest) and the emulated mobile UI
npm run test:e2e:desktop   # desktop only
npm run test:e2e:mobile    # emulated mobile only
```

The first run downloads Obsidian into `.obsidian-cache/` (ignored by git). On Linux without a display, run under `xvfb-run -a`. Choose versions with `OBSIDIAN_VERSIONS="1.10.0/latest latest/latest"` (app/installer pairs) and parallel Obsidian windows with `WDIO_MAX_INSTANCES`. Run one spec with, for example, `npm run test:e2e:desktop -- --spec test/e2e/specs/desktop/sync.e2e.ts`.

The Android app needs the Android SDK and an emulator (AVD) named `obsidian_test`, plus Appium, which isn't installed by `npm ci`:

```sh
npm run test:e2e:android:deps
npm run test:e2e:android
```

## Layout

| Path | What it holds |
|---|---|
| `wdio.conf.mts` | Desktop and emulated-mobile runs |
| `wdio.android.conf.mts` | The Android app (nightly in `.github/workflows/e2e-android.yml`) |
| `vaults/library/` | The fixture vault: three reference notes, a PDF with a DOI in its text, a draft, a collection note, a `.base` file, an empty `Inbox/`. Each run works on a copy |
| `stub-plugin/` | A test-only plugin that answers Stacks' network requests from fixtures (below) |
| `helpers/` | Shared steps (`stacks.ts`) and a small PDF writer (`pdf.ts`) |
| `specs/common/` | Every platform: plugin loads, capture from the inbox, Insert citation, Check library health |
| `specs/desktop/` | Desktop: formatted citations, duplicate merge, batch edits, import, the round trip, and sync and offline scenarios |
| `specs/bases/` | Desktop on Obsidian 1.10 and later: the library base's views evaluated by Bases, and the Stacks batch view |
| `specs/mobile/` | The emulated mobile UI |

## No network

Nothing reaches the network. Every request Stacks makes goes through one method, `request()` on the plugin (`src/main.ts`), which calls Obsidian's `requestUrl`. The stub plugin replaces that method on the loaded plugin when the layout is ready, before Stacks processes the inbox at startup. Everything after it runs for real: the plugin's fetcher, the metadata lookups and their parsing, inbox processing, duplicate checks and filing.

The stub answers Crossref requests for a few made-up DOIs (`10.1234/e2e.*`) and serves publisher pages at `https://example.org/articles/*` that name those DOIs. Any other URL gets a 404 and is recorded, so a test can check that nothing unexpected was requested. Tests can also switch it offline (every request throws, as `requestUrl` does without a network) and hold requests for one URL until released, to test what happens while a lookup is pending. Obsidian's `requestUrl` itself can't be replaced: the `obsidian` module's exports are read-only.

## Simulating sync and mobile

- **A sync client** is the test process writing into the vault folder on disk while Obsidian runs (`syncWrite`, `syncAppend` in `helpers/stacks.ts`), so Obsidian sees each file only through its file watcher.
- **Files that arrive while Obsidian is closed**: Stacks is turned off, the files are written, and Obsidian is restarted with Stacks on, so the files are in the vault at launch.
- **Mobile**: `emulateMobile` gives Obsidian's phone UI, but it is still the desktop app, so `Platform.isDesktopApp` stays true. The mobile spec reloads Stacks with that flag set to false to exercise Stacks' mobile path. The real mobile app is only covered by the Android run.
