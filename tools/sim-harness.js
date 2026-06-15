// Monte Carlo difficulty harness for 16-0 (DEV TOOL, not shipped to players).
//
// Question it answers: with the strongest team you could legally draft (one player
// per team, eligible per position), how often does a CLASSIC run go a perfect 16-0,
// and how does that rate respond to the difficulty knobs?
//
// It runs the REAL engine code (js/engine.js) and the REAL data loader
// (js/data-loader.js) verbatim, so the numbers match the live game's math. The only
// thing re-implemented here is the classic tournament loop, mirrored line-for-line
// from js/ui.js (bracket seeding + oppBonus + 2-2-1-1-1 home pattern).
//
// Run:  node tools/sim-harness.js

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SLOTS = ["PG", "SG", "SF", "PF", "C"]; // js/state.js
const ROUNDS = 4;                            // js/state.js
const WINS_PER_SERIES = 4;                   // js/state.js (best-of-7)

// ---- Load the real modules in Node ------------------------------------------

// Minimal fetch shim: DataLoader.loadJSON(path) does `await fetch(path)`, where path
// is a repo-relative file like "data/eras.json". We read it straight off disk.
async function diskFetch(rel) {
  const file = path.join(ROOT, rel);
  const text = fs.readFileSync(file, "utf8");
  return { ok: true, status: 200, json: async () => JSON.parse(text) };
}

// Evaluate js/engine.js (a `const Engine = (() => {...})()` IIFE) and hand back the
// Engine object. `overrides` lets us swap the tuning constants for the sweep without
// touching the source file - we string-replace `const NAME = <number>;` then re-eval.
function loadEngine(overrides = {}) {
  let code = fs.readFileSync(path.join(ROOT, "js", "engine.js"), "utf8");
  for (const [name, value] of Object.entries(overrides)) {
    const re = new RegExp(`const ${name} = [\\d.]+;`);
    code = code.replace(re, `const ${name} = ${value};`);
  }
  return new Function(`${code}\nreturn Engine;`)();
}

function loadDataLoader() {
  const code = fs.readFileSync(path.join(ROOT, "js", "data-loader.js"), "utf8");
  return new Function("fetch", `${code}\nreturn DataLoader;`)(diskFetch);
}

// ---- Best draftable five ----------------------------------------------------

// The composite rating is NOT additive per player (it averages stats and saturates), so
// we can't sum per-player values. Instead we backtrack over the top overall candidates
// per slot, scoring each COMPLETE legal five (five distinct players from five DISTINCT
// teams - the draft rule) with the real engine.lineupScore, and keep the best. TOP=12 by
// overall is plenty: the optimum's players are all near the top of their position.
function bestDraftableFive(teams, engine) {
  const players = [];
  for (const team of teams) {
    for (const p of team.roster) {
      players.push({ ...p, teamId: team.id, teamName: team.name, season: team.season });
    }
  }

  const TOP = 12;
  const candBySlot = SLOTS.map((slot) =>
    players
      .filter((p) => p.positions.includes(slot))
      .sort((a, b) => b.overall - a.overall)
      .slice(0, TOP)
  );

  let best = { score: -Infinity, five: null };
  const usedPlayers = new Set();
  const usedTeams = new Set();
  const chosen = {};

  function search(i) {
    if (i === SLOTS.length) {
      const score = engine.lineupScore(chosen);
      if (score > best.score) best = { score, five: { ...chosen } };
      return;
    }
    const slot = SLOTS[i];
    for (const p of candBySlot[i]) {
      if (usedPlayers.has(p.name) || usedTeams.has(p.teamId)) continue;
      usedPlayers.add(p.name);
      usedTeams.add(p.teamId);
      chosen[slot] = p;
      search(i + 1);
      delete chosen[slot];
      usedPlayers.delete(p.name);
      usedTeams.delete(p.teamId);
    }
  }
  search(0);
  return best.five;
}

// ---- Realistic drafts (mirror the actual spin/place mechanic) ---------------

// How many players in the whole pool can fill each slot. Used to assign a pick to its
// SCARCEST eligible open slot, the way a sensible drafter reserves hard-to-fill spots
// (centers) instead of wasting a flexible star on them.
function positionScarcity(teams) {
  const count = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
  for (const team of teams) for (const p of team.roster) for (const s of p.positions) count[s]++;
  return count;
}

