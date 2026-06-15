// DEV TOOL (not shipped). Generates real-data team files for the modern eras
// (2000s, 2010s, 2020s) from the MIT-licensed Brescou NBA dataset
// (https://github.com/Brescou/NBA-dataset-stats-player-team, 1996-97..2022-23).
//
// Input CSVs live in tools/.cache (downloaded once, gitignored). Output overwrites
// data/teams/{2000s,2010s,2020s}.json in the existing schema, adding a real
// `record: { wins, losses }` per team so playoff seeding uses true history.
//
// Run: node tools/build-teams.js

const fs = require("fs");
const path = require("path");

const CACHE = path.join(__dirname, ".cache");
const DATA = path.join(__dirname, "..", "data", "teams");

// ---- Tiny CSV parser (handles quoted fields with embedded commas) ----
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function readTable(file) {
  const rows = parseCSV(fs.readFileSync(path.join(CACHE, file), "utf8"));
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  return { rows: rows.slice(1).filter((r) => r.length > 1), idx };
}

// ---- Position mapping: coarse G/F/C -> court slots ----
const POS_MAP = {
  "G": ["PG", "SG"],
  "F": ["SF", "PF"],
  "C": ["C", "PF"],
  "G-F": ["SG", "SF"],
  "F-G": ["SF", "SG"],
  "F-C": ["PF", "C"],
  "C-F": ["C", "PF"],
};
const ORDER = ["PG", "SG", "SF", "PF", "C"];

// Infer a slot set when the index has no usable position, from the stat profile.
function inferPositions(s) {
  if (s.bpg >= 1.0 || s.rpg >= 9) return ["C", "PF"];
  if (s.apg >= 5) return ["PG", "SG"];
  if (s.rpg >= 6) return ["PF", "SF"];
  return ["SF", "SG"];
}

function canonical(set) {
  return ORDER.filter((slot) => set.includes(slot));
}

