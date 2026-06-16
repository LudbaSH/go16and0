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
  // A lineup's strength is its composite rating (see lineupScore). The WINNER of a game
  // is decided by a capped win probability (an Elo-style logistic): a favorite tops out
  // at WIN_CAP, so even a blowout mismatch keeps a small upset floor. A perfect 16-0 is
  // hard mainly because the bracket HARDENS each round (oppBonus in js/ui.js climbs to a
  // near-peer Finals), so all 16 games must be won against a stiffening field. The
  // displayed final score is cosmetic, generated afterwards to agree with the result.
  const HOME_COURT_EDGE = 3;   // rating points of advantage for the home side
  const RATING_SCALE = 6;      // how steeply a rating gap turns into win probability
  const WIN_CAP = 0.98;        // a favorite's single-game win chance never exceeds this
  const SEASON_WIN_CAP = 0.94; // lower cap for the regular-season sim, so even the best
                               // all-time roster lands around a 76-6 record and an 82-0
                               // season is a rare feat (cap^82) rather than a formality.
                               // The playoffs keep the higher WIN_CAP; their difficulty
                               // comes from the bracket hardening each round, not the cap.
  const SEASON_RATING_SCALE = 12; // gentler win curve for the regular season ONLY. The
                               // playoff scale (6) saturates by ~+15, so a merely-good five
                               // and a stacked one both cruised to ~76 wins. At 12 you need
                               // RTG ~92 to average 70 wins and the top end separates, so a
                               // 70+ win season rewards a genuinely balanced, stacked roster.
  const BASE_POINTS = 100;     // notional points each side scores before the margin
  const MARGIN_SCALE = 12;     // how lopsided a strong favorite's win looks, on average
  const SCORE_SPREAD = 9;      // extra random spread on the final margin (cosmetic only)

  // Per-player shooting efficiency proxy. The data has no shot attempts, so blend the
  // percentages into a true-shooting-ish number, roughly 0.45 (poor) to 0.62 (elite).
  function shootingScore(stats) {
    return 0.5 * stats.fg + 0.2 * stats.tp + 0.3 * stats.ft;
  }

  // A lineup's rating: the average overall (the quality anchor) plus bounded bonuses for
  // being a COMPLETE team - scoring, rebounding, playmaking, defense, and efficiency.
  // Each bonus saturates (tanh), so piling one stat hits diminishing returns and a
  // balanced, two-way five out-rates a one-dimensional one of equal overall. Centers are
  // a typical starter's per-game line; weights set how much each dimension can swing.
  const SCORING_W = 2.5, REBOUND_W = 2.0, PASSING_W = 2.0, DEFENSE_W = 2.0, EFF_W = 2.0;
  function lineupScore(five) {
    const players = Object.values(five);
    const n = players.length;
    if (n === 0) return 0;
    const avg = (sel) => players.reduce((sum, p) => sum + sel(p), 0) / n;
    const overall  = avg((p) => p.overall);
    const scoring  = avg((p) => p.stats.ppg);
    const rebound  = avg((p) => p.stats.rpg);
    const passing  = avg((p) => p.stats.apg);
    const defense  = avg((p) => p.stats.spg + p.stats.bpg);
    const shooting = avg((p) => shootingScore(p.stats));
    return overall
      + SCORING_W * Math.tanh((scoring - 18) / 8)
      + REBOUND_W * Math.tanh((rebound - 6) / 3)
      + PASSING_W * Math.tanh((passing - 4) / 2.5)
      + DEFENSE_W * Math.tanh((defense - 1.6) / 1)
      + EFF_W     * Math.tanh((shooting - 0.52) / 0.05);
  }

  // Single-game win probability: a logistic (tanh) curve in the rating difference,
  // squashed so a favorite never exceeds WIN_CAP and an underdog never drops below
  // 1 - WIN_CAP. Capping per-game dominance is what makes 16 wins in a row genuinely
  // hard, since a sweep is this probability raised to the 16th power.
  function winProbability(diff, cap = WIN_CAP, scale = RATING_SCALE) {
    return 0.5 + (cap - 0.5) * Math.tanh(diff / scale);
  }

  // Simulate one game between two rated lineups. oppBonus is a difficulty boost added
  // to the opponent's effective rating (used to escalate later rounds). The winner is
  // drawn from winProbability; the final score is then generated to match - a
  // comfortable margin when the result follows the ratings, a close one on an upset.
  // youAreHome: true = home, false = away, null = neutral court (no edge, e.g. the gauntlet).
  function simulateGame(yourRating, oppRating, youAreHome, oppBonus = 0) {
    const edge = youAreHome === null ? 0 : (youAreHome ? HOME_COURT_EDGE : -HOME_COURT_EDGE);
    const diff = (yourRating - (oppRating + oppBonus)) + edge;
    const youWon = Math.random() < winProbability(diff);

    const expectedMargin = MARGIN_SCALE * Math.tanh(diff / RATING_SCALE); // signed toward favorite
    const resultFollowsRating = (youWon ? 1 : -1) === Math.sign(expectedMargin || 1);
    const margin = resultFollowsRating
      ? Math.max(1, Math.round(Math.abs(expectedMargin) + Math.random() * SCORE_SPREAD))
      : Math.max(1, Math.round(1 + Math.random() * (SCORE_SPREAD - 1))); // upset: keep it close

    const half = margin / 2;
    const yourPoints = Math.round(BASE_POINTS + (youWon ? half : -half));
    const oppPoints = Math.round(BASE_POINTS + (youWon ? -half : half));
    return { yourPoints, oppPoints, youWon };
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

  // Simulate a regular season to give a drafted team a believable record. Plays `games`
  // contests against a league-average opponent (half home, half away) with the same win
  // model, so a stronger roster naturally posts a better record. That record then decides
  // playoff seeding / home court, so it is more than flavor.
  function simulateSeasonRecord(rating, leagueAvg, games = 82) {
    let wins = 0;
    for (let i = 0; i < games; i++) {
      const edge = i % 2 === 0 ? HOME_COURT_EDGE : -HOME_COURT_EDGE;
      if (Math.random() < winProbability(rating - leagueAvg + edge, SEASON_WIN_CAP, SEASON_RATING_SCALE)) wins++;
    }
    return { wins, losses: games - wins };
  }

  // Best-of-7 series. Home court follows the 2-2-1-1-1 pattern with user as home team
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
    lineupScore, simulateGame, simulateSeries, simulateBoxScore, simulateSeasonRecord,
  };
})();