const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// One realistic draft: spin distinct random teams; for each, pick a player that fits an
// open slot ("star" = highest overall, "random" = any eligible) and place it in its
// scarcest eligible open slot. A team with nothing that fits an open slot is skipped
// (a respin). Returns a five, or null on the rare deadlock (caller retries).
function draftRealistic(teams, strategy, scarcity) {
  const pool = shuffle(teams);
  const five = {};
  const open = new Set(SLOTS);
  for (const team of pool) {
    if (open.size === 0) break;
    const cands = team.roster.filter((p) => p.positions.some((s) => open.has(s)));
    if (!cands.length) continue;
    const pick = strategy === "star"
      ? cands.reduce((a, b) => (b.overall > a.overall ? b : a))
      : cands[Math.floor(Math.random() * cands.length)];
    const elig = SLOTS.filter((s) => open.has(s) && pick.positions.includes(s));
    const slot = elig.reduce((a, b) => (scarcity[b] < scarcity[a] ? b : a));
    five[slot] = pick;
    open.delete(slot);
  }
  return open.size === 0 ? five : null;
}

function draftRealisticSafe(teams, strategy, scarcity) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const five = draftRealistic(teams, strategy, scarcity);
    if (five) return five;
  }
  return null; // essentially never happens with this pool
}

// Run many runs, RE-DRAFTING the team each time via `fiveGen()` (so realistic drafts
// show their natural spread). Tracks the 16-0 / championship rate and the distribution
// of drafted team ratings.
function runArchetype(engine, fiveGen, rated, base, step, runs) {
  const ratings = [];
  let perfect = 0;
  let champ = 0;
  for (let i = 0; i < runs; i++) {
    const rating = engine.lineupScore(fiveGen());
    ratings.push(rating);
    const res = simulateRun(engine, rating, rated, base, step);
    if (res.champ) champ++;
    if (res.champ && res.firstLoss === 0) perfect++;
  }
  ratings.sort((a, b) => a - b);
  const at = (q) => ratings[Math.min(ratings.length - 1, Math.floor(q * ratings.length))];
  const mean = ratings.reduce((s, r) => s + r, 0) / ratings.length;
  return { runs, perfect, champ, mean, p10: at(0.1), p50: at(0.5), p90: at(0.9) };
}

// ---- Classic tournament (mirrors js/ui.js) ----------------------------------

// Each team's opponent rating (composite lineupScore, used by the sim) plus its SEEDING
// strength, which mirrors js/ui.js seedStrength: a real record maps onto the rating scale
// around league average; curated teams fall back to their composite rating. The bracket is
// ordered by seed strength (so round 1 faces the worst record), but each game is still
// decided by the opponent's composite rating - exactly like the live game.
const RECORD_RATING_SPREAD = 33; // js/ui.js
function ratedTeams(engine, teams) {
  const ratings = teams.map((team) => engine.lineupScore(engine.autoFillLineup(team.roster, SLOTS)));
  const leagueAvg = ratings.reduce((s, r) => s + r, 0) / ratings.length;
  return teams
    .map((team, i) => {
      const rating = ratings[i];
      let seed = rating;
      if (team.record) {
        const g = team.record.wins + team.record.losses;
        const winPct = g ? team.record.wins / g : 0.5;
        seed = leagueAvg + RECORD_RATING_SPREAD * (winPct - 0.5);
      }
      return { team, rating, seed };
    })
    .sort((a, b) => a.seed - b.seed); // weakest -> strongest by seed strength
}

// buildClassicBracket: one random team from each seed-strength quartile (round 1 = weakest
// ... round 4 = strongest). Returns the 4 opponent COMPOSITE ratings for this run.
function drawBracket(rated) {
  const n = rated.length;
  const out = [];
  for (let r = 0; r < ROUNDS; r++) {
    const lo = Math.floor((n * r) / ROUNDS);
    const hi = Math.max(lo + 1, Math.floor((n * (r + 1)) / ROUNDS));
    const pick = rated[lo + Math.floor(Math.random() * (hi - lo))];
    out.push(pick.rating);
  }
  return out;
}

// One full classic run with your fixed rating. Returns champ + per-round series wins
// and sweeps, plus the round of your first loss (0 = none = perfect 16-0).
function simulateRun(engine, yourRating, rated, difficultyBase, difficultyStep) {
  const won = [false, false, false, false];
  const swept = [false, false, false, false];
  const reached = [false, false, false, false];
  let firstLoss = 0;

  const bracket = drawBracket(rated);
  for (let r = 1; r <= ROUNDS; r++) {
    reached[r - 1] = true;
    const oppRating = bracket[r - 1];
    const oppBonus = difficultyBase + (r - 1) * difficultyStep; // js/ui.js classic
    const series = engine.simulateSeries(yourRating, oppRating, WINS_PER_SERIES, oppBonus);
    won[r - 1] = series.youWon;
    swept[r - 1] = series.oppWins === 0;
    if (series.oppWins > 0 && firstLoss === 0) firstLoss = r;
    if (!series.youWon) return { champ: false, won, swept, reached, firstLoss };
  }
  return { champ: true, won, swept, reached, firstLoss };
}

