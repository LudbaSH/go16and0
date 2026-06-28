// Career store. Persists lifetime totals and per-player accumulated stats across runs
// in localStorage so later features (achievements, the stats page, post-run summaries)
// can read them. No personal data - just your own game results, local to this browser.
//
// The per-player numbers are SYNTHETIC: box scores are generated to match each game's
// result (see Engine.simulateBoxScore), so these are "your sim's career stats", not real
// historical records. They track each player's real averages closely because that is what
// the sim is seeded from.

const Career = (() => {
  const KEY = "16-0:career";
  const VERSION = 1;

  // The empty store. load() deep-merges this over whatever is saved, so new fields added
  // in future versions are backfilled automatically and old saves keep working.
  function blank() {
    return {
      version: VERSION,
      lifetime: {
        runs: 0,           // finished runs of any kind
        championships: 0,  // runs that ended in a title (classic 16-x or gauntlet 10-0)
        perfectRuns: 0,    // flawless runs (16-0 / 10-0)
        eliminations: 0,   // runs that ended in a loss
        gamesWon: 0,       // individual games won, lifetime
        gamesLost: 0,      // individual games lost, lifetime
      },
      // name -> { drafted, games, pts, reb, ast, bestPts }
      players: {},
    };
  }

  function load() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY)); } catch { saved = null; }
    const base = blank();
    if (!saved || typeof saved !== "object") return base;
    return {
      version: VERSION,
      lifetime: { ...base.lifetime, ...(saved.lifetime || {}) },
      players: saved.players && typeof saved.players === "object" ? saved.players : {},
    };
  }

  function save(data) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch { /* storage full/blocked: skip, career stats are non-essential */ }
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  }

  // Fold one finished run into the store. `t` is the tournament (with t.allGames carrying
  // every game's box scores), `five` is slot -> player, `perfect` is the flawless flag.
  // Called once per run (guarded upstream by recordAttempt's _recorded flag).
  function recordRun(t, five, perfect) {
    const data = load();
    const L = data.lifetime;

    L.runs += 1;
    if (perfect) L.perfectRuns += 1;
    if (t.status === "won") L.championships += 1; else L.eliminations += 1;
    L.gamesWon += t.totalWins || 0;
    L.gamesLost += t.totalLosses || 0;

    // Per-player: walk every game's box and accumulate by name. Starters appear in every
    // game, so a player's game count is how many box lines carried their name this run.
    const games = t.allGames || [];
    const seen = {}; // name -> { games, pts, reb, ast, bestPts } for THIS run
    games.forEach((g) => (g.yourBox || []).forEach((line) => {
      const s = seen[line.name] || (seen[line.name] = { games: 0, pts: 0, reb: 0, ast: 0, bestPts: 0 });
      s.games += 1;
      s.pts += line.pts; s.reb += line.reb; s.ast += line.ast;
      if (line.pts > s.bestPts) s.bestPts = line.pts;
    }));

    // Merge this run's per-player totals into the career store, and bump "drafted" once for
    // each of the five actually rostered (a player can post a box without being a starter? no,
    // but we key drafted off the five to be exact).
    Object.entries(seen).forEach(([name, s]) => {
      const c = data.players[name] || (data.players[name] = { drafted: 0, games: 0, pts: 0, reb: 0, ast: 0, bestPts: 0 });
      c.games += s.games;
      c.pts += s.pts; c.reb += s.reb; c.ast += s.ast;
      if (s.bestPts > c.bestPts) c.bestPts = s.bestPts;
    });
    Object.values(five).forEach((p) => {
      if (!p) return;
      const c = data.players[p.name] || (data.players[p.name] = { drafted: 0, games: 0, pts: 0, reb: 0, ast: 0, bestPts: 0 });
      c.drafted += 1;
    });

    save(data);
  }

  return { KEY, load, recordRun, clear };
})();
