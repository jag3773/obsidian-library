// eslint.config.mjs: the same rules the Obsidian community directory runs on releases.
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	globalIgnores(["node_modules", "main.js", "test-dist", "test", "scripts", "esbuild.config.mjs", "esbuild.test.mjs"]),
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: { allowDefaultProject: ["eslint.config.*"] },
			},
		},
	},
]);
