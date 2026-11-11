// End-to-end tests in real Obsidian (desktop, and desktop with the mobile UI emulated).
// See test/e2e/README.md. Run with `npm run test:e2e` after `npm run build`.
//
// Environment:
//   E2E_TARGET            "all" (default), "desktop" or "mobile" (emulated mobile only)
//   OBSIDIAN_VERSIONS     desktop app/installer pairs, default "earliest/earliest latest/latest"
//                         ("earliest" is minAppVersion in manifest.json)
//   OBSIDIAN_MOBILE_VERSIONS  emulated-mobile pairs, default "latest/latest"
//   WDIO_MAX_INSTANCES    parallel Obsidian instances, default 2
import * as path from "node:path";
import { env } from "node:process";
import { parseObsidianVersions } from "wdio-obsidian-service";

const cacheDir = path.resolve(".obsidian-cache");
const target = env.E2E_TARGET ?? "all";

// Beta versions need Obsidian account credentials, so they aren't tested here.
const desktopVersions = target === "mobile" ? [] : await parseObsidianVersions(env.OBSIDIAN_VERSIONS ?? "earliest/earliest latest/latest", { cacheDir });
const mobileVersions = target === "desktop" ? [] : await parseObsidianVersions(env.OBSIDIAN_MOBILE_VERSIONS ?? "latest/latest", { cacheDir });
if (env.CI) {
	// The workflow uses this line as the key for its .obsidian-cache cache.
	console.log("obsidian-cache-key:", JSON.stringify([desktopVersions, mobileVersions]));
}

const vault = "test/e2e/vaults/library";
const plugins = [".", "test/e2e/stub-plugin"];
const specs = (...dirs: string[]) => dirs.map((d) => `./test/e2e/specs/${d}/**/*.e2e.ts`);
/** The Bases spec needs Obsidian 1.10 (Bases, and the Stacks batch view type); minAppVersion is older. */
const hasBases = (appVersion: string) => {
	const [major, minor] = appVersion.split(".").map(Number);
	return major > 1 || (major === 1 && minor >= 10);
};

export const config: WebdriverIO.Config = {
	runner: "local",
	framework: "mocha",
	// Each capability names its own specs below.
	specs: [],
	maxInstances: Number(env.WDIO_MAX_INSTANCES || 2),

	capabilities: [
		...desktopVersions.map<WebdriverIO.Capabilities>(([appVersion, installerVersion]) => ({
			browserName: "obsidian",
			"wdio:obsidianOptions": { appVersion, installerVersion, plugins, vault },
			"wdio:specs": specs("common", "desktop", ...(hasBases(appVersion) ? ["bases"] : [])),
		})),
		...mobileVersions.map<WebdriverIO.Capabilities>(([appVersion, installerVersion]) => ({
			browserName: "obsidian",
			"wdio:obsidianOptions": { appVersion, installerVersion, emulateMobile: true, plugins, vault },
			"goog:chromeOptions": { mobileEmulation: { deviceMetrics: { width: 390, height: 844 } } },
			"wdio:specs": specs("common", "mobile"),
		})),
	],

	services: ["obsidian"],
	reporters: ["obsidian"],
	mochaOpts: { ui: "bdd", timeout: 90 * 1000 },
	waitforInterval: 250,
	waitforTimeout: 15 * 1000,
	logLevel: "warn",
	cacheDir,
	injectGlobals: false,
};
