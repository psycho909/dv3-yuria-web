import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CARDS, colorLabel } from "../src/domain";
import { CARD_NAMES, pixelCharacters } from "../scripts/pixel-font-text.mjs";

const fonts = join(__dirname, "..", "public", "fonts");

describe("pixel font subset", () => {
  it("covers every character listed for pixel text", () => {
    const subset = new Set(readFileSync(join(fonts, "yuria-pixel.chars.txt"), "utf8").trim());
    const missing = pixelCharacters().filter(char => char !== " " && !subset.has(char));
    // Fix: add the text to scripts/pixel-font-text.mjs and run `npm run font`.
    expect(missing).toEqual([]);
  });

  it("lists the current card names and colors, which the verdict band interpolates", () => {
    expect([...CARD_NAMES].sort()).toEqual(Object.values(CARDS).map(card => card.name).sort());
    const listed = new Set(pixelCharacters());
    expect(Object.values(colorLabel).join("").split("").filter(char => !listed.has(char))).toEqual([]);
  });

  it("ships a small renamed subset with its licence", () => {
    expect(statSync(join(fonts, "yuria-pixel.woff2")).size).toBeLessThanOrEqual(60_000);
    expect(existsSync(join(fonts, "OFL.txt"))).toBe(true);
    expect(readFileSync(join(fonts, "OFL.txt"), "utf8")).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/i);
  });
});
