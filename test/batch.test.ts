import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, stringify } from "yaml";
import {
	applyToFrontmatter,
	collectionLink,
	describeResult,
	linkTarget,
	linkedFrom,
	linkingTo,
	planBatch,
	propertySkipReason,
	runBatch,
	sameLinkTarget,
} from "../src/batch";
import { baseFolder, matchProperties, starterBase, validateBase } from "../src/bases";
import { NetworkTracker, sameBytes } from "../src/sync";

const props = { status: "status", collections: "collections" };

test("collection input becomes one link, keeping an alias", () => {
	assert.equal(collectionLink("Climate"), "[[Climate]]");
	assert.equal(collectionLink(" [[Climate]] "), "[[Climate]]");
	assert.equal(collectionLink("[[Topics/Climate|Climate]]"), "[[Topics/Climate|Climate]]");
	assert.equal(collectionLink("  "), "");
	assert.equal(collectionLink("[[]]"), "");
});

test("link targets ignore aliases, headings, folders and case when compared", () => {
	assert.equal(linkTarget("[[Topics/Climate|Weather]]"), "Topics/Climate");
	assert.equal(linkTarget("[[Climate#Notes]]"), "Climate");
	assert.ok(sameLinkTarget("[[Topics/Climate|x]]", "[[climate]]"));
	assert.ok(!sameLinkTarget("[[Climate]]", "[[Climate change]]"));
	assert.ok(!sameLinkTarget("", ""));
});

test("set status changes only a different status", () => {
	const fm: Record<string, unknown> = { status: "queued" };
	assert.equal(applyToFrontmatter(fm, { kind: "status", value: "reading" }, props), true);
	assert.equal(fm.status, "reading");
	assert.equal(applyToFrontmatter(fm, { kind: "status", value: "reading" }, props), false);
	assert.equal(propertySkipReason(fm, { kind: "status", value: "reading" }, props), "already reading");
	assert.equal(propertySkipReason(fm, { kind: "status", value: "processed" }, props), undefined);
});

test("adding a collection appends a link once, to a list or a single value", () => {
	const empty: Record<string, unknown> = {};
	assert.ok(applyToFrontmatter(empty, { kind: "add-collection", link: "[[Climate]]" }, props));
	assert.deepEqual(empty.collections, ["[[Climate]]"]);

	const single: Record<string, unknown> = { collections: "[[Energy]]" };
	assert.ok(applyToFrontmatter(single, { kind: "add-collection", link: "[[Climate]]" }, props));
	assert.deepEqual(single.collections, ["[[Energy]]", "[[Climate]]"]);

	const present: Record<string, unknown> = { collections: ["[[Topics/Climate|Climate]]"] };
	assert.equal(applyToFrontmatter(present, { kind: "add-collection", link: "[[Climate]]" }, props), false);
	assert.deepEqual(present.collections, ["[[Topics/Climate|Climate]]"], "unchanged");
	assert.equal(propertySkipReason(present, { kind: "add-collection", link: "[[Climate]]" }, props), "already in Climate");
});

test("removing a collection drops every link to it and keeps the rest", () => {
	const fm: Record<string, unknown> = { collections: ["[[Climate]]", "[[Energy]]", "[[climate|again]]"] };
	assert.ok(applyToFrontmatter(fm, { kind: "remove-collection", link: "[[Climate]]" }, props));
	assert.deepEqual(fm.collections, ["[[Energy]]"]);
	assert.equal(propertySkipReason(fm, { kind: "remove-collection", link: "[[Climate]]" }, props), "not in Climate");
	assert.equal(propertySkipReason({}, { kind: "remove-collection", link: "[[Climate]]" }, props), "not in Climate");
});

test("a custom comparison decides which links are the same collection", () => {
	const fm: Record<string, unknown> = { collections: ["[[A/Climate]]"] };
	const resolvesDifferently = () => false;
	assert.ok(applyToFrontmatter(fm, { kind: "add-collection", link: "[[B/Climate]]" }, props, resolvesDifferently));
	assert.equal(fm.collections instanceof Array && fm.collections.length, 2);
});

test("custom property names are used", () => {
	const fm: Record<string, unknown> = {};
	applyToFrontmatter(fm, { kind: "status", value: "reading" }, { status: "Reading status", collections: "topics" });
	applyToFrontmatter(fm, { kind: "add-collection", link: "[[X]]" }, { status: "Reading status", collections: "topics" });
	assert.deepEqual(fm, { "Reading status": "reading", topics: ["[[X]]"] });
});

test("a plan splits items into those to process and those left alone, with reasons", () => {
	const plan = planBatch([1, 2, 3, 4], (n) => (n % 2 ? undefined : "even"));
	assert.deepEqual(plan.todo, [1, 3]);
	assert.deepEqual(plan.skipped, [
		{ item: 2, skip: "even" },
		{ item: 4, skip: "even" },
	]);
	assert.equal(plan.items.length, 4);
});

