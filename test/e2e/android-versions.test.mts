// Checks that the Android tests resolve "latest" from Android releases, using a release list
// where the newest Android build and the newest desktop build differ. Runs offline: the
// launcher reads a fresh obsidian-versions.json from the cache folder without fetching it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { parseObsidianVersions } from "wdio-obsidian-service";
import { androidVersions } from "./android-versions.mjs";

const GH = "https://github.com/obsidianmd/obsidian-releases/releases/download";

function release(version: string, downloads: Record<string, string>, installers: Record<string, unknown> = {}) {
	return {
		version,
		minInstallerVersion: "1.5.8",
		minRunnableInstallerVersion: "1.1.9",
		maxInstallerVersion: version,
		isBeta: false,
		gitHubRelease: `https://github.com/obsidianmd/obsidian-releases/releases/tag/v${version}`,
		downloads,
		installers,
	};
}

const desktop = (v: string) =>
	release(
		v,
		{ asar: `${GH}/v${v}/obsidian-${v}.asar.gz`, appImage: `${GH}/v${v}/Obsidian-${v}.AppImage` },
		{ appImage: { digest: "sha256:00", electron: "43.8.4", chrome: "150.0.7871.250", platforms: ["linux-x64"] } },
	);
const android = (v: string) => release(v, { apk: `${GH}/v${v}/Obsidian-${v}.apk` });

async function withVersions(versions: unknown[], run: (cacheDir: string) => Promise<void>): Promise<void> {
	const cacheDir = await mkdtemp(path.join(tmpdir(), "stacks-versions-"));
	try {
		const metadata = { schemaVersion: "2.2.0", commitDate: "2026-11-03T19:03:02Z", commitSha: "0", timestamp: new Date().toISOString() };
		await writeFile(path.join(cacheDir, "obsidian-versions.json"), JSON.stringify({ metadata, versions }));
		await run(cacheDir);
	} finally {
		await rm(cacheDir, { recursive: true, force: true });
	}
}

test("Android 'latest' is the newest Android build when a mobile-only fix is newer than desktop", async () => {
	// 2.0.0 shipped everywhere; 2.0.1 is an Android-only fix.
	const both = { ...desktop("2.0.0"), downloads: { ...desktop("2.0.0").downloads, ...android("2.0.0").downloads } };
	await withVersions([both, android("2.0.1")], async (cacheDir) => {
		assert.equal((await androidVersions("latest", cacheDir))[0][0], "2.0.1");
	});
});

test("Android 'latest' skips a desktop-only release that has no APK", async () => {
	// 2.0.0 shipped everywhere; 2.1.0 is desktop only.
	const both = { ...desktop("2.0.0"), downloads: { ...desktop("2.0.0").downloads, ...android("2.0.0").downloads } };
	await withVersions([both, desktop("2.1.0")], async (cacheDir) => {
		assert.equal((await androidVersions("latest", cacheDir))[0][0], "2.0.0");
		// The host platform's "latest" differs, which is why Android must ask for its own.
		assert.equal((await parseObsidianVersions("latest", { cacheDir, platform: "linux", arch: "x64" }))[0][0], "2.1.0");
	});
});