// ---- ALTERNATIVE win model: capped logistic ---------------------------------
// Decides each game by a win PROBABILITY instead of a points margin. tanh saturates,
// so a favorite's single-game chance is capped at CAP (an upset floor of 1-CAP). That
// bounds any 16-0 at ~CAP^16, compressing the optimizer down toward the casual without
// flattening the rating gap (SCALE controls how steeply skill ramps).
const ALT_HOME_EDGE = 3;

function altWinProb(diff, cap, scale) {
  return 0.5 + (cap - 0.5) * Math.tanh(diff / scale);
}

function altRun(yourRating, rated, base, step, cap, scale) {
  const home = [true, true, false, false, true, false, true];
  let firstLoss = 0;
  const bracket = drawBracket(rated);
  for (let r = 1; r <= ROUNDS; r++) {
    const oppRating = bracket[r - 1];
    const oppBonus = base + (r - 1) * step;
    let yw = 0;
    let ow = 0;
    let g = 0;
    while (yw < WINS_PER_SERIES && ow < WINS_PER_SERIES) {
      const edge = home[g] ? ALT_HOME_EDGE : -ALT_HOME_EDGE;
      const diff = yourRating - (oppRating + oppBonus) + edge;
      if (Math.random() < altWinProb(diff, cap, scale)) yw++;
      else ow++;
      g++;
    }
    if (ow > 0 && firstLoss === 0) firstLoss = r;
    if (ow >= WINS_PER_SERIES) return { champ: false, firstLoss };
  }
  return { champ: true, firstLoss };
}

function runAltArchetype(fiveGen, rated, base, step, cap, scale, runs) {
  let perfect = 0;
  let champ = 0;
  for (let i = 0; i < runs; i++) {
    const rating = baseEngineRef.lineupScore(fiveGen());
    const res = altRun(rating, rated, base, step, cap, scale);
    if (res.champ) champ++;
    if (res.champ && res.firstLoss === 0) perfect++;
  }
  return { runs, perfect, champ };
}

let baseEngineRef = null; // set in main; lineupScore is variance-independent

// ---- Aggregation ------------------------------------------------------------

function runBatch(engine, yourRating, rated, base, step, runs) {
  const reached = [0, 0, 0, 0];
  const wonGiven = [0, 0, 0, 0];
  const sweptGiven = [0, 0, 0, 0];
  const firstLossDist = [0, 0, 0, 0, 0]; // index 0 = no loss (perfect)
  let champ = 0;
  let perfect = 0;

  for (let i = 0; i < runs; i++) {
    const res = simulateRun(engine, yourRating, rated, base, step);
    for (let r = 0; r < ROUNDS; r++) {
      if (res.reached[r]) {
        reached[r]++;
        if (res.won[r]) wonGiven[r]++;
        if (res.swept[r]) sweptGiven[r]++;
      }
    }
    firstLossDist[res.firstLoss]++;
    if (res.champ) champ++;
    if (res.champ && res.firstLoss === 0) perfect++;
  }

  return { runs, champ, perfect, reached, wonGiven, sweptGiven, firstLossDist };
}

// ---- Formatting -------------------------------------------------------------

const pct = (num, den) => (den === 0 ? "  -   " : `${((100 * num) / den).toFixed(2)}%`.padStart(7));
const ROUND_NAMES = ["Round 1", "Round 2", "Conf Finals", "Finals"];

function printLineup(engine, five) {
  console.log("Best draftable five (one player per team, eligible per slot):\n");
  console.log("  slot  player                     team (season)              ovr   ppg   rpg   apg");
  console.log("  ----  -------------------------  -------------------------  ---  ----  ----  ----");
  for (const slot of SLOTS) {
    const p = five[slot];
    const team = `${p.teamName} (${p.season})`;
    console.log(
      `  ${slot.padEnd(4)}  ${p.name.padEnd(25)}  ${team.padEnd(25)}  ${String(p.overall).padStart(3)}  ${p.stats.ppg.toFixed(1).padStart(4)}  ${p.stats.rpg.toFixed(1).padStart(4)}  ${p.stats.apg.toFixed(1).padStart(4)}`
    );
  }
  console.log(`\n  lineupScore (your rating): ${engine.lineupScore(five).toFixed(2)}\n`);
}

