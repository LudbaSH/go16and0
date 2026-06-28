// Achievements. A static list of badges, each with a predicate over an evaluation context
// built by the UI from the durable run history (so past runs count) plus the live run that
// just ended (for per-series badges history can't reconstruct). Unlocked IDs persist in
// localStorage, local only. Evaluating is idempotent: already-earned badges are skipped.
//
// ctx shape:
//   titles        number  - lifetime titles (won or perfect runs)
//   perfectRuns   number  - lifetime perfect runs
//   maxStreak     number  - longest run of consecutive titles
//   maxRating     number  - highest team rating ever built
//   gauntletTitle boolean - has ever beaten the Gauntlet
//   run           object|null - the run that just ended, present only at run's end:
//     { won, perfect, gauntlet, blind, series:[{result,yourWins,oppWins,seq}], games:[{oppPoints}] }

const Achievements = (() => {
  const KEY = "16-0:achievements";

  // Did a won series ever pass through the exact state (opp `oppAt`, you `youAt`)? Replays
  // the ordered win/loss sequence. Used for the comeback badges: 3-1 (opp 3, you 1) and the
  // never-done-in-NBA-history 3-0 (opp 3, you 0). A 3-0 hole also passes through 3-1, so an
  // epic 0-3 comeback earns both - fitting.
  function reachedState(seq, oppAt, youAt) {
    let you = 0, opp = 0;
    for (const youWon of seq) {
      if (youWon) you += 1; else opp += 1;
      if (opp === oppAt && you === youAt) return true;
    }
    return false;
  }
  const wonFromDeficit = (run, oppAt, youAt) =>
    !!run && (run.series || []).some((s) => s.result === "won" && reachedState(s.seq || [], oppAt, youAt));

  const DEFS = [
    { id: "champion", name: "Champion", desc: "Win a title.",
      check: (c) => c.titles >= 1 },
    { id: "superteam", name: "Superteam", desc: "Build a team rated 100 or higher.",
      check: (c) => c.maxRating >= 100 },
    { id: "flawless", name: "Flawless", desc: "Complete a perfect run.",
      check: (c) => c.perfectRuns >= 1 },
    { id: "untouchable", name: "Untouchable", desc: "Complete three perfect runs.",
      check: (c) => c.perfectRuns >= 3 },
    { id: "three-peat", name: "Three-Peat", desc: "Win three titles in a row.",
      check: (c) => c.maxStreak >= 3 },
    { id: "giant-slayer", name: "Giant Slayer", desc: "Beat the Gauntlet.",
      check: (c) => c.gauntletTitle },
    { id: "comeback-31", name: "Comeback Kid", desc: "Win a series after falling behind 3-1.",
      check: (c) => wonFromDeficit(c.run, 3, 1) },
    { id: "comeback-30", name: "Reverse Sweep", desc: "Win a series after falling behind 3-0.",
      check: (c) => wonFromDeficit(c.run, 3, 0) },
    { id: "blind-faith", name: "Blind Faith", desc: "Win a title in Blind Build.",
      check: (c) => !!c.run && c.run.won && c.run.blind },
    { id: "blind-flawless", name: "Sightless Perfection", desc: "Complete a perfect run in Blind Build.",
      check: (c) => !!c.run && c.run.perfect && c.run.blind },
  ];

  function loadUnlocked() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
    catch { return {}; }
  }

  function saveUnlocked(map) {
    try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* storage blocked: skip */ }
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  }

  // Check every still-locked badge against the context. Newly earned ones are persisted
  // (id -> unlock timestamp) and returned so the UI can announce them. A throwing predicate
  // is treated as "not earned" so one bad check never blocks the rest.
  function evaluate(ctx) {
    const unlocked = loadUnlocked();
    const fresh = [];
    for (const def of DEFS) {
      if (unlocked[def.id]) continue;
      let earned = false;
      try { earned = def.check(ctx); } catch { earned = false; }
      if (earned) { unlocked[def.id] = Date.now(); fresh.push(def); }
    }
    if (fresh.length) saveUnlocked(unlocked);
    return fresh;
  }

  // All badges with their current unlocked state, for the stats page.
  function all() {
    const unlocked = loadUnlocked();
    return DEFS.map((d) => ({ id: d.id, name: d.name, desc: d.desc, unlocked: !!unlocked[d.id], at: unlocked[d.id] || null }));
  }

  function counts() {
    const unlocked = loadUnlocked();
    return { unlocked: Object.keys(unlocked).length, total: DEFS.length };
  }

  return { evaluate, all, counts, clear, KEY };
})();
