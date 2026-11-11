// eslint.scanner.config.mjs: lint the way the Obsidian community directory scans a release.
//
// Based on the "Full scanner-equivalent configuration" in eslint-plugin-obsidianmd's docs
// (docs/configuration.md#community-plugin-scanner-configuration), plus the rules the
// scanner's newest layer raises to errors for recently submitted plugins. Run from the
// repository root (`npm run lint:scanner`) so manifest.json, package.json and LICENSE are
// linted too.
//
// Errors here are what the directory's scorecard lists as risks, and fail CI. Warnings
// match its warnings and recommendations: CI prints them without failing.
//
// The directory doesn't say which version of eslint-plugin-obsidianmd it runs, and versions
// disagree, so CI runs this config with the project's version and with an older one
// (see .github/workflows/ci.yml).
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
			},
		},
	},

	...obsidianmd.configs.recommended,

	{
		files: ["**/*.{ts,cts,mts,tsx,js,cjs,mjs,jsx}"],
		rules: {
			// Security: errors in the scanner too.
			"no-eval": "error",
			"no-unsanitized/method": "error",
			"no-unsanitized/property": "error",
			"obsidianmd/regex-lookbehind": "error",
			"obsidianmd/no-forbidden-elements": "error",

			// Switched off by the scanner (covered by TypeScript or too noisy).
			"no-undef": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-argument": "off",
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-unsafe-return": "off",
			"@typescript-eslint/restrict-template-expressions": "off",
			"@typescript-eslint/no-base-to-string": "off",
			"import/no-unresolved": "off",
			"obsidianmd/commands/no-command-in-command-id": "off",
			"obsidianmd/commands/no-plugin-id-in-command-id": "off",

			// The newest layer, for plugins submitted recently (Stacks is one).
			"obsidianmd/settings-tab/no-manual-html-headings": "error",
			"obsidianmd/settings-tab/no-problematic-settings-headings": "error",
			"obsidianmd/sample-names": "error",
			"obsidianmd/no-sample-code": "error",
			"obsidianmd/platform": "error",
			"obsidianmd/no-plugin-as-component": "error",
			"obsidianmd/detach-leaves": "error",
			"obsidianmd/no-static-styles-assignment": "error",
			"obsidianmd/no-view-references-in-plugin": "error",
			"obsidianmd/no-unsupported-api": "error",
		},
	},

	// Implied eval, once per call: the core rule in JavaScript, typescript-eslint's in TypeScript.
	{ files: ["**/*.{js,cjs,mjs,jsx}"], rules: { "no-implied-eval": "error" } },
	{ files: ["**/*.{ts,cts,mts,tsx}"], rules: { "@typescript-eslint/no-implied-eval": "error" } },

	// The scanner checks the manifest and licence separately.
	{ files: ["manifest.json"], rules: { "obsidianmd/validate-manifest": "off" } },
	{ files: ["LICENSE", "LICENSE.md", "LICENSE.txt"], rules: { "obsidianmd/validate-license": "off" } },

	// The scanner honours disable comments but does not report unused ones.
	{ linterOptions: { reportUnusedDisableDirectives: "off", reportUnusedInlineConfigs: "off" } },

	globalIgnores([
		"main.js",
		"**/*.min.js",
		"**/{dist,build,out,release}/**/*.{js,cjs,mjs,jsx}",
		"node_modules",
		"dist",
		"build",
		"pkg",
		"test-dist",
		"test-vault",
		".obsidian",
		"**/.obsidian/**",
		"esbuild.config.mjs",
		"version-bump.mjs",
		"**/*.test.*",
		"**/*.tests.*",
		"**/*.spec.*",
		"**/*.specs.*",
		"**/test/**",
		"**/tests/**",
		"**/__tests__/**",
		"**/mocks/**",
		"**/__mocks__/**",
		"**/*.cjs",
		"**/*.mjs",
		"**/*.cts",
		"**/*.mts",
		"**/vite*",
		"**/scripts/**",
		"**/docs/**",
		"**/i18n/**",
		"**/i18next/**",
		"**/locale/**",
		"**/locales/**",
		"**/translations/**",
		"**/l10n/**",
		".pnpm-store",
		"**/testUtils**",
		"automation/**",
		"**/e2e/**",
		"**/e2e-tests/**",
		"**/*.e2e.*",
		"**/wdio.conf.*",
		"**/wdio.*.conf.*",
		"**/playwright.config.*",
		"**/{astro,babel,commitlint,docusaurus,esbuild,eslint,jest,oxlint,postcss,prettier,rolldown,rollup,stylelint,svelte,tailwind,tsdown,tsup,uno,webpack}.config.*",
		"**/{eslint,jest}.*.config.*",
		"**/jest.setup.*",
		"**/.{babelrc,eslintrc,mocharc,prettierrc}.*",
	]),
]);