test("a batch records each item's error and carries on", async () => {
	const seen: number[] = [];
	const r = await runBatch(
		[1, 2, 3],
		async (n) => {
			if (n === 2) throw new Error("broken");
			return n === 1;
		},
		{ progress: (done) => seen.push(done) }
	);
	assert.deepEqual(r.changed, [1]);
	assert.deepEqual(r.unchanged, [3]);
	assert.deepEqual(r.failed, [{ item: 2, error: "broken" }]);
	assert.deepEqual(seen, [1, 2, 3]);
	assert.equal(describeResult(r), "1 changed, 1 unchanged, 1 failed.");
});

test("a cancelled batch stops before the next item and lists what wasn't done", async () => {
	let stop = false;
	const r = await runBatch(
		[1, 2, 3, 4],
		async (n) => {
			if (n === 2) stop = true;
			return true;
		},
		{ cancelled: () => stop }
	);
	assert.deepEqual(r.changed, [1, 2]);
	assert.deepEqual(r.notRun, [3, 4]);
	assert.ok(r.cancelled);
	assert.match(describeResult(r), /cancelled with 2 not done/);
});

test("a fatal error (the plugin unloaded) stops the batch", async () => {
	class Fatal extends Error {}
	const r = await runBatch(
		[1, 2, 3],
		async (n) => {
			if (n === 2) throw new Fatal("unloaded");
			return true;
		},
		{},
		(e) => e instanceof Fatal
	);
	assert.deepEqual(r.changed, [1]);
	assert.deepEqual(r.notRun, [2, 3]);
	assert.equal(r.failed.length, 0);
	assert.ok(r.cancelled);
});

test("scopes from resolved links: what a note links to and what links to it", () => {
	const links = {
		"Climate.md": { "References/a.md": 1, "References/b.md": 2 },
		"References/a.md": { "Climate.md": 1 },
		"References/c.md": { "Climate.md": 1, "Energy.md": 1 },
		"References/d.md": { "Energy.md": 1, "Climate.md": 0 },
	};
	assert.deepEqual(linkedFrom(links, "Climate.md"), ["References/a.md", "References/b.md"]);
	assert.deepEqual(linkingTo(links, "Climate.md"), ["References/a.md", "References/c.md"]);
	assert.deepEqual(linkedFrom(links, "Nowhere.md"), []);
});

// ---------------------------------------------------------------- library base

test("the library base has a view per status, plus unfiled and missing PDF", () => {
	const names = matchProperties([]);
	Object.assign(names, { status: "Reading status", collections: "topics", pdf: "scan" });
	const config = parse(stringify(starterBase("Library/Refs", names, ["queued", "reading", "reviewing", "processed", "shelved", "reading", " "])));
	assert.equal(validateBase(config), null);
	assert.equal(baseFolder(config), "Library/Refs");
	const views = config.views as { name: string; filters?: string }[];
	assert.deepEqual(
		views.map((v) => v.name),
		["Library", "Queued", "Reading", "Reviewing", "Processed", "Shelved", "Unfiled", "Missing PDF"]
	);
	assert.equal(views[2].filters, `note["Reading status"] == "reading"`);
	assert.equal(views[6].filters, `note["topics"].isEmpty()`);
	assert.equal(views[7].filters, `note["scan"].isEmpty()`);
});

test("a status with quotes is a valid expression literal", () => {
	const config = parse(stringify(starterBase("R", matchProperties([]), ['to "check"'])));
	assert.equal(config.views[1].filters, `note["status"] == "to \\"check\\""`);
});

// ---------------------------------------------------------------- sync helpers

test("a lookup with no answer at all is unreachable; an error status is not", async () => {
	const offline = new NetworkTracker();
	const f = offline.wrap(async () => {
		throw new Error("net::ERR_INTERNET_DISCONNECTED");
	});
	await assert.rejects(f("https://example.com"));
	assert.ok(offline.unreachable);

	const refused = new NetworkTracker();
	await refused.wrap(async () => ({ status: 503, text: "" }))("https://example.com");
	assert.ok(!refused.unreachable);

	const none = new NetworkTracker();
	assert.ok(!none.unreachable, "no request made isn't offline");

	const mixed = new NetworkTracker();
	let n = 0;
	const g = mixed.wrap(async () => {
		if (n++ === 0) throw new Error("dns");
		return { status: 404, text: "" };
	});
	await assert.rejects(g("a"));
	await g("b");
	assert.ok(!mixed.unreachable, "one answer means the network works");
});

test("sameBytes compares length and content", () => {
	const a = new Uint8Array([1, 2, 3]);
	assert.ok(sameBytes(a, new Uint8Array([1, 2, 3])));
	assert.ok(!sameBytes(a, new Uint8Array([1, 2, 4])));
	assert.ok(!sameBytes(a, new Uint8Array([1, 2])));
});
