
/**
 * Pure module: personal and organization names as citation records need them.
 *
 * Notes keep names readable: `authors: ["[[Jane Doe]]"]`. Most names split correctly by
 * rule ("Jane Doe", "Ludwig van Beethoven", "Martin Luther King Jr."). When a name doesn't
 * (a two-word family name, an organization), the property carries its sort form as well:
 *
 *   "[[Gabriel García Márquez|García Márquez, Gabriel]]"  a link, with the split as its alias
 *   "García Márquez, Gabriel"                              plain text
 *   "{Mission Network News}"                               braces: a name used as is
 *
 * The same conventions as BibTeX's, so names survive export unchanged.
 */

import { asText } from "./text";

export interface PersonName {
	given?: string;
	family?: string;
	/** A name never split, such as an organization's. */
	literal?: string;
	/** "van", "de la": part of the family name for sorting rules that keep it. */
	particle?: string;
	/** "Jr.", "III". */
	suffix?: string;
}

const PARTICLES = new Set(["da", "das", "de", "del", "della", "der", "di", "dos", "du", "la", "le", "ten", "ter", "van", "von", "zu", "den", "op", "'t", "al", "el", "bin", "ibn"]);
const SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|v|phd|ph\.d\.|md|m\.d\.)$/i;
/** Words that mark a name as an organization's. */
const ORG = /\b(inc|llc|ltd|corp|company|corporation|university|college|institute|institution|press|association|foundation|ministries|ministry|church|society|council|committee|agency|department|organization|organisation|group|team|network|news|media|publishing|publishers|books|labs?|project|center|centre|alliance|partners|international|global|services|board|office|government|bureau|commission|consortium|federation|union|school|academy|museum|library|wiki|wikipedia|staff|editors|contributors)\b/i;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Display order: "Gabriel García Márquez", "Ludwig van Beethoven", "Martin Luther King Jr.". */
export function displayName(n: PersonName): string {
	if (n.literal) return n.literal;
	return clean([n.given, n.particle, n.family].filter(Boolean).join(" ") + (n.suffix ? ` ${n.suffix}` : ""));
}

/** Sort order with BibTeX's conventions: "García Márquez, Gabriel", "King, Martin Luther, Jr.", "{WHO}". */
export function sortForm(n: PersonName): string {
	if (n.literal) return `{${n.literal}}`;
	const family = clean([n.particle, n.family].filter(Boolean).join(" "));
	if (!n.given) return n.suffix ? `${family}, ${n.suffix}` : family;
	return n.suffix ? `${family}, ${n.suffix}, ${n.given}` : `${family}, ${n.given}`;
}

/**
 * Split a name written in display order ("Jane Doe"), sort order ("Doe, Jane") or braces
 * ("{Org}"). A single word, or a name with an organization word in it, is used as is.
 */
export function parseName(raw: string): PersonName {
	const s = clean(raw);
	if (!s) return {};
	const braced = s.match(/^\{(.+)\}$/);
	if (braced) return { literal: clean(braced[1]) };
	if (s.includes(",")) {
		const parts = s.split(",").map(clean).filter(Boolean);
		if (parts.length >= 2) {
			// "King, Jr., Martin Luther" or "King, Martin Luther, Jr."
			let suffix: string | undefined;
			if (parts.length >= 3 && SUFFIX.test(parts[1])) suffix = parts.splice(1, 1)[0];
			else if (parts.length >= 3 && SUFFIX.test(parts[parts.length - 1])) suffix = parts.pop();
			const famWords = parts[0].split(" ");
			let i = 0;
			while (i < famWords.length - 1 && PARTICLES.has(famWords[i].toLowerCase())) i++;
			return {
				family: famWords.slice(i).join(" "),
				particle: i ? famWords.slice(0, i).join(" ") : undefined,
				given: parts.slice(1).join(", ") || undefined,
				suffix,
			};
		}
	}
	if (ORG.test(s)) return { literal: s };
	const words = s.split(" ");
	if (words.length === 1) return { literal: s };
	let suffix: string | undefined;
	if (words.length > 2 && SUFFIX.test(words[words.length - 1].replace(/,$/, ""))) suffix = words.pop();
	// The family name is the last word plus any lower-case particles right before it.
	let start = words.length - 1;
	while (start > 1 && PARTICLES.has(words[start - 1].toLowerCase())) start--;
	const particleWords = words.slice(start, words.length - 1);
	return {
		given: words.slice(0, start).join(" ").replace(/,$/, ""),
		particle: particleWords.length ? particleWords.join(" ") : undefined,
		family: words[words.length - 1],
		suffix,
	};
}

const same = (a: PersonName, b: PersonName) =>
	(a.literal ?? "") === (b.literal ?? "") &&
	(a.given ?? "") === (b.given ?? "") &&
	(a.family ?? "") === (b.family ?? "") &&
	(a.particle ?? "") === (b.particle ?? "") &&
	(a.suffix ?? "") === (b.suffix ?? "");

/** Characters that would break or redirect a wikilink. */
const linkSafe = (s: string) => clean(s.replace(/[[\]|#^\\/:]/g, " "));

/**
 * The property value for a person: a link or plain text, carrying the sort form only when
 * the display form wouldn't split the same way.
 */
export function nameValue(n: PersonName, asLink: boolean): string {
	const display = displayName(n);
	const exact = same(parseName(display), n);
	if (asLink) {
		const target = linkSafe(display);
		if (!target) return "";
		return exact ? `[[${target}]]` : `[[${target}|${sortForm(n)}]]`;
	}
	return exact ? display : sortForm(n);
}

/** A name from a property value: "[[Target|Sort, Form]]", "[[Target]]", "Doe, Jane" or "{Org}". */
export function nameFromValue(v: unknown): PersonName {
	const s = asText(v).trim();
	const link = s.match(/^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]$/);
	if (link) {
		const alias = link[2]?.trim();
		// An alias in sort form (a comma or braces) says how to split; any other alias is just display text.
		if (alias && (/,/.test(alias) || /^\{.+\}$/.test(alias))) return parseName(alias);
		return parseName(link[1]);
	}
	return parseName(s);
}

/** Names from a list-or-string property value. */
export function namesFromProperty(v: unknown): PersonName[] {
	const items = Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v];
	return items.map(nameFromValue).filter((n) => n.literal || n.family || n.given);
}

/** The family name used for citekeys: the family (without particle), or the whole literal. */
export function familyOf(n: PersonName): string {
	return n.literal ?? n.family ?? n.given ?? "";
}
