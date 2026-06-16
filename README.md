# 16-0

A static, browser-based basketball simulation game. Spin for a random team from any
era, draft one player from it, and repeat until you have a starting five. Then take that
team through a playoff run and chase a perfect record.

Play at **[go16and0.com](https://go16and0.com)**. No account, no install, no tracking.

## How it plays

1. **Pick your info level.** Ratings and Stats (full overalls and stat lines) or Blind
   Build (names only, trust your gut).
2. **Draft your five.** Spin to reveal a real team from NBA history, then draft one of
   its players. Repeat until every position is filled, one player per slot.
3. **Run the gauntlet.** Each game is decided by a strength rating built from your five.
   The bigger your rating edge, the better your odds, but a favorite can still drop a
   game, so nothing is guaranteed.
4. **Go perfect.** A single flawless run is the whole goal.

Your team's rating is the average overall of your five plus bonuses for being a complete,
two-way team across scoring, rebounding, playmaking, defense, and shooting efficiency.
Each bonus has diminishing returns, so a balanced five beats five one-dimensional scorers
of the same overall. Defense (steals and blocks) and efficiency are the most overlooked
levers.

## Game modes

- **16-0** - Four playoff rounds, best-of-seven. Opponents are seeded weakest to strongest
  by record, the field hardens each round, and home court follows the 2-2-1-1-1 pattern.
  Win all sixteen games for a perfect run.
- **Gauntlet 10-0** - One game each against the ten greatest teams of all time, ordered
  weakest to strongest, on neutral courts. The legends are buffed to challenge an elite
  draft, and the final boss is the strongest team ever assembled. One loss ends it.

After a run you get a Finals MVP, a Roster Averages table, and a click-through summary of
every recent attempt (your roster and the bracket you faced), all stored locally.

## Data

The game ships with 212 historical teams and 928 players bundled as local JSON. There are
no runtime API calls. Player statistics are sourced from public historical records under
open licenses (CC0, MIT, CC BY-SA), attributed on the in-game Privacy page. This is an
independent fan project and is not affiliated with, endorsed by, or sponsored by the NBA,
NBPA, or any team or player.

## Stack

- Vanilla JavaScript, HTML, and CSS (Tailwind via CDN for utility classes, plus a custom
  `main.css`). No build step, no framework, no bundler.
- Fully static. No backend, no database, no user accounts. State lives in memory for the
  session; `localStorage` holds only preferences and a local run history.

```
/
├── index.html
├── css/main.css
├── js/            state, data-loader, engine, ui, dragdrop, sound
├── data/          eras + teams (per-decade JSON)
├── tools/         data generators and the Monte Carlo difficulty harness (dev only)
└── pages/         about, privacy, terms
```

## Running locally

It must be served over HTTP (the data loads via `fetch`, which fails on `file://`).

```bash
python -m http.server 8000
# then open http://localhost:8000
```

## Privacy

Zero personal data, no analytics, no tracking, no cookies. The only stored data is local
to your browser and clearable from the menu. See `pages/privacy.html`.

## Versioning

Current release: **v1.0.0**. See [CHANGELOG.md](CHANGELOG.md) for history and the roadmap
(accounts, backend, and leaderboards are planned but out of scope for v1).
