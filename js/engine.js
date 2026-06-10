// Simulation engine. Pure logic, no DOM access. Handles overall ratings,
// the spin, and playoff game/series simulation. See PLANNING.md for the model.

const Engine = (() => {
  // Pick a random team from an era's team list, avoiding `exclude` (the team shown
  // on the previous spin) so the reel never lands on the same team twice in a row.
  // With only one team available, exclusion is impossible and is ignored.
  function spinTeam(teams, exclude = null) {
    const pool = exclude && teams.length > 1 ? teams.filter((team) => team !== exclude) : teams;
    const index = Math.floor(Math.random() * pool.length);
    return pool[index];
  }

  // Team overall is the average of the top 8 players by overall rating.
  function teamOverall(players) {
    const top = [...players].sort((a, b) => b.overall - a.overall).slice(0, 8);
    if (top.length === 0) return 0;
    const sum = top.reduce((total, player) => total + player.overall, 0);
    return sum / top.length;
  }

  // Can this player occupy this court slot?
  function isEligible(player, slot) {
    return player.positions.includes(slot);
  }

  // Build the strongest legal starting five (slot -> player). Picks the eligible
  // player->slot assignment that maximizes, in order, (1) how many slots are filled
  // by an eligible player and (2) total overall - so a flexible star (e.g. Pippen at
  // PG) is slotted to free a teammate's spot rather than blocking it. Any slot with
  // no eligible player is backfilled with the best leftover. The search is a tiny
  // exhaustive one (five slots), which is exact and still instant.
  function autoFillLineup(roster, slots) {
    const ranked = [...roster].sort((a, b) => b.overall - a.overall);

    let best = { filled: -1, sum: -1, map: null };
    function search(i, used, map, sum, filled) {
      if (i === slots.length) {
        if (filled > best.filled || (filled === best.filled && sum > best.sum)) {
          best = { filled, sum, map: { ...map } };
        }
        return;
      }
      const slot = slots[i];
      for (const player of ranked) {
        if (used.has(player) || !player.positions.includes(slot)) continue;
        used.add(player);
        map[slot] = player;
        search(i + 1, used, map, sum + player.overall, filled + 1);
        delete map[slot];
        used.delete(player);
      }
      search(i + 1, used, map, sum, filled); // leave this slot empty for now
    }
    search(0, new Set(), {}, 0, 0);

    const lineup = best.map || {};
    const used = new Set(Object.values(lineup));
    for (const slot of slots) {
      if (lineup[slot]) continue;
      const next = ranked.find((p) => !used.has(p));
      if (next) {
        lineup[slot] = next;
        used.add(next);
      }
    }
    return lineup;
  }

  // ---- Scoring + simulation ----
  // NOTE: this is a PLACEHOLDER rating model. The stat weighting is intentionally
  // simple and lives in one place so it can be tuned later. For now a lineup's
  // strength is the average overall of its five, nudged by scoring punch (ppg).
  const HOME_COURT_EDGE = 3;   // points of advantage for the home side
  const GAME_VARIANCE = 11;    // random swing per side, in points (higher = more upsets)
  const BASE_POINTS = 100;     // notional points before adjustments

  function lineupScore(five) {
    const players = Object.values(five);
    if (players.length === 0) return 0;
    const ovr = players.reduce((sum, p) => sum + p.overall, 0) / players.length;
    const punch = players.reduce((sum, p) => sum + p.stats.ppg, 0) / 10;
    return ovr + punch;
  }

  function randomSwing() {
    return (Math.random() * 2 - 1) * GAME_VARIANCE;
  }

  // Simulate one game between two rated lineups. oppBonus is a difficulty boost
  // added to the opponent's effective rating (used to escalate later rounds).
  function simulateGame(yourRating, oppRating, youAreHome, oppBonus = 0) {
    const edge = youAreHome ? HOME_COURT_EDGE : -HOME_COURT_EDGE;
    const diff = (yourRating - (oppRating + oppBonus)) + edge;
    let yourPoints = Math.round(BASE_POINTS + diff / 2 + randomSwing());
    let oppPoints = Math.round(BASE_POINTS - diff / 2 + randomSwing());
    if (yourPoints === oppPoints) yourPoints += Math.random() < 0.5 ? 1 : -1; // no ties
    return { yourPoints, oppPoints, youWon: yourPoints > oppPoints };
  }

  // Simulate a per-player box score for one team in one game. Points are shares of
  // the team's total (so the sheet adds up to the final score), weighted by each
  // player's scoring average times a random "hot/cold" factor - that factor is why
  // the leading scorer changes from game to game and a role player can erupt.
  // Rebounds and assists are each player's average nudged by their own variance.
  function simulateBoxScore(players, teamPoints) {
    const list = players.filter(Boolean);
    if (!list.length) return [];

    const vary = (avg, lo, hi) => Math.max(0, Math.round(avg * (lo + Math.random() * (hi - lo))));

    const weights = list.map((p) => Math.max(0.15, p.stats.ppg) * (0.5 + Math.random() * 1.0));
    const totalW = weights.reduce((sum, w) => sum + w, 0) || 1;

    const lines = list.map((p, i) => ({
      name: p.name,
      pts: Math.round(teamPoints * (weights[i] / totalW)),
      reb: vary(p.stats.rpg, 0.6, 1.4),
      ast: vary(p.stats.apg, 0.6, 1.4),
    }));

    // Reconcile rounding so points sum exactly to the team's final score.
    let diff = teamPoints - lines.reduce((sum, l) => sum + l.pts, 0);
    lines.sort((a, b) => b.pts - a.pts);
    for (let i = 0; diff !== 0; i = (i + 1) % lines.length) {
      const step = diff > 0 ? 1 : -1;
      if (lines[i].pts + step >= 0) { lines[i].pts += step; diff -= step; }
    }
    return lines.sort((a, b) => b.pts - a.pts);
  }

  // Best-of-7 series. Home court follows the 2-2-1-1-1 NBA pattern for the higher
  // seed (assumed to be the player). Plays until one side reaches winsNeeded.
  function simulateSeries(yourRating, oppRating, winsNeeded, oppBonus = 0) {
    const homePattern = [true, true, false, false, true, false, true];
    const games = [];
    let yourWins = 0;
    let oppWins = 0;
    while (yourWins < winsNeeded && oppWins < winsNeeded) {
      const home = homePattern[games.length] ?? true;
      const game = simulateGame(yourRating, oppRating, home, oppBonus);
      games.push(game);
      if (game.youWon) yourWins += 1; else oppWins += 1;
    }
    return { games, yourWins, oppWins, youWon: yourWins > oppWins };
  }

  return {
    spinTeam, teamOverall, isEligible, autoFillLineup,
    lineupScore, simulateGame, simulateSeries, simulateBoxScore,
  };
})();