// ---- Overall rating from per-game production + efficiency ----
// raw production weights counting stats; the line is then mapped onto the curated
// ~50-99 scale and nudged by a true-shooting proxy. Calibrated so MVP-level bigs
// land ~99, perennial stars ~88-94, solid starters ~76-82, role players ~65-72.
function shootingProxy(s) {
  return 0.5 * s.fg + 0.2 * s.tp + 0.3 * s.ft;
}
function overallOf(s) {
  const raw = s.ppg + 0.7 * s.rpg + 0.7 * s.apg + 1.4 * s.spg + 1.4 * s.bpg;
  const eff = 10 * (shootingProxy(s) - 0.5);
  const val = 53 + 1.05 * raw + eff;
  return Math.max(50, Math.min(99, Math.round(val)));
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

// ---- Build a lookup of PERSON_ID -> coarse position ----
function loadPositions() {
  const { rows, idx } = readTable("player_index.csv");
  const map = new Map();
  for (const r of rows) {
    map.set(r[idx.PERSON_ID], (r[idx.POSITION] || "").trim());
  }
  return map;
}

// ---- Build a lookup of (TEAM_ID|SEASON) -> { name, wins, losses } ----
function loadTeamRecords() {
  const { rows, idx } = readTable("team_traditional_rs.csv");
  const map = new Map();
  for (const r of rows) {
    const key = `${r[idx.TEAM_ID]}|${r[idx.SEASON]}`;
    map.set(key, { name: r[idx.TEAM_NAME], wins: num(r[idx.W]), losses: num(r[idx.L]) });
  }
  return map;
}

const SLUG = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function decadeOf(startYear) {
  if (startYear < 2000) return null; // 1996-99 stay curated in the 1990s file
  if (startYear < 2010) return "2000s";
  if (startYear < 2020) return "2010s";
  return "2020s";
}

// How many teams to keep per season. Each year contributes its true contenders AND
// a spread down to weak lottery teams, so the pool has stars and scrubs alike.
const PER_SEASON = { "2000s": 6, "2010s": 6, "2020s": 8 };
const ALWAYS_TOP = 3; // always include each season's best 3 (captures champions/dynasties)

function spreadPick(sortedTeams, n) {
  const k = sortedTeams.length;
  if (n >= k) return sortedTeams;
  const top = sortedTeams.slice(0, ALWAYS_TOP);
  const rest = sortedTeams.slice(ALWAYS_TOP);
  const want = n - top.length;
  const picked = [];
  for (let i = 0; i < want; i++) {
    picked.push(rest[Math.round((i * (rest.length - 1)) / (want - 1))]);
  }
  return top.concat(picked);
}

function main() {
  const positions = loadPositions();
  const records = loadTeamRecords();
  const { rows, idx } = readTable("player_traditional_rs.csv");

  // Group player-season rows by team-season.
  const groups = new Map(); // key TEAM_ID|SEASON -> rows
  for (const r of rows) {
    if (r[idx.TEAM_ABBREVIATION] === "TOT") continue; // skip traded-combined lines
    const key = `${r[idx.TEAM_ID]}|${r[idx.SEASON]}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  // Bucket team-seasons by season so we can pick a standings spread per year.
  const bySeason = new Map(); // SEASON -> [{ key, teamId, season, rec }]
  for (const key of groups.keys()) {
    const [teamId, season] = key.split("|");
    const rec = records.get(key);
    if (!rec) continue;
    if (!bySeason.has(season)) bySeason.set(season, []);
    bySeason.get(season).push({ key, teamId, season, rec });
  }

  const out = { "2000s": [], "2010s": [], "2020s": [] };

  for (const [season, teams] of bySeason) {
    const startYear = parseInt(season.slice(0, 4), 10);
    const decade = decadeOf(startYear);
    if (!out[decade]) continue; // skip 1996-99 (kept curated)

    teams.sort((a, b) => b.rec.wins - a.rec.wins);
    const picked = spreadPick(teams, PER_SEASON[decade]);

    for (const t of picked) {
      const roster = buildRoster(groups.get(t.key), idx, positions);
      if (roster.length < 6) continue;
      out[decade].push({
        id: `${SLUG(t.rec.name)}-${startYear}`,
        name: t.rec.name,
        season,
        decade,
        record: { wins: t.rec.wins, losses: t.rec.losses },
        roster,
      });
    }
  }

  for (const decade of Object.keys(out)) {
    out[decade].sort((a, b) => a.season.localeCompare(b.season) || b.record.wins - a.record.wins);
    const file = path.join(DATA, `${decade}.json`);
    fs.writeFileSync(file, JSON.stringify(out[decade], null, 2) + "\n");
    console.log(`${decade}: ${out[decade].length} teams -> ${file}`);
  }

  // Diagnostics: distribution + a few marquee teams to sanity-check the scale.
  const all = [...out["2000s"], ...out["2010s"], ...out["2020s"]];
  const overalls = all.flatMap((t) => t.roster.map((p) => p.overall));
  overalls.sort((a, b) => a - b);
  const pct = (q) => overalls[Math.floor(q * (overalls.length - 1))];
  console.log(`\nTotal generated teams: ${all.length}`);
  console.log(`Overall distribution  min ${overalls[0]} | p25 ${pct(0.25)} | median ${pct(0.5)} | p75 ${pct(0.75)} | p95 ${pct(0.95)} | max ${overalls[overalls.length - 1]}`);
  const show = (name, season) => {
    const t = all.find((x) => x.name.includes(name) && x.season === season);
    if (t) console.log(`  ${t.season} ${t.name} (${t.record.wins}-${t.record.losses}): ` +
      t.roster.slice(0, 5).map((p) => `${p.name} ${p.overall}`).join(", "));
  };
  console.log("\nMarquee sanity check:");
  show("Lakers", "2000-01");
  show("Spurs", "2013-14");
  show("Warriors", "2016-17");
  show("Cavaliers", "2015-16");
  show("Nets", "2002-03");
  show("Bucks", "2021-22");
}

// Build up to 8 rotation players for a team-season, best by minutes.
function buildRoster(rosterRows, idx, positions) {
  const players = rosterRows
    .map((r) => {
      const stats = {
        ppg: num(r[idx.PTS]),
        rpg: num(r[idx.REB]),
        apg: num(r[idx.AST]),
        spg: num(r[idx.STL]),
        bpg: num(r[idx.BLK]),
        fg: num(r[idx.FG_PCT]),
        tp: num(r[idx.FG3_PCT]),
        ft: num(r[idx.FT_PCT]),
      };
      return {
        name: r[idx.PLAYER_NAME],
        gp: num(r[idx.GP]),
        min: num(r[idx.MIN]),
        posRaw: positions.get(r[idx.PLAYER_ID]) || "",
        stats,
      };
    })
    .filter((p) => p.gp >= 25 && p.min >= 12)
    .sort((a, b) => b.min - a.min)
    .slice(0, 8);

  return players.map((p) => {
    const mapped = POS_MAP[p.posRaw] || inferPositions(p.stats);
    return {
      name: p.name,
      positions: canonical(mapped),
      overall: overallOf(p.stats),
      stats: roundStats(p.stats),
    };
  });
}

function roundStats(s) {
  return {
    ppg: round1(s.ppg), rpg: round1(s.rpg), apg: round1(s.apg),
    spg: round1(s.spg), bpg: round1(s.bpg),
    fg: round3(s.fg), tp: round3(s.tp), ft: round3(s.ft),
  };
}
const round1 = (n) => Math.round(n * 10) / 10;
const round3 = (n) => Math.round(n * 1000) / 1000;

main();
