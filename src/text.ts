/**
 * A property value as text. Strings, numbers, booleans and dates read as String() would;
 * lists join their items with commas; any other object is empty rather than "[object Object]".
 */
export function asText(v: unknown): string {
	if (v === undefined || v === null) return "";
	if (typeof v === "string") return v;
	if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
	if (v instanceof Date) return v.toString();
	if (Array.isArray(v)) return v.map(asText).join(",");
	return "";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A local date as YYYY-MM-DD, or YYYY-MM-DD HHmm with `withTime`. */
export function localDate(d: Date = new Date(), withTime = false): string {
	const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	return withTime ? `${day} ${pad(d.getHours())}${pad(d.getMinutes())}` : day;
}
