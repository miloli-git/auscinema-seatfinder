// Generates a fully static mock-v1.html (seats + rail pre-rendered, no client JS) so headless
// Chrome renders it deterministically. Heatmap computed from depth + centrality (mirrors scorer).
import { readFileSync, writeFileSync } from "node:fs";

const sessions = [
  { t: "7:00 PM", fmt: "4DX", cin: "George Street", free: 120, score: 94, band: "elite", on: true },
  { t: "6:00 PM", fmt: "Gold Class", cin: "George Street", free: 50, score: 88, band: "great" },
  { t: "8:30 PM", fmt: "Gold Class", cin: "George Street", free: 49, score: 88, band: "great" },
  { t: "6:15 PM", fmt: "V-Max", cin: "George Street", free: 144, score: 86, band: "great" },
  { t: "7:00 PM", fmt: "Standard", cin: "George Street", free: 60, score: 69, band: "good" },
  { t: "9:10 PM", fmt: "Standard", cin: "George Street", free: 31, score: 61, band: "good" },
];

const ROWS = "ABCDEFGHJKLMNP".split("");
const COLS = 20, TARGET = 0.62, AISLE = 10;
const sold = new Set(["A3","A4","B11","C11","D11","H8","H9","K2","M15","N6","N7","P12","F18","G18"]);
const bucket = (v) => (v >= 0.88 ? "elite" : v >= 0.74 ? "great" : v >= 0.58 ? "good" : v >= 0.4 ? "ok" : "weak");
const scoreOf = (ri, c) => {
  const depth = ri / (ROWS.length - 1);
  const centre = (COLS - 1) / 2, central = 1 - Math.abs(c - centre) / centre;
  return Math.max(0, 1 - Math.abs(depth - TARGET) * 1.15 - (1 - central) * 0.55);
};

// best 5 available
const all = [];
ROWS.forEach((r, ri) => { for (let c = 0; c < COLS; c++) { const id = r + (c + 1); if (c !== AISLE && !sold.has(id)) all.push({ id, s: scoreOf(ri, c) }); } });
const best = new Set(all.sort((a, b) => b.s - a.s).slice(0, 5).map((x) => x.id));

const railHtml = sessions.map((s) => `
      <button class="sess" type="button" aria-pressed="${s.on ? "true" : "false"}">
        <span class="scorepill" data-band="${s.band}"><b>${s.score}</b><span>best</span></span>
        <span><span class="sess__time">${s.t}</span>
          <span class="sess__meta"><span class="tag">${s.fmt}</span></span>
          <span class="sess__sub">${s.cin} · ${s.free} free</span></span>
      </button>`).join("");

const gridHtml = ROWS.map((r, ri) => {
  const cells = [];
  for (let c = 0; c < COLS; c++) {
    const id = r + (c + 1);
    if (c === AISLE) cells.push(`<span class="seat" data-q="gap"></span>`);
    else if (sold.has(id)) cells.push(`<span class="seat" data-q="sold"></span>`);
    else cells.push(`<span class="seat" data-q="${bucket(scoreOf(ri, c))}"${best.has(id) ? " data-best" : ""}></span>`);
  }
  return `        <div class="row"><span class="row__lab">${r}</span><div class="seats">${cells.join("")}</div></div>`;
}).join("\n");

const tpl = readFileSync(new URL("./mock-v1.html", import.meta.url), "utf8");
// Replace the rail + grid containers' contents and strip the <script> block.
let out = tpl
  .replace(/<div class="rail" id="rail">[\s\S]*?<\/div>/, `<div class="rail" id="rail">${railHtml}\n      </div>`)
  .replace(/<div class="grid" id="grid"([^>]*)><\/div>/, `<div class="grid" id="grid"$1>\n${gridHtml}\n      </div>`)
  .replace(/<script>[\s\S]*?<\/script>\s*/, "");
writeFileSync(new URL("./mock-v1.static.html", import.meta.url), out);
console.log("wrote mock-v1.static.html — rail:", sessions.length, "rows:", ROWS.length, "best:", [...best].join(","));
