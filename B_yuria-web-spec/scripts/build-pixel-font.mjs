// Builds public/fonts/yuria-pixel.woff2: a subset of Cubic 11 (SIL OFL 1.1) holding only the characters in
// scripts/pixel-font-text.mjs. "Cubic" and "俐方體" are Reserved Font Names, and a subset is a Modified Version,
// so the font's names become "Yuria Pixel" (the build fails if a reserved name is still used as a name);
// the copyright notice keeps its original wording, as the licence requires.
// Run: npm run font   (downloads the pinned source release once into .cache/)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pixelCharacters } from "./pixel-font-text.mjs";

const require = createRequire(import.meta.url);
const { createFont, woff2 } = require("fonteditor-core");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE = "v1.500";
const SOURCE = { url: `https://raw.githubusercontent.com/ACh-K/Cubic-11/${RELEASE}/fonts/ttf/Cubic_11.ttf`, gitBlob: "48b3411ce6f6f54db45b6125d108b574ebdc973e" };
const LICENSE = { url: `https://raw.githubusercontent.com/ACh-K/Cubic-11/${RELEASE}/OFL.txt`, gitBlob: "4e863313ebd22ae0b44ea5f9538142b6b10e8f29" };
const RESERVED = ["Cubic", "俐方"];
const FAMILY = "Yuria Pixel";

/** Git blob hash, matching the SHA listed by the GitHub tree API for the pinned release. */
const gitBlobSha = buffer => createHash("sha1").update(`blob ${buffer.length}\0`).update(buffer).digest("hex");

async function pinned({ url, gitBlob }, cacheName) {
  const cachePath = join(root, ".cache", cacheName);
  let buffer = existsSync(cachePath) ? readFileSync(cachePath) : null;
  if (!buffer) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
    buffer = Buffer.from(await response.arrayBuffer());
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, buffer);
  }
  const actual = gitBlobSha(buffer);
  if (actual !== gitBlob) throw new Error(`${cacheName} does not match release ${RELEASE} (got ${actual}); delete .cache/${cacheName} and retry.`);
  return buffer;
}

// Name-table fields that identify the font to users and software; these must not use a reserved name.
const NAME_FIELDS = ["fontFamily", "fontSubFamily", "uniqueSubFamily", "fullName", "postScriptName", "preferredFamily", "preferredSubFamily", "compatibleFull"];

const source = await pinned(SOURCE, `Cubic_11-${RELEASE}.ttf`);
const license = await pinned(LICENSE, `OFL-${RELEASE}.txt`);
const characters = pixelCharacters();
const font = createFont(source, { type: "ttf", subset: characters.map(char => char.codePointAt(0)), hinting: false, kerning: false });

const data = font.get();
const missing = characters.filter(char => char !== " " && !data.cmap[char.codePointAt(0)]);
if (missing.length) throw new Error(`Source font lacks: ${missing.join(" ")}`);
// The copyright and designer records are kept verbatim (OFL condition 2); only the names the font is known by change.
Object.assign(data.name, {
  fontFamily: FAMILY, fontSubFamily: "Regular", fullName: `${FAMILY} Regular`, uniqueSubFamily: `${FAMILY} Regular ${RELEASE}`, postScriptName: "YuriaPixel-Regular",
  preferredFamily: FAMILY, preferredSubFamily: "Regular", compatibleFull: `${FAMILY} Regular`,
  description: `Subset of the Cubic 11 font ${RELEASE} (github.com/ACh-K/Cubic-11) under SIL OFL 1.1, renamed because the original name is reserved.`
});
font.set(data);

const ttf = Buffer.from(font.write({ type: "ttf", hinting: false, kerning: false }));
const written = createFont(ttf, { type: "ttf" }).get().name;
const namedAs = NAME_FIELDS.map(field => written[field]).filter(Boolean);
if (written.fontFamily !== FAMILY || namedAs.some(value => RESERVED.some(word => value.includes(word)))) throw new Error(`Reserved font name still used: ${JSON.stringify(namedAs)}`);
await woff2.init();
const output = Buffer.from(font.write({ type: "woff2", hinting: false, kerning: false }));

const outDir = join(root, "public", "fonts");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "yuria-pixel.woff2"), output);
writeFileSync(join(outDir, "yuria-pixel.chars.txt"), `${characters.join("")}\n`);
writeFileSync(join(outDir, "OFL.txt"), license);
console.log(`yuria-pixel.woff2: ${characters.length} characters, ${output.length.toLocaleString()} bytes`);
