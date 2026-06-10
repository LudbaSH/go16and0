// Loads era, team, and player data from local JSON. No runtime network calls
// to external services. All data is bundled with the game.

const DataLoader = (() => {
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

  // Load the curated playoff teams for one era.
  function loadTeams(eraId) {
    return loadJSON(`data/teams/${eraId}.json`);
  }

  return { loadJSON, loadEras, loadTeams };
})();
