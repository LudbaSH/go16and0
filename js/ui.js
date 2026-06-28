// UI layer: screen router, the draft loop, the playoff tournament, and overlays.
// Reads data via DataLoader, logic via Engine, run data via GameState.

const UI = (() => {
  const { SLOTS, ROUNDS, WINS_PER_SERIES, MAX_RESPINS } = GameState;
  const ROUND_NAMES = ["Round 1", "Round 2", "Conference Finals", "Finals"];

  // Difficulty: opponents are seeded weakest-to-strongest by REAL record, and each round
  // adds a rating bonus on top so the field hardens to a near-peer Finals. The bonus for
  // classic round r is base + (r-1)*step; the level chosen on the menu sets base/step.
  // (Gauntlet ignores this - it uses its own effective-strength curve below.) Standard is
  // the original tuning (base 2, step 3). Tunable here, paired with the engine's
  // WIN_CAP/RATING_SCALE (js/engine.js).
  const DIFFICULTY_LEVELS = [
    { id: "casual",   name: "Casual",   base: 0, step: 2 },
    { id: "easy",     name: "Easy",     base: 1, step: 2 },
    { id: "standard", name: "Standard", base: 2, step: 3 },
    { id: "hard",     name: "Hard",     base: 3, step: 4 },
    { id: "brutal",   name: "Brutal",   base: 4, step: 5 },
  ];
  const DIFFICULTY_KEY = "16-0:difficulty";
  let difficultyId = loadDifficulty();
  function loadDifficulty() {
    const saved = localStorage.getItem(DIFFICULTY_KEY);
    return DIFFICULTY_LEVELS.some((d) => d.id === saved) ? saved : "standard";
  }
  function currentDifficulty() {
    return DIFFICULTY_LEVELS.find((d) => d.id === difficultyId) || DIFFICULTY_LEVELS[2];
  }
  // The classic per-round difficulty bump (gauntlet uses gauntletBonus instead).
  function classicRoundBonus(round) {
    const d = currentDifficulty();
    return d.base + (round - 1) * d.step;
  }

  // Hot Hand: a player who erupts (well above their scoring average, and a real load) carries
  // a hot hand into the NEXT game in the run, where the box score tilts toward them and a flame
  // marks the row. Purely a box-score effect - the game result is decided by lineup ratings, so
  // this never changes win odds. Only one hot hand at a time, on YOUR roster.
  const HOT_FORM_MIN = 1.5; // this-game points must be >= 1.5x the player's season average
  const HOT_PTS_MIN = 20;   // ...and at least a 20-point night, so a low-usage spike doesn't count
  // Gauntlet difficulty is set by an explicit EFFECTIVE-strength curve, not the classic
  // ramp. A handpicked draft (best player per position, no weak link) out-rates any real
  // team - a maxed five hits ~106 while the best real team is ~89 - so without a buff the
  // all-time legends play soft. These two numbers buff each round's effective strength on a
  // line from the opener to the final boss, so the legends actually challenge an elite draft
  // (boss ~100 = a near-maxed five is favored but not safe). See gauntletBonuses.
  const GAUNTLET_OPENER_EFF = 83;  // round 1 effective rating (softest of the greats)
  const GAUNTLET_BOSS_EFF = 98;    // final boss effective rating

  // Mutators: one-at-a-time draft rule twists chosen on the mutators screen. Positionless
  // lives in the engine (isEligible); the rest are enforced here at draft time.
  const UNDERDOGS_MAX_OVERALL = 85;  // Underdogs: no player rated above this is draftable
  const SALARY_CAP = 200;            // Salary Cap: total budget for the five
  // Steep convex cost so stars are pricey and role players cheap (overall 99 ~99, 85 ~43,
  // 80 ~28, 74 ~15). Floor of 1 so even a 59 costs something.
  const playerCost = (p) => Math.max(1, Math.round(((p.overall - 58) ** 2) / 17));
  // Short display names for the active mutator, used on the Records run rows + detail.
  const MUTATOR_NAMES = {
    positionless: "Positionless", eralock: "Era Lock", salarycap: "Salary Cap",
    underdogs: "Underdogs", ironfive: "Iron Five",
  };

  let eras = [];
  let currentTeams = [];

  // Transient UI state (not part of the saved run).
  let selectedPlayer = null;      // player tapped on the draft court (to move/swap)
  let pendingDraftPlayer = null;  // pick tapped from the spun team, awaiting a court spot
  let usedTeams = new Set();       // teams you've already drafted from (never spin again)
  let draftAccents = new Map();    // placed player -> their spun team's franchise color
  let pickFilter = { q: "", group: "all", sort: "overall" }; // ratings-mode pick filters
  let isSpinning = false;    // a draft spin animation is mid-flight
  let animating = false;     // a score count-up is in progress
  let currentGameNo = 0;
  let speed = "normal";      // score count-up speed: "slow" | "normal" | "fast"
  let statsTab = "overview"; // active tab on the Records screen

  // Count-up durations in ms by speed setting.
  const SPEED_MS = { slow: 4000, normal: 3000, fast: 1800 };

  // Each franchise's main real color, used to tint the team it belongs to. Keyed by
  // the modern franchise name used in the data. Falls back to gold if unmapped.
  const TEAM_COLORS = {
    "Atlanta Hawks": "#E0414A", "Boston Celtics": "#1Fae6a", "Brooklyn Nets": "#C9CDD2",
    "Chicago Bulls": "#E03A4B", "Cleveland Cavaliers": "#C45070", "Dallas Mavericks": "#2E86D6",
    "Denver Nuggets": "#4F90DE", "Detroit Pistons": "#3D6BE0", "Golden State Warriors": "#2E86E0",
    "Houston Rockets": "#E0303C", "Indiana Pacers": "#FDBB30", "Los Angeles Clippers": "#E0415C",
    "Los Angeles Lakers": "#9B6BE0", "Miami Heat": "#E0245E", "Milwaukee Bucks": "#2BA45F",
    "Minnesota Timberwolves": "#3D8BD6", "New York Knicks": "#F58426", "Oklahoma City Thunder": "#2E9AE0",
    "Orlando Magic": "#1F9BD6", "Philadelphia 76ers": "#2E8AE6", "Phoenix Suns": "#E56A20",
    "Portland Trail Blazers": "#E03A4B", "Sacramento Kings": "#9B6FE0", "San Antonio Spurs": "#C9CDD2",
    "Toronto Raptors": "#E0314A", "Utah Jazz": "#F2A33C", "Washington Wizards": "#D85070",
  };
  const GOLD = "#fbbf24";
  function teamColor(name) { return TEAM_COLORS[name] || GOLD; }

  // Two-letter initials from a player's name ("LeBron James" -> "LJ").
  function initials(name) {
    const parts = name.replace(/[.]/g, "").split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] || "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : (parts[0]?.[1] || "");
    return (first + last).toUpperCase();
  }

  // Can `player` legally land in `targetSlot` given the current five? An empty
  // eligible slot is always fine. A swap into an occupied slot is only allowed if
  // the displaced player can also play the mover's current slot - otherwise one of
  // them would have nowhere to go (the disappearing-player bug).
  function canPlace(player, targetSlot, five) {
    if (!Engine.isEligible(player, targetSlot)) return false;
    const occupant = five[targetSlot];
    if (!occupant || occupant === player) return true;
    const sourceSlot = Object.keys(five).find((slot) => five[slot] === player);
    if (!sourceSlot) return true; // mover isn't on the court yet (fresh draft)
    return Engine.isEligible(occupant, sourceSlot);
  }

  // ---- Theme (light / dark) ----
  // The whole palette lives in CSS custom properties, so a theme is just a class on
  // <body> that re-points those variables (see main.css body.light). The choice is
  // the only thing we persist for theming.
  const THEME_KEY = "16-0:theme";
  const ICON = {
    sun: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/></svg>',
    moon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    soundOn: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    soundOff: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
  };

  function applyTheme(theme) {
    const light = theme === "light";
    document.body.classList.toggle("light", light);
    const btn = document.getElementById("theme-button");
    if (btn) btn.innerHTML = light ? ICON.moon : ICON.sun; // show the mode you'd switch to
  }

  function toggleTheme() {
    const next = document.body.classList.contains("light") ? "dark" : "light";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  }

  // ---- Difficulty (classic only) ----
  // Render the menu's level buttons and mark the active one. The choice is persisted so a
  // phone session keeps it between visits (it only affects the classic 16-0 ramp).
  function renderDifficulty() {
    const wrap = document.getElementById("difficulty-options");
    if (!wrap) return;
    wrap.innerHTML = DIFFICULTY_LEVELS
      .map((d) => `<button type="button" class="diff-btn${d.id === difficultyId ? " active" : ""}" data-action="set-difficulty" data-diff="${d.id}" aria-pressed="${d.id === difficultyId}">${d.name}</button>`)
      .join("");
  }

  function setDifficulty(id) {
    if (!DIFFICULTY_LEVELS.some((d) => d.id === id)) return;
    difficultyId = id;
    try { localStorage.setItem(DIFFICULTY_KEY, id); } catch { /* storage blocked: keep in memory */ }
    renderDifficulty();
  }

  function updateSoundButton() {
    const btn = document.getElementById("sound-button");
    if (btn) btn.innerHTML = Sound.isMuted() ? ICON.soundOff : ICON.soundOn;
  }

  function toggleSound() {
    Sound.toggleMute();
    updateSoundButton();
  }

  // ---- Attempt history (local only, no account) ----
  // A rolling log of finished runs in localStorage, surfaced on the Records screen. No
  // personal data - just mode, outcome, record, and the five you drafted. Privacy-disclosed.
  const HISTORY_KEY = "16-0:history";
  const HISTORY_CAP = 30;   // how many we keep

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
    catch { return []; }
  }

  function saveAttempt(entry) {
    const next = [entry, ...loadHistory()].slice(0, HISTORY_CAP);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* storage full/blocked: skip */ }
  }

  function clearHistory() {
    localStorage.removeItem(HISTORY_KEY);
    Career.clear();       // wipe lifetime/career stats too, so "Clear" erases all game data
    Achievements.clear(); // and earned badges
    if (GameState.get().screen === "stats") renderStats();
  }

  // One run row for the Records > Runs tab. The index is the position in loadHistory() so
  // view-run can re-open that exact run's summary. Older entries predate the roster capture;
  // only newer ones are clickable. Shows the drafted five's full names when available.
  function historyRowHTML(it, i) {
    const modeName = it.mode === "gauntlet" ? "Gauntlet" : "16-0";
    const mode = MUTATOR_NAMES[it.mutator] ? `${modeName} &middot; ${MUTATOR_NAMES[it.mutator]}` : modeName;
    const team = it.roster && it.roster.length
      ? it.roster.map((p) => p.name).join(" · ")
      : (it.team || []).join(" · ");
    const clickable = it.roster ? ` data-action="view-run" data-index="${i}" role="button" tabindex="0"` : "";
    return `<li class="history-row history-${it.outcome}${it.roster ? " is-clickable" : ""}"${clickable}>
      <span class="history-outcome">${it.label}</span>
      <span class="history-mode">${mode}</span>
      <span class="history-record">${it.record}</span>
      <span class="history-team">${team}</span></li>`;
  }

  // Build the achievement evaluation context from durable run history (so past runs count
  // toward cumulative badges) plus an optional live run (for per-series badges history can't
  // reconstruct). isTitle treats a won or perfect run as a title.
  function buildAchievementContext(liveRun = null) {
    const hist = loadHistory();
    const isTitle = (h) => h.outcome === "perfect" || h.outcome === "won";
    const titles = hist.filter(isTitle).length;
    const perfectRuns = hist.filter((h) => h.outcome === "perfect").length;
    const maxRating = hist.reduce((m, h) => Math.max(m, h.rtg || 0), 0);
    const gauntletTitle = hist.some((h) => h.mode === "gauntlet" && isTitle(h));
    // Longest streak of consecutive titles. History is newest-first, so walk it backward
    // (oldest to newest); any non-title resets the count.
    let streak = 0, maxStreak = 0;
    for (let i = hist.length - 1; i >= 0; i--) {
      streak = isTitle(hist[i]) ? streak + 1 : 0;
      if (streak > maxStreak) maxStreak = streak;
    }
    return { titles, perfectRuns, maxRating, gauntletTitle, maxStreak, run: liveRun };
  }

  // ---- Records screen: career stats, players, achievements, full run history ----
  function renderStats() {
    // Backfill cumulative badges from existing history each time Records opens, so past
    // runs (including ones played before achievements shipped) count. Silent - no toast.
    Achievements.evaluate(buildAchievementContext(null));
    setActiveStatsTab(statsTab);
    renderStatsBody(statsTab);
  }

  function selectStatsTab(tab) {
    if (!tab) return;
    statsTab = tab;
    setActiveStatsTab(tab);
    renderStatsBody(tab);
  }

  function setActiveStatsTab(tab) {
    document.querySelectorAll(".stats-tab").forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.stab === tab));
  }

  function renderStatsBody(tab) {
    const body = document.getElementById("stats-body");
    if (!body) return;
    if (tab === "players") body.innerHTML = statsPlayersHTML();
    else if (tab === "achievements") body.innerHTML = statsAchievementsHTML();
    else if (tab === "runs") body.innerHTML = statsRunsHTML();
    else body.innerHTML = statsOverviewHTML();
  }

  function emptyStatsHTML() {
    return `<p class="stats-empty">No runs yet. Finish a run to start building your record.</p>`;
  }

  // A donut ring filled to `pct`, with a big value and a caption in the middle. Pure inline
  // SVG so it needs no charting library and inherits theme colors from CSS.
  function donutSVG(pct, label, value) {
    const r = 38, circ = 2 * Math.PI * r;
    const dash = Math.max(0, Math.min(100, pct)) / 100 * circ;
    return `<svg viewBox="0 0 100 100" class="donut" role="img" aria-label="${label}: ${value}">
      <circle class="donut-track" cx="50" cy="50" r="${r}"></circle>
      <circle class="donut-fill" cx="50" cy="50" r="${r}" transform="rotate(-90 50 50)"
        stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}"></circle>
      <text class="donut-val" x="50" y="48">${value}</text>
      <text class="donut-lbl" x="50" y="64">${label}</text>
    </svg>`;
  }

  // One labeled horizontal bar scaled against `max`, for the outcome breakdown.
  function barRow(label, value, max, color) {
    const w = max ? Math.round((value / max) * 100) : 0;
    return `<div class="bar-row">
      <span class="bar-label">${label}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${w}%;background:${color}"></span></span>
      <span class="bar-val">${value}</span>
    </div>`;
  }

  // Overview dashboard: a win-rate donut and an outcome bar chart over the top, a tile grid
  // below. Run-level totals come from the durable history (so past runs show) - the Career
  // store only backs the per-player tab. Game win % is over individual games, not runs.
  function statsOverviewHTML() {
    const hist = loadHistory();
    if (!hist.length) return emptyStatsHTML();
    const isTitle = (h) => h.outcome === "perfect" || h.outcome === "won";
    const runs = hist.length;
    const titles = hist.filter(isTitle).length;
    const perfectRuns = hist.filter((h) => h.outcome === "perfect").length;
    const eliminations = hist.filter((h) => h.outcome === "eliminated").length;
    let gw = 0, gl = 0;
    hist.forEach((h) => {
      const [w, l] = (h.record || "0-0").split("-").map(Number);
      gw += w || 0; gl += l || 0;
    });
    const games = gw + gl;
    const winPct = games ? Math.round((gw / games) * 100) : 0;
    const ach = Achievements.counts();
    const maxOutcome = Math.max(titles, perfectRuns, eliminations, 1);

    const charts = `<div class="overview-charts">
      <div class="chart-card">${donutSVG(winPct, "Game win %", `${winPct}%`)}</div>
      <div class="chart-card bars-card">
        ${barRow("Titles", titles, maxOutcome, "var(--color-gold)")}
        ${barRow("Perfect", perfectRuns, maxOutcome, "var(--color-gold)")}
        ${barRow("Eliminated", eliminations, maxOutcome, "var(--color-orange)")}
      </div>
    </div>`;

    const tiles = [
      ["Runs", runs], ["Titles", titles],
      ["Perfect runs", perfectRuns], ["Eliminations", eliminations],
      ["Games won", gw], ["Games lost", gl],
      ["Game win %", `${winPct}%`], ["Badges", `${ach.unlocked}/${ach.total}`],
    ];
    const tileGrid = `<div class="stat-tiles">${tiles.map(([key, val]) =>
      `<div class="stat-tile"><span class="stat-val">${val}</span><span class="stat-key">${key}</span></div>`).join("")}</div>`;

    return charts + tileGrid;
  }

  // A handful of player highlights from the career store, instead of an endless table - the
  // most-used and best-performing players you've rostered, each accent-colored by its stat.
  // Synthetic averages (box scores are generated to match results). Rate-stat leaders need a
  // small sample so a one-game fluke can't top the board (falls back if nobody qualifies yet).
  const HIGHLIGHT_MIN_GAMES = 3;
  function statsPlayersHTML() {
    const players = Career.load().players;
    const rows = Object.entries(players).map(([name, s]) => {
      const g = s.games || 0;
      return { name, drafted: s.drafted || 0, g, ppg: g ? s.pts / g : 0, rpg: g ? s.reb / g : 0, apg: g ? s.ast / g : 0, hi: s.bestPts || 0 };
    }).filter((r) => r.g > 0);
    if (!rows.length) return `<p class="stats-empty">Player highlights start tracking from your next run.</p>`;

    // Pick the row with the largest `sel`. For rate stats, prefer rows with enough games but
    // fall back to the whole pool so an early career still shows a leader.
    const leaderBy = (sel, minGames = 0) => {
      const pool = rows.filter((r) => r.g >= minGames);
      const from = pool.length ? pool : rows;
      return from.reduce((best, r) => (sel(r) > sel(best) ? r : best), from[0]);
    };
    const M = HIGHLIGHT_MIN_GAMES;
    const picks = (n) => (n === 1 ? "pick" : "picks");
    const highlights = [
      { cat: "Most Drafted", accent: "#fbbf24", r: leaderBy((r) => r.drafted), val: (r) => `${r.drafted}`, unit: (r) => picks(r.drafted) },
      { cat: "Top Scorer", accent: "#fb7185", r: leaderBy((r) => r.ppg, M), val: (r) => r.ppg.toFixed(1), unit: () => "PPG" },
      { cat: "Career High", accent: "#f97316", r: leaderBy((r) => r.hi), val: (r) => `${r.hi}`, unit: () => "PTS" },
      { cat: "Top Rebounder", accent: "#38bdf8", r: leaderBy((r) => r.rpg, M), val: (r) => r.rpg.toFixed(1), unit: () => "RPG" },
      { cat: "Top Playmaker", accent: "#a78bfa", r: leaderBy((r) => r.apg, M), val: (r) => r.apg.toFixed(1), unit: () => "APG" },
    ];
    const items = highlights.map((h) => `<li class="ph-row" style="--accent:${h.accent}">
      <div class="ph-info">
        <span class="ph-cat">${h.cat}</span>
        <span class="ph-name">${h.r.name}</span>
      </div>
      <span class="ph-val">${h.val(h.r)} <small>${h.unit(h.r)}</small></span>
    </li>`).join("");
    return `<ul class="ph-list">${items}</ul>
      <p class="stats-note">Your most-used and best-performing players across every run.</p>`;
  }

  function statsAchievementsHTML() {
    const list = Achievements.all();
    const c = Achievements.counts();
    const cards = list.map((a) => `<div class="ach-card ${a.unlocked ? "unlocked" : "locked"}">
      <span class="ach-name">${a.name}</span>
      <span class="ach-desc">${a.desc}</span>
      <span class="ach-state">${a.unlocked ? "Unlocked" : "Locked"}</span>
    </div>`).join("");
    return `<p class="stats-note">${c.unlocked} of ${c.total} unlocked.</p>
      <div class="ach-grid">${cards}</div>`;
  }

  function statsRunsHTML() {
    const items = loadHistory();
    if (!items.length) return emptyStatsHTML();
    return `<ul class="history-list">${items.map((it, i) => historyRowHTML(it, i)).join("")}</ul>`;
  }

  // Open the click-through summary for a stored run: its roster and the bracket it faced.
  function openRunSummary(index) {
    const item = loadHistory()[index];
    if (!item || !item.roster) return;
    renderRunSummary(item);
    document.getElementById("run-overlay").classList.remove("hidden");
  }

  function closeRunSummary() {
    document.getElementById("run-overlay").classList.add("hidden");
  }

  function renderRunSummary(item) {
    const modeName = item.mode === "gauntlet" ? "Gauntlet 10-0" : "16-0";
    const mode = MUTATOR_NAMES[item.mutator] ? `${modeName} &middot; ${MUTATOR_NAMES[item.mutator]}` : modeName;
    const roundName = (i) => item.mode === "gauntlet"
      ? `Round ${i + 1}` : (ROUND_NAMES[i] || `Round ${i + 1}`);
    const verb = { won: "Beat", lost: "Lost to", unplayed: "Did not reach" };

    const rosterRows = (item.roster || []).map((p) =>
      `<tr><td class="ss-name"><span class="ss-av" style="background:${GOLD}">${p.slot}</span>${p.name}
        <span class="run-pos">${p.pos}</span></td><td>${p.overall}</td></tr>`).join("");

    const legRows = (item.bracket || []).map((b, i) =>
      `<li class="run-leg run-${b.result}">
        <span class="run-round">${roundName(i)}</span>
        <span class="run-opp">${b.name} <em>${b.season}</em>${b.record ? ` <span class="run-rec">${b.record}</span>` : ""}</span>
        <span class="run-badge">${verb[b.result] || ""}</span>
      </li>`).join("");

    document.getElementById("run-summary").innerHTML = `
      <div class="run-head">
        <div class="run-title">${item.label}</div>
        <div class="run-sub">${mode} &middot; ${item.record}</div>
      </div>
      <h3 class="run-section">Roster${item.rtg ? ` &middot; RTG ${item.rtg}` : ""}</h3>
      <div class="ss-tables"><table class="ss-table">
        <thead><tr><th class="ss-team" style="color:${GOLD}">Player</th><th>OVR</th></tr></thead>
        <tbody>${rosterRows}</tbody></table></div>
      <h3 class="run-section">Bracket</h3>
      <ul class="run-bracket">${legRows}</ul>`;
  }

  // ---- Boot ----
  async function boot() {
    try {
      eras = await DataLoader.loadEras();
    } catch (error) {
      showFatal("Could not load game data. If you opened the file directly, run it through a local web server.");
      return;
    }
    bindActions();
    bindMenu();
    bindDraftCourt();
    bindConfirm();
    applyTheme(localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark");
    updateSoundButton();
    renderDifficulty();
    document.getElementById("speed-select").addEventListener("change", (event) => {
      speed = event.target.value;
    });
    showScreen("menu");
  }

  function showFatal(message) {
    document.getElementById("app").innerHTML = `<p class="text-center text-muted mt-16">${message}</p>`;
  }

  // ---- Router ----
  function showScreen(id) {
    document.querySelectorAll(".screen").forEach((section) => {
      section.classList.toggle("hidden", section.dataset.screen !== id);
    });
    GameState.set({ screen: id });
    if (id === "stats") renderStats();
    if (id === "draft") renderDraft();
    if (id === "tournament") renderRound();
    if (id === "result") renderResult();
    window.scrollTo(0, 0);
  }

  function bindActions() {
    document.addEventListener("click", (event) => {
      const target = event.target.closest("[data-action]");
      if (!target) return;
      switch (target.dataset.action) {
        case "home": requestHome(); break;
        case "go-menu": showScreen("menu"); break;
        case "go-mode": showScreen("mode"); break;
        case "go-gamemode": showScreen("gamemode"); break;
        case "set-mode": chooseMode(target.dataset.mode); break;
        case "set-gamemode": chooseGameMode(target.dataset.gamemode); break;
        case "set-mutator": chooseMutator(target.dataset.mutator); break;
        case "spin": doSpin(); break;
        case "start-run": startRun(); break;
        case "play-game": playGame(); break;
        case "sim-round": simulateRound(); break;
        case "advance-round": advanceRound(); break;
        case "play-again": leaveRun("menu"); break;
        case "retry-gauntlet": retryAsGauntlet(); break;
        case "toggle-theme": toggleTheme(); break;
        case "toggle-sound": toggleSound(); break;
        case "clear-history": clearHistory(); break;
        case "go-stats": showScreen("stats"); break;
        case "stats-tab": selectStatsTab(target.dataset.stab); break;
        case "view-run": openRunSummary(Number(target.dataset.index)); break;
        case "open-howto": openMenu("howto"); break;
        case "set-difficulty": setDifficulty(target.dataset.diff); break;
      }
    });
  }

  function chooseMode(mode) {
    GameState.set({ mode });
    showScreen("gamemode");
  }

  // ---- Game mode select ----
  // Both modes draft from the full all-time pool (every seeded team), which is what
  // gives the draft real variety. The mode only changes the run that follows.
  // Game mode is chosen first, then the optional mutator on its own step. Picking a mode
  // no longer loads teams or enters the draft - the mutator screen does that next.
  function chooseGameMode(gameMode) {
    GameState.set({ gameMode });
    showScreen("mutators");
  }

  // Apply the chosen mutator (or none), wire its draft-time effect, then load teams and
  // enter the draft. Positionless flips eligibility in the engine for the player's draft.
  async function chooseMutator(mutator) {
    const active = mutator === "none" ? null : mutator;
    GameState.set({ mutator: active });
    Engine.setPositionless(active === "positionless");
    try {
      const playable = eras.filter((era) => era.hasData);
      const lists = await Promise.all(playable.map((era) => DataLoader.loadTeams(era.id)));
      // Tag each team with its era id so Era Lock can filter the spin pool to one decade.
      currentTeams = lists.flatMap((teams, i) => teams.map((team) => ({ ...team, era: playable[i].id })));
      leagueAvgRating = computeLeagueAvg();
    } catch (error) {
      showFatal("Could not load team data.");
      return;
    }
    // Iron Five removes re-rolls: you draft from whatever you spin.
    const respins = active === "ironfive" ? 0 : MAX_RESPINS;
    GameState.set({ five: {}, spunTeam: null, respins, lockedEra: null });
    selectedPlayer = null;
    pendingDraftPlayer = null;
    usedTeams = new Set();
    draftAccents = new Map();
    showScreen("draft");
  }

  // ---- Draft ----
  function renderDraft() {
    renderDraftMutator();
    resetSpinReel();
    renderDraftCourt();
    renderPicks();
    updateDraftProgress();
  }

  // Show the active mutator above the draft progress so the rule twist is never a surprise.
  // Salary Cap's label counts the live remaining budget, so each is a function of state.
  const MUTATOR_LABELS = {
    positionless: () => "Positionless - any player fits any slot",
    eralock: () => "Era Lock - same decade as your first pick",
    salarycap: () => `Salary Cap - ${remainingCap(GameState.get().five)} of ${SALARY_CAP} budget left`,
    underdogs: () => `Underdogs - no player rated above ${UNDERDOGS_MAX_OVERALL}`,
    ironfive: () => "Iron Five - no re-spins, draft who you spin",
  };
  function renderDraftMutator() {
    const el = document.getElementById("draft-mutator");
    if (!el) return;
    const label = MUTATOR_LABELS[GameState.get().mutator];
    const text = label ? label() : "";
    el.textContent = text;
    el.classList.toggle("hidden", !text);
  }

  // Budget left under Salary Cap = cap minus the cost of everyone already drafted.
  function remainingCap(five) {
    const spent = Object.values(five).reduce((sum, p) => sum + playerCost(p), 0);
    return SALARY_CAP - spent;
  }

  // Does the active mutator allow drafting this player into the current five? Positionless,
  // Era Lock and Iron Five impose no per-player draftability limit here (handled elsewhere);
  // Underdogs caps overall, Salary Cap caps cost against the remaining budget.
  function mutatorAllowsDraft(player, five) {
    const { mutator } = GameState.get();
    if (mutator === "underdogs") return player.overall <= UNDERDOGS_MAX_OVERALL;
    if (mutator === "salarycap") {
      // Reserve 1 budget point for every slot that would still be empty after this pick,
      // so you can never strand the run unable to afford a fifth starter (min cost is 1).
      const filled = Object.values(five).filter(Boolean).length;
      const reserve = Math.max(0, SLOTS.length - filled - 1);
      return playerCost(player) <= remainingCap(five) - reserve;
    }
    return true;
  }

  // Why a player can't be drafted right now, for the locked pick-row tooltip.
  function mutatorLockReason() {
    const { mutator } = GameState.get();
    if (mutator === "underdogs") return `Rated above the Underdogs cap of ${UNDERDOGS_MAX_OVERALL}`;
    if (mutator === "salarycap") return "Not enough cap space left";
    return "Can't draft this player";
  }

  // Keep the spin reel in sync with run state, so backing out of a run and
  // re-entering the draft shows a clean prompt instead of a stale team name.
  function resetSpinReel() {
    const reel = document.getElementById("spin-reel");
    const { spunTeam } = GameState.get();
    reel.classList.remove("is-spinning");
    if (GameState.draftCount() >= 5) {
      reel.textContent = "Your roster is set";
      reel.classList.remove("settled");
      tintSpinStage(null);
    } else if (spunTeam) {
      reel.innerHTML = `${spunTeam.name}<span class="reel-year">${spunTeam.season}</span>`;
      reel.classList.add("settled");
      tintSpinStage(spunTeam);
    } else {
      reel.textContent = "Spin for a random team";
      reel.classList.remove("settled");
      tintSpinStage(null);
    }
  }

  // Color the spin box with the settled team's franchise color (cleared on reset).
  function tintSpinStage(team) {
    const stage = document.getElementById("spin-stage");
    if (!stage) return;
    if (team) stage.style.setProperty("--accent", teamColor(team.name));
    else stage.style.removeProperty("--accent");
  }

  function renderDraftCourt() {
    const court = document.getElementById("draft-court");
    const { five, mode } = GameState.get();
    const currentSlot = selectedPlayer
      ? Object.keys(five).find((slot) => five[slot] === selectedPlayer)
      : null;

    court.innerHTML = "";
    SLOTS.forEach((slot) => {
      const slotEl = document.createElement("div");
      slotEl.className = "slot";
      slotEl.dataset.slot = slot;
      slotEl.innerHTML = `<span class="slot-label">${slot}</span>`;

      const player = five[slot];
      if (player) {
        const chip = playerCard(player, mode, { draggable: true });
        if (player === selectedPlayer) chip.classList.add("selected");
        slotEl.appendChild(chip);
      }
      // Highlight where a selected court chip could legally move or swap.
      if (selectedPlayer && slot !== currentSlot && canPlace(selectedPlayer, slot, five)) {
        slotEl.classList.add("breathing");
      }
      // Highlight open spots a freshly tapped draft pick can be placed into.
      if (pendingDraftPlayer && !player && Engine.isEligible(pendingDraftPlayer, slot)) {
        slotEl.classList.add("breathing");
      }
      court.appendChild(slotEl);
    });
    updateCourtHint();
    renderPlayerDetail();
  }

  // Card under the court that reveals the highlighted player's full name, positions,
  // and stats. Accent-bordered in that player's team color. The .show class drives a
  // small fade/slide-in; clearing it lets the card animate back out.
  function renderPlayerDetail() {
    const panel = document.getElementById("player-detail");
    if (!panel) return;
    const player = selectedPlayer;
    if (!player) {
      panel.classList.remove("show");
      return;
    }
    const accent = draftAccents.get(player) || GOLD;
    panel.style.setProperty("--accent", accent);
    panel.innerHTML = `
      <div class="pd-name">${player.name}</div>
      <div class="pd-pos">${player.positions.join(" / ")}</div>
      <div class="pd-stats">${statLine(player.stats)}</div>`;
    // Force a reflow so re-selecting a different player re-triggers the animation.
    void panel.offsetWidth;
    panel.classList.add("show");
  }

  // Prompt under the court telling the user what to do with the active player.
  function updateCourtHint() {
    const hint = document.getElementById("court-hint");
    if (!hint) return;
    if (pendingDraftPlayer) {
      hint.textContent = `Tap a highlighted spot to place ${pendingDraftPlayer.name}.`;
    } else if (selectedPlayer) {
      hint.textContent = `Tap a highlighted spot to move ${selectedPlayer.name}, or tap them again to cancel.`;
    } else if (GameState.draftCount() > 0) {
      hint.textContent = "Tap a player on the court to move them.";
    } else {
      hint.textContent = "";
    }
  }

  // Tap-to-select on the court: select a chip, then tap a breathing slot to move.
  function bindDraftCourt() {
    document.getElementById("draft-court").addEventListener("click", (event) => {
      const chip = event.target.closest(".player");
      const slotEl = event.target.closest(".slot");
      const { five } = GameState.get();

      // A draft pick is waiting to be placed: tap an open eligible spot to drop it.
      if (pendingDraftPlayer) {
        if (slotEl && !five[slotEl.dataset.slot] && Engine.isEligible(pendingDraftPlayer, slotEl.dataset.slot)) {
          placeDraft(pendingDraftPlayer, slotEl.dataset.slot);
        }
        return; // any other tap is ignored until a spot is chosen
      }

      if (selectedPlayer) {
        const currentSlot = Object.keys(five).find((slot) => five[slot] === selectedPlayer);
        if (slotEl && slotEl.dataset.slot !== currentSlot && canPlace(selectedPlayer, slotEl.dataset.slot, five)) {
          const player = selectedPlayer;
          selectedPlayer = null;
          placeInFive(player, slotEl);
          return;
        }
        if (chip && chip.player && chip.player !== selectedPlayer) { selectChip(chip.player); return; }
        selectChip(null); // tapped own chip or empty space: deselect
        return;
      }
      if (chip && chip.player) selectChip(chip.player);
    });
  }

  function selectChip(player) {
    selectedPlayer = player;
    pendingDraftPlayer = null; // selecting a court chip cancels a pending pick
    renderDraftCourt();
  }

  // Project the drafted five's rating + regular-season record, recomputing only when the
  // lineup actually changes so the record number stays stable across re-renders.
  function refreshTeamProjection() {
    const { five } = GameState.get();
    const sig = SLOTS.map((s) => five[s] && five[s].name).join("|");
    if (GameState.get()._teamSig !== sig) {
      const rating = Engine.lineupScore(five);
      GameState.set({
        teamRating: rating,
        teamRecord: Engine.simulateSeasonRecord(rating, leagueAvgRating),
        _teamSig: sig,
      });
    }
    return GameState.get();
  }

  function updateDraftProgress() {
    const filled = GameState.draftCount();
    const { respins, spunTeam, mode } = GameState.get();
    const progress = document.getElementById("draft-progress");
    if (filled >= 5) {
      const s = refreshTeamProjection();
      const rec = `projected ${s.teamRecord.wins}-${s.teamRecord.losses}`;
      // Keep the numeric rating out of blind builds; the record is fun flavor either way.
      progress.innerHTML = mode === "ratings"
        ? `Your roster is set &middot; <b>RTG ${Math.round(s.teamRating)}</b> &middot; ${rec}`
        : `Your roster is set &middot; ${rec}`;
    } else {
      progress.textContent = `Pick ${filled + 1} of 5`;
    }
    const cont = document.getElementById("draft-continue");
    cont.classList.toggle("hidden", filled < 5);
    cont.textContent = GameState.get().gameMode === "gauntlet" ? "Enter Gauntlet →" : "Enter Playoffs →";

    const spinButton = document.getElementById("spin-button");
    spinButton.classList.toggle("hidden", filled >= 5);
    const mustPick = spunTeam && respins <= 0 && currentTeamHasDraftable();
    spinButton.disabled = mustPick || isSpinning;
    spinButton.textContent = mustPick ? "No re-spins left" : spunTeam ? "Re-spin" : "Spin";

    // Re-spins remaining sit directly under the spin button. Iron Five has none by design,
    // so it gets its own line rather than a bare "0".
    const respinsEl = document.getElementById("respins-left");
    respinsEl.textContent = filled >= 5 ? ""
      : GameState.get().mutator === "ironfive" ? "Iron Five - no re-spins"
      : `Re-spins left: ${respins}`;
  }

  // Does the currently spun team still have a player you can legally draft?
  function currentTeamHasDraftable() {
    const { spunTeam, five } = GameState.get();
    if (!spunTeam) return false;
    const taken = Object.values(five).map((p) => p.name);
    return spunTeam.roster.some((p) =>
      !taken.includes(p.name) && mutatorAllowsDraft(p, five) &&
      SLOTS.some((slot) => !five[slot] && Engine.isEligible(p, slot)));
  }

  function doSpin() {
    const state = GameState.get();
    // Ignore presses while a spin is mid-flight, so a fast double-click can't burn
    // an extra re-spin or start two reels at once.
    if (isSpinning || !currentTeams.length || GameState.draftCount() >= 5) return;

    pendingDraftPlayer = null; // a new team invalidates any armed pick

    // Spinning again while a draftable team is shown spends a re-spin.
    const isRespin = !!state.spunTeam && currentTeamHasDraftable();
    if (isRespin) {
      if (state.respins <= 0) return;
      GameState.set({ respins: state.respins - 1 });
    }

    const previousTeam = state.spunTeam;
    // Exclude teams you've already drafted from; fall back to the full list only if
    // every team has been used (can't happen in a 5-pick run, but keep it safe).
    let available = currentTeams.filter((team) => !usedTeams.has(team));
    // Era Lock: once the first pick fixes an era, only spin teams from that same decade.
    if (state.mutator === "eralock" && state.lockedEra) {
      const eraTeams = available.filter((team) => team.era === state.lockedEra);
      if (eraTeams.length) available = eraTeams;
    }
    const pool = available.length ? available : currentTeams;
    const reel = document.getElementById("spin-reel");
    const spinButton = document.getElementById("spin-button");
    isSpinning = true;
    spinButton.disabled = true;

    const reveal = () => {
      const team = Engine.spinTeam(pool, previousTeam);
      GameState.set({ spunTeam: team });
      reel.innerHTML = `${team.name}<span class="reel-year">${team.season}</span>`;
      reel.classList.remove("is-spinning", "reel-roll");
      reel.classList.add("settled");
      tintSpinStage(team);
      Sound.settle();
      isSpinning = false;
      renderPicks();
      updateDraftProgress();
    };

    if (prefersReducedMotion()) { reveal(); return; }

    reel.classList.remove("settled");
    reel.classList.add("is-spinning");
    // Slot-machine feel: the reel flicks through names fast at first, then DECELERATES into
    // the landing. The per-tick delay grows with the square of progress (an ease-out curve),
    // so early ticks are a blur and the last few drop into place. Self-scheduling setTimeout
    // (not a fixed setInterval) is what lets each tick have its own, longer, delay.
    const TICKS = 22;
    let i = 0;
    const step = () => {
      const random = pool[Math.floor(Math.random() * pool.length)];
      reel.textContent = random.name;
      reel.classList.remove("reel-roll"); void reel.offsetWidth; reel.classList.add("reel-roll"); // restart the slide
      Sound.tick(i / TICKS);
      if (i++ >= TICKS) { reveal(); return; }
      const progress = i / TICKS;
      setTimeout(step, 40 + 230 * progress * progress); // ease-out: 40ms -> ~270ms
    };
    step();
  }

  function renderPicks() {
    const { spunTeam, mode } = GameState.get();
    const controls = document.getElementById("pick-controls");

    if (!spunTeam || GameState.draftCount() >= 5) {
      controls.innerHTML = "";
      document.getElementById("draft-picks").innerHTML = "";
      return;
    }

    // Filters only make sense (and only have data to act on) in ratings mode.
    renderPickControls(mode === "ratings");
    renderPickRows();
  }

  // Position groups for the ratings-mode filter buttons.
  function inGroup(player, group) {
    if (group === "all") return true;
    if (group === "guard") return player.positions.some((p) => p === "PG" || p === "SG");
    if (group === "forward") return player.positions.some((p) => p === "SF" || p === "PF");
    if (group === "center") return player.positions.includes("C");
    return true;
  }

  function renderPickControls(show) {
    const controls = document.getElementById("pick-controls");
    if (!show) { controls.innerHTML = ""; return; }
    const groups = [["all", "All"], ["guard", "Guards"], ["forward", "Forwards"], ["center", "Centers"]];
    const sorts = [["overall", "OVR"], ["ppg", "PPG"], ["rpg", "RPG"], ["apg", "APG"], ["spg", "SPG"], ["bpg", "BPG"], ["name", "A-Z"]];
    controls.innerHTML = `
      <div class="pick-controls">
        <input id="pick-search" class="pick-search" type="search" placeholder="Search name"
          value="${pickFilter.q}" aria-label="Search players by name" />
        <div class="pick-chips" role="group" aria-label="Filter by position">
          ${groups.map(([id, label]) =>
            `<button type="button" class="pick-chip${pickFilter.group === id ? " active" : ""}" data-group="${id}">${label}</button>`).join("")}
        </div>
        <label class="pick-sort">Sort
          <select id="pick-sort" aria-label="Sort players">
            ${sorts.map(([id, label]) =>
              `<option value="${id}"${pickFilter.sort === id ? " selected" : ""}>${label}</option>`).join("")}
          </select>
        </label>
      </div>`;

    controls.querySelector("#pick-search").addEventListener("input", (event) => {
      pickFilter = { ...pickFilter, q: event.target.value };
      renderPickRows();
    });
    controls.querySelectorAll(".pick-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        pickFilter = { ...pickFilter, group: chip.dataset.group };
        renderPickControls(true);
        renderPickRows();
      });
    });
    controls.querySelector("#pick-sort").addEventListener("change", (event) => {
      pickFilter = { ...pickFilter, sort: event.target.value };
      renderPickRows();
    });
  }

  // Order the spun team's roster for display. Blind mode is always alphabetical
  // (no stats to rank on); ratings mode honors the filter/sort controls.
  function orderedRoster() {
    const { spunTeam, mode } = GameState.get();
    let roster = [...spunTeam.roster];
    if (mode !== "ratings") {
      return roster.sort((a, b) => a.name.localeCompare(b.name));
    }
    const q = pickFilter.q.trim().toLowerCase();
    roster = roster.filter((p) => inGroup(p, pickFilter.group) && p.name.toLowerCase().includes(q));
    const by = pickFilter.sort;
    roster.sort((a, b) => {
      if (by === "name") return a.name.localeCompare(b.name);
      if (by === "overall") return b.overall - a.overall;
      return (b.stats[by] || 0) - (a.stats[by] || 0);
    });
    return roster;
  }

  function renderPickRows() {
    const wrap = document.getElementById("draft-picks");
    const { mode, five } = GameState.get();
    wrap.innerHTML = "";

    const takenNames = Object.values(five).map((p) => p.name);
    const roster = orderedRoster();

    if (roster.length === 0) {
      wrap.innerHTML = '<p class="text-muted text-sm text-center">No players match.</p>';
      return;
    }

    roster.forEach((player) => {
      const alreadyOwned = takenNames.includes(player.name);
      const hasOpenSlot = SLOTS.some((slot) => !five[slot] && Engine.isEligible(player, slot));
      const allowed = mutatorAllowsDraft(player, five);
      const draftable = !alreadyOwned && hasOpenSlot && allowed;

      const row = document.createElement("button");
      row.type = "button";
      row.className = draftable ? "pick-row" : "pick-row locked";
      if (player === pendingDraftPlayer) row.classList.add("selected");
      row.innerHTML = pickRowHTML(player, mode);
      if (draftable) {
        row.addEventListener("click", () => selectPick(player));
      } else {
        row.disabled = true;
        row.title = alreadyOwned ? "Already on your roster"
          : !hasOpenSlot ? "No open spot for this position"
          : mutatorLockReason();
      }
      wrap.appendChild(row);
    });
  }

  function pickRowHTML(player, mode) {
    const ovr = mode === "ratings" ? `<span class="pick-ovr">${player.overall}</span>` : "";
    // Under Salary Cap, always surface each player's cost - it's a core part of the mode, so
    // it shows even in blind mode (the dev opted to reveal cost there over hiding it).
    const cost = GameState.get().mutator === "salarycap"
      ? `<span class="pick-cost">${playerCost(player)}</span>` : "";
    // Wrap the right-side tags so they right-align together no matter which are present
    // (overall in ratings, cost under Salary Cap, both, or neither in plain blind mode).
    const right = (ovr || cost) ? `<span class="pick-right">${ovr}${cost}</span>` : "";
    const head = `<div class="pick-head">
      <span class="pick-name">${player.name}</span>
      <span class="pick-pos">${player.positions.join("/")}</span>${right}</div>`;
    const stats = mode === "ratings" ? `<div class="pick-stats">${statLine(player.stats)}</div>` : "";
    return head + stats;
  }

  // Full stat line for the draft pick rows and the detail card. Counting stats first, then
  // defense (steals/blocks) and the shooting splits, so a user can judge the two most
  // overlooked rating areas - defense and efficiency - not just points and assists.
  function statLine(s) {
    const pct = (v) => (v * 100).toFixed(1);
    const parts = [
      `${s.ppg} PPG`, `${s.rpg} RPG`, `${s.apg} APG`,
      `${s.spg} SPG`, `${s.bpg} BPG`,
      `${pct(s.fg)} FG%`, `${pct(s.tp)} 3P%`, `${pct(s.ft)} FT%`,
    ];
    return parts.join(" · ");
  }

  // Tap a draftable pick: arm it and light up the spots it can fill. The player is
  // not placed until the user taps a court slot (see placeDraft).
  function selectPick(player) {
    pendingDraftPlayer = pendingDraftPlayer === player ? null : player;
    selectedPlayer = null;
    renderDraftCourt();
    renderPicks();
  }

  function placeDraft(player, slot) {
    const { five: current, spunTeam, mutator, lockedEra } = GameState.get();
    const five = { ...current };
    if (five[slot] || !Engine.isEligible(player, slot) || !mutatorAllowsDraft(player, current)) return;
    five[slot] = player;
    // Era Lock: the very first pick fixes the decade every later spin is filtered to.
    const nextLockedEra = (mutator === "eralock" && !lockedEra && spunTeam) ? spunTeam.era : lockedEra;
    if (spunTeam) {
      usedTeams.add(spunTeam);                           // this team can't be spun again
      draftAccents.set(player, teamColor(spunTeam.name)); // chip keeps the team's color
    }
    GameState.set({ five, spunTeam: null, lockedEra: nextLockedEra });
    pendingDraftPlayer = null;
    selectedPlayer = null;
    renderDraft();
  }

  // Rearrange the five by dragging a chip between eligible slots.
  function placeInFive(player, slotEl) {
    if (!slotEl) return;
    const target = slotEl.dataset.slot;
    const five = { ...GameState.get().five };
    // Block illegal moves: an occupied target only accepts a swap when the
    // displaced player can play the mover's old slot. Otherwise do nothing.
    if (!canPlace(player, target, five)) return;

    const sourceSlot = Object.keys(five).find((slot) => five[slot] === player);
    const displaced = five[target];

    five[target] = player;
    if (sourceSlot && sourceSlot !== target) {
      if (displaced) five[sourceSlot] = displaced; // guaranteed eligible by canPlace
      else delete five[sourceSlot];
    }
    GameState.set({ five });
    renderDraft();
  }

  // ---- Run (tournament / gauntlet) ----
  // Gauntlet ladder: the ten greatest teams of all time, ordered weakest -> strongest, so
  // round 1 is the softest of the legends and round 10 is the boss. This is an editorial
  // BLENDED ranking (legacy + record + engine rating), not a pure sort - a raw rating sort
  // would crown the '85-86 Celtics and bury the '16-17 Warriors mid-pack. Each entry is
  // matched to a real team in the pool by exact name + season.
  const GAUNTLET_LADDER = [
    ["Los Angeles Lakers", "2000-01"],   // Shaq + Kobe peak; softest opener of the greats
    ["Miami Heat", "2012-13"],           // LeBron three-peat core, 27-game streak
    ["Los Angeles Lakers", "1986-87"],   // Showtime, Magic
    ["Los Angeles Lakers", "1971-72"],   // 33-game win streak
    ["Philadelphia 76ers", "1966-67"],   // Wilt, 68-13
    ["Boston Celtics", "2023-24"],       // highest-rated modern champion
    ["Oklahoma City Thunder", "2024-25"],// modern juggernaut, best record in the pool
    ["Boston Celtics", "1985-86"],       // Bird; the literal "best ever" candidate
    ["Chicago Bulls", "1995-96"],        // 72-10, Jordan - the record the boss broke
    ["Golden State Warriors", "2016-17"],// FINAL BOSS - KD superteam, 16-1 playoff run
  ];
  let leagueAvgRating = 0; // baseline a drafted team's regular-season record is sim'd against

  const teamRatingOf = (roster) => Engine.lineupScore(Engine.autoFillLineup(roster, SLOTS));

  function computeLeagueAvg() {
    if (!currentTeams.length) return 0;
    const sum = currentTeams.reduce((total, team) => total + teamRatingOf(team.roster), 0);
    return sum / currentTeams.length;
  }

  // The five's rating, plus a one-line record summary, for the draft-screen reveal.
  function yourTeamRating() {
    return Engine.lineupScore(GameState.get().five);
  }

  // Higher seed (better record, rating as tiebreak) holds home court for a series.
  function youHoldHomeCourt(t) {
    const opp = t.oppMeta[t.round - 1];
    if (!opp) return true;
    if (t.yourRecord.wins !== opp.record.wins) return t.yourRecord.wins > opp.record.wins;
    return t.yourRating >= opp.rating;
  }

  function startRun() {
    const { gameMode } = GameState.get();
    const t = GameState.get().tournament;
    if (gameMode === "gauntlet") {
      t.bracket = buildGauntlet();
      t.rounds = t.bracket.length;   // 10 all-time greats
      t.winsNeeded = 1;              // single game per round
    } else {
      t.bracket = buildClassicBracket();
      t.rounds = ROUNDS;             // 4 playoff rounds
      t.winsNeeded = WINS_PER_SERIES; // best of 7
    }
    // Rate the drafted five and project a regular-season record (reusing the one shown
    // on the draft screen if it is for this exact roster), then do the same for every
    // opponent. Records drive playoff seeding / home court below.
    t.yourRating = yourTeamRating();
    t.yourRecord = (GameState.get().teamRecord) || Engine.simulateSeasonRecord(t.yourRating, leagueAvgRating);
    t.oppMeta = t.bracket.map((team) => {
      const rating = teamRatingOf(team.roster);
      // Prefer the team's real historical record (modern eras carry it); fall back to a
      // simulated one for the older curated eras that have no recorded W-L.
      const record = team.record || Engine.simulateSeasonRecord(rating, leagueAvgRating);
      return { rating, record };
    });
    // Gauntlet difficulty is computed from the opponents' actual ratings so the curve still
    // climbs despite the narrative ordering (classic uses the flat BASE/STEP ramp instead).
    t.gauntletBonus = gameMode === "gauntlet"
      ? gauntletBonuses(t.oppMeta.map((m) => m.rating))
      : null;
    t.round = 1;
    resetSeries(t);
    showScreen("tournament");
  }

  // A team's seeding strength on the shared rating scale, so the all-time pool seeds by
  // true strength. Teams with a real record (modern eras) are placed by win percentage,
  // mapped around the league-average rating; older curated teams use their lineup rating.
  // Both land in the same band, so a 60-win team and a stacked legend sort sensibly.
  const RECORD_RATING_SPREAD = 33; // a .500 team sits at league average; .800 ~ +10
  function seedStrength(team) {
    if (team.record) {
      const games = team.record.wins + team.record.losses;
      const winPct = games ? team.record.wins / games : 0.5;
      return leagueAvgRating + RECORD_RATING_SPREAD * (winPct - 0.5);
    }
    return Engine.lineupScore(Engine.autoFillLineup(team.roster, SLOTS));
  }

  // Classic: seed 4 distinct opponents weakest-to-strongest, so round 1 is a genuine
  // cupcake (worst record) and the Finals opponent is a real contender.
  function buildClassicBracket() {
    const rated = currentTeams
      .map((team) => ({ team, s: seedStrength(team) }))
      .sort((a, b) => a.s - b.s);
    const n = rated.length;
    const picks = [];
    for (let r = 0; r < ROUNDS; r++) {
      const lo = Math.floor((n * r) / ROUNDS);
      const hi = Math.max(lo + 1, Math.floor((n * (r + 1)) / ROUNDS));
      const segment = rated.slice(lo, hi);
      picks.push(segment[Math.floor(Math.random() * segment.length)].team);
    }
    return picks;
  }

  // Gauntlet: the curated all-time ladder (GAUNTLET_LADDER) resolved against the live pool,
  // weakest -> strongest. Any entry not found in the data is skipped so the run still builds.
  function buildGauntlet() {
    return GAUNTLET_LADDER
      .map(([name, season]) => currentTeams.find((team) => team.name === name && team.season === season))
      .filter(Boolean);
  }

  // Per-round rating bonus for the gauntlet. Each round targets an EFFECTIVE strength on a
  // straight line from GAUNTLET_OPENER_EFF (round 1) to GAUNTLET_BOSS_EFF (final round), and
  // the bonus is the gap between that target and the team's real rating. The line rises and
  // always clears the raw ratings here, so effective strength climbs every round regardless
  // of the narrative ordering. Bonuses are clamped at 0 so a legend never plays below its
  // real strength (a no-op given the targets, but safe if the ladder or ratings change).
  function gauntletBonuses(ratings) {
    const last = ratings.length - 1;
    return ratings.map((rating, i) => {
      const target = last === 0
        ? GAUNTLET_BOSS_EFF
        : GAUNTLET_OPENER_EFF + (GAUNTLET_BOSS_EFF - GAUNTLET_OPENER_EFF) * (i / last);
      return Math.max(0, target - rating);
    });
  }

  function resetSeries(t) {
    t.yourWins = 0;
    t.oppWins = 0;
    t.games = [];
  }

  function roundLabel(t, gameMode) {
    if (gameMode === "gauntlet") return `Round ${t.round} of ${t.rounds}`;
    return ROUND_NAMES[t.round - 1] || `Round ${t.round}`;
  }

  function renderRound() {
    const { tournament: t, gameMode } = GameState.get();
    t.opponent = t.bracket[t.round - 1];
    const format = gameMode === "gauntlet" ? "single game" : "best of 7";
    document.getElementById("tournament-status").textContent =
      `${roundLabel(t, gameMode)} - ${format} - overall record ${t.totalWins}-${t.totalLosses}`;
    renderMatchup(t.opponent);
    renderAnalytics(t);
    renderSeriesStatus(t);
    document.getElementById("game-log").innerHTML = "";
    document.getElementById("box-tabs").innerHTML = ""; // the game picker only appears at series end
    // Mount the box score at zero up front so the area is reserved (no jump on play).
    const oppLineup = Engine.autoFillLineup(t.opponent.roster, SLOTS);
    const yourLines = SLOTS.map((s) => GameState.get().five[s]).filter(Boolean);
    const oppLines = SLOTS.map((s) => oppLineup[s]).filter(Boolean);
    buildStatsheet(yourLines, oppLines, t.opponent.name, { title: `${gameLabel(1)} box score` });
    document.getElementById("scoreboard").innerHTML = '<div class="sb-label">Press play to tip off</div>';
    const advance = document.getElementById("series-advance");
    advance.classList.add("hidden");
    advance.textContent = "Next Round →";
    document.getElementById("play-game").classList.remove("hidden");
    // Simulate-round only makes sense for a multi-game series, i.e. classic.
    document.getElementById("sim-round").classList.toggle("hidden", gameMode !== "classic");
    updatePlayLabel();
    refreshPlayControls();
  }

  function renderMatchup(opponent) {
    const { five, mode, gameMode, tournament: t } = GameState.get();
    const oppColor = teamColor(opponent.name);
    const matchup = document.getElementById("matchup");
    // Record (and rating, in ratings mode) for each side. The better record holds home
    // court, marked with a badge so the user sees who has the edge before tip-off.
    const oppInfo = t.oppMeta && t.oppMeta[t.round - 1];
    const showRating = mode === "ratings";
    const teamMeta = (record, rating) => {
      const rec = record ? `${record.wins}-${record.losses}` : "";
      const ovr = showRating && rating ? ` <span class="meta-rating">RTG ${Math.round(rating)}</span>` : "";
      return `<div class="matchup-meta">${rec}${ovr}</div>`;
    };
    const homeBadge = '<span class="home-badge">Home court</span>';
    // The gauntlet is played on neutral courts, so neither side shows a home-court badge.
    const isGauntlet = gameMode === "gauntlet";
    const youHome = !isGauntlet && youHoldHomeCourt(t);
    const oppHome = !isGauntlet && !youHome;
    matchup.innerHTML = `
      <div class="matchup-side" style="--side:${GOLD}">
        <h3 class="font-display font-bold text-lg">Your Roster ${youHome ? homeBadge : ""}</h3>
        ${teamMeta(t.yourRecord, t.yourRating)}
        <div class="mini-five" id="your-five"></div>
      </div>
      <div class="vs">vs</div>
      <div class="matchup-side" style="--side:${oppColor}">
        <h3 class="font-display font-bold text-lg" style="color:${oppColor}">${opponent.name} <span class="opp-year">${opponent.season}</span> ${oppHome ? homeBadge : ""}</h3>
        ${teamMeta(oppInfo && oppInfo.record, oppInfo && oppInfo.rating)}
        <div class="mini-five" id="opp-five"></div>
      </div>`;

    const oppLineup = Engine.autoFillLineup(opponent.roster, SLOTS);
    SLOTS.forEach((slot) => {
      if (five[slot]) document.getElementById("your-five").appendChild(playerMini(slot, five[slot], mode, GOLD));
      if (oppLineup[slot]) document.getElementById("opp-five").appendChild(playerMini(slot, oppLineup[slot], mode, oppColor, true));
    });
  }

  // Descriptive analytics for your built five: its own aggregates plus this round's matchup
  // edge. Purely descriptive - no targets or "what you need" benchmarks. Ratings mode only;
  // in Blind Build it stays hidden, since it would leak the ratings the mode hides.
  function teamAnalytics(five) {
    const players = SLOTS.map((s) => five[s]).filter(Boolean);
    const n = players.length || 1;
    const sum = (sel) => players.reduce((acc, p) => acc + sel(p), 0);
    return {
      overall: sum((p) => p.overall) / n,
      ppg: sum((p) => p.stats.ppg),                       // team totals: the five sum to a team line
      rpg: sum((p) => p.stats.rpg),
      apg: sum((p) => p.stats.apg),
      stocks: sum((p) => p.stats.spg + p.stats.bpg),       // steals + blocks, the "stocks" stat
      ts: sum((p) => Engine.shootingScore(p.stats)) / n,   // avg shooting efficiency proxy (~0.45-0.62)
    };
  }

  // Map a rating edge (your rating minus the opponent's effective rating for this round) to a
  // plain-language tag and an accent that runs green (favored) -> gold (even) -> red (underdog).
  function edgeDescriptor(edge) {
    if (edge >= 8) return { label: "Heavy favorite", accent: "#34d399" };
    if (edge >= 3) return { label: "Favored", accent: "#a3e635" };
    if (edge > -3) return { label: "Toss-up", accent: "#fbbf24" };
    if (edge > -8) return { label: "Underdog", accent: "#fb923c" };
    return { label: "Long shot", accent: "#fb7185" };
  }

  function renderAnalytics(t) {
    const el = document.getElementById("analytics");
    if (!el) return;
    const { five, mode, gameMode } = GameState.get();
    if (mode !== "ratings") { el.innerHTML = ""; el.classList.add("hidden"); return; }

    const a = teamAnalytics(five);
    // Opponent's effective rating = its lineup rating plus this round's difficulty bump (the
    // gauntlet's per-round buff or the classic linear ramp), matching what the sim actually uses.
    const oppRating = (t.oppMeta && t.oppMeta[t.round - 1] && t.oppMeta[t.round - 1].rating) || 0;
    const roundBonus = gameMode === "gauntlet"
      ? (t.gauntletBonus[t.round - 1] ?? 0)
      : classicRoundBonus(t.round);
    const edge = t.yourRating - (oppRating + roundBonus);
    const { label, accent } = edgeDescriptor(edge);
    const signed = `${edge >= 0 ? "+" : ""}${edge.toFixed(1)}`;

    // A bar shows where each aggregate sits across a plausible all-time range - a quick read on
    // the team's shape, not a target. Each metric maps its value into [lo, hi] then clamps 0..1.
    const fill = (v, lo, hi) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
    const metric = (val, key, f) =>
      `<div class="an-metric"><div class="an-val">${val}</div><div class="an-key">${key}</div>
       <div class="an-bar"><span style="width:${Math.round(f * 100)}%"></span></div></div>`;
    el.innerHTML = `
      <div class="an-head">
        <span class="an-title">Team Profile</span>
        <span class="an-edge" style="--accent:${accent}" title="Your rating vs this round's opponent, including the round's difficulty bump">${signed} edge &middot; ${label}</span>
      </div>
      <div class="an-metrics">
        ${metric(Math.round(t.yourRating), "RTG", fill(t.yourRating, 70, 108))}
        ${metric(Math.round(a.overall), "AVG OVR", fill(a.overall, 68, 99))}
        ${metric(a.ppg.toFixed(1), "PPG", fill(a.ppg, 95, 135))}
        ${metric(a.rpg.toFixed(1), "RPG", fill(a.rpg, 28, 55))}
        ${metric(a.apg.toFixed(1), "APG", fill(a.apg, 18, 38))}
        ${metric(a.stocks.toFixed(1), "STOCKS", fill(a.stocks, 5, 15))}
        ${metric(Math.round(a.ts * 100), "TS%", fill(a.ts, 0.48, 0.62))}
      </div>`;
    el.classList.remove("hidden");
  }

  function renderSeriesStatus(t) {
    // A gauntlet round is one game, so a "0 - 0" series score is just noise.
    const isGauntlet = GameState.get().gameMode === "gauntlet";
    document.getElementById("series-status").textContent = isGauntlet ? "" : `${t.yourWins} - ${t.oppWins}`;

    // Momentum banner: spell out the series situation so the stakes are obvious. It is easy
    // to fall down 1-3 without noticing the score line; this calls it out in plain words and
    // color. Classic only - a single gauntlet game has no series arc, so the banner is hidden.
    const banner = document.getElementById("series-momentum");
    if (!banner) return;
    if (isGauntlet) { banner.hidden = true; banner.textContent = ""; return; }
    banner.hidden = false;
    const m = seriesMomentum(t);
    banner.className = `series-momentum mood-${m.mood}`;
    banner.textContent = m.text;
  }

  // Describe a best-of-seven's current state as a short phrase plus a mood that drives its
  // color (good = gold, bad = orange, critical = red alert, neutral = muted). Keyed off the
  // win counts so a clinching game shows the final outcome even before the series formally
  // ends. winsNeeded is 4 in classic, so "facing elimination" is one loss from out.
  function seriesMomentum(t) {
    const need = t.winsNeeded;
    const y = t.yourWins, o = t.oppWins;
    const score = `${y}-${o}`;
    if (y >= need) return { text: `Series won ${score}`, mood: "good" };
    if (o >= need) return { text: `Series lost ${score}`, mood: "neutral" };

    const youFaceElim = o === need - 1; // one more opponent win ends your run
    const oppFaceElim = y === need - 1; // one more of your wins takes the round
    if (youFaceElim && oppFaceElim) return { text: `Game ${need * 2 - 1} - winner takes all`, mood: "critical" };
    if (youFaceElim) return { text: `Down ${score}, facing elimination`, mood: "critical" };
    if (oppFaceElim) return { text: `Up ${score}, closeout game`, mood: "good" };

    if (y === o) return y === 0
      ? { text: `Best of ${need * 2 - 1} - first to ${need}`, mood: "neutral" }
      : { text: `Series tied ${score}`, mood: "neutral" };
    return y > o
      ? { text: `Series lead ${score}`, mood: "good" }
      : { text: `Series deficit ${score}`, mood: "bad" };
  }

  function updatePlayLabel() {
    const t = GameState.get().tournament;
    const label = GameState.get().gameMode === "gauntlet" ? "Tip Off" : `Play Game ${t.games.length + 1}`;
    document.getElementById("play-game").textContent = label;
    // Speed sits under the play button, so it no longer decenters it - keep it
    // available for every game while the series is still being played.
    showSpeedControl(true);
  }

  function showSpeedControl(visible) {
    document.getElementById("speed-select").parentElement.classList.toggle("hidden", !visible);
  }

  function refreshPlayControls() {
    document.getElementById("play-game").disabled = animating;
    document.getElementById("sim-round").disabled = animating;
  }

  // Simulate the next game of the current series and attach its box scores. Pure
  // result - no DOM, no animation - so both the watched and the instant paths use it.
  function createGame() {
    const state = GameState.get();
    const t = state.tournament;
    const oppLineup = Engine.autoFillLineup(t.opponent.roster, SLOTS);
    const yourRating = Engine.lineupScore(state.five);
    const oppRating = Engine.lineupScore(oppLineup);
    // The gauntlet is played on neutral courts (null), so no home/away edge. Classic home
    // court follows the 2-2-1-1-1 pattern for the HIGHER SEED; if the opponent out-seeded
    // you, the pattern flips and you open on the road.
    const seedPattern = [true, true, false, false, true, false, true][t.games.length] ?? true;
    const youAreHome = state.gameMode === "gauntlet"
      ? null
      : (youHoldHomeCourt(t) ? seedPattern : !seedPattern);
    // Gauntlet uses the precomputed per-round bonus (gauntletBonuses) that flattens the
    // narrative ordering into a rising difficulty curve; classic uses the linear ramp.
    const oppBonus = state.gameMode === "gauntlet"
      ? (t.gauntletBonus[t.round - 1] ?? 0)
      : classicRoundBonus(t.round);
    const game = Engine.simulateGame(yourRating, oppRating, youAreHome, oppBonus);

    // Per-player box scores that add up to each side's final points, ordered PG -> C
    // so the rows line up with the matchup card and never reshuffle on count-up. The
    // hot hand carried from the previous game (if any) tilts your box toward that player.
    game.yourBox = orderBoxBySlot(Engine.simulateBoxScore(Object.values(state.five), game.yourPoints, t.hotHand || null), state.five);
    game.oppBox = orderBoxBySlot(Engine.simulateBoxScore(Object.values(oppLineup), game.oppPoints), oppLineup);
    // Decide who carries a hot hand into the NEXT game (this game's eruption, if any).
    t.hotHand = nextHotHand(game.yourBox);
    game.oppName = t.opponent.name;
    game.youAreHome = youAreHome; // kept so the box score can tag the venue
    currentGameNo = t.games.length + 1;
    game.no = currentGameNo; // kept so finished games can be relabeled and re-viewed
    return game;
  }

  function playGame() {
    if (animating) return;
    const t = GameState.get().tournament;
    if (t.status !== "playing") return;

    const game = createGame();
    animating = true;
    // Mount the box score at zero so its rows stay put, then count the numbers up
    // alongside the score (no show/hide layout shift between games).
    const boxAnim = buildStatsheet(game.yourBox, game.oppBox, game.oppName, {
      title: `${gameLabel(currentGameNo)} box score`, highlight: true,
    });
    refreshPlayControls();
    animateCountUp(game, boxAnim, () => commitGame(game));
  }

  // Classic only: blow through the rest of the current best-of-seven at once and land
  // on the series-end state (final box + game picker). Skips the count-up entirely.
  function simulateRound() {
    if (animating) return;
    const t = GameState.get().tournament;
    if (t.status !== "playing") return;
    while (t.yourWins < t.winsNeeded && t.oppWins < t.winsNeeded) {
      commitGame(createGame()); // commitGame ends the series once a side clinches
    }
  }

  function commitGame(game) {
    const t = GameState.get().tournament;
    t.games.push(game);
    t.allGames.push(game); // run-wide log; gauntlet MVP averages across every decade
    if (game.youWon) { t.yourWins += 1; t.totalWins += 1; }
    else { t.oppWins += 1; t.totalLosses += 1; }

    logGame(currentGameNo, game);
    renderSeriesStatus(t);
    animating = false;

    if (t.yourWins >= t.winsNeeded) return endSeries(true);
    if (t.oppWins >= t.winsNeeded) return endSeries(false);

    updatePlayLabel();
    refreshPlayControls();
  }

  function logGame(number, game) {
    const row = document.createElement("div");
    row.className = `game-row ${game.youWon ? "win" : "loss"}`;
    row.innerHTML = `<span>${gameLabel(number)}</span>
      <span>${game.yourPoints} - ${game.oppPoints}</span>
      <span>${game.youWon ? "W" : "L"}</span>`;
    document.getElementById("game-log").appendChild(row);
  }

  // A series ended. We never jump straight to the result screen - the final score and
  // box score stay on view and a button takes the user onward when they're ready.
  function endSeries(youWon) {
    const t = GameState.get().tournament;
    const runOver = !youWon || t.round >= t.rounds;
    t.status = youWon ? (runOver ? "won" : "playing") : "eliminated";

    // Log the finished series so end-of-run achievements can read it (sweep, Game 7,
    // comeback). seq is the ordered win/loss of each game in the series.
    (t.seriesLog || (t.seriesLog = [])).push({
      round: t.round,
      result: youWon ? "won" : "lost",
      yourWins: t.yourWins,
      oppWins: t.oppWins,
      seq: t.games.map((g) => g.youWon),
    });

    document.getElementById("play-game").classList.add("hidden");
    document.getElementById("sim-round").classList.add("hidden");
    showSpeedControl(false);
    const advance = document.getElementById("series-advance");
    advance.textContent = runOver ? "See Result →" : "Next Round →";
    advance.classList.remove("hidden");

    // Let the user flip back through any game in the series and read its box score.
    renderBoxTabs(t.games);
    if (t.games.length) showGameBox(t.games, t.games.length - 1);
  }

  // A row of buttons (one per game) shown at series end. With a single game there is
  // nothing to pick, so it stays empty. Clicking a tab shows that game's box score.
  function renderBoxTabs(games) {
    const wrap = document.getElementById("box-tabs");
    if (games.length < 2) { wrap.innerHTML = ""; return; }
    wrap.innerHTML = games
      .map((g, i) => `<button type="button" class="box-tab" data-box="${i}">${gameLabel(g.no)}</button>`)
      .join("");
    wrap.querySelectorAll(".box-tab").forEach((btn, i) =>
      btn.addEventListener("click", () => showGameBox(games, i)));
  }

  // Rebuild the box score for a finished game (full final numbers, no count-up) and
  // mark its tab active.
  function showGameBox(games, i) {
    const g = games[i];
    const anim = buildStatsheet(g.yourBox, g.oppBox, g.oppName, {
      title: `${gameLabel(g.no)} box score`, highlight: true,
    });
    paintStatsheet(anim, 1);
    // Keep the scoreboard above in step with the game being viewed.
    document.getElementById("scoreboard").innerHTML = scoreboardHTML(g.no, g.yourPoints, g.oppPoints, g, true);
    document.querySelectorAll("#box-tabs .box-tab").forEach((btn, idx) =>
      btn.classList.toggle("active", idx === i));
  }

  function advanceRound() {
    const t = GameState.get().tournament;
    if (t.status === "won" || t.status === "eliminated") { showScreen("result"); return; }
    t.round += 1;
    resetSeries(t);
    showScreen("tournament");
  }

  // A short confetti burst over the result screen on a championship. Pure DOM: spawn N
  // colored pieces with randomized position/timing/drift, let CSS animate the fall, then
  // remove the whole layer. No canvas, no library. Skipped under reduced-motion.
  const CONFETTI_COLORS = ["#fbbf24", "#fb7185", "#34d399", "#38bdf8", "#a78bfa", "#f97316"];
  function launchConfetti(amount) {
    if (prefersReducedMotion()) return;
    const layer = document.createElement("div");
    layer.className = "confetti-layer";
    for (let i = 0; i < amount; i++) {
      const piece = document.createElement("span");
      piece.className = "confetti-piece";
      const drift = (Math.random() * 2 - 1) * 90; // horizontal sway as it falls, px
      piece.style.cssText =
        `left:${Math.random() * 100}%;` +
        `background:${CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]};` +
        `animation-delay:${(Math.random() * 0.7).toFixed(2)}s;` +
        `animation-duration:${(2.4 + Math.random() * 1.8).toFixed(2)}s;` +
        `--drift:${drift.toFixed(0)}px;--rot:${Math.floor(Math.random() * 720)}deg`;
      layer.appendChild(piece);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 5500); // outlast the longest piece (delay + duration)
  }

  // ---- Result ----
  function renderResult() {
    const { tournament: t, five, mode, gameMode } = GameState.get();
    const isGauntlet = gameMode === "gauntlet";
    const perfect = t.status === "won" && t.totalLosses === 0;
    const perfectMark = isGauntlet ? "10-0" : "16-0";

    const title = document.getElementById("result-title");
    title.textContent = perfect ? perfectMark : t.status === "won" ? "Champions" : "Eliminated";
    title.classList.toggle("text-gold", t.status === "won");

    // On a perfect run the big title already reads "10-0" / "16-0", so the record line
    // would just repeat it - hide it. Otherwise it shows the real record (e.g. 14 - 2).
    const recordEl = document.getElementById("result-record");
    recordEl.textContent = perfect ? "" : `${t.totalWins} - ${t.totalLosses}`;
    recordEl.classList.toggle("hidden", perfect);
    document.getElementById("result-sub").textContent = perfect
      ? (isGauntlet
          ? "A perfect gauntlet. Ten of the greatest teams ever, not one loss."
          : "A perfect playoff run. Sixteen wins, zero losses. The dream.")
      : t.status === "won"
        ? "Champions, but not perfect. Can you run it back without a loss?"
        : isGauntlet
          ? "The gauntlet ends here. Build a stronger roster and try again."
          : "Knocked out. Build a stronger roster and try again.";

    renderFinalsMVP(t);
    renderResultActions(t, isGauntlet, perfect);
    recordAttempt(t, gameMode, five, perfect);
    renderResultTeam(t, five);
    renderResultSummary(t);
    // Celebrate a title - a fuller burst for a flawless run.
    if (t.status === "won") launchConfetti(perfect ? 170 : 100);
  }

  // Box-score table of your five at run's end: position, overall, and each starter's
  // per-game averages across the ENTIRE run (t.allGames). Shown win or lose. Overalls
  // are revealed here even in blind mode - the run is over, so it is a recap, not a hint.
  function renderResultTeam(t, five) {
    const recap = document.getElementById("result-five");
    const games = t.allGames || [];
    const totals = {};
    games.forEach((g) => (g.yourBox || []).forEach((l) => {
      const s = totals[l.name] || (totals[l.name] = { pts: 0, reb: 0, ast: 0 });
      s.pts += l.pts; s.reb += l.reb; s.ast += l.ast;
    }));
    const n = games.length || 1;
    const rows = SLOTS.map((slot) => {
      const p = five[slot];
      if (!p) return "";
      const s = totals[p.name] || { pts: 0, reb: 0, ast: 0 };
      return `<tr>
        <td class="ss-name"><span class="ss-av" style="background:${GOLD}">${slot}</span>${p.name}</td>
        <td>${p.overall}</td>
        <td>${(s.pts / n).toFixed(1)}</td>
        <td>${(s.reb / n).toFixed(1)}</td>
        <td>${(s.ast / n).toFixed(1)}</td>
      </tr>`;
    }).join("");
    recap.innerHTML = `<div class="ss-tables"><table class="ss-table">
      <thead><tr><th class="ss-team" style="color:${GOLD}">Roster Averages</th>
        <th>OVR</th><th>PPG</th><th>RPG</th><th>APG</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }

  // Post-run recap below the roster table: a few headline numbers, a series-by-series
  // breakdown, and any badges unlocked this run. Reads only the box scores already kept on
  // t.allGames - the run is over, so revealing everything is a recap, not a hint.
  // (Named distinctly from the Records-overlay renderRunSummary to avoid shadowing it.)
  function renderResultSummary(t) {
    const wrap = document.getElementById("result-summary");
    if (!wrap) return;
    const games = t.allGames || [];
    if (!games.length) { wrap.innerHTML = ""; return; }

    const s = runSummaryStats(t);
    const tile = (val, key) => `<div class="stat-tile"><span class="stat-val">${val}</span><span class="stat-key">${key}</span></div>`;
    const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
    const tiles = [
      tile(signed(s.pointDiff), "Point Differential"),
      s.biggestWin ? tile(`+${s.biggestWin.margin}`, `Biggest Win &middot; ${s.biggestWin.opp}`) : "",
      s.closestWin ? tile(`+${s.closestWin.margin}`, `Closest Win &middot; ${s.closestWin.opp}`) : "",
      s.topScorer ? tile(s.topScorer.ppg.toFixed(1), `Top Scorer &middot; ${s.topScorer.name}`) : "",
    ].join("");

    const series = s.series.map((sr) => `<li class="series-row ${sr.won ? "won" : "lost"}">
      <span class="sr-rd">${sr.label}</span>
      <span class="sr-opp">${sr.opp}</span>
      <span class="sr-score">${sr.score}</span>
      <span class="sr-margin">${signed(sr.margin)}</span></li>`).join("");

    const badges = (t._earnedBadges || []);
    const badgeHTML = badges.length
      ? `<div class="run-badges"><span class="run-badges-label">Unlocked this run</span>${
          badges.map((b) => `<span class="run-badge">${b.name}</span>`).join("")}</div>`
      : "";

    wrap.innerHTML = `<h3 class="summary-head">Run Summary</h3>
      <div class="stat-tiles">${tiles}</div>
      <ul class="series-list">${series}</ul>${badgeHTML}`;
  }

  // Crunch t.allGames into the recap numbers. Series are grouped by opponent name (each
  // round faces a distinct team, so the name is a stable per-series key) in bracket order.
  function runSummaryStats(t) {
    const games = t.allGames || [];
    const seasonByName = {};
    (t.bracket || []).forEach((tm) => { seasonByName[tm.name] = tm.season; });
    const label = (name) => seasonByName[name] ? `'${String(seasonByName[name]).slice(-2)} ${name}` : name;

    let pointDiff = 0;
    let biggestWin = null, closestWin = null;
    const scorers = {};
    const order = [];
    const byOpp = {};

    games.forEach((g) => {
      const margin = g.yourPoints - g.oppPoints;
      pointDiff += margin;
      if (g.youWon) {
        if (!biggestWin || margin > biggestWin.margin) biggestWin = { margin, opp: label(g.oppName) };
        if (!closestWin || margin < closestWin.margin) closestWin = { margin, opp: label(g.oppName) };
      }
      (g.yourBox || []).forEach((l) => { scorers[l.name] = (scorers[l.name] || 0) + l.pts; });
      if (!(g.oppName in byOpp)) { byOpp[g.oppName] = { wins: 0, losses: 0, margin: 0 }; order.push(g.oppName); }
      const grp = byOpp[g.oppName];
      if (g.youWon) grp.wins += 1; else grp.losses += 1;
      grp.margin += margin;
    });

    let topScorer = null;
    Object.entries(scorers).forEach(([name, pts]) => {
      if (!topScorer || pts > topScorer.pts) topScorer = { name, pts };
    });
    if (topScorer) topScorer.ppg = topScorer.pts / games.length;

    const series = order.map((name, i) => {
      const grp = byOpp[name];
      return { label: `Round ${i + 1}`, opp: label(name), score: `${grp.wins}-${grp.losses}`,
        margin: grp.margin, won: grp.wins > grp.losses };
    });

    return { pointDiff, biggestWin, closestWin, topScorer, series };
  }

  // After a classic championship, offer to take the very same five into the gauntlet.
  // The button copy leans on whether the run was a flawless 16-0 or just a title.
  function renderResultActions(t, isGauntlet, perfect) {
    const retry = document.getElementById("result-retry");
    const offerGauntlet = t.status === "won" && !isGauntlet;
    retry.classList.toggle("hidden", !offerGauntlet);
    if (offerGauntlet) {
      retry.textContent = perfect
        ? "Take this team to the Gauntlet →"
        : "Redeem this team in the Gauntlet →";
    }
  }

  function retryAsGauntlet() {
    GameState.set({ gameMode: "gauntlet", tournament: GameState.freshTournament() });
    startRun(); // keeps the existing five; builds the gauntlet bracket from currentTeams
  }

  // Save this finished run to local history (once). The label mirrors the headline.
  function recordAttempt(t, gameMode, five, perfect) {
    if (t._recorded) return;
    t._recorded = true;
    const label = perfect
      ? (gameMode === "gauntlet" ? "Perfect 10-0" : "Perfect 16-0")
      : t.status === "won" ? "Champions" : "Eliminated";
    // Per-round outcome: rounds before the one we ended on were won; the final round we
    // played is a win only if the whole run was won; anything after was never reached.
    const lastPlayed = t.round;
    const bracket = t.bracket.map((team, i) => {
      const round = i + 1;
      const result = round < lastPlayed ? "won"
        : round === lastPlayed ? (t.status === "won" ? "won" : "lost")
        : "unplayed";
      const rec = t.oppMeta[i] && t.oppMeta[i].record;
      return { name: team.name, season: team.season, result, record: rec ? `${rec.wins}-${rec.losses}` : "" };
    });
    saveAttempt({
      ts: Date.now(),
      mode: gameMode,
      mutator: GameState.get().mutator, // null when no mutator was used
      outcome: t.status === "won" ? (perfect ? "perfect" : "won") : "eliminated",
      label,
      record: `${t.totalWins}-${t.totalLosses}`,
      rtg: Math.round(t.yourRating),
      team: SLOTS.map((slot) => five[slot] && initials(five[slot].name)).filter(Boolean),
      roster: SLOTS.map((slot) => five[slot] && {
        slot, name: five[slot].name, pos: five[slot].positions.join("/"), overall: five[slot].overall,
      }).filter(Boolean),
      bracket,
    });
    // Fold this run's box scores into the lifetime career store (achievements/stats page
    // read from it). Guarded by the same _recorded flag above, so it runs once per run.
    Career.recordRun(t, five, perfect);

    // Evaluate achievements AFTER saving to history above, so cumulative badges already
    // count this run. The live run carries per-series detail history can't reconstruct.
    const earned = Achievements.evaluate(buildAchievementContext({
      won: t.status === "won",
      perfect,
      gauntlet: gameMode === "gauntlet",
      blind: GameState.get().mode === "blind",
      series: t.seriesLog || [],
      games: t.allGames || [],
    }));
    // Keep this run's freshly unlocked badges on the tournament so the run summary can
    // list them, surviving any re-render of the result screen (recordAttempt only runs once).
    t._earnedBadges = earned;
    if (earned.length) toastAchievements(earned);
  }

  // Slide-in toasts announcing newly unlocked achievements. They stack and auto-dismiss;
  // purely additive, so a blocked/absent toast never affects the run.
  function toastAchievements(list) {
    const stack = document.getElementById("toast-stack");
    if (!stack) return;
    list.forEach((badge, i) => {
      const toast = document.createElement("div");
      toast.className = "toast";
      toast.innerHTML = `<span class="toast-label">Achievement unlocked</span>
        <span class="toast-name">${badge.name}</span>
        <span class="toast-desc">${badge.desc}</span>`;
      stack.appendChild(toast);
      // Stagger entrances so multiple unlocks read one at a time, then auto-remove.
      const show = setTimeout(() => toast.classList.add("show"), 60 + i * 180);
      const hide = setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 300);
      }, 4200 + i * 180);
      toast.addEventListener("click", () => { clearTimeout(show); clearTimeout(hide); toast.remove(); });
    });
  }

  // Finals MVP: the player on your roster with the best average stats. Scoring is
  // weighted - points count double, rebounds and assists equally - so the headline
  // scorer usually wins but a huge all-round line can take it. Classic averages over the
  // final series (t.games); the gauntlet has no single "final series" - each decade is one
  // game - so it averages over the whole run (t.allGames). Only shown when you win.
  const MVP_PTS_WEIGHT = 2;
  function renderFinalsMVP(t) {
    const box = document.getElementById("result-mvp");
    const gauntlet = GameState.get().gameMode === "gauntlet";
    // Win: your best player across the final series (classic) or the whole run (gauntlet).
    // Lose in the final round: the opponent who beat you gets the Finals MVP instead, taken
    // from that last matchup (t.games). Losing earlier shows no Finals MVP.
    const lostInFinals = t.status === "eliminated" && t.round === t.rounds;
    let mvp = null;
    if (t.status === "won") {
      mvp = computeFinalsMVP(gauntlet ? t.allGames : t.games, "yourBox");
    } else if (lostInFinals) {
      mvp = computeFinalsMVP(t.games, "oppBox");
    }
    if (!mvp) { box.classList.add("hidden"); box.innerHTML = ""; return; }
    box.innerHTML = `<div class="mvp-label">Finals MVP</div>
      <div class="mvp-name">${mvp.name}</div>
      <div class="mvp-stats">${mvp.ppg.toFixed(1)} PPG &middot; ${mvp.rpg.toFixed(1)} RPG &middot; ${mvp.apg.toFixed(1)} APG</div>`;
    box.classList.remove("hidden");
  }

  // Best averaged line from a set of games, read off either side's box (boxKey is
  // "yourBox" or "oppBox"). Scoring is weighted so the headline scorer usually wins.
  function computeFinalsMVP(games, boxKey) {
    if (!games || !games.length) return null;
    const totals = {};
    games.forEach((g) => (g[boxKey] || []).forEach((l) => {
      const sum = totals[l.name] || (totals[l.name] = { name: l.name, pts: 0, reb: 0, ast: 0 });
      sum.pts += l.pts; sum.reb += l.reb; sum.ast += l.ast;
    }));
    const n = games.length;
    let best = null;
    Object.values(totals).forEach((sum) => {
      const ppg = sum.pts / n, rpg = sum.reb / n, apg = sum.ast / n;
      const score = ppg * MVP_PTS_WEIGHT + rpg + apg;
      if (!best || score > best.score) best = { name: sum.name, ppg, rpg, apg, score };
    });
    return best;
  }

  // ---- Player renderers ----
  function playerCard(player, mode, { draggable }) {
    const el = document.createElement("div");
    el.className = "player";
    el.player = player;
    el.title = player.name; // full name on hover, since the node shows initials
    const accent = draftAccents.get(player);
    if (accent) el.style.setProperty("--accent", accent); // the spun team's color, kept on the chip
    const ovr = mode === "ratings" ? `<span class="p-ovr">${player.overall}</span>` : "";
    el.innerHTML = `<span class="p-init">${initials(player.name)}</span>${ovr}`;

    if (draggable) {
      DragDrop.makeDraggable(el, {
        getEligibleSlots: () => Array.from(document.querySelectorAll("#draft-court .slot"))
          .filter((slot) => canPlace(player, slot.dataset.slot, GameState.get().five)),
        onDrop: (slotEl) => placeInFive(player, slotEl),
      });
    }
    return el;
  }

  function playerMini(slot, player, mode, accent = GOLD, isOpponent = false) {
    const el = document.createElement("div");
    el.className = "player-mini";
    // Opponent overalls are hidden on purpose: seeing a "70" on a player you just lost to is
    // more frustrating than informative, and the buffed gauntlet legends play well above
    // their raw rating anyway. Your own five still shows overalls in ratings mode.
    const ovr = (mode === "ratings" && !isOpponent) ? `<span class="p-ovr">${player.overall}</span>` : "";
    el.innerHTML = `<span class="mini-av" style="background:${accent}">${initials(player.name)}</span>` +
      `<span class="mini-slot">${slot}</span><span class="mini-name">${player.name}</span>${ovr}`;
    return el;
  }

  // ---- Score count-up ----
  function animateCountUp(game, boxAnim, done) {
    const board = document.getElementById("scoreboard");
    const duration = SPEED_MS[speed] ?? SPEED_MS.normal;
    if (prefersReducedMotion()) { // reduced motion: show the final score and box at once
      board.innerHTML = scoreboardHTML(currentGameNo, game.yourPoints, game.oppPoints, game, true);
      paintStatsheet(boxAnim, 1);
      done();
      return;
    }
    const start = performance.now();
    function frame(now) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 2);
      const y = Math.round(game.yourPoints * eased);
      const o = Math.round(game.oppPoints * eased);
      board.innerHTML = scoreboardHTML(currentGameNo, y, o, game, progress >= 1);
      paintStatsheet(boxAnim, eased);
      if (progress < 1) requestAnimationFrame(frame);
      else done();
    }
    requestAnimationFrame(frame);
  }

  // Classic plays a best-of-7, so each game is numbered. A gauntlet round is a single
  // elimination game, so the number is meaningless - show the round instead.
  function gameLabel(number) {
    const { gameMode, tournament: t } = GameState.get();
    return gameMode === "gauntlet" ? roundLabel(t, gameMode) : `Game ${number}`;
  }

  function scoreboardHTML(number, you, opp, game, isFinal = false) {
    const youClass = isFinal ? (game.youWon ? "won" : "") : "";
    const oppClass = isFinal ? (game.youWon ? "" : "won") : "";
    // Venue is known before tip-off, so show it throughout the count-up.
    const venue = game && typeof game.youAreHome === "boolean"
      ? ` <span class="sb-venue">${game.youAreHome ? "Home" : "Away"}</span>` : "";
    return `<div class="sb-label">${gameLabel(number)}${venue}</div>
      <div class="sb-score"><span class="${youClass}">${you}</span>
      <span class="sb-dash">-</span><span class="${oppClass}">${opp}</span></div>`;
  }

  // Two small box-score tables (your roster | opponent). The rows are always mounted
  // so the layout never jumps - it shows zeros at tip-off and the numbers count up in
  // sync with the score (see paintStatsheet). Each side is tinted with its team color.
  // `lines` entries need a `name`; `pts`/`reb`/`ast` may be absent (shown as 0).
  // Returns the cell references + flattened lines so the count-up can drive them.
  function buildStatsheet(yourLines, oppLines, oppName, opts = {}) {
    const { title = "", highlight = false } = opts;
    const sheet = document.getElementById("statsheet");
    const table = (label, color, lines) => {
      // The standout on each side (highest pts + reb + ast) gets a highlighted row.
      // Skipped for the zero shell, where every total is 0 and a leader is meaningless.
      let topIdx = -1, bestV = -Infinity;
      if (highlight) lines.forEach((l, i) => {
        const v = (l.pts || 0) + (l.reb || 0) + (l.ast || 0);
        if (v > bestV) { bestV = v; topIdx = i; }
      });
      const rows = lines.map((l, i) =>
        `<tr class="${i === topIdx ? "ss-top" : ""}${l.hot ? " ss-hothand" : ""}"><td class="ss-name"><span class="ss-av" style="background:${color}">${initials(l.name)}</span><span class="ss-pname">${l.name}</span>${l.hot ? '<span class="ss-hot" title="Hot hand - riding a hot streak" aria-label="Hot hand">🔥</span>' : ""}</td>
         <td class="ss-pts">0</td><td class="ss-reb">0</td><td class="ss-ast">0</td>
         <td class="ss-fg">0-0</td><td class="ss-tp">0-0</td><td class="ss-ft">0-0</td><td class="ss-ts"></td></tr>`).join("");
      return `<table class="ss-table">
        <thead><tr><th class="ss-team" style="color:${color}">${label}</th><th>PTS</th><th>REB</th><th>AST</th><th>FG</th><th>3P</th><th>FT</th><th>TS%</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
    };
    const titleHTML = title ? `<div class="ss-title">${title}</div>` : "";
    sheet.innerHTML = titleHTML +
      `<div class="ss-tables">${table("Your Roster", GOLD, yourLines)}${table(oppName, teamColor(oppName), oppLines)}</div>`;

    const lines = [...yourLines, ...oppLines];
    const cells = Array.from(sheet.querySelectorAll("tbody tr")).map((tr) => ({
      pts: tr.querySelector(".ss-pts"), reb: tr.querySelector(".ss-reb"), ast: tr.querySelector(".ss-ast"),
      fg: tr.querySelector(".ss-fg"), tp: tr.querySelector(".ss-tp"), ft: tr.querySelector(".ss-ft"), ts: tr.querySelector(".ss-ts"),
    }));
    return { lines, cells };
  }

  // Who, if anyone, carries a hot hand into the next game: the game's leading scorer,
  // but only if they truly erupted (HOT_PTS_MIN points AND HOT_FORM_MIN x their average).
  // Returns a player name or null. Reads the `form` the engine left on each line.
  function nextHotHand(box) {
    let best = null;
    for (const l of box) {
      const erupted = (l.pts || 0) >= HOT_PTS_MIN && (l.form || 0) >= HOT_FORM_MIN;
      if (erupted && (!best || l.pts > best.pts)) best = l;
    }
    return best ? best.name : null;
  }

  // Reorder a (pts-sorted) box score into fixed PG -> C slot order, using the
  // slot -> player lineup the box was simulated from to look up each name's slot.
  function orderBoxBySlot(box, lineupBySlot) {
    const slotOf = {};
    for (const [slot, player] of Object.entries(lineupBySlot)) slotOf[player.name] = slot;
    return [...box].sort((a, b) => SLOTS.indexOf(slotOf[a.name]) - SLOTS.indexOf(slotOf[b.name]));
  }

  // Write each player's stats scaled by the animation progress (0..1) into the
  // already-mounted cells. At eased = 1 this lands on the exact final numbers.
  function paintStatsheet(anim, eased) {
    if (!anim) return;
    const makes = (made, att) => `${Math.round((made || 0) * eased)}-${Math.round((att || 0) * eased)}`;
    anim.lines.forEach((l, i) => {
      const c = anim.cells[i];
      c.pts.textContent = Math.round((l.pts || 0) * eased);
      c.reb.textContent = Math.round((l.reb || 0) * eased);
      c.ast.textContent = Math.round((l.ast || 0) * eased);
      // Shooting splits count up alongside the score; TS% is revealed only on the final frame
      // (it is a summary, not a counter). Older box scores without splits show blanks.
      if (!c.fg) return;
      const hasLine = l.fga !== undefined;
      c.fg.textContent = hasLine ? makes(l.fgm, l.fga) : "";
      c.tp.textContent = hasLine ? makes(l.tpm, l.tpa) : "";
      c.ft.textContent = hasLine ? makes(l.ftm, l.fta) : "";
      c.ts.textContent = hasLine && eased >= 0.999 ? `${Math.round((l.ts || 0) * 100)}%` : "";
    });
  }

  // ---- Leaving a run ----
  // Only guard the home button when there's real progress to lose: a draft you've started
  // picking, or a tournament in progress. The selection screens, Records, and the finished
  // result screen have nothing to discard, so the logo just takes you home directly.
  function requestHome() {
    const screen = GameState.get().screen;
    if (screen === "menu") return;
    const draftInProgress = screen === "draft" && GameState.draftCount() > 0;
    const inActiveRun = draftInProgress || screen === "tournament";
    if (inActiveRun) {
      document.getElementById("confirm-overlay").classList.remove("hidden");
      return;
    }
    leaveRun("menu");
  }

  function bindConfirm() {
    const overlay = document.getElementById("confirm-overlay");
    document.getElementById("confirm-yes").addEventListener("click", () => {
      hideConfirm();
      leaveRun("menu");
    });
    document.getElementById("confirm-no").addEventListener("click", hideConfirm);
    overlay.addEventListener("click", (event) => { if (event.target === overlay) hideConfirm(); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") hideConfirm(); });
  }

  function hideConfirm() {
    document.getElementById("confirm-overlay").classList.add("hidden");
  }

  // Clear transient state, reset the run, go to a screen.
  function leaveRun(screen) {
    animating = false;
    isSpinning = false;
    selectedPlayer = null;
    pendingDraftPlayer = null;
    usedTeams = new Set();
    draftAccents = new Map();
    pickFilter = { q: "", group: "all", sort: "overall" };
    GameState.reset();
    showScreen(screen);
  }

  // ---- Menu overlay ----
  function bindMenu() {
    const overlay = document.getElementById("menu-overlay");
    document.getElementById("menu-button").addEventListener("click", () => openMenu("howto"));
    document.getElementById("menu-close").addEventListener("click", closeMenu);
    overlay.addEventListener("click", (event) => { if (event.target === overlay) closeMenu(); });

    const runOverlay = document.getElementById("run-overlay");
    document.getElementById("run-close").addEventListener("click", closeRunSummary);
    runOverlay.addEventListener("click", (event) => { if (event.target === runOverlay) closeRunSummary(); });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { closeMenu(); closeRunSummary(); }
    });
    overlay.querySelectorAll(".overlay-tab").forEach((tab) => {
      tab.addEventListener("click", () => selectTab(tab.dataset.tab));
    });
    document.getElementById("setting-reduce-motion").addEventListener("change", (event) => {
      document.body.classList.toggle("reduce-motion", event.target.checked);
    });
  }

  function openMenu(tab) {
    document.getElementById("menu-overlay").classList.remove("hidden");
    selectTab(tab);
  }

  function closeMenu() {
    document.getElementById("menu-overlay").classList.add("hidden");
  }

  function selectTab(name) {
    const overlay = document.getElementById("menu-overlay");
    overlay.querySelectorAll(".overlay-tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.tab === name);
    });
    overlay.querySelectorAll(".overlay-content").forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.panel !== name);
    });
  }

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
      || document.body.classList.contains("reduce-motion");
  }

  return { boot };
})();
