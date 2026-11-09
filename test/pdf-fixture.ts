// Builds small PDFs in memory for annotation tests: text drawn in Helvetica at known
// positions, plus annotations as an external reader would write them. Only what the tests
// need; not a general PDF writer.

export interface FixtureText {
	x: number;
	y: number;
	size?: number;
	text: string;
}

export interface FixtureAnnot {
	subtype: "Highlight" | "Underline" | "StrikeOut" | "Squiggly" | "Text" | "FreeText" | "Ink" | "Link";
	/** [x1, y1, x2, y2] */
	rect: number[];
	/** Flat QuadPoints, 8 numbers per quad, in the order readers write them: TL, TR, BL, BR. */
	quads?: number[];
	color?: number[];
	contents?: string;
	name?: string;
	/** Index (within the same page) of the annotation this one replies to. */
	replyTo?: number;
	/** Seconds since epoch for /M; omitted when undefined. */
	modified?: string;
}

export interface FixturePage {
	text?: FixtureText[];
	annots?: FixtureAnnot[];
}

export interface FixtureOptions {
	/** /PageLabels: roman numerals for the first `roman` pages, then decimal from 1. */
	roman?: number;
}

const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);

/** A PDF text string: plain when ASCII, UTF-16BE with BOM otherwise. */
function pdfString(s: string): string {
	if (/^[\x20-\x7e]*$/.test(s)) return `(${esc(s)})`;
	let hex = "FEFF";
	for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
	return `<${hex}>`;
}

export function buildPdf(pages: FixturePage[], options: FixtureOptions = {}): Uint8Array {
	const objects: string[] = [];
	const add = (body: string) => {
		objects.push(body);
		return objects.length;
	};
	const reserve = () => add("");
	const catalog = reserve();
	const pagesObj = reserve();
	const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
	const pageIds: number[] = [];
	for (const page of pages) {
		const stream = (page.text ?? []).map((t) => `BT /F1 ${t.size ?? 12} Tf ${t.x} ${t.y} Td (${esc(t.text)}) Tj ET`).join("\n");
		const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
		const pageId = reserve();
		const annotIds: number[] = [];
		for (const a of page.annots ?? []) {
			const parts = [`/Type /Annot`, `/Subtype /${a.subtype}`, `/Rect [${a.rect.join(" ")}]`, `/P ${pageId} 0 R`];
			if (a.quads) parts.push(`/QuadPoints [${a.quads.join(" ")}]`);
			if (a.color) parts.push(`/C [${a.color.join(" ")}]`);
			if (a.contents !== undefined) parts.push(`/Contents ${pdfString(a.contents)}`);
			if (a.name) parts.push(`/NM ${pdfString(a.name)}`);
			if (a.modified) parts.push(`/M (${a.modified})`);
			if (a.replyTo !== undefined) parts.push(`/IRT ${annotIds[a.replyTo]} 0 R`);
			if (a.subtype === "FreeText") parts.push(`/DA (/Helv 12 Tf 0 g)`);
			annotIds.push(add(`<< ${parts.join(" ")} >>`));
		}
		const annots = annotIds.length ? ` /Annots [${annotIds.map((i) => `${i} 0 R`).join(" ")}]` : "";
		objects[pageId - 1] =
			`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R${annots} >>`;
		pageIds.push(pageId);
	}
	objects[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
	const labels = options.roman
		? ` /PageLabels << /Nums [0 << /S /r >> ${options.roman} << /S /D /St 1 >>] >>`
		: "";
	objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R${labels} >>`;

	let out = "%PDF-1.7\n";
	const offsets: number[] = [];
	objects.forEach((body, i) => {
		offsets.push(out.length);
		out += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xref = out.length;
	out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
	out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return new TextEncoder().encode(out);
}

/** Quad (TL, TR, BL, BR) covering [x1, x2] on a line whose baseline is y for a font size. */
export function lineQuad(x1: number, x2: number, y: number, size = 12): number[] {
	const top = y + size * 0.8;
	const bottom = y - size * 0.25;
	return [x1, top, x2, top, x1, bottom, x2, bottom];
}
