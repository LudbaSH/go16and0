# CLAUDE.md - Instructions for Claude Code

This file defines how Claude Code should behave when working on this project. Read it before doing anything else. Reference PLANNING.md for full project context.

---

## Project Identity

This is a static, browser-based basketball simulation game. The working title is **16-0**. It is a solo side project, not a commercial product, not affiliated with any league, team, or player association. All decisions should reflect that: lean, clean, legally cautious, no unnecessary complexity.

---

## Stack & Architecture

- **Vanilla JS, HTML, CSS** - no frameworks unless there is a strong reason introduced by the developer. Keep it simple and fast.
- **Static only** - no backend, no server-side logic, no database. Everything runs in the browser.
- **No user accounts** - guest-only for now. No login, no auth, no sessions stored beyond the active game.
- **State** lives in memory during a session. Use `localStorage` only if the developer explicitly asks to persist something (e.g. high scores). Never store personal data.
- **No external API calls** at runtime - all player/team/era data is bundled as local JSON.
- Future backend (leaderboards, accounts) is out of scope until the developer says otherwise.

---

## Skills to Apply

When working on this project, Claude Code should look for and apply the following skills if present in the project or skills directory:

- `marketing` - for copy, launch text, social posts, README messaging
- `ui-ux-promax` - for interface decisions, layout, interaction design, accessibility
- Any `code-mastery` skills present - apply relevant ones for JS quality, performance, and structure

If a skill file is not yet present, flag it and continue with best judgment. Do not block on missing skills.

---

## Code Style

- Clean, readable, well-commented code - this project may be open-sourced and read by others
- No minification during development
- Modular file structure - separate concerns (data, logic, UI, simulation engine)
- Prefer descriptive variable and function names over brevity
- No jQuery. No lodash unless genuinely needed.
- Mobile-first responsive design
- **No em dashes** in any generated code comments, copy, or documentation. Use a hyphen or rewrite the sentence.

---

## Legal — CRITICAL

This is the most important non-game section. Every decision touching user-facing text, data handling, or external references must respect the following:

### Privacy & Data
- **Collect zero user data.** No analytics, no tracking pixels, no fingerprinting.
- If any third-party script is ever added (e.g. Ko-fi, fonts), flag it to the developer first and explain what data it may collect.
- A Privacy Policy page must exist and must accurately state that no personal data is collected.

### Cookies
- Use **no cookies** unless strictly necessary for core functionality.
- If a cookie or localStorage entry is ever introduced, it must be disclosed in the Privacy Policy.
- No cookie consent banner is needed as long as no tracking or non-essential cookies exist, but the Privacy Policy must confirm this.

### Terms & Conditions
- A Terms of Use page must exist, clearly stating:
  - The game is for entertainment purposes only
  - No real money, gambling, or wagering is involved
  - The developer makes no guarantees of accuracy regarding player stats or historical records

### Copyright & IP
- **Player names and statistics** used in this game are for informational/historical reference. The game does not reproduce proprietary databases or licensed content.
- Do not use official NBA logos, team logos, or jersey designs without confirmed free/open license.
- Use generic visual representations (colors, abbreviations) for teams where rights are unclear.
- No endorsement by players, teams, the NBA, or any associated entity is implied or stated.

### No Endorsement / No Sponsorship
- The game must include a clear disclaimer on the about/legal page: *"This game is an independent fan project. It is not affiliated with, endorsed by, or sponsored by the NBA, NBPA, or any team or player."*
- Do not use phrases like "official," "licensed," or "partnered" anywhere.

### Rights Notice
- Add a footer copyright notice: `© [Year] [Developer Name]. All rights reserved.`
- Include: *"Player statistics sourced from public historical records."*

---

## File Structure (suggested starting point)

```
/
├── index.html
├── CLAUDE.md
├── PLANNING.md
├── README.md
├── /css
│   └── main.css
├── /js
│   ├── main.js
│   ├── engine.js        // simulation logic
│   ├── data-loader.js   // loads era/player/team JSON
│   └── ui.js            // DOM interactions
├── /data
│   ├── eras.json
│   ├── teams/
│   └── players/
└── /pages
    ├── privacy.html
    ├── terms.html
    └── about.html
```

---

## What Claude Code Should NOT Do

- Do not add user tracking, analytics scripts, or ad scripts - ever, without explicit developer instruction
- Do not use licensed sports data APIs without the developer confirming rights
- Do not create user accounts, login flows, or any form that collects personal information
- Do not generate placeholder legal text and call it done - flag legal pages for developer review before publishing
- Do not over-engineer - this is a lean static game, not a SaaS product
