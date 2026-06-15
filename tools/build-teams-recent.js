// DEV TOOL (not shipped). Regenerates data/teams/2020s.json from the CC0 public-domain
// "Historical NBA Data and Player Box Scores" dataset by Eoin A. Moore (Kaggle, CC0),
// covering the 2020-21 .. 2025-26 seasons - including the recent years no other open set
// had. Input CSVs live in tools/.cache (gitignored). Run: node tools/build-teams-recent.js
//
// Sources used (all from the same CC0 dataset):
//   PlayerStatistics.csv  - per-game player box scores  -> season per-game averages
//   Players.csv           - guard/forward/center flags  -> court positions
//   TeamStatistics.csv     - official seasonWins/seasonLosses -> real records + team name
//
// The overall formula and team-selection match tools/build-teams.js so the whole pool
// stays on one consistent scale.

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const CACHE = path.join(__dirname, ".cache");
const OUT_FILE = path.join(__dirname, "..", "data", "teams", "2020s.json");
const FIRST_START_YEAR = 2020; // 2020-21 onward

// ---- shared helpers (mirrors tools/build-teams.js) --------------------------
const ORDER = ["PG", "SG", "SF", "PF", "C"];
function shootingProxy(s) { return 0.5 * s.fg + 0.2 * s.tp + 0.3 * s.ft; }
function overallOf(s) {
  const raw = s.ppg + 0.7 * s.rpg + 0.7 * s.apg + 1.4 * s.spg + 1.4 * s.bpg;
  const eff = 10 * (shootingProxy(s) - 0.5);
  return Math.max(50, Math.min(99, Math.round(53 + 1.05 * raw + eff)));
}
function inferPositions(s) {
  if (s.bpg >= 1.0 || s.rpg >= 9) return ["C", "PF"];
  if (s.apg >= 5) return ["PG", "SG"];
  if (s.rpg >= 6) return ["PF", "SF"];
  return ["SF", "SG"];
}
function posFromFlags(g, f, c) {
  const set = [];
  if (g) set.push("PG", "SG");
  if (f) set.push("SF", "PF");
  if (c) set.push("C", "PF");
  return [...new Set(set)];
}
const canonical = (set) => ORDER.filter((slot) => set.includes(slot));
const round1 = (n) => Math.round(n * 10) / 10;
const round3 = (n) => Math.round(n * 1000) / 1000;
const SLUG = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function seasonOf(dateStr) {
  const y = +dateStr.slice(0, 4), m = +dateStr.slice(5, 7);
  const s = m >= 10 ? y : y - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, "0")}`;
}
function parseMin(v) {
  if (!v) return 0;
  if (v.includes(":")) { const [m, s] = v.split(":"); return (+m || 0) + (+s || 0) / 60; }
  return +v || 0;
}
function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }

// Quote-aware CSV line split (only pays the cost when a line actually has quotes).
function splitLine(line) {
  if (line.indexOf('"') === -1) return line.split(",");
  const out = []; let f = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { out.push(f); f = ""; }
    else f += c;
  }
  out.push(f);
  return out;
}

const PER_SEASON = 8;
const ALWAYS_TOP = 3;
function spreadPick(sorted, n) {
  const k = sorted.length;
  if (n >= k) return sorted;
  const top = sorted.slice(0, ALWAYS_TOP);
  const rest = sorted.slice(ALWAYS_TOP);
  const want = n - top.length;
  const picked = [];
  for (let i = 0; i < want; i++) picked.push(rest[Math.round((i * (rest.length - 1)) / (want - 1))]);
  return top.concat(picked);
}

// ---- Players.csv: personId -> court positions -------------------------------
function loadPositions() {
  const text = fs.readFileSync(path.join(CACHE, "Players.csv"), "utf8");
  const lines = text.split("\n");
  const idx = Object.fromEntries(lines[0].trim().split(",").map((h, i) => [h, i]));
  const map = new Map();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const r = splitLine(lines[i]);
    map.set(r[idx.personId], canonical(posFromFlags(+r[idx.guard], +r[idx.forward], +r[idx.center])));
  }
  return map;
}

// ---- TeamStatistics.csv: ("City Name"|season) -> { name, wins, losses } ------
// Official running record; the final regular-season game (max games played) is the
// season record. Keyed by team NAME (playerteamId is missing for some seasons, names
// are always present), which also matches how PlayerStatistics identifies teams.
function loadRecords() {
  const text = fs.readFileSync(path.join(CACHE, "TeamStatistics.csv"), "utf8");
  const lines = text.split("\n");
  const h = lines[0].trim().split(",");
  const idx = Object.fromEntries(h.map((c, i) => [c, i]));
  const recs = new Map();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const r = splitLine(lines[i]);
    if (r[idx.gameType] !== "Regular Season") continue;
    const season = seasonOf(r[idx.gameDate]);
    if (+season.slice(0, 4) < FIRST_START_YEAR) continue;
    const name = `${r[idx.teamCity]} ${r[idx.teamName]}`.trim();
    const wins = num(r[idx.seasonWins]), losses = num(r[idx.seasonLosses]);
    const key = `${name}|${season}`;
    const prev = recs.get(key);
    if (!prev || wins + losses > prev.wins + prev.losses) {
      recs.set(key, { name, wins, losses, season });
    }
  }
  return recs;
}

// ---- TeamStatistics.csv: season -> champion name ----------------------------
// The champion won the season's final playoff game, so the latest winning ("win"=1)
// playoff row in a season belongs to the champion. Used to GUARANTEE the reigning
// champ is in the pool even when its regular-season record was not top-tier.
function loadChampions() {
  const text = fs.readFileSync(path.join(CACHE, "TeamStatistics.csv"), "utf8");
  const lines = text.split("\n");
  const idx = Object.fromEntries(lines[0].trim().split(",").map((c, i) => [c, i]));
  const last = new Map(); // season -> { date, name }
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const r = splitLine(lines[i]);
    if (r[idx.gameType] !== "Playoffs" || r[idx.win] !== "1") continue;
    const season = seasonOf(r[idx.gameDate]);
    if (+season.slice(0, 4) < FIRST_START_YEAR) continue;
    const date = r[idx.gameDate];
    const prev = last.get(season);
    if (!prev || date > prev.date) last.set(season, { date, name: `${r[idx.teamCity]} ${r[idx.teamName]}`.trim() });
  }
  const champs = new Map();
  for (const [season, v] of last) champs.set(season, v.name);
  return champs;
}

// ---- PlayerStatistics.csv (389MB): stream + aggregate to season per-game -----
async function aggregatePlayers(positions) {
  const file = path.join(CACHE, "PlayerStatistics.csv");
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let idx = null;
  const acc = new Map(); // personId|season|teamId -> totals
  const games = new Map(); // teamId|season -> Map(gameId -> winFlag), for fallback records
  const teamNames = new Map(); // teamId|season -> "City Name"
  for await (const line of rl) {
    if (!line) continue;
    if (idx === null) { idx = Object.fromEntries(line.trim().split(",").map((c, i) => [c, i])); continue; }
    // Cheap pre-filters before the full split: must be a regular-season recent row.
    if (line.indexOf("Regular Season") === -1) continue;
    const r = splitLine(line);
    if (r[idx.gameType] !== "Regular Season") continue;
    const date = r[idx.gameDate];
    if (+date.slice(0, 4) < FIRST_START_YEAR && !(date.slice(0, 4) === String(FIRST_START_YEAR - 1) && +date.slice(5, 7) >= 10)) continue;
    const season = seasonOf(date);
    if (+season.slice(0, 4) < FIRST_START_YEAR) continue;
    const team = `${r[idx.playerteamCity]} ${r[idx.playerteamName]}`.trim();
    if (!team) continue; // can't identify the team
    // Capture the game result for fallback records (one entry per game per team).
    const tsKey = `${team}|${season}`;
    if (r[idx.win] === "0" || r[idx.win] === "1") {
      if (!games.has(tsKey)) games.set(tsKey, new Map());
      games.get(tsKey).set(r[idx.gameId], +r[idx.win]);
      if (!teamNames.has(tsKey)) teamNames.set(tsKey, team);
    }
    const min = parseMin(r[idx.numMinutes]);
    if (min <= 0) continue; // did not play (DND etc.)
    const key = `${r[idx.personId]}|${season}|${team}`;
    let a = acc.get(key);
    if (!a) {
      a = { name: `${r[idx.firstName]} ${r[idx.lastName]}`.trim(), personId: r[idx.personId],
            team, season, g: 0, min: 0, pts: 0, reb: 0, ast: 0, stl: 0,
            blk: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0 };
      acc.set(key, a);
    }
    a.g++; a.min += min;
    a.pts += num(r[idx.points]); a.reb += num(r[idx.reboundsTotal]); a.ast += num(r[idx.assists]);
    a.stl += num(r[idx.steals]); a.blk += num(r[idx.blocks]);
    a.fgm += num(r[idx.fieldGoalsMade]); a.fga += num(r[idx.fieldGoalsAttempted]);
    a.tpm += num(r[idx.threePointersMade]); a.tpa += num(r[idx.threePointersAttempted]);
    a.ftm += num(r[idx.freeThrowsMade]); a.fta += num(r[idx.freeThrowsAttempted]);
  }
  // To per-game line, then group by team-season.
  const byTeamSeason = new Map(); // teamId|season -> [players]
  for (const a of acc.values()) {
    if (a.g < 25 || a.min / a.g < 12) continue; // rotation players only
    const stats = {
      ppg: a.pts / a.g, rpg: a.reb / a.g, apg: a.ast / a.g, spg: a.stl / a.g, bpg: a.blk / a.g,
      fg: a.fga ? a.fgm / a.fga : 0, tp: a.tpa ? a.tpm / a.tpa : 0, ft: a.fta ? a.ftm / a.fta : 0,
    };
    const mapped = positions.get(a.personId);
    const player = {
      name: a.name,
      positions: mapped && mapped.length ? mapped : canonical(inferPositions(stats)),
      overall: overallOf(stats),
      mpg: a.min / a.g,
      stats: { ppg: round1(stats.ppg), rpg: round1(stats.rpg), apg: round1(stats.apg),
               spg: round1(stats.spg), bpg: round1(stats.bpg),
               fg: round3(stats.fg), tp: round3(stats.tp), ft: round3(stats.ft) },
    };
    const key = `${a.team}|${a.season}`;
    if (!byTeamSeason.has(key)) byTeamSeason.set(key, []);
    byTeamSeason.get(key).push(player);
  }
  // Fallback records computed from game results, for team-seasons TeamStatistics omits
  // (e.g. 2021-22). Valid pre-2023 where there is no NBA Cup to muddy the standings.
  const fallback = new Map();
  for (const [key, gameMap] of games) {
    let wins = 0, losses = 0;
    for (const w of gameMap.values()) { if (w === 1) wins++; else losses++; }
    const season = key.split("|")[1];
    fallback.set(key, { name: teamNames.get(key), wins, losses, season });
  }
  return { byTeamSeason, fallback };
}

async function main() {
  const positions = loadPositions();
  const records = loadRecords();
  const champions = loadChampions();
  console.log(`Loaded ${positions.size} player positions, ${records.size} team-season records, ${champions.size} champions.`);
  console.log("Streaming PlayerStatistics.csv (this takes a moment)...");
  const { byTeamSeason, fallback } = await aggregatePlayers(positions);

  // Bucket by season, attach record (TeamStatistics first, computed fallback otherwise).
  const bySeason = new Map();
  for (const [key, players] of byTeamSeason) {
    const rec = records.get(key) || fallback.get(key);
    if (!rec || players.length < 6) continue;
    if (!bySeason.has(rec.season)) bySeason.set(rec.season, []);
    bySeason.get(rec.season).push({ rec, players });
  }

  const teams = [];
  for (const [season, list] of bySeason) {
    list.sort((a, b) => b.rec.wins - a.rec.wins);
    const picked = spreadPick(list, PER_SEASON);
    // Guarantee the reigning champion is in the pool, even on a modest record.
    const champName = champions.get(season);
    const champEntry = champName && list.find((t) => t.rec.name === champName);
    if (champEntry && !picked.includes(champEntry)) picked.push(champEntry);
    for (const t of picked) {
      const roster = t.players.sort((a, b) => b.mpg - a.mpg).slice(0, 8)
        .map(({ mpg, ...p }) => p); // drop the helper field
      teams.push({
        id: `${SLUG(t.rec.name)}-${+season.slice(0, 4)}`,
        name: t.rec.name, season, decade: "2020s",
        record: { wins: t.rec.wins, losses: t.rec.losses },
        roster,
      });
    }
  }

  teams.sort((a, b) => a.season.localeCompare(b.season) || b.record.wins - a.record.wins);
  fs.writeFileSync(OUT_FILE, JSON.stringify(teams, null, 2) + "\n");
  console.log(`\nWrote ${teams.length} teams -> ${OUT_FILE}`);

  // Sanity: seasons covered + a marquee per recent season.
  const seasons = [...new Set(teams.map((t) => t.season))].sort();
  console.log(`Seasons: ${seasons.join(", ")}`);
  const show = (season) => {
    const top = teams.filter((t) => t.season === season).sort((a, b) => b.record.wins - a.record.wins)[0];
    if (top) console.log(`  ${season} best: ${top.name} (${top.record.wins}-${top.record.losses}) - ` +
      top.roster.slice(0, 4).map((p) => `${p.name} ${p.overall}`).join(", "));
  };
  for (const s of seasons) show(s);
}

main().catch((e) => { console.error(e); process.exit(1); });