// How often a clearly-better team loses ONE game (realism check). Your raw rating is
// `rawMargin` above the opponent; `home=false` makes it a road game (the harsh case).
function mismatchLossRate(engine, rawMargin, home, trials = 200000) {
  let losses = 0;
  for (let i = 0; i < trials; i++) {
    if (!engine.simulateGame(100 + rawMargin, 100, home, 0).youWon) losses++;
  }
  return losses / trials;
}

// Regular-season outcome for a team of `rating` vs the league average, mirroring the
// live game's Engine.simulateSeasonRecord. Reports the mean record and how often the
// 82-game season comes out perfect - an 82-0 should be a rare feat, not a formality.
function seasonStats(engine, rating, leagueAvg, trials = 30000) {
  let perfect = 0;
  let totalWins = 0;
  for (let i = 0; i < trials; i++) {
    const rec = engine.simulateSeasonRecord(rating, leagueAvg);
    totalWins += rec.wins;
    if (rec.wins === 82) perfect++;
  }
  return { meanWins: totalWins / trials, perfectRate: perfect / trials };
}

function printBatch(label, b) {
  console.log(`\n${label}  (${b.runs.toLocaleString()} runs)`);
  console.log(`  Perfect 16-0 rate : ${pct(b.perfect, b.runs).trim()}`);
  console.log(`  Championship rate : ${pct(b.champ, b.runs).trim()}  (wins the title, losses allowed)\n`);
  console.log("  round         reached   win series | reached   sweep 4-0 | reached");
  console.log("  -----------   -------   ------------------   ------------------");
  for (let r = 0; r < ROUNDS; r++) {
    console.log(
      `  ${ROUND_NAMES[r].padEnd(11)}   ${pct(b.reached[r], b.runs)}   ${pct(b.wonGiven[r], b.reached[r])}              ${pct(b.sweptGiven[r], b.reached[r])}`
    );
  }
  console.log("\n  Where the perfect run dies (round of first loss):");
  const labels = ["none (16-0)", "Round 1", "Round 2", "Conf Finals", "Finals"];
  for (let i = 0; i < labels.length; i++) {
    console.log(`    ${labels[i].padEnd(12)}: ${pct(b.firstLossDist[i], b.runs)}`);
  }
}

function printArchetypes(label, rows) {
  console.log(`\n${label}`);
  console.log("  archetype       mean rating  (p10 / p50 / p90)     16-0 rate   champ rate");
  console.log("  -------------   -----------  ------------------    ---------   ----------");
  for (const r of rows) {
    const dist = `${r.mean.toFixed(1)}`.padStart(5) + `   (${r.p10.toFixed(0)} / ${r.p50.toFixed(0)} / ${r.p90.toFixed(0)})`.padEnd(18);
    console.log(`  ${r.name.padEnd(13)}   ${dist}    ${pct(r.perfect, r.runs)}    ${pct(r.champ, r.runs)}`);
  }
}

// ---- Main -------------------------------------------------------------------

