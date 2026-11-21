// The study tools that find and count: every place a thing occurs, the Book's spelling variants,
// where speech opens, an āyah's pronouns, a wording check, two āyāt word against word, and the
// grammar filters added to construction search. Expectations are facts of the text, checked
// against quran.db (no oracle: new features).

import { describe, it, expect, beforeAll } from "vitest";
import type { Hono } from "hono";
import { corpusServices, corpusTestApp } from "./corpus-app.js";
import { spellingDiffKinds } from "../src/spellings.js";
import { lettersKey } from "../src/wording.js";

let app: Hono;
const get = async (path: string) => {
  const res = await app.request(`/corpus${path}`);
  return { status: res.status, body: (await res.json()) as any };
};
const post = async (path: string, body: unknown) => {
  const res = await app.request(`/corpus${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};
const nfc = (s: string) => s.normalize("NFC");
const at = (places: any[]) => places.map((p: any) => `${p.verseKey}:${p.word}`);

beforeAll(async () => { app = corpusTestApp(); });

describe("POST /occurrences", () => {
  it("a marker key from the Links panel lists the same āyāt the marker counts, every place included", async () => {
    const links = (await get("/verses/19:47/links")).body;
    expect(links.links.length).toBeGreaterThan(0);
    for (const m of links.links) {
      const { status, body } = await post("/occurrences", { kind: m.kind, key: m.key });
      expect(status).toBe(200);
      expect(body.ayahs, `${m.kind} ${m.key}`).toBe(m.ayahs);
      const verses = new Set(body.places.map((p: any) => p.verseKey));
      expect(verses.has("19:47")).toBe(true);
      for (const p of m.places) expect(verses.has(p.verseKey)).toBe(true);
    }
  });

  it("every Rare-links phrase and pair (n = 2 to 5) lists exactly the āyāt the item lists", async () => {
    const svc = corpusServices();
    let walked = 0;
    for (let n = 2; n <= 5; n++) {
      const { total } = await svc.links.exclusive({ kind: "phrase", n, limit: 1 });
      for (let offset = 0; offset < total; offset += 500) {
        for (const it of (await svc.links.exclusive({ kind: "phrase", n, limit: 500, offset })).items) {
          const want = it.places.map((p) => p.verseKey);
          const kinds = it.length === 2 ? (["pair", "phrase"] as const) : (["phrase"] as const);
          for (const kind of kinds) {
            const got = await svc.occurrences.find({ kind, key: it.key });
            expect(got.ayahs, `${kind} ${it.key}`).toBe(want.length);
            expect([...new Set(got.places.map((p) => p.verseKey))], `${kind} ${it.key}`).toEqual(want);
          }
          walked++;
        }
      }
    }
    expect(walked).toBeGreaterThan(6000);
  }, 300_000);

  it("a phrase that begins with و is found with and without it: 2:27 and 13:25", async () => {
    const key = "الذين ينقضون عهد الله من بعد ميثقه ويقطعون ما امر الله به ان يوصل ويفسدون في الارض اولئك";
    const { body } = await post("/occurrences", { kind: "phrase", key });
    expect(at(body.places)).toEqual(["2:27:1", "13:25:1"]);
  });

  it("a pair: قَالَ سَلَٰمٌ in three āyāt, two words long, as written", async () => {
    const { body } = await post("/occurrences", { kind: "pair", key: "قال سلم" });
    expect(body).toMatchObject({ kind: "pair", key: "قال سلم", total: 3, ayahs: 3, truncated: false });
    expect(at(body.places)).toEqual(["11:69:8", "19:47:1", "51:25:6"]);
    expect(body.places.every((p: any) => p.words === 2)).toBe(true);
  });

  it("every place, not only the first in each āyah: ق و ل in 1,722 words of 1,383 āyāt", async () => {
    const { body } = await post("/occurrences", { kind: "root", key: "قول" });
    expect(body.total).toBe(1722);
    expect(body.ayahs).toBe(1383);
    expect(body.places.length).toBe(1722);
    expect(at(body.places).slice(0, 3)).toEqual(["2:8:4", "2:11:2", "2:11:8"]);
  });

  it("typed keys: a root spaced, unspaced or in Buckwalter; a lemma and a form without marks", async () => {
    const root = (await post("/occurrences", { kind: "root", key: "قول" })).body;
    for (const key of ["ق و ل", "qwl"]) expect((await post("/occurrences", { kind: "root", key })).body.total).toBe(root.total);
    const isa = (await post("/occurrences", { kind: "lemma", key: "عيسى" })).body;
    expect(isa).toMatchObject({ key: "عيسى", total: 25, ayahs: 25 });
    expect(at(isa.places)[0]).toBe("2:87:10");
    const imra = (await post("/occurrences", { kind: "form", key: "امرات" })).body;
    expect(imra.total).toBe(7);
    expect(at(imra.places)).toContain("12:30:5");
  });

  it("a spelling: إِبْرَٰهِـۧمَ (pasted as displayed) is its own shape, 15 words in 12 āyāt", async () => {
    const { body } = await post("/occurrences", { kind: "spelling", key: "إِبْرَٰهِـۧمَ" });
    expect(body).toMatchObject({ total: 15, ayahs: 12 });
    expect(at(body.places)[0]).toBe("2:124:3");
    expect((await post("/occurrences", { kind: "spelling", key: "إِبْرَٰهِيمَ" })).body.total).toBe(54);
  });

  it("a construction: the query runs Book-wide, capped at 6000 places with the full counts kept", async () => {
    const { body } = await post("/occurrences", { kind: "construction", key: "verbs", query: { slots: [{ pos: "V" }] } });
    expect(body.total).toBeGreaterThan(6000);
    expect(body.places.length).toBe(6000);
    expect(body.truncated).toBe(true);
    expect(body.places[0]).toEqual({ verseKey: "1:5", word: 2, words: 1, text: "نَعْبُدُ" });
    const page = (await post("/occurrences", { kind: "construction", key: "verbs", query: { slots: [{ pos: "V" }] }, limit: 2, offset: 1 })).body;
    expect(at(page.places)).toEqual(["1:5:4", "1:6:1"]);
  });

  it("refuses an unknown kind, a missing key and a bad query", async () => {
    expect((await post("/occurrences", { kind: "nope", key: "x" })).status).toBe(400);
    expect((await post("/occurrences", { kind: "root" })).status).toBe(400);
    expect((await post("/occurrences", { kind: "construction", query: { slots: [{ pos: "nope" }] } })).status).toBe(400);
  });
});

describe("GET /spellings", () => {
  it("lists words written more than one way, most places first, with neutral kinds", async () => {
    const { body } = await get("/spellings?limit=5");
    expect(body.total).toBeGreaterThan(150);
    expect(body.kinds.map((k: any) => k.id)).toEqual(expect.arrayContaining(["ta", "alif", "ya", "hamza", "double-ta", "doubling", "ending"]));
    const totals = body.items.map((g: any) => g.total);
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
    for (const g of body.items) {
      expect(g.spellings.length).toBeGreaterThan(1);
      for (const s of g.spellings) expect(s.places.length).toBeLessThanOrEqual(12);
    }
  });

  it("إبراهيم: found by its plain letters, two shapes (54 and 15), the difference a ي", async () => {
    const { body } = await get(`/spellings?q=${encodeURIComponent("ابراهيم")}`);
    expect(body.total).toBe(1);
    const g = body.items[0];
    expect(g).toMatchObject({ key: "2:124:3", total: 69, kinds: ["ya"] });
    expect(g.spellings.map((s: any) => [s.surface, s.count, s.ayahs])).toEqual([["إِبْرَٰهِيمَ", 54, 51], ["إِبْرَٰهِۦمَ", 15, 12]]);
    const full = (await get("/spellings/2:124:3")).body;
    expect(full.spellings[0].places.length).toBe(54);
    expect(full.spellings[1].places[0]).toEqual({ verseKey: "2:124", word: 3 });
    expect((await get("/spellings/9:9:99")).status).toBe(404);
  });

  it("the kind filter keeps only groups of that kind, and counts follow the search", async () => {
    const { body } = await get("/spellings?kind=ta&limit=500");
    expect(body.items.every((g: any) => g.kinds.includes("ta"))).toBe(true);
    expect(body.total).toBe(body.kinds.find((k: any) => k.id === "ta").count);
  });

  it("names a difference by the letters only", () => {
    expect(spellingDiffKinds("رحمة", "رحمت")).toEqual(["ta"]);
    expect(spellingDiffKinds("كتاب", "كتٰب")).toEqual(["alif"]);
    expect(spellingDiffKinds("إبرٰهيم", "إبرٰهۦم")).toEqual(["ya"]);
    expect(spellingDiffKinds("لقاء", "لقائ")).toEqual(["hamza"]);
    expect(spellingDiffKinds("تذكر", "تتذكر")).toEqual(["double-ta"]);
    expect(spellingDiffKinds("يرتدد", "يرتد")).toEqual(["doubling"]);
    expect(spellingDiffKinds("يشاقق", "يشآق")).toEqual(["doubling"]);
    expect(spellingDiffKinds("صلوٰة", "صلات")).toEqual(["ta", "waw-alif"]);
  });

  it("no group is left under \"other\"; the new kinds hold their words", async () => {
    const { body } = await get("/spellings?limit=500");
    expect(body.kinds.map((k: any) => k.id)).not.toContain("other");
    const of = async (kind: string) => (await get(`/spellings?kind=${kind}&limit=500`)).body.items.map((g: any) => g.spellings.map((s: any) => nfc(s.surface)));
    expect(await of("double-ta")).toContainEqual([nfc("تَذَكَّرُ"), nfc("تَتَذَكَّرُ")]);
    expect((await of("doubling")).flat()).toEqual(expect.arrayContaining([nfc("يَرْتَدِدْ"), nfc("يَرْتَدَّ")]));
    const salat = (await get(`/spellings?q=${encodeURIComponent("صلوة")}`)).body.items[0];
    // صَلَوٰة and صَلَاتِهِمْ part at و / ا; the ت of the second is the pronoun's doing, so it is not named
    expect(salat.kinds).toEqual(["waw-alif"]);
  });

  it("ة or ت: each spelling is the places written so with nothing attached; the pronoun-carrying words stand apart", async () => {
    const ta = (await get("/spellings?kind=ta&limit=500")).body.items;
    const of = (word: string) => ta.find((g: any) => g.spellings.some((s: any) => nfc(s.surface) === nfc(word)));
    const woman = of("ٱمْرَأَتُ");
    expect(woman.spellings.map((s: any) => [nfc(s.surface), s.count, s.attached ?? 0])).toEqual([[nfc("ٱمْرَأَتُ"), 7, 0], [nfc("ٱمْرَأَةٌ"), 4, 0]]);
    expect(woman.withPronoun).toMatchObject({ count: 13 });
    expect(woman.total).toBe(24);
    const full = (await get(`/spellings/${woman.key}`)).body;
    expect(full.spellings[0].places.map((p: any) => p.verseKey)).toEqual(["3:35", "12:30", "12:51", "28:9", "66:10", "66:10", "66:11"]);
    expect(full.withPronoun.places.length).toBe(13);
    expect(of("رَحْمَتَ").spellings.map((s: any) => s.count)).toEqual([72, 7]);
    expect(of("رَحْمَتَ").withPronoun.count).toBe(35);
    expect(of("نِعْمَتَ").spellings[1].count).toBe(11);
    // a word whose ت only ever follows a pronoun is not listed (مَلَـٰٓئِكَتِهِۦ, قَرْيَتِنَا)
    expect(ta.some((g: any) => /ملائك|ملٰئك|قري/.test(nfc(g.lemma)))).toBe(false);
    // where the bare word is never written ت, the pronoun-carrying words stay with their spelling
    const salat = (await get(`/spellings?q=${encodeURIComponent("صلوة")}`)).body.items[0];
    expect(salat.withPronoun).toBeUndefined();
    expect(salat.spellings.map((s: any) => [s.count, s.attached ?? 0])).toEqual([[69, 2], [9, 9]]);
  });

  it("one word is listed once: كِتَٰب with and without ٱل, a verb in every person", async () => {
    const all = (await get("/spellings?limit=500")).body.items;
    const book = all.filter((g: any) => nfc(g.lemma) === nfc("كِتَٰب"));
    expect(book.length).toBe(1);
    expect(book[0].spellings.map((s: any) => s.count)).toEqual([237, 4]);
    const said = all.filter((g: any) => nfc(g.lemma) === nfc("قَالَ"));
    expect(said.map((g: any) => g.spellings.map((s: any) => [nfc(s.surface), s.count]))).toEqual([[[nfc("قَالَ"), 863], [nfc("قَٰلَ"), 4]]]);
    // the plural صَلَوَٰت is written like صَلَوٰتَكَ, and is still not a spelling of the singular
    const salat = all.find((g: any) => nfc(g.lemma) === nfc("صَلَوٰة"));
    expect(salat.kinds).toEqual(["waw-alif"]);
  });

  it("a rule from a spelling lists exactly the places the list counts, for every spelling of every word", async () => {
    const items = [
      ...(await get("/spellings?limit=500")).body.items,
      ...(await get("/spellings?kind=ending&limit=500")).body.items,
    ];
    let checked = 0;
    for (const item of items) {
      const g = (await get(`/spellings/${item.key}`)).body;
      for (const s of g.spellings) {
        const { body } = await post("/occurrences", { kind: "spelling", key: `${g.key}|${s.surface}`, limit: 6000 });
        expect(body.places.map((p: any) => `${p.verseKey}:${p.word}`)).toEqual(s.places.map((p: any) => `${p.verseKey}:${p.word}`));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(350);
    const woman = (await post("/occurrences", { kind: "spelling", key: "3:35:3|ٱمْرَأَةٌ" })).body;
    expect(woman).toMatchObject({ total: 4, ayahs: 4 });
    expect(woman.places.map((p: any) => p.verseKey)).toEqual(["4:12", "4:128", "27:23", "33:50"]);
    // the bare shape, with no group named, is every word whose stem is written so
    expect((await post("/occurrences", { kind: "spelling", key: "ٱمْرَأَتُ" })).body.total).toBe(20);
    // a group or spelling the list does not have is no place
    expect((await post("/occurrences", { kind: "spelling", key: "9:9:99|ٱمْرَأَتُ" })).body.total).toBe(0);
    expect((await post("/occurrences", { kind: "spelling", key: "3:35:3|كتاب" })).body.total).toBe(0);
  });

  it("sort=alpha lists the words in the order of the Arabic alphabet", async () => {
    const { body } = await get("/spellings?sort=alpha&limit=500");
    const first = body.items.map((g: any) => nfc(g.lemma).replace(/[^\u0621-\u064A\u0671]/g, "")[0]);
    // أ … ي: the first letters never go back (a hamza on any seat and ٱ are read as ا)
    const ranks = first.map((ch: string) => ("ءآأؤإئٱا".includes(ch) ? "ا" : ch));
    expect([...ranks].sort()).toEqual(ranks);
    expect(new Set(ranks).size).toBeGreaterThan(15);
    expect(body.total).toBe((await get("/spellings?limit=1")).body.total);
  });

  it("grammar endings: decided from the case, left out of the default list, and not marked in the reader", async () => {
    const all = (await get("/spellings?limit=500")).body;
    const ending = (await get("/spellings?kind=ending&limit=500")).body;
    const only = ending.items.filter((g: any) => g.kinds.length === 1);
    expect(all.hidden).toBe(only.length);
    expect(all.hidden).toBeGreaterThan(0);
    const keys = new Set(all.items.map((g: any) => g.key));
    for (const g of only) expect(keys.has(g.key)).toBe(false);
    const shapes = ending.items.map((g: any) => g.spellings.map((s: any) => nfc(s.surface)).sort().join(" / "));
    for (const pair of [["ذُو", "ذِى"], ["بَنِىٓ", "بَنُوٓا۟"], ["أُو۟لِى", "أُو۟لُوا۟"], ["تَارِكِىٓ", "تَارِكُوٓا۟"]]) {
      expect(shapes).toContain(pair.map(nfc).sort().join(" / "));
    }
    // ذُو in 2:105 and ذِى in 2:83 are not spelling variants in the reader
    expect((await get("/verses/2:105/spelling?pos=23")).body).toEqual([]);
    expect((await get("/chapters/2/variants")).body.some((v: any) => v.verse_key === "2:83" && v.positions.includes(12))).toBe(false);
  });

  it("not one word written two ways: آللَّهُ (the question) and يَبْلَىٰ (another verb) are in no group", async () => {
    expect((await get("/verses/10:59/spelling?pos=14")).body).toEqual([]);
    expect((await get("/verses/20:120/spelling?pos=13")).body).toEqual([]);
    const all = [...(await get("/spellings?limit=500")).body.items, ...(await get("/spellings?kind=ending&limit=500")).body.items];
    const surfaces = all.flatMap((g: any) => g.spellings.map((s: any) => nfc(s.surface)));
    expect(surfaces).not.toContain(nfc("آللَّهُ"));
    expect(surfaces).not.toContain(nfc("يَبْلَىٰ"));
  });
});

describe("GET /chapters/:id/speech-openers", () => {
  it("al-Ikhlāṣ: the one قُلْ, sure", async () => {
    const { body } = await get("/chapters/112/speech-openers");
    expect(body).toEqual({ chapter: 112, openers: [{ verseKey: "112:1", word: 1, text: "قُلْ", root: "قول", lemma: "قَالَ", sure: true }] });
  });

  it("every verb of ن د و, sure only where a vocative or the أَنْ of interpretation follows it", async () => {
    const t = (await get("/chapters/20/speech-openers")).body;
    expect(t.openers.find((o: any) => o.verseKey === "20:11")).toMatchObject({ word: 3, root: "ندو", sure: true });   // نُودِىَ يَٰمُوسَىٰٓ
    const a = (await get("/chapters/7/speech-openers")).body.openers.filter((o: any) => o.root === "ندو" && o.sure);
    expect(a.map((o: any) => o.verseKey)).toEqual(["7:43", "7:44", "7:46", "7:50"]);
    // 5:58 نَادَيْتُمْ إِلَى ٱلصَّلَوٰةِ: a call with nothing quoted after it, listed but not sure
    const m = (await get("/chapters/5/speech-openers")).body.openers;
    expect(m.find((o: any) => o.root === "ندو")).toMatchObject({ verseKey: "5:58", sure: false });
    // 11:42 وَنَادَىٰ نُوحٌ ٱبْنَهُ وَكَانَ فِى مَعْزِلٍ يَـٰبُنَىَّ: كَانَ comes before the vocative
    const h = (await get("/chapters/11/speech-openers")).body.openers;
    expect(h.find((o: any) => o.verseKey === "11:42")).toMatchObject({ word: 7, root: "ندو", sure: false });
    expect(h.filter((o: any) => o.root === "قول").every((o: any) => o.sure === true)).toBe(true);
    expect((await get("/chapters/115/speech-openers")).status).toBe(404);
  });

  it("?roots= adds a reader's roots: their verbs are `added`, sure the same way; unknown roots find nothing", async () => {
    const plain = (await get("/chapters/11/speech-openers")).body.openers;
    const { status, body } = await get(`/chapters/11/speech-openers?roots=${encodeURIComponent("د ع و,زززز")}`);
    expect(status).toBe(200);
    const added = body.openers.filter((o: any) => o.added);
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((o: any) => o.root === "دعو" && typeof o.sure === "boolean")).toBe(true);
    expect(body.openers.filter((o: any) => !o.added)).toEqual(plain);
    expect(plain.some((o: any) => "added" in o)).toBe(false);
    // ق و ل asked for again is not "added"
    expect((await get(`/chapters/112/speech-openers?roots=${encodeURIComponent("قول")}`)).body.openers[0].added).toBeUndefined();
    const many = Array.from({ length: 11 }, (_, i) => "قول".repeat(i + 1)).join(",");
    expect((await get(`/chapters/11/speech-openers?roots=${encodeURIComponent(many)}`)).status).toBe(422);
  });
});

describe("GET /verses/:key/pronouns", () => {
  it("1:7: the تَ and هِمْ attached, and with verbs=1 the verb's own person, number and gender", async () => {
    const plain = (await get("/verses/1:7/pronouns")).body;
    expect(plain.pronouns.map((p: any) => [p.word, p.pronoun, p.type])).toEqual([[3, "تَ", "attached"], [4, "هِمْ", "attached"], [7, "هِمْ", "attached"]]);
    const verbs = (await get("/verses/1:7/pronouns?verbs=1")).body;
    expect(verbs.pronouns[0]).toEqual({ word: 3, text: "أَنْعَمْتَ", pronoun: "", type: "verb", person: "2", number: "S", gender: "M", part: 1 });
  });

  it("7:11 خَلَقْنَـٰكُمْ: two pronouns, numbered after the verb's own subject, the same with verbs on or off", async () => {
    const plain = (await get("/verses/7:11/pronouns")).body.pronouns.filter((p: any) => p.word === 2);
    expect(plain.map((p: any) => [p.pronoun, p.person, p.number, p.part])).toEqual([["نَٰ", "1", "P", 2], ["كُمْ", "2", "P", 3]]);
    const verbs = (await get("/verses/7:11/pronouns?verbs=1")).body.pronouns.filter((p: any) => p.word === 2);
    expect(verbs.map((p: any) => [p.type, p.part])).toEqual([["verb", 1], ["attached", 2], ["attached", 3]]);
    // every pronoun keeps its number whether verbs are asked for or not
    for (const key of ["2:255", "12:4", "1:5"]) {
      const a = (await get(`/verses/${key}/pronouns`)).body.pronouns;
      const b = (await get(`/verses/${key}/pronouns?verbs=1`)).body.pronouns.filter((p: any) => p.type !== "verb");
      expect(a).toEqual(b);
      expect(a.every((p: any) => p.part >= 1)).toBe(true);
    }
  });

  it("1:5: إِيَّاكَ twice, a separate word", async () => {
    const { body } = await get("/verses/1:5/pronouns");
    expect(body.pronouns.map((p: any) => [p.word, p.type, p.person, p.number, p.gender])).toEqual([[1, "separate", "2", "S", "M"], [3, "separate", "2", "S", "M"]]);
  });

  it("12:101: the ى of رَبِّ is not written, so its pronoun is empty", async () => {
    const { body } = await get("/verses/12:101/pronouns");
    expect(body.pronouns[0]).toMatchObject({ word: 1, pronoun: "", type: "attached", person: "1", number: "S" });
    expect(nfc(body.pronouns[0].text)).toBe(nfc("رَبِّ"));
    expect((await get("/verses/999:1/pronouns")).status).toBe(404);
  });
});

describe("POST /spread", () => {
  it("counts places and āyāt by sūrah and page, zeros included; an āyah with two of the roots counts once", async () => {
    const { status, body } = await post("/spread", { roots: ["ص ب ر", "Slw", "زززز"] });
    expect(status).toBe(200);
    expect(body.roots).toEqual(["صبر", "صلو"]);
    expect(body.unknown).toEqual(["زززز"]);
    expect(body.chapters.length).toBe(114);
    expect(body.pages.length).toBe(604);
    expect(body.chapters[0]).toEqual({ chapter: 1, places: 0, ayahs: 0, verses: 7 });
    expect(body.chapters.reduce((n: number, c: any) => n + c.places, 0)).toBe(body.total);
    expect(body.pages.reduce((n: number, p: any) => n + p.places, 0)).toBe(body.total);
    expect(body.emptyChapters).toBe(body.chapters.filter((c: any) => c.places === 0).length);
    expect(body.emptyPages).toBe(body.pages.filter((p: any) => p.places === 0).length);
    // each root alone, against the occurrences of each
    const sabr = (await post("/spread", { roots: ["صبر"] })).body;
    const salat = (await post("/spread", { roots: ["صلو"] })).body;
    expect(sabr.total).toBe((await post("/occurrences", { kind: "root", key: "صبر" })).body.total);
    expect(body.total).toBe(sabr.total + salat.total);
    // 2:45 وَٱسْتَعِينُوا۟ بِٱلصَّبْرِ وَٱلصَّلَوٰةِ holds both: one āyah, two places
    expect(body.ayahs).toBeLessThan(sabr.ayahs + salat.ayahs);
  });

  it("takes 1 to 60 roots", async () => {
    expect((await post("/spread", { roots: [] })).status).toBe(422);
    expect((await post("/spread", { roots: Array(61).fill("قول") })).status).toBe(422);
    expect((await post("/spread", {})).status).toBe(422);
    expect((await post("/spread", { roots: ["qwl"] })).body.roots).toEqual(["قول"]);
  });
});

describe("GET /supplications", () => {
  it("where the Lord is addressed with رَبَّنَا, رَبِّ and ٱللَّهُمَّ, in Book order", async () => {
    const { body } = await get("/supplications");
    const by = Object.fromEntries(body.openings.map((o: any) => [o.id, o]));
    expect(by.rabbana.count).toBe(71);
    expect(by.rabbi.count).toBe(67);
    expect(by.allahumma.count).toBe(5);
    expect(body.total).toBe(71 + 67 + 5);
    const at = (k: string) => body.items.filter((i: any) => i.verseKey === k).map((i: any) => `${i.opening}@${i.word}`);
    expect(at("2:285")).toEqual(["rabbana@25"]);           // غُفْرَانَكَ رَبَّنَا
    expect(at("2:286")).toEqual(["rabbana@13", "rabbana@20", "rabbana@31"]);
    expect(at("12:101")).toEqual(["rabbi@1"]);              // رَبِّ قَدْ ءَاتَيْتَنِى
    expect(at("5:114")).toEqual(["allahumma@5", "rabbana@6"]);
    for (const k of ["1:2", "6:162", "7:54", "35:34", "89:15"]) expect(at(k), k).toEqual([]);
    const order = body.items.map((i: any) => i.verseKey.split(":").map(Number));
    for (let i = 1; i < order.length; i++) expect(order[i][0] * 1000 + order[i][1]).toBeGreaterThanOrEqual(order[i - 1][0] * 1000 + order[i - 1][1]);
  });

  it("?opening= keeps one; an unknown one is refused", async () => {
    const { body } = await get("/supplications?opening=allahumma");
    expect(body.items.map((i: any) => i.verseKey)).toEqual(["3:26", "5:114", "8:32", "10:10", "39:46"]);
    expect(body.total).toBe(5);
    expect(body.openings.find((o: any) => o.id === "rabbana").count).toBe(71);
    expect((await get("/supplications?opening=nope")).status).toBe(422);
  });
});

describe("GET /chapters/:id/frame", () => {
  it("al-Baqarah: the roots its first three āyāt share with its last three, rarest first", async () => {
    const { body } = await get("/chapters/2/frame");
    expect(body).toMatchObject({ chapter: 2, verses: 286, n: 3, opening: ["2:1", "2:2", "2:3"], close: ["2:284", "2:285", "2:286"] });
    const inBook = body.shares.map((s: any) => s.inBook);
    expect([...inBook].sort((a, b) => a - b)).toEqual(inBook);
    const amn = body.shares.find((s: any) => s.root === "امن");
    expect(amn.opening[0]).toMatchObject({ verseKey: "2:3", word: 2 });       // يُؤْمِنُونَ
    expect(amn.inBook).toBe((await post("/occurrences", { kind: "root", key: "امن" })).body.total);
    for (const s of body.shares) {
      expect(s.opening.length).toBeGreaterThan(0);
      expect(s.close.length).toBeGreaterThan(0);
      expect(["form", "lemma", "root"]).toContain(s.level);
    }
  });

  it("n is lowered so the two ends never overlap; out of range is refused", async () => {
    const short = (await get("/chapters/103/frame?n=10")).body;
    expect(short).toMatchObject({ verses: 3, n: 1, opening: ["103:1"], close: ["103:3"] });
    expect((await get("/chapters/2/frame?n=11")).status).toBe(422);
    expect((await get("/chapters/2/frame?n=0")).status).toBe(422);
    expect((await get("/chapters/115/frame")).status).toBe(404);
  });
});

describe("POST /wording-check", () => {
  it("says, word by word, how each is found", async () => {
    const { status, body } = await post("/wording-check", { text: "بِسْمِ ٱللَّهِ، الرحمن وكتابهم ٱلْـَٔاخِرَةِ الصلاة xyz زرقطون" });
    expect(status).toBe(200);
    const by = Object.fromEntries(body.words.map((w: any) => [w.text, w]));
    expect(body.words.map((w: any) => w.text)).toEqual(["بِسْمِ", "ٱللَّهِ", "الرحمن", "وكتابهم", "ٱلْـَٔاخِرَةِ", "الصلاة", "زرقطون"]);
    expect(by["بِسْمِ"]).toMatchObject({ status: "written", written: { count: 3, ayahs: 3 }, sample: "1:1" });
    expect(by["الرحمن"].status).toBe("letters");
    expect(by["الرحمن"].letters.forms.map(nfc)).toContain(nfc("ٱلرَّحْمَٰنِ"));
    expect(by["الرحمن"].letters.roots).toEqual(["رحم"]);
    expect(by["وكتابهم"]).toMatchObject({ status: "stem", stem: { prefix: "و", text: "كِتَٰبَهُمْ", count: 1 }, sample: "17:71" });
    // the displayed text writes this hamza on a tatweel; the morphology on the line: one word
    expect(by["ٱلْـَٔاخِرَةِ"].status).toBe("written");
    expect(by["الصلاة"].letters.forms.map(nfc)).toContain(nfc("ٱلصَّلَوٰةَ"));
    expect(by["زرقطون"]).toMatchObject({ status: "none", stem: null, sample: null });
    expect(body.summary).toEqual({ total: 7, written: 3, letters: 2, stem: 1, none: 1 });
  });

  it("takes at most 200 words", async () => {
    expect((await post("/wording-check", { text: "قال ".repeat(201) })).status).toBe(422);
    expect((await post("/wording-check", { text: "قال ".repeat(200) })).status).toBe(200);
    expect((await post("/wording-check", {})).status).toBe(422);
  });

  it("letters ignore vowels and the ways a letter is carried", () => {
    expect(lettersKey("ٱلْكِتَٰبُ")).toBe(lettersKey("الكتاب"));
    expect(lettersKey("قَالَ")).not.toBe(lettersKey("قُلْ"));
  });
});

describe("GET /diff", () => {
  it("2:35 and 7:19: the same command, with وَقُلْنَا, رَغَدًا and و / ف the differences", async () => {
    const { body } = await get("/diff?a=2:35&b=7:19");
    expect(body.counts).toEqual({ same: 13, marks: 0, spelling: 0, changed: 3, "only-a": 2, "only-b": 0 });
    expect(body.rows[0]).toEqual({ a: { word: 1, text: "وَقُلْنَا" }, b: null, how: "only-a" });
    const kulaa = body.rows.find((r: any) => r.a?.word === 7);
    expect(kulaa).toMatchObject({ b: { word: 6, text: "فَكُلَا" }, how: "changed" });
    expect(body.rows.find((r: any) => r.a?.text === "رَغَدًا")).toMatchObject({ b: null, how: "only-a" });
  });

  it("2:136 and 3:84: إبراهيم in its two spellings is one word written differently", async () => {
    const { body } = await get("/diff?a=2:136&b=3:84");
    const ib = body.rows.find((r: any) => r.how === "spelling" && r.a.text === "إِبْرَٰهِۦمَ");
    expect(ib.b.text).toBe("إِبْرَٰهِيمَ");
  });

  it("an āyah against itself is the same throughout; unknown keys are 404", async () => {
    const { body } = await get("/diff?a=55:13&b=55:16");
    expect(body.counts.same).toBe(body.rows.length);
    expect((await get("/diff?a=2:35&b=999:1")).status).toBe(404);
    expect((await get("/diff?a=2:35")).status).toBe(422);
  });
});

describe("grammar filters", () => {
  const search = async (body: unknown) => (await post("/construction-search", { limit: 500, ...(body as object) })).body;

  it("the catalog lists the new vocabularies", async () => {
    const { body } = await get("/construction-presets");
    expect(body.derivations).toEqual({ ACT_PCPL: "Active participle", PASS_PCPL: "Passive participle", VN: "Verbal noun" });
    expect(body.verbForms[0]).toBe("I");
    expect(body.suffixes["3MP"]).toBeTruthy();
  });

  it("participles: every word the corpus marks (2,974 active, 551 passive)", async () => {
    expect((await search({ slots: [{ derivation: "ACT_PCPL" }] })).total).toBe(2974);
    const pass = await search({ slots: [{ derivation: "PASS_PCPL" }] });
    expect(pass.total).toBe(551);
    expect(pass.hits[0]).toMatchObject({ verse_key: "1:7", start: 6 });   // ٱلْمَغْضُوبِ
  });

  it("verb form: form X verbs (369), form I as the corpus leaves it unmarked", async () => {
    const x = await search({ slots: [{ pos: "V", verbForm: "X" }] });
    expect(x.total).toBe(369);
    expect(x.hits[0]).toMatchObject({ verse_key: "1:5", start: 4 });     // نَسْتَعِينُ
    const one = await search({ slots: [{ derivation: "ACT_PCPL", verbForm: "I" }], limit: 1 });
    expect(one.hits[0]).toMatchObject({ verse_key: "1:4", start: 1 });  // مَٰلِكِ
  });

  it("noun number: the duals (237 words)", async () => {
    expect((await search({ slots: [{ noun: { number: "D" } }] })).total).toBe(237);
  });

  it("opening with رَبَّنَا / رَبِّ: 24 āyāt, 2:128 and 12:101 among them, not 7:122 (رَبِّ مُوسَىٰ)", async () => {
    const r = await search({ atStart: true, slots: [{ lemma: "رَبّ", suffix: ["1S", "1P"] }] });
    expect(r.ayahs).toBe(24);
    const keys = r.hits.map((h: any) => h.verse_key);
    expect(keys).toEqual(expect.arrayContaining(["2:128", "12:101", "71:28"]));
    expect(keys).not.toContain("7:122");
  });

  it("refuses a value the data doesn't have", async () => {
    const res = await post("/construction-search", { slots: [{ verbForm: "XIV" }] });
    expect(res.status).toBe(400);
    expect((await post("/construction-search", { slots: [{ noun: { number: "X" } }] })).status).toBe(400);
  });
});
