import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codingFileSchema } from "./types.ts";
import { instructionsSchema } from "./instructions.ts";
import { verifyCoding } from "./verify.ts";
import { codeIndex } from "./instructions.ts";

const url = (f: string) => new URL(`../assets/examples/${f}`, import.meta.url);

/**
 * The bundled example fixture (Greifenbote 22.txt + example-coding.json +
 * frame-devices.json) must stay internally consistent: every entry's range and
 * excerpt against the article text, every entry's device in the catalog.
 */
describe("bundled example fixture", () => {
  const text = readFileSync(url("Greifenbote 22.txt"), "utf8");
  const coding = codingFileSchema.parse(JSON.parse(readFileSync(url("example-coding.json"), "utf8")));
  const instr = instructionsSchema.parse(JSON.parse(readFileSync(url("frame-devices.json"), "utf8")));

  it("has no coding entries with bad ranges or excerpts", () => {
    expect(verifyCoding(text, coding)).toEqual([]);
  });

  it("has more than 100 entries covering every catalog leaf", () => {
    expect(coding.codes.length).toBeGreaterThan(100);
    const ids = codeIndex(instr);
    const used = new Set(coding.codes.map((c) => c.device));
    for (const [id, code] of ids) {
      if (!code.includes(".")) continue;
      expect(used.has(id), `device ${code} uncoded`).toBe(true);
    }
  });
});
