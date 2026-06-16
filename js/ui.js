// UI layer: screen router, the draft loop, the playoff tournament, and overlays.
// Reads data via DataLoader, logic via Engine, run data via GameState.

const UI = (() => {
  const { SLOTS, ROUNDS, WINS_PER_SERIES, MAX_RESPINS } = GameState;
  const ROUND_NAMES = ["Round 1", "Round 2", "Conference Finals", "Finals"];

  // Difficulty: opponents are seeded weakest-to-strongest by REAL record, and each round
  // adds a rating bonus on top so the field hardens to a near-peer Finals. Tunable here,
  // paired with the engine's WIN_CAP/RATING_SCALE (js/engine.js).
  const DIFFICULTY_BASE = 2;
  const DIFFICULTY_STEP = 3;
  // Gauntlet difficulty is set by an explicit EFFECTIVE-strength curve, not the classic
  // ramp. A handpicked draft (best player per position, no weak link) out-rates any real
  // team - a maxed five hits ~106 while the best real team is ~89 - so without a buff the
  // all-time legends play soft. These two numbers buff each round's effective strength on a
  // line from the opener to the final boss, so the legends actually challenge an elite draft
  // (boss ~100 = a near-maxed five is favored but not safe). See gauntletBonuses.
  const GAUNTLET_OPENER_EFF = 83;  // round 1 effective rating (softest of the greats)
  const GAUNTLET_BOSS_EFF = 98;    // final boss effective rating

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

  function updateSoundButton() {
    const btn = document.getElementById("sound-button");
    if (btn) btn.innerHTML = Sound.isMuted() ? ICON.soundOff : ICON.soundOn;
  }

  function toggleSound() {
    Sound.toggleMute();
    updateSoundButton();
  }

  // ---- Attempt history (local only, no account) ----
  // A short rolling log of finished runs in localStorage so the menu can show the
  // last few attempts. No personal data - just mode, outcome, record, and the names
  // of the five you drafted. Disclosed on the privacy page.
  const HISTORY_KEY = "16-0:history";
  const HISTORY_CAP = 30;   // how many we keep
  const HISTORY_SHOWN = 5;  // how many the menu previews

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
    renderHistory();
  }

  function renderHistory() {
    const wrap = document.getElementById("history");
    if (!wrap) return;
    const items = loadHistory();
    if (!items.length) { wrap.classList.add("hidden"); wrap.innerHTML = ""; return; }

    const rows = items.slice(0, HISTORY_SHOWN).map((it, i) => {
      const mode = it.mode === "gauntlet" ? "Gauntlet" : "16-0";
      const team = (it.team || []).join(" · ");
      // Older entries predate the roster/bracket capture; only newer ones open a summary.
      const clickable = it.roster ? ` data-action="view-run" data-index="${i}" role="button" tabindex="0"` : "";
      return `<li class="history-row history-${it.outcome}${it.roster ? " is-clickable" : ""}"${clickable}>
        <span class="history-outcome">${it.label}</span>
        <span class="history-mode">${mode}</span>
        <span class="history-record">${it.record}</span>
        <span class="history-team">${team}</span></li>`;
    }).join("");

    wrap.innerHTML = `<div class="history-head"><span>Recent attempts</span>
        <button class="history-clear" data-action="clear-history" type="button">Clear</button></div>
      <ul class="history-list">${rows}</ul>`;
    wrap.classList.remove("hidden");
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
    const mode = item.mode === "gauntlet" ? "Gauntlet 10-0" : "16-0";
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
    if (id === "menu") renderHistory();
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
        case "view-run": openRunSummary(Number(target.dataset.index)); break;
        case "open-howto": openMenu("howto"); break;
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
  async function chooseGameMode(gameMode) {
    GameState.set({ gameMode });
    try {
      const playable = eras.filter((era) => era.hasData);
      const lists = await Promise.all(playable.map((era) => DataLoader.loadTeams(era.id)));
      currentTeams = lists.flat();
      leagueAvgRating = computeLeagueAvg();
    } catch (error) {
      showFatal("Could not load team data.");
      return;
    }
    GameState.set({ five: {}, spunTeam: null, respins: MAX_RESPINS });
    selectedPlayer = null;
    pendingDraftPlayer = null;
    usedTeams = new Set();
    draftAccents = new Map();
    showScreen("draft");
  }

  // ---- Draft ----
  function renderDraft() {
    resetSpinReel();
    renderDraftCourt();
    renderPicks();
    updateDraftProgress();
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

    // Re-spins remaining sit directly under the spin button.
    const respinsEl = document.getElementById("respins-left");
    respinsEl.textContent = filled >= 5 ? "" : `Re-spins left: ${respins}`;
  }

  // Does the currently spun team still have a player you can legally draft?
  function currentTeamHasDraftable() {
    const { spunTeam, five } = GameState.get();
    if (!spunTeam) return false;
    const taken = Object.values(five).map((p) => p.name);
    return spunTeam.roster.some((p) =>
      !taken.includes(p.name) && SLOTS.some((slot) => !five[slot] && Engine.isEligible(p, slot)));
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
    const available = currentTeams.filter((team) => !usedTeams.has(team));
    const pool = available.length ? available : currentTeams;
    const reel = document.getElementById("spin-reel");
    const spinButton = document.getElementById("spin-button");
    isSpinning = true;
    spinButton.disabled = true;

    const reveal = () => {
      const team = Engine.spinTeam(pool, previousTeam);
      GameState.set({ spunTeam: team });
      reel.innerHTML = `${team.name}<span class="reel-year">${team.season}</span>`;
      reel.classList.remove("is-spinning");
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
    const TOTAL_TICKS = 16;
    let ticks = 0;
    const interval = setInterval(() => {
      const random = pool[Math.floor(Math.random() * pool.length)];
      reel.textContent = random.name;
      Sound.tick(ticks / TOTAL_TICKS);
      if (++ticks > TOTAL_TICKS) { clearInterval(interval); reveal(); }
    }, 80);
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
      const draftable = !alreadyOwned && hasOpenSlot;

      const row = document.createElement("button");
      row.type = "button";
      row.className = draftable ? "pick-row" : "pick-row locked";
      if (player === pendingDraftPlayer) row.classList.add("selected");
      row.innerHTML = pickRowHTML(player, mode);
      if (draftable) {
        row.addEventListener("click", () => selectPick(player));
      } else {
        row.disabled = true;
        row.title = alreadyOwned ? "Already on your roster" : "No open spot for this position";
      }
      wrap.appendChild(row);
    });
  }

  function pickRowHTML(player, mode) {
    const ovr = mode === "ratings" ? `<span class="pick-ovr">${player.overall}</span>` : "";
    const head = `<div class="pick-head">
      <span class="pick-name">${player.name}</span>
      <span class="pick-pos">${player.positions.join("/")}</span>${ovr}</div>`;
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
    const { five: current, spunTeam } = GameState.get();
    const five = { ...current };
    if (five[slot] || !Engine.isEligible(player, slot)) return;
    five[slot] = player;
    if (spunTeam) {
      usedTeams.add(spunTeam);                           // this team can't be spun again
      draftAccents.set(player, teamColor(spunTeam.name)); // chip keeps the team's color
    }
    GameState.set({ five, spunTeam: null });
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
      <div class="matchup-side" style="border-top-color:${GOLD}">
        <h3 class="font-display font-bold text-lg">Your Roster ${youHome ? homeBadge : ""}</h3>
        ${teamMeta(t.yourRecord, t.yourRating)}
        <div class="mini-five" id="your-five"></div>
      </div>
      <div class="vs">vs</div>
      <div class="matchup-side" style="border-top-color:${oppColor}">
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

  function renderSeriesStatus(t) {
    // A gauntlet round is one game, so a "0 - 0" series score is just noise.
    const isGauntlet = GameState.get().gameMode === "gauntlet";
    document.getElementById("series-status").textContent = isGauntlet ? "" : `${t.yourWins} - ${t.oppWins}`;
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
      : DIFFICULTY_BASE + (t.round - 1) * DIFFICULTY_STEP;
    const game = Engine.simulateGame(yourRating, oppRating, youAreHome, oppBonus);

    // Per-player box scores that add up to each side's final points, ordered PG -> C
    // so the rows line up with the matchup card and never reshuffle on count-up.
    game.yourBox = orderBoxBySlot(Engine.simulateBoxScore(Object.values(state.five), game.yourPoints), state.five);
    game.oppBox = orderBoxBySlot(Engine.simulateBoxScore(Object.values(oppLineup), game.oppPoints), oppLineup);
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
        `<tr class="${i === topIdx ? "ss-top" : ""}"><td class="ss-name"><span class="ss-av" style="background:${color}">${initials(l.name)}</span>${l.name}</td>
         <td class="ss-pts">0</td><td class="ss-reb">0</td><td class="ss-ast">0</td></tr>`).join("");
      return `<table class="ss-table">
        <thead><tr><th class="ss-team" style="color:${color}">${label}</th><th>PTS</th><th>REB</th><th>AST</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
    };
    const titleHTML = title ? `<div class="ss-title">${title}</div>` : "";
    sheet.innerHTML = titleHTML +
      `<div class="ss-tables">${table("Your Roster", GOLD, yourLines)}${table(oppName, teamColor(oppName), oppLines)}</div>`;

    const lines = [...yourLines, ...oppLines];
    const cells = Array.from(sheet.querySelectorAll("tbody tr")).map((tr) => ({
      pts: tr.querySelector(".ss-pts"), reb: tr.querySelector(".ss-reb"), ast: tr.querySelector(".ss-ast"),
    }));
    return { lines, cells };
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
    anim.lines.forEach((l, i) => {
      const c = anim.cells[i];
      c.pts.textContent = Math.round((l.pts || 0) * eased);
      c.reb.textContent = Math.round((l.reb || 0) * eased);
      c.ast.textContent = Math.round((l.ast || 0) * eased);
    });
  }

  // ---- Leaving a run ----
  function requestHome() {
    if (GameState.get().screen === "menu") return;
    document.getElementById("confirm-overlay").classList.remove("hidden");
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
