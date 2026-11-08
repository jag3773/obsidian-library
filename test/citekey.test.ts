import { test } from "node:test";
import assert from "node:assert/strict";
import { disambiguate, familyFromFullName, generateCitekey, parsePattern, titleWords } from "../src/citekey";

const BBT = "auth.lower + shorttitle(3, 3) + year";

// Expected keys are real Better BibTeX keys from the author's library.
const cases: [string, string[], number | undefined, string][] = [
	["24:14 - A Testimony to All Peoples", ["Parks", "Coles"], 2019, "parks2414Testimony2019"],
	["Missionary Methods: St. Paul's or Ours?", ["Allen"], 2011, "allenMissionaryMethodsSt2011"],
	["The 7 habits of highly effective people: restoring the character ethic", ["Covey"], 2004, "covey7HabitsHighly2004"],
	["Paul's Idea of Community", ["Banks"], 2020, "banksPaulsIdeaCommunity2020"],
	["10 Client-side Storage Options and When to Use Them - SitePoint", [], undefined, "10ClientsideStorage"],
	["18-956 Google LLC v. Oracle America, Inc. (04/05/2021)", [], 2021, "18956GoogleLLC2021"],
	["A Manual Greek Lexicon of the New Testament", ["Abbott-Smith"], 2000, "abbott-smithManualGreekLexicon2000"],
	["Don't use cosine similarity carelessly", ["Migdał"], 2025, "migdalDontUseCosine2025"],
	["Harmony-Seeking Computations: a Science of Non-Classical Dynamics", ["Alexander"], 2009, "alexanderHarmonySeekingComputationsScience2009"],
];

for (const [title, authors, year, expected] of cases) {
	test(`citekey ${expected}`, () => {
		assert.equal(generateCitekey({ title, authors, year }, BBT), expected);
	});
}

test("title words: apostrophes, hyphens and periods join; colons split", () => {
	assert.deepEqual(titleWords("Amazon.com: Paul's Client-side 24:14"), ["Amazoncom", "Pauls", "Clientside", "24", "14"]);
});

test("other patterns", () => {
	const input = { title: "The Forgotten Ways", authors: ["Hirsch", "Catchim"], year: 2006 };
	assert.equal(generateCitekey(input, "auth + year"), "Hirsch2006");
	assert.equal(generateCitekey(input, "authors(2).lower + '_' + veryshorttitle"), "hirschcatchim_Forgotten");
	// Modifiers apply to their own term only, as in Better BibTeX.
	assert.equal(generateCitekey(input, "auth.upper + title"), "HIRSCHForgottenWays");
});

test("missing author and year drop out", () => {
	assert.equal(generateCitekey({ title: "Announcing the Android Ready SE Alliance" }, BBT), "AnnouncingAndroidReady");
});

test("bad pattern throws", () => {
	assert.throws(() => parsePattern("auth + nonsense(2)"));
});

test("disambiguate like Better BibTeX", () => {
	const taken = new Set(["key2020", "key2020a"]);
	assert.equal(disambiguate("key2020", (k) => taken.has(k)), "key2020b");
	assert.equal(disambiguate("free", (k) => taken.has(k)), "free");
});

test("family names", () => {
	assert.equal(familyFromFullName("Stan Parks"), "Parks");
	assert.equal(familyFromFullName("Parks, Stan"), "Parks");
});
