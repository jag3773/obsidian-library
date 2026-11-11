// End-to-end tests in the real Obsidian Android app, on an Android Virtual Device named
// "obsidian_test", through Appium. Runs the platform-independent specs (test/e2e/specs/common):
// the plugin loads, capture from the inbox, Insert citation, Check library health.
//
// Needs the Android SDK and emulator, and Appium, which isn't a regular dev dependency:
//   npm run test:e2e:android:deps   (installs appium, its UiAutomator2 driver and the wdio service)
//   npm run build && npm run test:e2e:android
// See test/e2e/README.md. The nightly workflow .github/workflows/e2e-android.yml runs this.
//
// Environment:
//   OBSIDIAN_VERSIONS   app versions to test, default "latest" ("earliest" is minAppVersion)
//   APPIUM_HOST, APPIUM_PORT  an Appium server to use instead of the one the service starts
import * as path from "node:path";
import { env } from "node:process";
import { parseObsidianVersions } from "wdio-obsidian-service";

const cacheDir = path.resolve(".obsidian-cache");

// Beta versions aren't available for the Android app.
const versions = await parseObsidianVersions(env.OBSIDIAN_VERSIONS ?? "latest", { cacheDir });
if (env.CI) {
	// The workflow uses this line as the key for its .obsidian-cache cache.
	console.log("obsidian-cache-key:", JSON.stringify(versions));
}

export const config: WebdriverIO.Config = {
	runner: "local",
	framework: "mocha",
	specs: ["./test/e2e/specs/common/**/*.e2e.ts"],

	// Appium can't run tests in parallel.
	maxInstances: 1,
	hostname: env.APPIUM_HOST || "localhost",
	port: parseInt(env.APPIUM_PORT || "4723"),

	// The installer version doesn't apply to the mobile app.
	capabilities: versions.map<WebdriverIO.Capabilities>(([appVersion]) => ({
		browserName: "obsidian",
		browserVersion: appVersion,
		platformName: "Android",
		"appium:automationName": "UiAutomator2",
		"appium:avd": "obsidian_test",
		// The service resets Obsidian when it needs to.
		"appium:noReset": true,
		"appium:adbExecTimeout": 60 * 1000,
		"wdio:obsidianOptions": {
			plugins: [".", "test/e2e/stub-plugin"],
			vault: "test/e2e/vaults/library",
		},
	})),

	services: ["obsidian", ["appium", { args: { allowInsecure: "*:chromedriver_autodownload,*:adb_shell" } }]],
	reporters: ["obsidian"],
	mochaOpts: { ui: "bdd", timeout: 3 * 60 * 1000 },
	waitforInterval: 250,
	waitforTimeout: 30 * 1000,
	logLevel: "warn",
	cacheDir,
	injectGlobals: false,
};
