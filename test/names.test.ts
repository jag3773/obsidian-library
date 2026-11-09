import { test } from "node:test";
import assert from "node:assert/strict";
import { familyFromFullName } from "../src/citekey";
import { displayName, nameFromValue, nameValue, namesFromProperty, parseName, sortForm } from "../src/names";

test("names in display order split into given and family", () => {
	assert.deepEqual(parseName("Jane Doe"), { given: "Jane", family: "Doe", particle: undefined, suffix: undefined });
	assert.deepEqual(parseName("Ludwig van Beethoven"), { given: "Ludwig", particle: "van", family: "Beethoven", suffix: undefined });
	assert.deepEqual(parseName("Martin Luther King Jr."), { given: "Martin Luther", particle: undefined, family: "King", suffix: "Jr." });
	assert.deepEqual(parseName("Charles de la Fontaine"), { given: "Charles", particle: "de la", family: "Fontaine", suffix: undefined });
});

test("sort order, braces and organizations", () => {
	assert.deepEqual(parseName("García Márquez, Gabriel"), { family: "García Márquez", particle: undefined, given: "Gabriel", suffix: undefined });
	assert.deepEqual(parseName("King, Jr., Martin Luther"), { family: "King", particle: undefined, given: "Martin Luther", suffix: "Jr." });
	assert.deepEqual(parseName("van Gogh, Vincent"), { family: "Gogh", particle: "van", given: "Vincent", suffix: undefined });
	assert.deepEqual(parseName("{Mission Network News}"), { literal: "Mission Network News" });
	assert.deepEqual(parseName("World Health Organization"), { literal: "World Health Organization" });
	assert.deepEqual(parseName("unfoldingWord"), { literal: "unfoldingWord" });
});

test("display and sort forms", () => {
	const n = { given: "Gabriel", family: "García Márquez" };
	assert.equal(displayName(n), "Gabriel García Márquez");
	assert.equal(sortForm(n), "García Márquez, Gabriel");
	assert.equal(sortForm({ literal: "WHO" }), "{WHO}");
	assert.equal(sortForm({ given: "Martin Luther", family: "King", suffix: "Jr." }), "King, Jr., Martin Luther");
});

test("property values carry the sort form only when the display form would split differently", () => {
	assert.equal(nameValue({ given: "Jane", family: "Doe" }, true), "[[Jane Doe]]");
	assert.equal(nameValue({ given: "Jane", family: "Doe" }, false), "Jane Doe");
	assert.equal(nameValue({ given: "Gabriel", family: "García Márquez" }, true), "[[Gabriel García Márquez|García Márquez, Gabriel]]");
	assert.equal(nameValue({ given: "Gabriel", family: "García Márquez" }, false), "García Márquez, Gabriel");
	assert.equal(nameValue({ literal: "Elevation Worship" }, true), "[[Elevation Worship|{Elevation Worship}]]");
	assert.equal(nameValue({ literal: "World Health Organization" }, true), "[[World Health Organization]]");
	assert.equal(nameValue({ given: "Ann/Marie", family: "Smith" }, true), "[[Ann Marie Smith]]", "link-breaking characters are dropped");
});

test("names read back from property values", () => {
	for (const n of [
		{ given: "Jane", family: "Doe" },
		{ given: "Gabriel", family: "García Márquez" },
		{ literal: "Elevation Worship" },
		{ given: "Martin Luther", family: "King", suffix: "Jr." },
	]) {
		for (const asLink of [true, false]) {
			const back = nameFromValue(nameValue(n, asLink));
			assert.equal(displayName(back), displayName(n), `${JSON.stringify(n)} ${asLink}`);
			assert.equal(sortForm(back), sortForm(n));
		}
	}
	assert.deepEqual(nameFromValue("[[Jane Doe|Janie]]").family, "Doe", "an ordinary alias is display text");
	assert.deepEqual(namesFromProperty(["[[Jane Doe]]", "", null, "Bo Chen"]).map(displayName), ["Jane Doe", "Bo Chen"]);
	assert.deepEqual(namesFromProperty("Jane Doe").map(displayName), ["Jane Doe"]);
});

test("citekey family names follow the same rules", () => {
	assert.equal(familyFromFullName("Andy Weir"), "Weir");
	assert.equal(familyFromFullName("Weir, Andy"), "Weir");
	assert.equal(familyFromFullName("Martin Luther King Jr."), "King");
	assert.equal(familyFromFullName("{Barna Group}"), "Barna Group");
	assert.equal(familyFromFullName("Plato"), "Plato");
});
