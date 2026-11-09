/**
 * The round trip's Host on desktop, from Node's modules. Loaded only when
 * Platform.isDesktopApp, so mobile never touches fs or child_process.
 */
import { App, FileSystemAdapter, Platform } from "obsidian";
import type { Host } from "./roundtrip";

export interface NodeModules {
	fs: typeof import("fs");
	path: typeof import("path");
	os: typeof import("os");
	cp: typeof import("child_process");
}

declare global {
	interface Window {
		/** Node's require, present in the desktop app's renderer. */
		require: NodeJS.Require;
	}
}

function requireModules(): NodeModules {
	if (Platform.isDesktopApp) {
		return {
			fs: window.require("fs") as typeof import("fs"),
			path: window.require("path") as typeof import("path"),
			os: window.require("os") as typeof import("os"),
			cp: window.require("child_process") as typeof import("child_process"),
		};
	}
	throw new Error("This needs the Obsidian desktop app.");
}

/** `modules` is for tests, which run as ES modules without require. */
export function nodeHost(app: App, modules: NodeModules = requireModules()): Host {
	const { fs, path, os, cp } = modules;
	const fsp = fs.promises;
	const windows = process.platform === "win32";
	return {
		join: (dir, name) => path.join(dir, name),
		readFile: async (p) => new Uint8Array(await fsp.readFile(p)),
		writeFile: async (p, data) => {
			// Write beside the target, then rename, so a sync client never uploads half a file.
			const tmp = `${p}.stacks-${process.pid}.tmp`;
			await fsp.writeFile(tmp, data);
			await fsp.rename(tmp, p);
		},
		stat: async (p) => {
			try {
				const s = await fsp.stat(p);
				return s.isFile() ? { size: s.size, mtimeMs: Math.floor(s.mtimeMs) } : null;
			} catch {
				return null;
			}
		},
		isDirectory: async (p) => {
			try {
				return (await fsp.stat(p)).isDirectory();
			} catch {
				return false;
			}
		},
		list: async (dir) => (await fsp.readdir(dir, { withFileTypes: true })).filter((d) => d.isFile()).map((d) => d.name),
		watch: (dir, onChange) => {
			const w = fs.watch(dir, (_event, name) => {
				if (name) onChange(String(name));
			});
			w.on("error", (e) => console.warn("[Stacks] tablet folder watcher", e));
			return () => w.close();
		},
		tempDir: () => fsp.mkdtemp(path.join(os.tmpdir(), "obsidian-stacks-")),
		removeDir: (p) => fsp.rm(p, { recursive: true, force: true }),
		run: (command, cwd, timeoutMs) =>
			new Promise((resolve) => {
				cp.exec(command, { cwd: cwd ?? undefined, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
					const output = `${stdout ?? ""}${stderr ?? ""}`;
					if (!err) resolve({ code: 0, output });
					else resolve({ code: err.killed ? null : typeof err.code === "number" ? err.code : 1, output: output || err.message });
				});
			}),
		quote: (p) => (windows ? `"${p.replace(/"/g, '""')}"` : `'${p.replace(/'/g, `'\\''`)}'`),
		vaultPath: () => (app.vault.adapter instanceof FileSystemAdapter ? app.vault.adapter.getBasePath() || null : null),
	};
}
