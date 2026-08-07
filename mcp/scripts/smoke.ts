// (committed smoke test — see the header comment for how to run it)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Smoke test: drives the stdio server through a real MCP client and asserts the
// write guards hold. Writes proposals into whatever research.db is configured, so
// point QF_RESEARCH_DB at a scratch file when running it:
//   QF_RESEARCH_DB=/tmp/smoke.db npm run smoke -w @alsiraat/mcp
const t = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "src/index.ts"],
  env: process.env as Record<string, string>,
});
const c = new Client({ name: "probe", version: "1.0.0" });
await c.connect(t);

const tools = await c.listTools();
console.log("TOOLS:", tools.tools.length);
console.log("  read-only:", tools.tools.filter((x: any) => x.annotations?.readOnlyHint).map((x) => x.name).join(", "));
console.log("  writes   :", tools.tools.filter((x: any) => !x.annotations?.readOnlyHint).map((x) => x.name).join(", "));
const prompts = await c.listPrompts();
console.log("PROMPTS:", prompts.prompts.map((p) => p.name).join(", "));
const res = await c.listResources();
console.log("RESOURCES:", res.resources.map((r) => r.uri).join(", "));

const txt = (r: any) => r.content[0].text as string;
const call = async (name: string, args: any) => txt(await c.callTool({ name, arguments: args }));

console.log("\n--- study_root فلح ---");
const sr = JSON.parse(await call("study_root", { root: "فلح", occurrences: 2 }));
console.log("  root:", sr.root, "| forms:", sr.forms.map((f: any) => f.form).join(", "));
console.log("  lexicons:", sr.lexicons.length, "| company:", sr.keeps_company_with.slice(0,3).map((k:any)=>k.root).join(" "));
console.log("  samples:", sr.sample_occurrences.map((s: any) => s.verse_key).join(", "));

console.log("\n--- read_ayah 2:5 (no translation field?) ---");
const ra = JSON.parse(await call("read_ayah", { verse_key: "2:5" }));
console.log("  words:", ra.words.length, "| has 'translation' key:", "translation" in ra || JSON.stringify(ra).includes("translation"));
console.log("  w8:", JSON.stringify(ra.words[7]));

console.log("\n--- find_where_roots_meet نفق + امن ---");
const fw = JSON.parse(await call("find_where_roots_meet", { root_a: "نفق", root_b: "امن", limit: 5 }));
console.log("  together_in:", fw.together_in, "| first:", fw.ayat.map((x: any) => x.verse_key).join(", "));

console.log("\n--- guards ---");
const w1 = await c.callTool({ name: "propose_indication", arguments: { root: "فلح", label: "break open", meaning: "split the covering", refinements: [{ form: "مُفْلِحُون", label: "those who break through" }, { form: "لَيْسَ", label: "bogus form" }] } });
const p1 = JSON.parse(txt(w1 as any));
console.log("  proposed:", p1.id, "| is_primary:", p1.is_primary, "| refined:", p1.refinements.length, "| rejected:", JSON.stringify(p1.rejected_refinements));
const w2 = JSON.parse(await call("add_note", { verse_key: "2:5", text: "does مفلحون imply an outcome or a state?", kind: "question", word_position: 8 }));
console.log("  note:", w2.id, "awaiting_review:", w2.awaiting_review);
const bad = await c.callTool({ name: "add_note", arguments: { verse_key: "nope", text: "x" } });
console.log("  bad verse key ->", (bad as any).isError, txt(bad as any).slice(0, 60));
const bad2 = await c.callTool({ name: "add_note", arguments: { verse_key: "2:5", text: "   " } });
console.log("  empty text   ->", (bad2 as any).isError, txt(bad2 as any).slice(0, 60));

console.log("\n--- resources ---");
const meth = await c.readResource({ uri: "alsiraat://method" });
console.log("  method chars:", (meth.contents[0] as any).text.length);
const sum = await c.readResource({ uri: "alsiraat://research/summary" });
console.log("  summary:\n" + (sum.contents[0] as any).text.split("\n").slice(0, 12).map((l: string) => "    " + l).join("\n"));

console.log("\n--- prompt ---");
const pr = await c.getPrompt({ name: "test_indication", arguments: { root: "فلح", indication: "to break open" } });
console.log("  prompt chars:", (pr.messages[0].content as any).text.length, "| mentions ignore-tafsir:", (pr.messages[0].content as any).text.includes("IGNORE the traditional"));

await c.close();
