/**
 * Batch actions on many reference notes: what each action changes in a note's properties,
 * the preview of a whole batch, and a cancellable runner that reports per-item errors.
 * Pure module: no Obsidian imports, so it is unit tested in Node.
 *
 * Scope (which notes a batch acts on) is decided by the caller and always shown in the
 * preview: notes selected in the file explorer, a folder, the references folder, notes
 * linked from or linking to the active note, or the rows of a Stacks batch view in a Base.
 */

export type BatchAction =
	| { kind: "status"; value: string }
	| { kind: "add-collection"; link: string }
	| { kind: "remove-collection"; link: string }
	| { kind: "regenerate-citekey" }
	| { kind: "complete" };

export type BatchKind = BatchAction["kind"];

export const ACTION_LABELS: Record<BatchKind, string> = {
	status: "Set status",
	"add-collection": "Add to collection",
	"remove-collection": "Remove from collection",
	"regenerate-citekey": "Regenerate citekeys",
	complete: "Complete metadata",
};

type Frontmatter = Record<string, unknown>;

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/**
 * The link a collection is written as: "Climate", "[[Climate]]" and "[[Climate|alias]]" all
 * become "[[Climate]]" (or keep the alias). Empty input gives "".
 */
export function collectionLink(input: string): string {
	const s = input.trim();
	if (!s) return "";
	const inner = s.replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
	return inner ? `[[${inner}]]` : "";
}

/** The link target of a link-ish value: "[[Folder/Note|alias]]" → "Folder/Note". */
export function linkTarget(value: unknown): string {
	return text(value)
		.replace(/^\[\[/, "")
		.replace(/\]\]$/, "")
		.split("|")[0]
		.split("#")[0]
		.replace(/\.md$/i, "")
		.trim();
}

/** Default comparison of two links: same target, ignoring case and any folder path. */
export function sameLinkTarget(a: unknown, b: unknown): boolean {
	const name = (v: unknown) => linkTarget(v).split("/").pop()?.toLowerCase() ?? "";
	const x = name(a);
	return !!x && x === name(b);
}

/** A property value as a list: a list stays a list, one value becomes [value], empty becomes []. */
function asList(v: unknown): unknown[] {
	if (Array.isArray(v)) return v.filter((x) => x !== null && x !== "");
	return v === undefined || v === null || v === "" ? [] : [v];
}

export type Same = (a: unknown, b: unknown) => boolean;

/**
 * Apply a property action to frontmatter in place. Returns whether anything changed.
 * Only status and collection actions edit properties; the others return false here.
 */
export function applyToFrontmatter(fm: Frontmatter, action: BatchAction, props: { status: string; collections: string }, same: Same = sameLinkTarget): boolean {
	switch (action.kind) {
		case "status": {
			if (text(fm[props.status]) === action.value) return false;
			fm[props.status] = action.value;
			return true;
		}
		case "add-collection": {
			const list = asList(fm[props.collections]);
			if (list.some((v) => same(v, action.link))) return false;
			fm[props.collections] = [...list, action.link];
			return true;
		}
		case "remove-collection": {
			const list = asList(fm[props.collections]);
			const kept = list.filter((v) => !same(v, action.link));
			if (kept.length === list.length) return false;
			fm[props.collections] = kept;
			return true;
		}
		default:
			return false;
	}
}

/** One planned item: change it, or leave it with a reason. */
export interface PlannedItem<T> {
	item: T;
	/** Why the item is left alone; undefined when it will be processed. */
	skip?: string;
}

export interface BatchPlan<T> {
	items: PlannedItem<T>[];
	/** Items that will be processed. */
	todo: T[];
	/** Items left alone, with reasons. */
	skipped: PlannedItem<T>[];
}

/**
 * Preview a batch. `check` returns a reason to skip an item (already has that status,
 * not a reference, no identifier...) or undefined to process it.
 */
export function planBatch<T>(items: T[], check: (item: T) => string | undefined): BatchPlan<T> {
	const planned = items.map((item) => ({ item, skip: check(item) }));
	return {
		items: planned,
		todo: planned.filter((p) => p.skip === undefined).map((p) => p.item),
		skipped: planned.filter((p) => p.skip !== undefined),
	};
}

/** Why a property action would leave this frontmatter as it is, or undefined if it changes it. */
export function propertySkipReason(fm: Frontmatter, action: BatchAction, props: { status: string; collections: string }, same: Same = sameLinkTarget): string | undefined {
	const copy: Frontmatter = { ...fm };
	if (applyToFrontmatter(copy, action, props, same)) return undefined;
	switch (action.kind) {
		case "status":
			return `already ${action.value}`;
		case "add-collection":
			return `already in ${linkTarget(action.link)}`;
		case "remove-collection":
			return `not in ${linkTarget(action.link)}`;
		default:
			return undefined;
	}
}

export interface BatchResult<T> {
	/** Items the action changed. */
	changed: T[];
	/** Items the action ran on without a change. */
	unchanged: T[];
	failed: { item: T; error: string }[];
	/** Items not reached because the batch was cancelled. */
	notRun: T[];
	cancelled: boolean;
}

export interface RunOptions<T> {
	/** Checked before each item; true stops the batch. */
	cancelled?: () => boolean;
	/** Called after each item with the number done so far. */
	progress?: (done: number, total: number, item: T) => void;
}

/**
 * Run `fn` on each item in turn. An item's error is recorded and the batch goes on; a
 * cancel stops before the next item. `fn` returns whether it changed the item.
 * An error for which `isFatal` is true (the plugin was unloaded) stops the batch too.
 */
export async function runBatch<T>(
	items: T[],
	fn: (item: T) => Promise<boolean>,
	opts: RunOptions<T> = {},
	isFatal: (e: unknown) => boolean = () => false
): Promise<BatchResult<T>> {
	const out: BatchResult<T> = { changed: [], unchanged: [], failed: [], notRun: [], cancelled: false };
	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		if (opts.cancelled?.()) {
			out.cancelled = true;
			out.notRun = items.slice(i);
			break;
		}
		try {
			if (await fn(item)) out.changed.push(item);
			else out.unchanged.push(item);
		} catch (e) {
			if (isFatal(e)) {
				out.cancelled = true;
				out.notRun = items.slice(i);
				break;
			}
			out.failed.push({ item, error: e instanceof Error ? e.message : String(e) });
		}
		opts.progress?.(i + 1, items.length, item);
	}
	return out;
}

/** One-line summary of a finished batch. */
export function describeResult(r: BatchResult<unknown>): string {
	const parts = [`${r.changed.length} changed`];
	if (r.unchanged.length) parts.push(`${r.unchanged.length} unchanged`);
	if (r.failed.length) parts.push(`${r.failed.length} failed`);
	if (r.cancelled) parts.push(`cancelled with ${r.notRun.length} not done`);
	return parts.join(", ") + ".";
}

// ---------------------------------------------------------------- scopes

/** Obsidian's resolvedLinks shape: source path → destination path → link count. */
export type ResolvedLinks = Record<string, Record<string, number>>;

/** Paths `source` links to, in the order the cache lists them. */
export function linkedFrom(links: ResolvedLinks, source: string): string[] {
	return Object.keys(links[source] ?? {});
}

/** Paths that link to `target` (its backlinks), sorted. */
export function linkingTo(links: ResolvedLinks, target: string): string[] {
	return Object.keys(links)
		.filter((src) => src !== target && (links[src]?.[target] ?? 0) > 0)
		.sort();
}