async function main() {
  const DataLoader = loadDataLoader();
  const eras = await DataLoader.loadEras();
  const playable = eras.filter((e) => e.hasData);
  const lists = await Promise.all(playable.map((e) => DataLoader.loadTeams(e.id)));
  const teams = lists.flat();

  const baseEngine = loadEngine(); // real constants
  const five = bestDraftableFive(teams, baseEngine);
  const yourRating = baseEngine.lineupScore(five);
  const rated = ratedTeams(baseEngine, teams);

  console.log("=".repeat(78));
  console.log("16-0 difficulty harness  -  CLASSIC mode, best draftable team");
  console.log("=".repeat(78));
  console.log(`\nPool: ${teams.length} teams across ${playable.length} eras.\n`);
  printLineup(baseEngine, five);

  // New composite rating spread + the quartile boundaries the bracket samples.
  const n = rated.length;
  const ratings = rated.map((r) => r.rating);
  console.log(`Rating spread (composite): min ${ratings[0].toFixed(1)} | median ${ratings[Math.floor(n / 2)].toFixed(1)} | max ${ratings[n - 1].toFixed(1)}`);
  console.log("Opponent strength by round (quartile the bracket samples):");
  for (let r = 0; r < ROUNDS; r++) {
    const lo = Math.floor((n * r) / ROUNDS);
    const hi = Math.max(lo + 1, Math.floor((n * (r + 1)) / ROUNDS));
    const seg = rated.slice(lo, hi);
    console.log(`  ${ROUND_NAMES[r].padEnd(11)}  oppRating ${seg[0].rating.toFixed(1)} - ${seg[seg.length - 1].rating.toFixed(1)}`);
  }

  const scarcity = positionScarcity(teams);
  const genStar = () => draftRealisticSafe(teams, "star", scarcity);
  const genRandom = () => draftRealisticSafe(teams, "random", scarcity);

  // Realism check on the CURRENT engine: how often a clearly-better team loses a game.
  console.log("\n" + "-".repeat(78));
  console.log("REALISM CHECK - single-game loss when you out-rate the opponent:");
  for (const [margin, label] of [[10, "+10"], [18, "+18 (your 71-11 vs the 14-68 Nets)"], [25, "+25"]]) {
    const home = (100 * mismatchLossRate(baseEngine, margin, true)).toFixed(1);
    const road = (100 * mismatchLossRate(baseEngine, margin, false)).toFixed(1);
    console.log(`  by ${label.padEnd(34)}  home loss ${home}%   road loss ${road}%`);
  }

  // REGULAR-SEASON 82-0 check: the regular season is simulated vs the league average
  // (Engine.simulateSeasonRecord) and uses a LOWER cap (SEASON_WIN_CAP) than the
  // playoffs, so even the best roster lands near 76-6 and a literal 82-0 is rare.
  const leagueAvg = teams.reduce((s, t) => s + baseEngine.lineupScore(baseEngine.autoFillLineup(t.roster, SLOTS)), 0) / teams.length;
  console.log("\n" + "-".repeat(78));
  console.log(`REGULAR-SEASON 82-0 check  (sim vs league-average rating ${leagueAvg.toFixed(1)}):`);
  for (const [label, rating] of [["best draftable five", yourRating], ["+20 over avg", leagueAvg + 20], ["+10 over avg", leagueAvg + 10]]) {
    const s = seasonStats(baseEngine, rating, leagueAvg);
    console.log(`  ${label.padEnd(20)} mean ${s.meanWins.toFixed(1)}-${(82 - s.meanWins).toFixed(1)}   P(82-0) ${(100 * s.perfectRate).toFixed(2)}%`);
  }

  // PHASE 2 RETUNE: high cap (so blowout mismatches almost never upset - kills the
  // "lost to a 14-68 team" problem) + steeper late-round escalation (so the title and a
  // 16-0 are genuine achievements, not a formality). Each row reports the realistic
  // star-chaser's 16-0 and CHAMPIONSHIP rates (titles should NOT be easy), the optimal
  // ceiling, the random floor, and the road-upset rate at a +18 mismatch.
  console.log("\n" + "=".repeat(78));
  console.log("PHASE 2 RETUNE  (rating = composite; HOME_EDGE=3)");
  console.log("  config                            Opt16-0  OptChmp  StarChmp  RndChmp  road+18");
  console.log("  -------------------------------   -------  -------  --------  -------  -------");
  const RUNS = 20000;
  const configs = [
    { cap: 0.98, scale: 6, base: 5, step: 7 },
    { cap: 0.98, scale: 6, base: 6, step: 7 },
    { cap: 0.98, scale: 6, base: 6, step: 6 },
    { cap: 0.98, scale: 6, base: 5, step: 6 },
	{ cap: 0.98, scale: 6, base: 4, step: 5 },
	{ cap: 0.98, scale: 6, base: 3, step: 4 },
	{ cap: 0.98, scale: 6, base: 2, step: 3 },
  ];
  for (const c of configs) {
    const eng = loadEngine({ WIN_CAP: c.cap, RATING_SCALE: c.scale });
    const opt = runArchetype(eng, () => five, rated, c.base, c.step, RUNS);
    const star = runArchetype(eng, genStar, rated, c.base, c.step, RUNS);
    const rnd = runArchetype(eng, genRandom, rated, c.base, c.step, RUNS);
    const road = (100 * mismatchLossRate(eng, 18, false, 60000)).toFixed(1) + "%";
    const tag = `CAP=${c.cap} SC=${c.scale} BASE=${c.base} STEP=${c.step}`.padEnd(32);
    console.log(
      `  ${tag}  ${pct(opt.perfect, opt.runs)}  ${pct(opt.champ, opt.runs)}  ${pct(star.champ, star.runs)}  ${pct(rnd.champ, rnd.runs)}  ${road.padStart(6)}`
    );
  }
  console.log("\n  Targets: Opt16-0 ~4-6% (a sweep is rare even for the best team),");
  console.log("  OptChmp ~50-65% (a great team usually but not always wins the title),");
  console.log("  StarChmp lower, RndChmp ~0, road+18 small (few scrub upsets).\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
