// Loads era, team, and player data from local JSON. No runtime network calls
// to external services. All data is bundled with the game.

const DataLoader = (() => {
  const POSITION_ORDER = ["PG", "SG", "SF", "PF", "C"];

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

  // Load the curated playoff teams for one era, applying flexible-position overrides.
  async function loadTeams(eraId) {
    const teams = await loadJSON(`data/teams/${eraId}.json`);
    return teams.map((team) => ({
      ...team,
      roster: team.roster.map(withFlexiblePositions),
    }));
  }

  return { loadJSON, loadEras, loadTeams };
})();
