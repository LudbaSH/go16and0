# Changelog

All notable changes to 16-0 are recorded here. This project uses
[semantic versioning](https://semver.org): MAJOR.MINOR.PATCH. Big features (an account
system, a backend, leaderboards) bump the MAJOR or MINOR version and get their own entry.

## [Unreleased]

Planned, not yet built. These are out of scope for v1 and will land in later versions:

- User accounts and guest-to-account upgrade.
- A backend to persist runs beyond the local browser.
- Global and per-mode leaderboards (strongest squad assembled, win streaks).
- More eras and teams as additional openly-licensed data is folded in.

## [1.0.0] - 2026

First public release.

### Game
- Spin-and-draft loop: draft a starting five one player at a time from random
  all-time teams.
- Two info levels: Ratings and Stats, or Blind Build.
- **16-0** mode: four best-of-seven playoff rounds, record-based seeding, a hardening
  field each round, and 2-2-1-1-1 home court. Sixteen straight wins for a perfect run.
- **Gauntlet 10-0** mode: ten single games against the greatest teams of all time, ordered
  weakest to strongest on neutral courts, with the legends buffed to challenge an elite
  draft and the strongest team ever as the final boss.
- Simulation engine with a capped-logistic win model, per-game box scores, and a balanced
  team rating that rewards two-way, well-rounded fives over one-dimensional ones.
- Finals MVP (yours on a win, the opponent's if they beat you in the final), an end-of-run
  Roster Averages table, and a click-through summary of recent runs (roster and bracket).

### Data
- 212 historical teams and 928 players bundled as local JSON, no runtime API calls.
- Sourced from public historical records under open licenses (CC0, MIT, CC BY-SA),
  attributed on the Privacy page.

### Tech and privacy
- Fully static: vanilla JS/HTML/CSS, no backend, no build step.
- Zero personal data, no analytics, no tracking, no cookies. Only local preferences and a
  clearable run history are stored in the browser.
- About, Privacy, and Terms pages with a clear independent-fan-project disclaimer.
