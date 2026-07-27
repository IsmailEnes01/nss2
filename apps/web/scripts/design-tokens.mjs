#!/usr/bin/env node
// Derives the theme block in src/styles.css from the color tokens in the
// repo-root DESIGN.md, so the two can't drift.
//
// Before this existed, DESIGN.md held hex values and styles.css held HSL
// values converted by hand — two copies of the palette with a lossy manual
// step between them, and nothing to catch it when only one was edited.
// DESIGN.md is now the source of truth; this script does the conversion.
//
//   bun run design:tokens          rewrite styles.css from DESIGN.md
//   bun run design:tokens --check  fail if it would change anything (CI)
//
// Only the block between the GENERATED markers in styles.css is touched;
// everything else in that file (the @theme block, shadows, base layer) is
// hand-written and left alone. Tokens with no DESIGN.md source (--muted,
// --border, --input, --ring, the player colors) keep their values here in
// DERIVED — they're deliberate in-between shades, not palette entries.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESIGN_MD = join(HERE, "..", "..", "..", "DESIGN.md");
const STYLES = join(HERE, "..", "src", "styles.css");

const START = "  /* GENERATED FROM DESIGN.md — run `bun run design:tokens` */";
const END = "  /* END GENERATED */";

/** DESIGN.md color token → the shadcn CSS variables it feeds. */
const MAPPING = [
  ["neutral", "--background"],
  ["on-primary", "--foreground"],
  ["neutral-container", "--card"],
  ["on-primary", "--card-foreground"],
  ["neutral-container", "--popover"],
  ["on-primary", "--popover-foreground"],
  ["tertiary", "--primary"],
  ["on-tertiary", "--primary-foreground"],
  ["primary", "--secondary"],
  ["on-primary", "--secondary-foreground"],
  ["secondary", "--muted-foreground"],
  ["on-primary", "--accent-foreground"],
  ["danger", "--destructive"],
];

/** Shades with no direct DESIGN.md entry — in-between values by design. */
const DERIVED = [
  ["--muted", "hsl(220 35% 14%)"],
  ["--accent", "hsl(217 45% 20%)"],
  ["--border", "hsl(220 30% 18%)"],
  ["--input", "hsl(220 28% 22%)"],
  ["--ring", "hsl(217 91% 68%)"],
  ["--player-one", "hsl(199 85% 58%)"],
  ["--player-two", "hsl(350 85% 64%)"],
];

function parseColors(markdown) {
  const front = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (front === null) throw new Error("DESIGN.md has no YAML front matter");
  const lines = front[1].split("\n");
  const start = lines.findIndex((line) => line.trim() === "colors:");
  if (start === -1) throw new Error("DESIGN.md front matter has no `colors:`");

  const colors = {};
  for (const line of lines.slice(start + 1)) {
    // Any key at a shallower indent ends the colors block.
    if (/^\S/.test(line)) break;
    const match = line.match(/^\s{2}([\w-]+):\s*"?(#[0-9a-fA-F]{6})"?\s*$/);
    if (match !== null) colors[match[1]] = match[2];
  }
  return colors;
}

/** #rrggbb → "hsl(H S% L%)", the format the stylesheet already uses. */
function hexToHsl(hex) {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const round = (n) => Math.round(n);
  return `hsl(${round(h)} ${round(s * 100)}% ${round(l * 100)}%)`;
}

function buildBlock(colors) {
  const out = [START];
  for (const [token, cssVar] of MAPPING) {
    const hex = colors[token];
    if (hex === undefined) {
      throw new Error(`DESIGN.md is missing the "${token}" color token`);
    }
    out.push(`  ${cssVar}: ${hexToHsl(hex)}; /* colors.${token} ${hex} */`);
  }
  for (const [cssVar, value] of DERIVED) {
    out.push(`  ${cssVar}: ${value};`);
  }
  out.push(END);
  return out.join("\n");
}

function main() {
  const check = process.argv.includes("--check");
  const colors = parseColors(readFileSync(DESIGN_MD, "utf8"));
  const block = buildBlock(colors);
  const css = readFileSync(STYLES, "utf8");

  // Match whatever line endings the working copy already uses. This repo is
  // checked out on Windows (CRLF); emitting LF here would make --check report
  // "out of date" on every single run, forever.
  const eol = css.includes("\r\n") ? "\r\n" : "\n";
  const blockEol = block.replaceAll("\n", eol);

  const from = css.indexOf(START);
  const to = css.indexOf(END);
  if (from === -1 || to === -1) {
    throw new Error(
      `styles.css is missing the generated-block markers.\nExpected:\n${START}\n  …\n${END}`,
    );
  }
  const next = css.slice(0, from) + blockEol + css.slice(to + END.length);

  if (next === css) {
    console.log("design tokens: up to date");
    return;
  }
  if (check) {
    console.error(
      "design tokens: styles.css is out of date with DESIGN.md — run `bun run design:tokens`",
    );
    process.exit(1);
  }
  writeFileSync(STYLES, next);
  console.log("design tokens: styles.css updated from DESIGN.md");
}

main();
