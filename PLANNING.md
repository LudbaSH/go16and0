# PLANNING.md — 16-0: The Basketball Dynasty Simulator

> *"Build the perfect team. Run the perfect playoffs. Go 16-0."*

---

## What Is This?

**16-0** is a browser-based basketball simulation game where the player builds a team through a random draft mechanic and then runs a playoff gauntlet — trying to go undefeated, 16-0, to win the championship.

Inspired by:
- **82-0** (https://www.82-0.com/) — NBA roster builder using real player stats
- **7-0** (https://7a0.com.br/en/play) — football (soccer) team builder with a tournament simulation

This game takes elements from both and adds an **era system**, a **deeper player rating engine**, and a focused **playoff format**.

---

## Core Game Loop

1. **Player selects an Era** (or "All-Time" mode)
2. **Spin mechanic** assigns a random team from that era
3. **Roster is revealed** — players from that team/era with stats + overall ratings
4. **Playoff bracket is generated** — seeded from weakest to strongest, era-appropriate
5. **Simulate playoff run** — game-by-game, round-by-round
6. **Result screen** — final record (e.g. 14-2), series outcomes, MVP-style stat line
7. **Goal: 16-0** — a perfect playoff run

---

## Era System

Eras divide basketball history into distinct periods. Each era has:
- A set of eligible **teams** (with historical rosters)
- A pool of **players** (with era-accurate stats)
- **Playoff format** matching that era (e.g. best-of-5 in early rounds for older eras)

### Proposed Eras

| Era | Years | Flavour |
|-----|-------|---------|
| Early NBA | 1950–1969 | Pioneers, low scores, small rosters |
| Golden Era | 1970–1989 | ABA merger, Showtime, Bird/Magic |
| 90s Hardwood | 1990–1999 | Physical defense, Jordan, Shaq |
| 2000s | 2000–2012 | Post-Jordan, Spurs dynasty, superteams begin |
| Modern Era | 2013–present | 3-point revolution, load management |
| All-Time | Mixed | Best players/teams from all eras combined |

---

## The Spin Mechanic

- Player hits **SPIN**
- A random team from the selected era is chosen (weighted or pure random — TBD)
- The team's historical roster is loaded
- Player can see who they got before the playoff run begins
- No re-spins by default (can add as a difficulty option later)

---

## Player Rating System

This is a key differentiator from 82-0 (which only uses PTS/REB/AST).

### Overall Rating (1–99)

Calculated from a weighted formula across multiple stat categories:

**Offensive (55% weight)**
- Points per game
- True Shooting % (or FG% + 3P% + FT%)
- Assists per game
- Offensive Rating (if available)

**Defensive (30% weight)**
- Steals per game
- Blocks per game
- Defensive Rebounds
- Defensive Rating (if available)

**Intangibles (15% weight)**
- Games played / durability proxy
- Championships / Finals appearances (historical bonus)
- Era adjustment factor (normalise across eras — a 28 PPG average in the 60s means something different than today)

### Position Ratings
Each player also has positional ratings (PG, SG, SF, PF, C) reflecting how well their stats translate to each role. This allows for flexible lineup construction later.

### Team Overall
Average of the top 8 players by overall rating — used in playoff simulation.

---

## Playoff Simulation Engine

### Format
- Mirrors real NBA playoffs: 4 rounds, best-of-7 (adjust for older eras)
- **Round 1 & 2:** Seeded weaker opponents (bottom-half historical playoff teams from era)
- **Conference Finals:** Mid-tier powerhouse
- **Finals:** The strongest team from that era

### Simulation Logic (per game)
Each game result is calculated using:
- **Team Overall differential** — higher overall = higher base win probability
- **Random variance** — upsets are possible, nothing is guaranteed
- **Home court** — slight advantage (historical home court win % is ~60%)
- **Star player performance** — top player's overall influences single-game swings

### Series Output
Each round returns:
- Series result (W/L, e.g. 4-1)
- Running playoff record (e.g. 8-1 after 2 rounds)
- Key player stat lines (simulated per game)
- "Game of the series" highlight moment (text-based)

### The 16-0 Ideal
Going 16-0 requires winning every game in all 4 rounds. It is rare and hard — as it should be. The simulation should make it feel earned.

---

## UI & UX Vision

### Feel
- Clean, dark-themed, basketball-court inspired palette
- Smooth transitions — the spin should feel satisfying
- Mobile-first, fully responsive
- No clutter — the game is the focus

### Key Screens
1. **Home / Era Select** — minimal, atmospheric, pick your era or spin all-time
2. **Spin Screen** — animated wheel or slot-style reveal of your team
3. **Roster Screen** — your team's players, stats, and overall ratings displayed as cards
4. **Bracket Screen** — visual playoff bracket with opponent previews
5. **Simulation Screen** — round-by-round results, animated score reveals
6. **Final Screen** — playoff record, MVP, trophy if 16-0, share button

### Interactions
- One primary action per screen (keep it simple)
- Keyboard-accessible
- Share result as image or text snippet (Twitter/X, Reddit friendly)

---

## Data Strategy

### Sources (to be confirmed before use)
- Basketball-Reference.com — historical stats (public data, verify terms before scraping)
- Publicly available historical box score datasets on GitHub/Kaggle
- Hand-curated JSON for key historical rosters where automated data is unreliable

### Data Format
All data stored as local JSON — no runtime API calls.

```json
// Example player entry
{
  "id": "jordan_michael_1996",
  "name": "Michael Jordan",
  "team": "Chicago Bulls",
  "era": "90s",
  "season": "1995-96",
  "stats": {
    "ppg": 30.4,
    "rpg": 6.6,
    "apg": 4.3,
    "spg": 2.2,
    "bpg": 0.5,
    "fg_pct": 0.495,
    "three_pct": 0.427,
    "ft_pct": 0.834
  },
  "overall": 99,
  "position": "SG"
}
```

---

## Legal Pages Required

All must exist before public launch:

- **Privacy Policy** — confirms no personal data collected, no cookies beyond functional necessity, no third-party tracking
- **Terms of Use** — entertainment only, no gambling, no accuracy guarantees
- **About / Disclaimer** — independent fan project, not affiliated with NBA/NBPA/teams/players, no endorsement implied

See CLAUDE.md for full legal requirements.

---

## Launch Plan

### Phase 1 — MVP (playable, shareable)
- [ ] 1–2 eras functional (90s + Modern recommended)
- [ ] Spin mechanic working
- [ ] Playoff simulation running end-to-end
- [ ] Result screen with share text
- [ ] Legal pages live
- [ ] Mobile responsive

### Phase 2 — Polish
- [ ] All eras
- [ ] Animated spin
- [ ] Bracket visualisation
- [ ] Player card UI
- [ ] Per-game simulation detail

### Phase 3 — Growth
- [ ] Leaderboard (requires backend decision)
- [ ] Custom team builder
- [ ] Historical challenges (e.g. "Can 2016 Warriors go 16-0?")
- [ ] Social share as image

---

## Marketing & Release (Phase 1)

Target communities for launch post:
- r/webgames
- r/nba
- r/basketball
- r/IndieGaming
- r/sideprojects
- Twitter/X basketball community
- ProductHunt (after polish)

Post tone: direct, no hype. "I built this, here's what it does, here's the link." Let the game speak. Show the 16-0 challenge as the hook.

---

## Open Questions (to resolve during build)

1. Is the spin purely random or weighted by team quality/popularity?
2. Do we show opponent stats before each round or only reveal after simulation?
3. How granular is per-game simulation — just W/L, or simulated box scores?
4. Era adjustment formula — how to normalise stats across very different scoring environments?
5. What's the "fun threshold" for upset probability — needs playtesting
6. Domain name — TBD
7. Backend timeline — after MVP ships and if there's traction
