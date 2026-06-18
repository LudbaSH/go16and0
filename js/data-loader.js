// Loads era, team, and player data from local JSON. No runtime network calls
// to external services. All data is bundled with the game.

const DataLoader = (() => {
  const POSITION_ORDER = ["PG", "SG", "SF", "PF", "C"];

  // --- Rating recompression -------------------------------------------------
  // The generated eras (2000s+) originally derived each overall from box-score
  // stats and CLAMPED at 99, so a dozen different stars all flattened to 99 with
  // no separation. That inflated team ratings and made a simulated 82-0 too easy.
  // We fix it in two steps, applied at load time so every consumer (game + sim
  // harness) sees the same numbers:
  //   1. Recompute generated overalls UNCAPPED from stats, so elites spread out.
  //   2. Run every overall (generated and curated) through a concave curve that
  //      leaves role players untouched (<=80) and squashes the top end, where
  //      RATING_K < 1 controls how hard the ceiling is pulled down.
  const RATING_K = 0.7;
  const SQUASH_FLOOR = 85;

  // Concave squash: identity below the floor, linearly compressed above it.
  function squashOverall(value) {
    if (value <= SQUASH_FLOOR) return value;
    return SQUASH_FLOOR + (value - SQUASH_FLOOR) * RATING_K;
  }

  // Uncapped version of the generator's overall formula (no clamp at 99), so the
  // truly dominant stat lines separate from the merely very good before squashing.
  function rawOverallFromStats(s) {
    const raw = s.ppg + 0.7 * s.rpg + 0.7 * s.apg + 1.4 * s.spg + 1.4 * s.bpg;
    const shootingProxy = 0.5 * s.fg + 0.2 * s.tp + 0.3 * s.ft;
    return 53 + 1.05 * raw + 10 * (shootingProxy - 0.5);
  }

  // Editorial exemptions: a handful of true apex seasons the pure stat-squash
  // under-rates. These are legacy peaks, not a database. Keyed by "name|season"
  // and applied AFTER squashing, so only the all-timers crack the high 90s.
  const GOAT_PEAKS = {
    "Michael Jordan|1995-96": 99,
    "Stephen Curry|2015-16": 98,
    "Wilt Chamberlain|1966-67": 98,
    "LeBron James|2009-10": 97,
    "Shaquille O'Neal|2000-01": 96,
    "Hakeem Olajuwon|1993-94": 95,
    "Kareem Abdul-Jabbar|1970-71": 95,
  };

  // Final overall for one player on one team. Generated teams carry a `record`
  // and box-score stats we can recompute from; curated eras keep their hand-set
  // overall and are only squashed.
  function adjustedOverall(player, season, isGenerated) {
    const peak = GOAT_PEAKS[`${player.name}|${season}`];
    if (peak !== undefined) return peak;
    const base = isGenerated ? rawOverallFromStats(player.stats) : player.overall;
    const squashed = squashOverall(base);
    return Math.max(50, Math.min(99, Math.round(squashed)));
  }

  // Curated multi-position eligibility. The bundled data lists each player's main
  // one or two spots; this widens the genuinely versatile players (point-forwards,
  // stretch bigs, combo guards, positionless wings) to the spots they really played.
  // It is basketball domain knowledge, not a database - extend it freely. Positions
  // here are UNIONED with the data, never removed. Keyed by exact player name.
  const POSITION_OVERRIDES = {
    "Magic Johnson": ["PG", "SG", "SF", "PF"],
    "LeBron James": ["PG", "SG", "SF", "PF"],
    "Scottie Pippen": ["PG", "SG", "SF", "PF"],
    "Draymond Green": ["SF", "PF", "C"],
    "Kevin Garnett": ["SF", "PF", "C"],
    "Kevin Durant": ["SG", "SF", "PF"],
    "Giannis Antetokounmpo": ["SF", "PF", "C"],
    "Lamar Odom": ["SF", "PF", "C"],
    "Tracy McGrady": ["PG", "SG", "SF"],
    "Penny Hardaway": ["PG", "SG", "SF"],
    "Grant Hill": ["PG", "SG", "SF"],
    "Charles Barkley": ["SF", "PF", "C"],
    "Dirk Nowitzki": ["SF", "PF", "C"],
    "Toni Kukoc": ["SG", "SF", "PF"],
    "Boris Diaw": ["SG", "SF", "PF", "C"],
    "Nicolas Batum": ["SG", "SF", "PF"],
    "Andre Iguodala": ["SG", "SF", "PF"],
    "Hedo Turkoglu": ["SG", "SF", "PF"],
    "Anthony Davis": ["SF", "PF", "C"],
    "Shawn Marion": ["SG", "SF", "PF"],
    "Rasheed Wallace": ["SF", "PF", "C"],
    "Dennis Rodman": ["SF", "PF", "C"],
    "Julius Erving": ["SG", "SF", "PF"],
    "Manu Ginobili": ["PG", "SG", "SF"],
    "Kawhi Leonard": ["SG", "SF", "PF"],
    "Jimmy Butler": ["SG", "SF", "PF"],
    "Paul George": ["SG", "SF", "PF"],
    "Ben Simmons": ["PG", "SF", "PF"],
    "Pau Gasol": ["PF", "C"],
    "Domantas Sabonis": ["SF", "PF", "C"],
    "Robert Horry": ["SF", "PF", "C"],
    "Detlef Schrempf": ["SG", "SF", "PF"],
    "Chris Webber": ["SF", "PF", "C"],
    "Rudy Gay": ["SG", "SF", "PF"],
    "Josh Smith": ["SF", "PF", "C"],
    "Antawn Jamison": ["SF", "PF"],
    "Tobias Harris": ["SG", "SF", "PF"],
    "Jrue Holiday": ["PG", "SG"],
    "James Harden": ["PG", "SG"],
    "Russell Westbrook": ["PG", "SG"],
    "Clyde Drexler": ["PG", "SG", "SF"],
    "John Havlicek": ["SG", "SF"],
  };

  // Union a player's data positions with any curated override, in canonical order.
  function withFlexiblePositions(player) {
    const extra = POSITION_OVERRIDES[player.name];
    if (!extra) return player;
    const merged = new Set([...player.positions, ...extra]);
    const positions = POSITION_ORDER.filter((slot) => merged.has(slot));
    return { ...player, positions };
  }

  // Fetch a JSON file from the local data directory.
  async function loadJSON(path) {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Failed to load ${path}: ${response.status}`);
    }
    return response.json();
  }

  // Load the list of available eras.
  function loadEras() {
    return loadJSON("data/eras.json");
  }

  // Load the curated playoff teams for one era, applying the rating recompression
  // and flexible-position overrides. Teams with a real `record` are the generated
  // (stat-derived) eras; their overalls are recomputed uncapped before squashing.
  async function loadTeams(eraId) {
    const teams = await loadJSON(`data/teams/${eraId}.json`);
    return teams.map((team) => {
      const isGenerated = Boolean(team.record);
      const roster = team.roster.map((player) => {
        const overall = adjustedOverall(player, team.season, isGenerated);
        return withFlexiblePositions({ ...player, overall });
      });
      return { ...team, roster };
    });
  }

  return { loadJSON, loadEras, loadTeams };
})();
