import { test } from "node:test";
import assert from "node:assert/strict";
import { asText } from "../src/text";

test("asText reads property values as String() would, but never as [object Object]", () => {
	assert.equal(asText(undefined), "");
	assert.equal(asText(null), "");
	assert.equal(asText("  Title "), "  Title ");
	assert.equal(asText(2024), "2024");
	assert.equal(asText(false), "false");
	assert.equal(asText(["a", 1, ["b"]]), "a,1,b");
	assert.equal(asText({ nested: "map" }), "");
	assert.equal(asText([{ x: 1 }, "y"]), ",y");
	const d = new Date(2024, 0, 2);
	assert.equal(asText(d), String(d));
});
