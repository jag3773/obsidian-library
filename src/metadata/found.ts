/** Pure module: partial metadata gathered from one layer of a page, and how layers combine. */

export interface Found {
	type?: string;
	title?: string;
	/** Display names, "First Last" order. */
	authors?: string[];
	editors?: string[];
	translators?: string[];
	/** Other people credited (narrators, illustrators). Never used as authors. */
	contributors?: string[];
	language?: string;
	volume?: string;
	issue?: string;
	pages?: string;
	edition?: string;
	place?: string;
	issn?: string;
	/** ISO date: YYYY-MM-DD, YYYY-MM or YYYY. */
	date?: string;
	publisher?: string;
	journal?: string;
	isbn?: string;
	doi?: string;
	url?: string;
	abstract?: string;
}

/** Text that ends the way a shortened teaser does. */
export const truncated = (s: string) => /(…|\.\.\.)\s*$/.test(s);

/**
 * Combine layers, most trusted first: each field takes the first layer that has it. An
 * abstract that looks cut short ("…") gives way to a longer one from a later layer.
 */
export function mergeFound(...layers: Found[]): Found {
	const out: Found = {};
	for (const layer of layers) {
		for (const [k, v] of Object.entries(layer) as [keyof Found, Found[keyof Found]][]) {
			if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) continue;
			if (out[k] === undefined) (out as Record<string, unknown>)[k] = v;
		}
	}
	const abstracts = layers.map((l) => l.abstract).filter((a): a is string => !!a);
	if (out.abstract && truncated(out.abstract)) {
		const stem = out.abstract.replace(/(…|\.\.\.)\s*$/, "").trim();
		const fuller = abstracts.find((a) => !truncated(a) && a.length > stem.length);
		if (fuller) out.abstract = fuller;
	}
	return out;
}
