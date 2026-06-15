// Single in-memory store for the current run. No persistence, no personal data.

const GameState = (() => {
  const SLOTS = ["PG", "SG", "SF", "PF", "C"];
  const ROUNDS = 4;        // playoff rounds
  const WINS_PER_SERIES = 4; // best-of-7
  const MAX_RESPINS = 3;   // re-rolls allowed across the whole draft

  function freshTournament() {
    return {
      round: 1,          // 1..rounds
      rounds: ROUNDS,    // number of rounds this run (4 classic, 7 gauntlet)
      winsNeeded: WINS_PER_SERIES, // wins to take a round (4 classic, 1 gauntlet)
      bracket: [],       // the opponents, in order
      opponent: null,    // opponent team for the current round
      yourWins: 0,       // wins in the current series
      oppWins: 0,        // losses in the current series
      games: [],         // game scores for the current series (reset each round)
      allGames: [],      // every game across the whole run (for the gauntlet MVP)
      totalWins: 0,      // games won across the whole run
      totalLosses: 0,    // games lost across the whole run
      status: "playing", // "playing" | "won" | "eliminated"
    };
  }

  const state = {
    screen: "menu",
    mode: null,          // "ratings" | "blind" (how much info is shown)
    gameMode: null,      // "classic" (16-0) | "gauntlet" (7-0)
    five: {},            // slot -> drafted player (the player's starting five)
    spunTeam: null,      // team shown by the latest draft spin
    respins: MAX_RESPINS, // re-rolls remaining this draft
    teamRating: 0,       // drafted five's rating (shown once the roster is set)
    teamRecord: null,    // projected regular-season record { wins, losses }
    _teamSig: "",        // signature of the five the projection was computed for
    tournament: freshTournament(),
  };

  function get() {
    return state;
  }

  // Shallow merge keeps updates simple for this flat store.
  function set(patch) {
    Object.assign(state, patch);
  }

  function reset() {
    set({
      screen: "menu", mode: null, gameMode: null,
      five: {}, spunTeam: null, respins: MAX_RESPINS,
      teamRating: 0, teamRecord: null, _teamSig: "",
      tournament: freshTournament(),
    });
  }

  // How many of the five slots are filled.
  function draftCount() {
    return SLOTS.filter((slot) => state.five[slot]).length;
  }

  return { SLOTS, ROUNDS, WINS_PER_SERIES, MAX_RESPINS, freshTournament, get, set, reset, draftCount };
})();
