// Resolves the Obsidian versions the Android end-to-end tests run, from Android's own
// releases. Android and desktop release separately (a mobile-only fix, a desktop-only
// release), so "latest" must not come from the host platform. Used by wdio.android.conf.mts
// and checked by android-versions.test.mts.
import { parseObsidianVersions } from "wdio-obsidian-service";

export function androidVersions(spec: string, cacheDir: string): Promise<[string, string][]> {
	return parseObsidianVersions(spec, { cacheDir, platform: "android" });
}
