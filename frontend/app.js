/* ── Running Coach App ── */

const GITHUB_REPO = "omrisi37/mygarmin";
const APP_PASSWORD = "omrirun2026"; // Change this to your preferred password

const CROSS_TRAINING_ACTIVITIES = [
  {id:"football",  label:"Football",    emoji:"⚽"},
  {id:"gym",       label:"Gym",         emoji:"🏋️"},
  {id:"pilates",   label:"Pilates",     emoji:"🧘"},
  {id:"swimming",  label:"Swimming",    emoji:"🏊"},
  {id:"cycling",   label:"Cycling",     emoji:"🚴"},
  {id:"tennis",    label:"Tennis",      emoji:"🎾"},
  {id:"basketball",label:"Basketball",  emoji:"🏀"},
  {id:"yoga",      label:"Yoga",        emoji:"🤸"},
  {id:"boxing",    label:"Boxing",      emoji:"🥊"},
];

// ── Auth ──────────────────────────────────────────────────────────────────────

function doLogin() {
  const input = document.getElementById("pw-input").value;
  if (input === APP_PASSWORD) {
    localStorage.setItem("rc_auth", "1");
    showApp();
  } else {
    document.getElementById("pw-error").style.display = "block";
    document.getElementById("pw-input").value = "";
    document.getElementById("pw-input").focus();
  }
}

function logout() {
  localStorage.removeItem("rc_auth");
  location.reload();
}

// ── Manual Skips ──────────────────────────────────────────────────────────────

function getManualSkips() {
  try { return JSON.parse(localStorage.getItem("rc_manual_skips") || "{}"); } catch { return {}; }
}

function markDaySkipped(date, dayTitle) {
  const skips = getManualSkips();
  skips[date] = { skipped: true, title: dayTitle, skipped_at: new Date().toISOString() };
  localStorage.setItem("rc_manual_skips", JSON.stringify(skips));
  closeModal();
  renderScreen(currentScreen);
}

function markDayRescheduled(fromDate, toDate, dayTitle) {
  const skips = getManualSkips();
  skips[fromDate] = { skipped: true, rescheduled_to: toDate, title: dayTitle, skipped_at: new Date().toISOString() };
  skips[toDate] = skips[toDate] || {};
  skips[toDate].moved_from = fromDate;
  skips[toDate].moved_title = dayTitle;
  localStorage.setItem("rc_manual_skips", JSON.stringify(skips));
  closeModal();
  renderScreen(currentScreen);
}

function unmarkDaySkipped(date) {
  const skips = getManualSkips();
  const entry = skips[date];
  // Clean up cross-references
  if (entry?.rescheduled_to) {
    const target = skips[entry.rescheduled_to];
    if (target) { delete target.moved_from; delete target.moved_title; if (!Object.keys(target).length) delete skips[entry.rescheduled_to]; }
  }
  if (entry?.moved_from && skips[entry.moved_from]) {
    delete skips[entry.moved_from].rescheduled_to;
  }
  delete skips[date];
  localStorage.setItem("rc_manual_skips", JSON.stringify(skips));
  closeModal();
  renderScreen(currentScreen);
}

function showSkipOrRescheduleModal(date, dayTitle) {
  // Collect upcoming run days from plan (next 7 days, excluding today/past)
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = [];
  if (currentPlan) {
    const allDays = [
      ...(currentPlan.days || []),
      ...((currentPlan.weeks || []).flatMap(w => w.days || []))
    ];
    const seen = new Set();
    for (const d of allDays) {
      if (d.date && d.date > date && !d.completed && !seen.has(d.date)) {
        seen.add(d.date);
        upcoming.push(d);
      }
    }
    upcoming.sort((a, b) => a.date.localeCompare(b.date));
  }
  const upcomingOptions = upcoming.slice(0, 7).map(d =>
    `<option value="${d.date}">${d.day} ${d.date} — ${d.title}</option>`
  ).join("");

  document.getElementById("day-modal-body").innerHTML = `
    <div style="font-size:32px;margin-bottom:8px">⏭</div>
    <h2 style="font-size:18px;font-weight:700;margin-bottom:6px">Skip or Reschedule?</h2>
    <p class="text-sm text-mid" style="margin-bottom:18px">${dayTitle}</p>

    <div style="display:flex;flex-direction:column;gap:10px">
      ${upcomingOptions ? `
      <div style="background:var(--surface2);border-radius:10px;padding:14px">
        <div class="text-sm" style="font-weight:600;margin-bottom:8px">📅 Move to another day</div>
        <select id="reschedule-target" style="width:100%;background:var(--surface3);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px">
          <option value="">— pick a day —</option>
          ${upcomingOptions}
        </select>
        <button class="btn" style="margin-top:10px;width:100%" onclick="
          const t=document.getElementById('reschedule-target').value;
          if(t) markDayRescheduled('${date}', t, \`${dayTitle.replace(/`/g,"'")}\`);
        ">Confirm Move</button>
      </div>` : ""}

      <button class="btn btn-ghost" onclick="markDaySkipped('${date}', \`${dayTitle.replace(/`/g,"'")}\`)" style="color:var(--text-dim)">
        🛌 Just Rest — mark as skipped
      </button>
      <button class="btn btn-ghost" onclick="closeModal()" style="margin-top:4px">Cancel</button>
    </div>
  `;
}

// ── Settings (stored in localStorage) ────────────────────────────────────────

function getSettings() {
  try {
    return JSON.parse(localStorage.getItem("rc_settings") || "{}");
  } catch { return {}; }
}

function saveSettings(obj) {
  const current = getSettings();
  localStorage.setItem("rc_settings", JSON.stringify({ ...current, ...obj }));
}


// ── Navigation ────────────────────────────────────────────────────────────────

let currentScreen = "today";

const PAGE_TITLES = { today: "Today", week: "This Week", goals: "Training Goals", analyse: "Analytics", settings: "Settings" };

function navigate(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  document.getElementById(`screen-${id}`).classList.add("active");
  document.querySelectorAll(`[data-nav="${id}"]`).forEach(b => b.classList.add("active"));
  currentScreen = id;
  const titleEl = document.getElementById("desktop-page-title");
  if (titleEl) titleEl.textContent = PAGE_TITLES[id] || id;
  renderScreen(id);
}

// ── Plan Data ─────────────────────────────────────────────────────────────────

let currentPlan = null;
let currentAnalytics = null;
let completedSessions = {}; // persistent log: { "2026-06-25": { completed, actual_stats, ... } }

async function fetchPlan() {
  try {
    const res = await fetch(`/data/plan.json?t=${Date.now()}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchAnalytics() {
  try {
    const res = await fetch(`/data/analytics.json?t=${Date.now()}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchCompletedSessions() {
  try {
    const res = await fetch(`/data/completed_sessions.json?t=${Date.now()}`);
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

async function fetchUserSettings() {
  try {
    const res = await fetch(`/data/user_settings.json?t=${Date.now()}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function restoreSettingsIfEmpty(remoteSettings) {
  if (!remoteSettings) return;
  const local = getSettings();
  // If the user has no goal saved locally, restore from the server copy
  if (!local.goal && !local.race_date) {
    const { saved_at, ...fields } = remoteSettings;
    saveSettings(fields);
    console.log("Settings restored from user_settings.json");
  }
}

async function refreshData() {
  showToast("Refreshing…");
  [currentPlan, currentAnalytics, completedSessions] = await Promise.all([
    fetchPlan(), fetchAnalytics(), fetchCompletedSessions(),
  ]);
  renderScreen(currentScreen);
  showToast("✓ Updated");
}


// ── Workflow Trigger ──────────────────────────────────────────────────────────

async function triggerWorkflow(file, inputs = {}) {
  try {
    const res = await fetch("/api/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow: file, inputs }),
    });
    const data = await res.json();
    if (res.ok && data.ok) return true;
    showToast("❌ " + (data.error || "Failed to trigger workflow"));
    return false;
  } catch {
    showToast("❌ Network error — try again");
    return false;
  }
}

async function generatePlan() {
  showToast("⏳ Generating plan…");
  const ok = await triggerWorkflow("weekly-plan.yml");
  if (ok) showToast("✅ Plan generating — check back in ~90s");
}

// Build a Google Calendar "Add Event" URL for a single workout day
function gcalUrl(day) {
  if (!day.date || day.distance_km === 0) return null;

  // Default workout time: 6:30 AM, duration from plan
  const start = new Date(`${day.date}T06:30:00`);
  const end   = new Date(start.getTime() + (day.duration_min || 60) * 60000);

  const fmt = d => d.toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"");

  const title = encodeURIComponent(`🏃 ${day.title}`);
  const details = encodeURIComponent([
    day.description || "",
    "",
    `Distance: ${day.distance_km} km`,
    `Duration: ${day.duration_min} min`,
    `Intensity: ${day.intensity}`,
    day.hr_zone ? `HR Zone: ${day.hr_zone}` : "",
    day.key_focus ? `Focus: ${day.key_focus}` : "",
    day.notes ? `Notes: ${day.notes}` : "",
  ].filter(Boolean).join("\n"));

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${fmt(start)}/${fmt(end)}&details=${details}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function intensityKey(intensity = "") {
  const m = { "Rest":"rest","Easy":"easy","Moderate":"easy","Tempo":"tempo","Hard":"hard","Long Run":"longrun","Race":"hard" };
  return m[intensity] || "easy";
}

function workoutEmoji(type = "", intensity = "") {
  if (intensity === "Rest") return "😴";
  if (type === "Long Run" || intensity === "Long Run") return "🏃";
  if (intensity === "Tempo") return "⚡";
  if (intensity === "Hard") return "🔥";
  const ct = { "Cross-Training":"💪","WeightTraining":"🏋️","Gym":"🏋️","Swimming":"🏊","Cycling":"🚴","Soccer":"⚽","Football":"⚽","Tennis":"🎾","Basketball":"🏀","Boxing":"🥊","Yoga":"🧘","Pilates":"🧘","Swim":"🏊" };
  if (ct[type]) return ct[type];
  return "🟢";
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning, Omri";
  if (h < 17) return "Good afternoon, Omri";
  return "Good evening, Omri";
}

function formatDate(d) {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function todayDayName() {
  return new Date().toLocaleDateString("en-US", { weekday: "long" });
}

function daysToRace(raceDateStr) {
  if (!raceDateStr) return null;
  const diff = Math.ceil((new Date(raceDateStr) - new Date()) / 86400000);
  return diff;
}

function showToast(msg, ms = 3000) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), ms);
}

function closeModal() {
  document.getElementById("day-modal").classList.remove("open");
}

// ── Render: TODAY ─────────────────────────────────────────────────────────────

function renderToday() {
  const el = document.getElementById("today-content");
  const plan = currentPlan;
  const today = todayDayName();
  const todayWorkout = plan?.days?.find(d => d.day === today);
  const s = getSettings();

  const statusHtml = plan ? (() => {
    const map = {
      pending_approval: { cls:"pending",  icon:"⏳", title:"Plan ready", sub:"Go to Goals tab to add workouts to calendar" },
      approved:         { cls:"approved", icon:"✅", title:"Plan approved", sub:"Ready to sync to Google Calendar" },
      synced:           { cls:"synced",   icon:"📅", title:"Synced to Google Calendar", sub:"Check your calendar" },
    };
    const st = map[plan.status] || map.pending_approval;
    return `<div class="banner ${st.cls}">
      <span class="banner-icon">${st.icon}</span>
      <div><div class="banner-title">${st.title}</div><div class="banner-sub">${st.sub}</div></div>
    </div>`;
  })() : "";

  const workoutHtml = (() => {
    if (!todayWorkout) return `
      <div class="workout-hero">
        <div class="card-label">TODAY'S WORKOUT</div>
        <div class="wo-emoji">📭</div>
        <div class="wo-title">No plan yet</div>
        <div class="wo-sub">Generate your first plan below</div>
      </div>`;

    const done   = todayWorkout.completed;
    const actual = todayWorkout.actual_stats || {};
    const rating = todayWorkout.execution_rating;
    const isSwap = rating === "swapped";
    const isRun  = ["Run","TrailRun","VirtualRun"].includes(actual.activity_type);

    if (done) {
      // Show what was actually done
      const actName  = actual.activity_name || actual.activity_type || "Activity";
      const actEmoji = isSwap ? "🔄" : (isRun ? "✅" : "✅");
      const subParts = [
        isRun && actual.distance_km  ? `${actual.distance_km} km`  : "",
        actual.duration_min          ? `${actual.duration_min} min` : "",
        actual.avg_hr                ? `${actual.avg_hr} bpm`       : "",
        isRun && actual.avg_pace     ? `${actual.avg_pace}/km`      : "",
      ].filter(Boolean);
      const ratingBadge = `<span style="font-size:12px;padding:2px 8px;border-radius:10px;background:var(--surface2);color:${_ratingColor(rating)}">${_ratingLabel(rating)}</span>`;
      const coachNote = todayWorkout.coach_analysis
        ? `<div class="wo-desc" style="margin-top:10px;font-style:italic;color:var(--text-dim)">"${todayWorkout.coach_analysis}"</div>`
        : "";
      return `
        <div class="workout-hero">
          <div class="card-label">TODAY · COMPLETED</div>
          <div class="wo-emoji">${actEmoji}</div>
          <div class="wo-title">${actName}</div>
          ${subParts.length ? `<div class="wo-sub">${subParts.join(" · ")}</div>` : ""}
          <div style="margin-top:8px">${ratingBadge}</div>
          ${coachNote}
          ${isSwap ? "" : `<div class="text-xs text-dim" style="margin-top:8px">Planned: ${todayWorkout.title}</div>`}
        </div>`;
    }

    return `
      <div class="workout-hero">
        <div class="card-label">TODAY'S WORKOUT</div>
        <div class="wo-emoji">${workoutEmoji(todayWorkout.workout_type, todayWorkout.intensity)}</div>
        <div class="wo-title">${todayWorkout.title}</div>
        <div class="wo-sub">${todayWorkout.intensity === "Rest" ? "Recovery is training too" :
          `${todayWorkout.distance_km} km · ${todayWorkout.duration_min} min`}</div>
        ${todayWorkout.description ? `<div class="wo-desc">${todayWorkout.description}</div>` : ""}
      </div>`;
  })();

  const weekHtml = plan ? (() => {
    const days     = plan.days || [];
    const runs     = days.filter(d => d.distance_km > 0);
    const plannedKm = plan.total_distance_km || runs.reduce((s, d) => s + (d.distance_km || 0), 0);
    const totalRuns = runs.length;
    const startDate = days[0]?.date;
    const endDate   = days[6]?.date;
    const dateRange = startDate ? `${new Date(startDate).toLocaleDateString("en-US",{month:"short",day:"numeric"})} – ${new Date(endDate).toLocaleDateString("en-US",{month:"short",day:"numeric"})}` : "";

    // Actual km completed this week from synced sessions
    const actualKm = days.reduce((sum, d) => {
      if (!d.completed || !d.actual_stats) return sum;
      const isRun = ["Run","TrailRun","VirtualRun"].includes(d.actual_stats.activity_type);
      return sum + (isRun ? (d.actual_stats.distance_km || 0) : 0);
    }, 0);
    const actualRuns = days.filter(d => d.completed && ["Run","TrailRun","VirtualRun"].includes(d.actual_stats?.activity_type)).length;
    const progressPct = plannedKm > 0 ? Math.min(100, Math.round((actualKm / plannedKm) * 100)) : 0;
    const progressColor = progressPct >= 100 ? "var(--green)" : progressPct >= 60 ? "var(--orange)" : "var(--accent)";

    // Coach week summary from analytics
    const coachSummary = currentAnalytics?.recommendations?.[0] || plan.coaching_notes || "";

    return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div class="card-label" style="margin-bottom:0">THIS WEEK</div>
        <div class="text-xs text-dim">${dateRange}</div>
      </div>
      <div class="stats-grid" style="margin-bottom:12px">
        <div class="stat-box">
          <div class="stat-val green">${actualKm > 0 ? actualKm.toFixed(1) : plannedKm}<span class="stat-unit"> km</span></div>
          <div class="stat-lbl">${actualKm > 0 ? "Done" : "Planned"}</div>
        </div>
        <div class="stat-box">
          <div class="stat-val accent">${actualRuns > 0 ? actualRuns : totalRuns}</div>
          <div class="stat-lbl">${actualRuns > 0 ? "Runs done" : "Runs planned"}</div>
        </div>
      </div>
      ${actualKm > 0 ? `
      <div class="prog-row" style="margin-bottom:8px">
        <div class="prog-label"><span>Weekly target</span><span>${actualKm.toFixed(1)} / ${plannedKm} km · ${progressPct}%</span></div>
        <div class="prog-track"><div class="prog-fill" style="width:${progressPct}%;background:${progressColor}"></div></div>
      </div>` : ""}
      <div class="prog-row">
        <div class="prog-label"><span>Aerobic (Zone 1–2)</span><span>${plan.aerobic_percent}%</span></div>
        <div class="prog-track"><div class="prog-fill green" style="width:${plan.aerobic_percent}%"></div></div>
      </div>
      <div class="prog-row" style="margin-top:8px">
        <div class="prog-label"><span>Anaerobic (Zone 4–5)</span><span>${plan.anaerobic_percent}%</span></div>
        <div class="prog-track"><div class="prog-fill red" style="width:${plan.anaerobic_percent}%"></div></div>
      </div>
      ${coachSummary ? `
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
        <div class="text-xs" style="color:var(--orange);font-weight:700;margin-bottom:4px">🧠 COACH FOR NEXT WEEK</div>
        <p class="text-xs text-dim" style="line-height:1.5">${coachSummary}</p>
      </div>` : ""}
    </div>`;
  })() : "";

  const stravaHtml = plan?.strava_summary ? `
    <div class="card">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--orange)" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        <div class="card-label" style="margin-bottom:0">STRAVA — LAST 14 DAYS</div>
      </div>
      <div class="stats-grid" style="margin-bottom:0">
        <div class="stat-box">
          <div class="stat-val">${plan.strava_summary.distance_km} <span class="stat-unit">km</span></div>
          <div class="stat-lbl">Total Distance</div>
        </div>
        <div class="stat-box">
          <div class="stat-val">${plan.strava_summary.runs}</div>
          <div class="stat-lbl">Total Runs</div>
        </div>
        <div class="stat-box">
          <div class="stat-val">${plan.strava_averages?.avg_hr || "—"} <span class="stat-unit">bpm</span></div>
          <div class="stat-lbl">Avg Heart Rate</div>
        </div>
        <div class="stat-box">
          <div class="stat-val">${plan.strava_summary.duration_hours || "—"}<span class="stat-unit"> h</span></div>
          <div class="stat-lbl">Total Hours</div>
        </div>
      </div>
      ${(plan.synced_at || plan.generated_at) ? `<div class="text-xs text-dim mt-8">Last synced ${new Date(plan.synced_at || plan.generated_at).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}</div>` : ""}
    </div>` : "";

  el.innerHTML = `
    ${_workflowBanner()}
    ${statusHtml}
    ${workoutHtml}
    ${weekHtml}
    ${stravaHtml}
    <button class="btn btn-ghost" onclick="navigate('goals')" style="margin-top:4px">
      ⚡ Generate / Update Plan
    </button>
  `;
}

// ── Render: WEEK ──────────────────────────────────────────────────────────────

let weekViewMode = "week";

function setWeekView(mode) {
  weekViewMode = mode === "race" ? "week" : mode;
  renderWeek();
}

function _phaseColor(phase) {
  const m = {
    "Base Building":       "var(--green)",
    "Aerobic Development": "var(--blue)",
    "Peak Training":       "var(--orange)",
    "Taper":               "#a855f7",
    "Race Week":           "var(--red)",
  };
  return m[phase] || "var(--text-dim)";
}

// ── Workflow status banner ─────────────────────────────────────────────────────

function _setWorkflowPending(action, label) {
  localStorage.setItem("rc_pending_workflow", JSON.stringify({
    action, label, triggered_at: new Date().toISOString(),
  }));
}

function _clearWorkflowPending() {
  localStorage.removeItem("rc_pending_workflow");
}

function _workflowBanner() {
  const raw = localStorage.getItem("rc_pending_workflow");
  if (!raw) return "";
  try {
    const { label, triggered_at } = JSON.parse(raw);
    const age = Math.round((Date.now() - new Date(triggered_at).getTime()) / 1000);
    if (age > 360) { _clearWorkflowPending(); return ""; }
    return `<div class="workflow-banner">
      <div style="display:flex;align-items:center;gap:10px;flex:1">
        <div class="workflow-spinner">⏳</div>
        <div>
          <div style="font-weight:600;font-size:13px">${label}</div>
          <div style="font-size:11px;color:var(--text-dim)">${age}s elapsed · auto-updating when ready</div>
        </div>
      </div>
      <button onclick="_clearWorkflowPending();renderScreen(currentScreen)"
        style="background:none;border:none;color:var(--text-dim);font-size:18px;cursor:pointer;line-height:1;padding:4px 0 4px 8px">✕</button>
    </div>`;
  } catch { return ""; }
}

// ── Full roadmap view ─────────────────────────────────────────────────────────

function _renderRoadmap(plan) {
  const weeks4 = plan.weeks || [];
  const roadmap = plan.roadmap || [];

  if (!weeks4.length && !roadmap.length) {
    return `<div class="empty"><div class="empty-icon">🗺</div><h3>No roadmap yet</h3><p>Generate a plan with a race date set to see all weeks.</p></div>`;
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  const allWeeks = [
    ...weeks4.map((w, i) => ({
      week_number: w.week_number || i + 1,
      week_start: w.days?.[0]?.date || "",
      week_end:   w.days?.[6]?.date || "",
      phase: w.phase || "",
      total_km: w.total_distance_km || 0,
      weekly_summary: w.weekly_summary || "",
      days: w.days || [],
      is_detail: true,
      key_sessions: [],
    })),
    ...roadmap.map(w => ({
      ...w,
      week_end: w.week_start
        ? new Date(new Date(w.week_start + "T12:00:00").getTime() + 6 * 86400000).toISOString().slice(0,10)
        : "",
      is_detail: false,
    })),
  ];

  const s = getSettings();
  const d2r = daysToRace(s.race_date);

  const hasRoadmapData = roadmap.length > 0;

  const cardsHtml = allWeeks.map((week, idx) => {
    const color = _phaseColor(week.phase);
    const isCurrentWeek = week.week_start && week.week_end
      ? week.week_start <= todayStr && week.week_end >= todayStr
      : false;

    const dateRange = week.week_start
      ? `${new Date(week.week_start + "T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})} – ${new Date((week.week_end||week.week_start) + "T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}`
      : "";

    // Dots row
    const dotsHtml = week.is_detail
      ? (week.days).map(day => {
          const dc = _intensityColor(day.intensity);
          return `<div class="month-week-dot" style="background:${dc}">${day.day?.[0] || ""}</div>`;
        }).join("")
      : (week.key_sessions || []).map(() =>
          `<div class="month-week-dot" style="background:${color}55">•</div>`
        ).join("");

    // Body
    const bodyHtml = week.is_detail
      ? _renderWeekDays(week.days, idx)
      : `<div style="padding:8px 0 4px">
          ${(week.key_sessions || []).map(s => `<div class="day-row" style="opacity:0.85">
            <div class="day-dot" style="background:${color}"></div>
            <div class="day-name">${s}</div>
          </div>`).join("") || `<div class="text-sm text-dim" style="padding:6px 0">${week.weekly_summary || "Overview week"}</div>`}
          <div class="text-xs text-dim" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">Regenerate plan to unlock full day-by-day detail for this week.</div>
        </div>`;

    return `
      <div class="month-week${isCurrentWeek ? " race-now" : ""}">
        <div class="month-week-header" onclick="toggleMonthWeek('race-${idx}')">
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:2px">
              <span style="font-weight:700;font-size:14px">Week ${week.week_number || idx+1}</span>
              <span class="day-badge" style="background:${color}20;color:${color};border:1px solid ${color}40;font-size:10px">${week.phase}</span>
              ${isCurrentWeek ? `<span class="day-badge easy" style="font-size:10px">← Now</span>` : ""}
            </div>
            <div class="text-xs text-dim">${dateRange} · ${week.total_km || week.total_distance_km || 0} km</div>
          </div>
          <div style="color:var(--text-dim);font-size:18px">›</div>
        </div>
        <div class="month-week-dots">${dotsHtml}</div>
        <div class="month-week-body" id="month-week-body-race-${idx}">
          ${bodyHtml}
        </div>
      </div>`;
  }).join("");

  const raceCard = s.race_date ? `
    <div class="month-week" style="border-left:3px solid var(--red);border-radius:10px">
      <div style="padding:14px 18px;display:flex;align-items:center;gap:10px">
        <div style="font-size:22px">🏁</div>
        <div>
          <div style="font-weight:700;font-size:14px">${s.race_name || "Race Day"}</div>
          <div class="text-xs text-dim">${new Date(s.race_date+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}
            ${d2r !== null && d2r >= 0 ? ` · ${d2r} days away` : ""}</div>
        </div>
      </div>
    </div>` : "";

  const noRoadmapNote = !hasRoadmapData && weeks4.length > 0 ? `
    <div class="info-box" style="margin:8px 0">
      Showing current 4-week block only. Regenerate your plan to unlock the full week-by-week roadmap to race day.
    </div>` : "";

  return `${noRoadmapNote}${cardsHtml}${raceCard}`;
}

function _renderMacroTimeline() {
  const s = getSettings();
  if (!s.race_date) return "";

  const raceDate = new Date(s.race_date);
  const today = new Date();
  today.setHours(0,0,0,0);
  const totalDays = Math.ceil((raceDate - today) / 86400000);
  if (totalDays <= 0) return "";

  const weeksLeft = Math.floor(totalDays / 7);

  const phases = [
    { name: "Base Building",      color: "var(--green)",  minWeek: 13 },
    { name: "Aerobic Development",color: "var(--blue)",   minWeek: 9  },
    { name: "Peak Training",      color: "var(--orange)", minWeek: 5  },
    { name: "Taper",              color: "#a855f7",       minWeek: 2  },
    { name: "Race Week",          color: "var(--red)",    minWeek: 0  },
  ];

  function phaseFor(w) {
    for (const p of phases) if (w >= p.minWeek) return p;
    return phases[phases.length - 1];
  }

  // Build week-by-week bars (max 20 shown)
  const totalWeeks = Math.min(weeksLeft, 20);
  const barsHtml = Array.from({ length: totalWeeks }, (_, i) => {
    const wLeft = weeksLeft - i;
    const p = phaseFor(wLeft);
    const isNow = i === 0;
    const weekDate = new Date(today.getTime() + i * 7 * 86400000);
    const label = weekDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `<div class="timeline-bar${isNow ? " now" : ""}" style="background:${p.color};opacity:${isNow ? 1 : 0.45}"
      title="Week ${i+1}: ${p.name} · ${label}"></div>`;
  }).join("");

  const currentPhase = phaseFor(weeksLeft);
  const raceDateStr = raceDate.toLocaleDateString("en-US", { weekday:"short", month:"long", day:"numeric", year:"numeric" });

  return `
    <div class="card" style="margin-bottom:12px">
      <div class="card-label">📅 FULL PLAN — ROAD TO RACE</div>
      <div style="font-size:13px;font-weight:700;margin-bottom:4px">${s.race_name || "Race Day"} · ${raceDateStr}</div>
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:12px">${weeksLeft} weeks to go · Now in <span style="color:${currentPhase.color};font-weight:700">${currentPhase.name}</span></div>
      <div class="timeline-bars">${barsHtml}</div>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-dim);margin-top:4px">
        <span>Now</span><span>Race Day 🏁</span>
      </div>
      <div class="timeline-legend">
        ${phases.map(p => `<span><span class="tl-dot" style="background:${p.color}"></span>${p.name}</span>`).join("")}
      </div>
    </div>`;
}

function _ratingColor(rating) {
  const m = { "great":"var(--green)", "on-plan":"var(--green)", "slightly-hard":"var(--orange)", "too-hard":"var(--red)", "too-easy":"var(--blue)", "skipped":"var(--text-dim)", "swapped":"var(--text-dim)" };
  return m[rating] || "var(--green)";
}

function _ratingLabel(rating) {
  const m = { "great":"✨ Great", "on-plan":"✅ On plan", "slightly-hard":"⚠️ Slightly hard", "too-hard":"🔴 Too hard", "too-easy":"💤 Too easy", "skipped":"⏭ Skipped", "swapped":"📅 Day swapped" };
  return m[rating] || "✅ Done";
}

function _getThisWeekDates() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOfWeek = today.getDay(); // 0=Sun
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

function _renderRecentCompleted() {
  // Show completed sessions from the persistent log that are in the current week
  // but NOT already in the current plan (those are handled by _renderWeekDays)
  if (!completedSessions || !Object.keys(completedSessions).length) return "";

  const planDates = new Set();
  (currentPlan?.days || []).forEach(d => d.date && planDates.add(d.date));
  (currentPlan?.weeks || []).forEach(w => (w.days || []).forEach(d => d.date && planDates.add(d.date)));

  const thisWeek = new Set(_getThisWeekDates());
  const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

  const extras = Object.entries(completedSessions)
    .filter(([date]) => thisWeek.has(date) && !planDates.has(date))
    .sort(([a], [b]) => a.localeCompare(b));

  if (!extras.length) return "";

  const rowsHtml = extras.map(([date, session]) => {
    const actual = session.actual_stats || {};
    const rating = session.execution_rating || "on-plan";
    const isRun = ["Run","TrailRun","VirtualRun"].includes(actual.activity_type);
    const distLabel = isRun && actual.distance_km ? `${actual.distance_km} km` : "";
    const hrLabel   = actual.avg_hr ? `${actual.avg_hr} bpm` : "";
    const paceLabel = isRun && actual.avg_pace ? `${actual.avg_pace}/km` : "";
    const durLabel  = !isRun && actual.duration_min ? `${actual.duration_min} min` : "";
    const calLabel  = !isRun && actual.calories ? `${actual.calories} kcal` : "";
    const subParts  = [distLabel, durLabel, hrLabel, paceLabel, calLabel].filter(Boolean);
    const d = new Date(date + "T12:00:00");
    const abbr = DAYS[d.getDay() === 0 ? 6 : d.getDay() - 1];
    const title = actual.activity_name || actual.activity_type || "Activity";
    return `<div class="day-row done" onclick="openCompletedModal('${date}')">
      <div class="day-abbr">${abbr}</div>
      <div class="day-dot done-dot">✓</div>
      <div style="flex:1;min-width:0">
        <div class="day-name">${title}</div>
        ${subParts.length ? `<div class="done-sub">${subParts.join(" · ")}</div>` : ""}
      </div>
      <div class="done-badge" style="color:${_ratingColor(rating)}">${_ratingLabel(rating)}</div>
      <div class="day-chevron">›</div>
    </div>`;
  }).join("");

  return `<div style="margin-bottom:4px">
    <div class="card-label" style="padding:0 4px;margin-bottom:6px">COMPLETED THIS WEEK</div>
    ${rowsHtml}
  </div>`;
}

function openCompletedModal(date) {
  const session = completedSessions?.[date];
  if (!session) return;
  const actual = session.actual_stats || {};
  const rating = session.execution_rating || "on-plan";
  const isRun = ["Run","TrailRun","VirtualRun"].includes(actual.activity_type);
  const actLabel = actual.activity_name ? `"${actual.activity_name}"` : (actual.activity_type || "Activity");
  const hasActual = actual.distance_km || actual.duration_min || actual.avg_hr || actual.calories;
  const compareHtml = hasActual ? `
    <div class="compare-grid">
      <div class="compare-col">
        <div class="compare-col-label actual">✅ Actual · ${actLabel}</div>
        ${actual.duration_min            ? `<div class="compare-stat"><strong>${actual.duration_min} min</strong> duration</div>` : ""}
        ${isRun && actual.distance_km    ? `<div class="compare-stat"><strong>${actual.distance_km} km</strong> distance</div>` : ""}
        ${actual.avg_hr                  ? `<div class="compare-stat"><strong>${actual.avg_hr} bpm</strong> avg HR</div>` : ""}
        ${isRun && actual.avg_pace       ? `<div class="compare-stat"><strong>${actual.avg_pace}/km</strong> pace</div>` : ""}
        ${actual.calories                ? `<div class="compare-stat"><strong>${actual.calories} kcal</strong> burned</div>` : ""}
        ${actual.elevation_m             ? `<div class="compare-stat"><strong>${actual.elevation_m} m</strong> elevation</div>` : ""}
      </div>
    </div>` : "";

  const coachHtml = session.coach_analysis ? `
    <div class="coach-card">
      <div class="card-label">🧠 COACH ANALYSIS</div>
      <p class="text-sm text-mid" style="line-height:1.6">${session.coach_analysis}</p>
      ${session.coach_adjustment ? `
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(0,212,170,0.15)">
          <div class="text-xs" style="color:var(--orange);font-weight:700;margin-bottom:4px">⚡ SUGGESTED ADJUSTMENT</div>
          <p class="text-sm text-mid"><strong>${session.coach_adjustment.day}:</strong> ${session.coach_adjustment.change}</p>
          <p class="text-xs text-dim" style="margin-top:2px">${session.coach_adjustment.reason || ""}</p>
        </div>` : ""}
    </div>` : "";

  document.getElementById("day-modal-body").innerHTML = `
    <div style="font-size:28px;margin-bottom:6px">✅</div>
    <h2 style="font-size:20px;font-weight:700;margin-bottom:2px">${actual.activity_name || actual.activity_type || "Activity"}</h2>
    <div class="text-sm text-mid" style="margin-bottom:10px">${date}</div>
    <div style="margin-bottom:12px">
      <span class="done-badge" style="color:${_ratingColor(rating)}">${_ratingLabel(rating)}</span>
    </div>
    ${coachHtml}
    ${compareHtml}
    <button class="btn btn-ghost" onclick="closeModal()" style="margin-top:20px">Close</button>
  `;
  document.getElementById("day-modal").classList.add("open");
}

function _renderWeekDays(days, weekOffset) {
  const today = todayDayName();
  return days.map((day, i) => {
    const key = intensityKey(day.intensity);
    const isToday = (weekOffset === 0) && (day.day === today);
    const done = day.completed;
    const actual = day.actual_stats;
    const rating = day.execution_rating;

    if (done) {
      const isRun      = ["Run","TrailRun","VirtualRun"].includes(actual?.activity_type);
      const isSwapped  = rating === "swapped";
      const distLabel  = isRun && actual?.distance_km   ? `${actual.distance_km} km`  : "";
      const hrLabel    = actual?.avg_hr                 ? `${actual.avg_hr} bpm`      : "";
      const paceLabel  = isRun && actual?.avg_pace      ? `${actual.avg_pace}/km`     : "";
      const durLabel   = !isRun && actual?.duration_min ? `${actual.duration_min} min` : "";
      const calLabel   = !isRun && actual?.calories     ? `${actual.calories} kcal`   : "";
      const subParts   = [distLabel, durLabel, hrLabel, paceLabel, calLabel].filter(Boolean);
      // Show actual activity name if it differs from planned (e.g. ran instead of Pilates)
      const actualName = actual?.activity_name || actual?.activity_type;
      const displayTitle = isSwapped
        ? `🔄 ${actualName || day.title}`
        : actualName && actual?.activity_type && !["Run","TrailRun","VirtualRun"].includes(actual.activity_type) === false && day.workout_type === "Cross-Training"
          ? `${actualName}`
          : actualName && actualName !== day.title
            ? `${actualName} <span style="font-size:10px;color:var(--text-dim)">(planned: ${day.title})</span>`
            : day.title;
      return `<div class="day-row done" onclick="openDayModal(${i}, ${weekOffset})">
        <div class="day-abbr">${day.day.slice(0,3).toUpperCase()}</div>
        <div class="day-dot done-dot">${isSwapped ? "🔄" : "✓"}</div>
        <div style="flex:1;min-width:0">
          <div class="day-name">${displayTitle}</div>
          ${subParts.length ? `<div class="done-sub">${subParts.join(" · ")}</div>` : ""}
        </div>
        <div class="done-badge" style="color:${_ratingColor(rating)}">${_ratingLabel(rating)}</div>
        <div class="day-chevron">›</div>
      </div>`;
    }

    const manualSkip = day.date ? getManualSkips()[day.date] : null;
    if (manualSkip && (manualSkip.skipped || manualSkip.moved_from)) {
      const isRescheduled = !!manualSkip.rescheduled_to;
      const isMovedHere   = !!manualSkip.moved_from;
      const subLabel = isRescheduled
        ? `Moved → ${manualSkip.rescheduled_to}`
        : isMovedHere
          ? `↩ Moved from ${manualSkip.moved_from} · ${manualSkip.moved_title || ""}`
          : "Skipped / Rest";
      const badgeLabel = isRescheduled ? "📅 Moved" : isMovedHere ? "↩ From earlier" : "⏭ Skipped";
      const dotIcon = isMovedHere ? "↩" : "⏭";

      return `<div class="day-row done" onclick="openDayModal(${i}, ${weekOffset})">
        <div class="day-abbr">${day.day.slice(0,3).toUpperCase()}</div>
        <div class="day-dot" style="background:var(--text-dim);color:#fff;font-size:11px;display:flex;align-items:center;justify-content:center">${dotIcon}</div>
        <div style="flex:1;min-width:0">
          <div class="day-name" style="color:var(--text-dim)">${day.title}</div>
          <div style="font-size:10px;color:var(--text-dim)">${subLabel}</div>
        </div>
        <div class="done-badge" style="color:var(--text-dim)">${badgeLabel}</div>
        <div class="day-chevron">›</div>
      </div>`;
    }

    return `<div class="day-row${isToday ? " today" : ""}" onclick="openDayModal(${i}, ${weekOffset})">
      <div class="day-abbr${isToday ? " today" : ""}">${day.day.slice(0,3).toUpperCase()}</div>
      <div class="day-dot ${key}"></div>
      <div style="flex:1;min-width:0">
        <div class="day-name">${day.title}</div>
        ${day.coach_adjusted ? `<div style="font-size:10px;color:var(--orange)">⚡ Coach adjusted</div>` : ""}
      </div>
      ${day.distance_km > 0 ? `<div class="text-sm text-mid">${day.distance_km}km</div>` : ""}
      <div class="day-badge ${key}">${day.intensity}</div>
      <div class="day-chevron">›</div>
    </div>`;
  }).join("");
}

function _intensityColor(intensity) {
  const m = { "Rest":"var(--surface3)","Easy":"var(--green)","Moderate":"var(--green)","Tempo":"var(--orange)","Hard":"var(--red)","Long Run":"var(--blue)","Race":"var(--red)" };
  return m[intensity] || "var(--green)";
}

function toggleMonthWeek(idx) {
  const body = document.getElementById(`month-week-body-${idx}`);
  if (body) body.classList.toggle("open");
}

function renderWeek() {
  const el = document.getElementById("week-content");
  const plan = currentPlan;
  if (!plan?.days) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">📭</div><h3>No plan yet</h3><p>Generate a plan from the Today tab.</p></div>`;
    return;
  }

  const hasMonthData = Array.isArray(plan.weeks) && plan.weeks.length > 0;
  const hasRoadmap = hasMonthData || Array.isArray(plan.roadmap) && plan.roadmap.length > 0;
  const weekData = hasMonthData ? (plan.weeks[0] || plan) : plan;

  const toggleHtml = hasMonthData ? `
    <div class="view-toggle">
      <button class="view-toggle-btn${weekViewMode === "week" ? " active" : ""}" onclick="setWeekView('week')">This Week</button>
      <button class="view-toggle-btn${weekViewMode === "month" ? " active" : ""}" onclick="setWeekView('month')">4-Week Plan</button>
    </div>` : "";

  const macroTimeline = _renderMacroTimeline();

  if (weekViewMode === "month" && hasMonthData) {
    const monthCardsHtml = plan.weeks.map((week, idx) => {
      const dotsHtml = (week.days || []).map(day => {
        const color = _intensityColor(day.intensity);
        const abbr = day.day ? day.day.slice(0,1) : "";
        return `<div class="month-week-dot" style="background:${color}">${abbr}</div>`;
      }).join("");

      return `
        <div class="month-week">
          <div class="month-week-header" onclick="toggleMonthWeek(${idx})">
            <div>
              <div style="font-weight:700;font-size:14px">Week ${week.week_number || idx+1}</div>
              <div class="text-xs text-dim">${week.phase || ""} · ${week.total_distance_km || 0} km</div>
            </div>
            <div style="color:var(--text-dim);font-size:18px">›</div>
          </div>
          <div class="month-week-dots">${dotsHtml}</div>
          <div class="month-week-body" id="month-week-body-${idx}">
            ${_renderWeekDays(week.days || [], idx)}
          </div>
        </div>`;
    }).join("");

    el.innerHTML = `
      <div class="page-title">Training Plan</div>
      <div class="page-sub">4-Week block overview</div>
      ${macroTimeline}
      ${toggleHtml}
      ${monthCardsHtml}
    `;
  } else {
    const today = todayDayName();
    el.innerHTML = `
      <div class="page-title">This Week</div>
      <div class="page-sub">Week ${weekData.week_number || 1} · ${weekData.phase || ""}</div>
      ${_workflowBanner()}
      ${macroTimeline}
      ${toggleHtml}
      ${_renderRecentCompleted()}
      ${_renderWeekDays(weekData.days || [], 0)}
      <div class="legend" style="margin-top:8px">
        <div class="legend-label">INTENSITY LEGEND</div>
        <div class="legend-item"><div class="legend-dot" style="background:var(--green)"></div> Easy</div>
        <div class="legend-item"><div class="legend-dot" style="background:var(--orange)"></div> Tempo</div>
        <div class="legend-item"><div class="legend-dot" style="background:var(--red)"></div> Hard</div>
        <div class="legend-item"><div class="legend-dot" style="background:var(--blue)"></div> Long Run</div>
        <div class="legend-item"><div class="legend-dot" style="background:var(--surface3);border:1px solid var(--border)"></div> Rest</div>
      </div>
    `;
  }
}

// ── Time picker helpers ───────────────────────────────────────────────────────

function _parseTargetTime(str) {
  // Returns { h, m } from stored "H:MM:SS" or "H:MM" or ""
  if (!str) return { h: 3, m: 45 };
  const parts = str.split(":").map(Number);
  if (parts.length >= 2) return { h: parts[0], m: parts[1] };
  return { h: 3, m: 45 };
}

function _renderTimePicker(savedTime) {
  const { h, m } = _parseTargetTime(savedTime);
  const hourOpts = Array.from({ length: 7 }, (_, i) =>
    `<option value="${i}" ${i === h ? "selected" : ""}>${i}h</option>`
  ).join("");
  const minOpts = [0,5,10,15,20,25,30,35,40,45,50,55].map(v =>
    `<option value="${v}" ${v === m ? "selected" : ""}>${String(v).padStart(2,"0")}m</option>`
  ).join("");
  return `<div style="display:flex;gap:8px;align-items:center">
    <select id="g-time-h" class="form-input" style="flex:1" onchange="_updateTimePreview()">${hourOpts}</select>
    <select id="g-time-m" class="form-input" style="flex:1" onchange="_updateTimePreview()">${minOpts}</select>
  </div>`;
}

function _updateTimePreview() {
  const h = parseInt(document.getElementById("g-time-h")?.value || "0");
  const m = parseInt(document.getElementById("g-time-m")?.value || "0");
  const el = document.getElementById("g-time-preview");
  if (el) el.textContent = h === 0 && m === 0 ? "No target time set" : `Target: ${h}h ${m}m`;
}

function _readTargetTime() {
  const h = parseInt(document.getElementById("g-time-h")?.value || "0");
  const m = parseInt(document.getElementById("g-time-m")?.value || "0");
  if (h === 0 && m === 0) return "";
  return `${h}:${String(m).padStart(2,"0")}:00`;
}

// ── Render: GOALS ────────────────────────────────────────────────────────────

function renderGoals() {
  const el = document.getElementById("goals-content");
  const s = getSettings();
  const d2r = daysToRace(s.race_date);

  const days = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  const savedDays = s.run_days || ["Tuesday","Thursday","Saturday","Sunday"];

  const ct = s.cross_training || [];
  const ctHtml = _renderCTSection(ct);

  const qualityEnabled = s.quality_enabled || false;
  const qualitySessions = s.quality_sessions || 2;
  const qualityTypes = s.quality_types || [];
  const qtypes = ["intervals","tempo","fartlek","hills"];
  const qualityHtml = `
    <div class="card">
      <div class="card-label">⚡ QUALITY SESSIONS</div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <input type="checkbox" id="g-quality-enabled" ${qualityEnabled ? "checked" : ""}
            onchange="toggleQualitySection(this.checked)" style="accent-color:var(--orange);width:18px;height:18px"/>
          <span style="font-size:14px;font-weight:600">Include speed/interval training</span>
        </label>
      </div>
      <div id="quality-details" style="display:${qualityEnabled ? "block" : "none"}">
        <div class="form-group" style="margin-top:12px">
          <label class="form-label">Quality sessions per week: <span id="g-quality-sessions-val">${qualitySessions}</span></label>
          <input id="g-quality-sessions" type="range" min="1" max="3" step="1" value="${qualitySessions}"
            oninput="document.getElementById('g-quality-sessions-val').textContent=this.value"/>
        </div>
        <div class="form-group" style="margin-top:12px">
          <label class="form-label">Session types</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">
            ${qtypes.map(qt => `
              <button class="quality-chip${qualityTypes.includes(qt) ? " selected" : ""}"
                onclick="toggleQualityType('${qt}')" id="qchip-${qt}">
                ${qt.charAt(0).toUpperCase()+qt.slice(1)}
              </button>`).join("")}
          </div>
        </div>
      </div>
    </div>`;

  const skipCt = s.weekly_skip_ct || [];
  const weeklyExceptionsHtml = ct.length > 0 ? `
    <div class="card">
      <div class="card-label">🔄 THIS WEEK EXCEPTIONS</div>
      <div class="info-box" style="margin-bottom:14px">Tell the coach if you're skipping a usual activity this week — it may free up a slot for a run</div>
      ${ct.map(act => {
        const isSkipped = skipCt.includes(act.id);
        return `<div class="ct-item">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:14px;font-weight:600">${act.emoji} ${act.label}</span>
            <div class="skip-toggle">
              <button class="skip-btn${!isSkipped ? " active-doing" : ""}"
                onclick="setSkipCT('${act.id}', false)">Doing it ✓</button>
              <button class="skip-btn${isSkipped ? " active-skip" : ""}"
                onclick="setSkipCT('${act.id}', true)">Skipping ✗</button>
            </div>
          </div>
        </div>`;
      }).join("")}
    </div>` : "";

  el.innerHTML = `
    <div class="page-title">Training Goals</div>
    <div class="page-sub">Set your goal and generate a personalised plan</div>

    <div class="card">
      <div class="card-label">🎯 RACE GOAL</div>
      <div class="form-group">
        <label class="form-label">Event Type</label>
        <select id="g-goal" class="form-input">
          <option value="Marathon" ${s.goal==="Marathon"?"selected":""}>Marathon</option>
          <option value="Half Marathon" ${s.goal==="Half Marathon"?"selected":""}>Half Marathon</option>
          <option value="10km" ${s.goal==="10km"?"selected":""}>10 km Race</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Race Name</label>
        <input id="g-race-name" class="form-input" type="text" placeholder="e.g. Tel Aviv Marathon 2026" value="${s.race_name||""}"/>
      </div>
      <div class="form-group">
        <label class="form-label">Race Date</label>
        <input id="g-race-date" class="form-input" type="date" value="${s.race_date||""}"/>
      </div>
      <div class="form-group">
        <label class="form-label">Target Finish Time</label>
        ${_renderTimePicker(s.target_time || "")}
        <div class="text-xs text-dim" style="margin-top:4px" id="g-time-preview"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-label">📆 WEEKLY SCHEDULE</div>
      <div class="form-group">
        <label class="form-label">Plan Start Date</label>
        <input id="g-start-date" class="form-input" type="date" value="${s.start_date||""}"/>
        <span class="text-xs text-dim" style="margin-top:2px">Leave empty to start from next Monday</span>
      </div>
      <div class="form-group" style="margin-top:4px">
        <label class="form-label">Running Days</label>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px">
          ${days.map(d => `
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;background:var(--surface2);border:1px solid ${savedDays.includes(d)?"var(--accent)":"var(--border)"};border-radius:8px;padding:7px 12px;font-size:13px;font-weight:500;color:${savedDays.includes(d)?"var(--accent)":"var(--text-dim)"};transition:all 0.15s">
              <input type="checkbox" id="g-day-${d}" value="${d}" ${savedDays.includes(d)?"checked":""} style="accent-color:var(--accent)" onchange="updateDayLabel(this)"/>
              ${d.slice(0,3)}
            </label>`).join("")}
        </div>
      </div>
      <div class="form-group" style="margin-top:4px">
        <label class="form-label">Sessions per Week: <span id="g-sessions-val">${s.sessions_per_week||4}</span></label>
        <input id="g-sessions" type="range" min="2" max="7" step="1" value="${s.sessions_per_week||4}"
          oninput="document.getElementById('g-sessions-val').textContent=this.value"/>
        <div class="text-xs text-dim" style="margin-top:2px">AI will pick the best ${s.sessions_per_week||4} days from your selected days above</div>
      </div>
      <div class="form-group">
        <label class="form-label">Weekly Hours Budget: <span id="g-hours-val">${s.weekly_hours||7}</span>h</label>
        <input id="g-hours" type="range" min="3" max="15" step="0.5" value="${s.weekly_hours||7}"
          oninput="document.getElementById('g-hours-val').textContent=this.value"/>
      </div>
      ${d2r !== null ? `<div class="info-box">📅 ${d2r >= 0 ? `${d2r} days to race` : `Race was ${Math.abs(d2r)} days ago`}</div>` : ""}
    </div>

    ${ctHtml}
    ${qualityHtml}
    ${weeklyExceptionsHtml}

    <button class="btn btn-green" onclick="saveGoalsAndGenerate()" style="margin-bottom:10px">⚡ Save &amp; Generate Plan</button>
    <button class="btn btn-ghost" onclick="saveGoalsOnly()">💾 Save Goals Only</button>
    <p class="text-xs text-dim" style="text-align:center;margin-top:10px">Fetches your latest Strava runs · AI builds a personalised week</p>

    ${currentPlan ? `
    <div class="card" style="margin-top:16px">
      <div class="card-label">CURRENT PLAN</div>
      <div class="form-row"><span class="form-row-label">Phase</span><span class="form-row-value">${currentPlan.phase||"—"}</span></div>
      <div class="form-row"><span class="form-row-label">Total Distance</span><span class="form-row-value">${currentPlan.total_distance_km||"—"} km</span></div>
      ${currentPlan.generated_at ? `<div class="text-xs text-dim mt-8">Generated ${new Date(currentPlan.generated_at).toLocaleDateString()} by Claude AI</div>` : ""}

      <div class="card-label" style="margin-top:14px">ADD TO GOOGLE CALENDAR</div>
      <p class="text-sm text-mid" style="margin-bottom:10px;line-height:1.5">Tap a workout to add it to your calendar.</p>
      ${(currentPlan.days||[]).filter(d => d.distance_km > 0).map(day => {
        const url = gcalUrl(day);
        const key = intensityKey(day.intensity);
        return `<a href="${url}" target="_blank" style="text-decoration:none">
          <div class="day-row" style="margin-bottom:8px">
            <div class="day-abbr">${day.day.slice(0,3).toUpperCase()}</div>
            <div class="day-dot ${key}"></div>
            <div class="day-name">${day.title}</div>
            <div class="text-sm text-mid">${day.distance_km}km</div>
            <div style="color:var(--accent);font-size:20px">+</div>
          </div>
        </a>`;
      }).join("")}
    </div>` : ""}
  `;
}

// ── Cross-Training helpers ────────────────────────────────────────────────────

function _renderCTSection(ct) {
  const selectedIds = ct.map(a => a.id);
  const dayNames = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

  const pillsHtml = CROSS_TRAINING_ACTIVITIES.map(act => `
    <button class="activity-pill${selectedIds.includes(act.id) ? " selected" : ""}"
      onclick="toggleCrossTraining('${act.id}')" id="ct-pill-${act.id}">
      ${act.emoji} ${act.label}
    </button>`).join("");

  const selectedActivities = ct.filter(a => CROSS_TRAINING_ACTIVITIES.find(x => x.id === a.id));
  const dayPickersHtml = selectedActivities.map(act => {
    const actDef = CROSS_TRAINING_ACTIVITIES.find(x => x.id === act.id);
    const selectedDays = act.days || [];
    const chips = dayNames.map(d => `
      <button class="day-chip${selectedDays.includes(d) ? " selected" : ""}"
        onclick="toggleCTDay('${act.id}','${d}')" id="ctday-${act.id}-${d}">
        ${d.slice(0,3)}
      </button>`).join("");
    return `<div class="ct-item">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px">${actDef ? actDef.emoji : ""} ${act.label} — which days?</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${chips}</div>
    </div>`;
  }).join("");

  return `
    <div class="card" id="ct-card">
      <div class="card-label">💪 CROSS-TRAINING</div>
      <div class="activity-pill-grid" id="ct-pills">${pillsHtml}</div>
      <div id="ct-day-pickers">${dayPickersHtml}</div>
    </div>`;
}

function toggleCrossTraining(id) {
  const s = getSettings();
  let ct = s.cross_training || [];
  const idx = ct.findIndex(a => a.id === id);
  if (idx >= 0) {
    ct.splice(idx, 1);
  } else {
    const def = CROSS_TRAINING_ACTIVITIES.find(a => a.id === id);
    if (def) ct.push({ id: def.id, label: def.label, emoji: def.emoji, days: [] });
  }
  saveSettings({ cross_training: ct });

  // Re-render just the CT card contents
  const card = document.getElementById("ct-card");
  if (card) {
    const newHtml = _renderCTSection(ct);
    const tmp = document.createElement("div");
    tmp.innerHTML = newHtml;
    card.innerHTML = tmp.querySelector("#ct-card").innerHTML;
  }

  // Re-render weekly exceptions if visible
  _rerenderWeeklyExceptions();
}

function toggleCTDay(actId, day) {
  const s = getSettings();
  let ct = s.cross_training || [];
  const act = ct.find(a => a.id === actId);
  if (!act) return;
  const dayIdx = act.days.indexOf(day);
  if (dayIdx >= 0) {
    act.days.splice(dayIdx, 1);
  } else {
    act.days.push(day);
  }
  saveSettings({ cross_training: ct });

  // Update chip styling only
  const btn = document.getElementById(`ctday-${actId}-${day}`);
  if (btn) {
    btn.classList.toggle("selected", act.days.includes(day));
  }
}

function _rerenderWeeklyExceptions() {
  // Find the weekly exceptions card and re-render it
  const s = getSettings();
  const ct = s.cross_training || [];
  const skipCt = s.weekly_skip_ct || [];

  // Look for existing exceptions card and update
  const cards = document.querySelectorAll(".card");
  let exceptCard = null;
  cards.forEach(c => {
    if (c.querySelector(".card-label")?.textContent?.includes("THIS WEEK EXCEPTIONS")) {
      exceptCard = c;
    }
  });

  if (ct.length === 0 && exceptCard) {
    exceptCard.remove();
    return;
  }

  if (ct.length > 0) {
    const newCardHtml = `
      <div class="card-label">🔄 THIS WEEK EXCEPTIONS</div>
      <div class="info-box" style="margin-bottom:14px">Tell the coach if you're skipping a usual activity this week — it may free up a slot for a run</div>
      ${ct.map(act => {
        const isSkipped = skipCt.includes(act.id);
        return `<div class="ct-item">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:14px;font-weight:600">${act.emoji} ${act.label}</span>
            <div class="skip-toggle">
              <button class="skip-btn${!isSkipped ? " active-doing" : ""}"
                onclick="setSkipCT('${act.id}', false)">Doing it ✓</button>
              <button class="skip-btn${isSkipped ? " active-skip" : ""}"
                onclick="setSkipCT('${act.id}', true)">Skipping ✗</button>
            </div>
          </div>
        </div>`;
      }).join("")}`;
    if (exceptCard) {
      exceptCard.innerHTML = newCardHtml;
    }
  }
}

function toggleQualitySection(enabled) {
  const el = document.getElementById("quality-details");
  if (el) el.style.display = enabled ? "block" : "none";
  const s = getSettings();
  saveSettings({ quality_enabled: enabled });
}

function toggleQualityType(qt) {
  const s = getSettings();
  let types = s.quality_types || [];
  const idx = types.indexOf(qt);
  if (idx >= 0) {
    types.splice(idx, 1);
  } else {
    types.push(qt);
  }
  saveSettings({ quality_types: types });
  const btn = document.getElementById(`qchip-${qt}`);
  if (btn) btn.classList.toggle("selected", types.includes(qt));
}

function setSkipCT(actId, skip) {
  const s = getSettings();
  let skipCt = s.weekly_skip_ct || [];
  const idx = skipCt.indexOf(actId);
  if (skip && idx < 0) {
    skipCt.push(actId);
  } else if (!skip && idx >= 0) {
    skipCt.splice(idx, 1);
  }
  saveSettings({ weekly_skip_ct: skipCt });

  // Update button styling
  const doingBtn = document.querySelector(`[onclick="setSkipCT('${actId}', false)"]`);
  const skipBtn = document.querySelector(`[onclick="setSkipCT('${actId}', true)"]`);
  if (doingBtn) {
    doingBtn.className = `skip-btn${!skip ? " active-doing" : ""}`;
  }
  if (skipBtn) {
    skipBtn.className = `skip-btn${skip ? " active-skip" : ""}`;
  }
}

function updateDayLabel(cb) {
  const label = cb.closest("label");
  if (cb.checked) {
    label.style.borderColor = "var(--accent)";
    label.style.color = "var(--accent)";
  } else {
    label.style.borderColor = "var(--border)";
    label.style.color = "var(--text-dim)";
  }
}

function _getSelectedDays() {
  const days = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  return days.filter(d => document.getElementById(`g-day-${d}`)?.checked);
}

function saveGoalsOnly() {
  _saveGoalFields();
  showToast("✅ Goals saved");
  renderGoals();
}

async function saveGoalsAndGenerate() {
  const fields = _saveGoalFields();
  showToast("✅ Goals saved — generating plan…");
  const ok = await triggerWorkflow("weekly-plan.yml", {
    start_date:       fields.start_date || "",
    run_days:         fields.run_days.join(","),
    sessions_per_week: String(fields.sessions_per_week),
    weekly_hours:     String(fields.weekly_hours),
    training_goal:    fields.goal || "",
    target_time:      fields.target_time || "",
    race_name:        fields.race_name || "",
    race_date:        fields.race_date || "",
    cross_training:   JSON.stringify(fields.cross_training || []),
    quality_sessions: fields.quality_enabled ? String(fields.quality_sessions || 2) : "0",
    quality_types:    (fields.quality_types || []).join(","),
    weekly_skip_ct:   (fields.weekly_skip_ct || []).join(","),
  });
  if (!ok) return;
  _setWorkflowPending("generate", "Generating your personalised plan… this takes about 90 seconds");
  navigate("week");
  setTimeout(async () => {
    [currentPlan, currentAnalytics, completedSessions] = await Promise.all([
      fetchPlan(), fetchAnalytics(), fetchCompletedSessions(),
    ]);
    _clearWorkflowPending();
    renderScreen(currentScreen);
    showToast("✅ New plan is ready — check your week view!", 6000);
  }, 90000);
}

function _saveGoalFields() {
  const s = getSettings();
  const fields = {
    goal:              document.getElementById("g-goal").value,
    race_name:         document.getElementById("g-race-name").value,
    race_date:         document.getElementById("g-race-date").value,
    target_time:       _readTargetTime(),
    start_date:        document.getElementById("g-start-date").value,
    run_days:          _getSelectedDays(),
    sessions_per_week: parseInt(document.getElementById("g-sessions").value),
    weekly_hours:      parseFloat(document.getElementById("g-hours").value),
    // Cross-training: read from current settings (updated in real time by toggleCrossTraining/toggleCTDay)
    cross_training:    (getSettings()).cross_training || [],
    quality_enabled:   document.getElementById("g-quality-enabled")?.checked || false,
    quality_sessions:  parseInt(document.getElementById("g-quality-sessions")?.value || "2"),
    quality_types:     (getSettings()).quality_types || [],
    weekly_skip_ct:    (getSettings()).weekly_skip_ct || [],
  };
  saveSettings(fields);
  return fields;
}

// ── Render: SETTINGS ──────────────────────────────────────────────────────────

function renderSettings() {
  const el = document.getElementById("settings-content");

  el.innerHTML = `
    <!-- Strava -->
    <div class="settings-section">
      <div class="settings-header"><span class="icon" style="color:var(--orange)">🔶</span> Strava Connection</div>
      <div class="settings-body">
        <div class="info-box">✅ Connected via OAuth. Your Strava runs are fetched automatically when generating a plan.</div>
        <button class="btn btn-accent" onclick="syncFromStrava()" style="margin-top:10px">🔄 Sync Session</button>
        <p class="text-xs text-dim" style="margin-top:6px">Marks completed workouts · Coach analyses each session · Refreshes the Analytics tab. Does not change your plan.</p>
      </div>
    </div>

    <!-- Google Calendar -->
    <div class="settings-section">
      <div class="settings-header"><span class="icon">📅</span> Google Calendar</div>
      <div class="settings-body">
        <div class="info-box">Tap any workout in the Goals tab to open Google Calendar on your device and add it with one tap. No API keys needed.</div>
      </div>
    </div>

    <!-- Account -->
    <div class="settings-section">
      <div class="settings-header"><span class="icon">👤</span> Account</div>
      <div class="settings-body">
        <button class="btn btn-ghost" onclick="if(confirm('Log out?'))logout()">Log Out</button>
      </div>
    </div>
  `;
}

async function syncFromStrava() {
  showToast("⏳ Syncing session with Strava…");
  const ok = await triggerWorkflow("sync-session.yml");
  if (!ok) return;
  _setWorkflowPending("sync", "Syncing session · coach is analysing your run…");
  renderScreen(currentScreen);
  setTimeout(async () => {
    [currentPlan, currentAnalytics, completedSessions] = await Promise.all([
      fetchPlan(), fetchAnalytics(), fetchCompletedSessions(),
    ]);
    _clearWorkflowPending();
    renderScreen(currentScreen);
    showToast("✅ Session synced — tap the day to see coach analysis", 5000);
  }, 75000);
}


// ── Day Modal ─────────────────────────────────────────────────────────────────

function openDayModal(i, weekOffset) {
  weekOffset = weekOffset || 0;
  let days;
  if (weekOffset > 0 && currentPlan?.weeks?.[weekOffset]) {
    days = currentPlan.weeks[weekOffset].days;
  } else {
    days = currentPlan?.days;
  }
  const day = days?.[i];
  if (!day) return;
  const key = intensityKey(day.intensity);
  const done = day.completed;
  const actual = day.actual_stats || {};
  const rating = day.execution_rating;

  // ── Completed session modal ──
  if (done) {
    const isRun     = ["Run","TrailRun","VirtualRun"].includes(actual?.activity_type);
    const actLabel  = actual?.activity_name ? `"${actual.activity_name}"` : (actual?.activity_type || "Activity");
    const hasActual = actual.distance_km || actual.duration_min || actual.avg_hr || actual.calories;
    const compareHtml = hasActual ? `
      <div class="compare-grid">
        <div class="compare-col">
          <div class="compare-col-label actual">✅ Actual · ${actLabel}</div>
          ${actual.duration_min                    ? `<div class="compare-stat"><strong>${actual.duration_min} min</strong> duration</div>` : ""}
          ${isRun && actual.distance_km            ? `<div class="compare-stat"><strong>${actual.distance_km} km</strong> distance</div>` : ""}
          ${actual.avg_hr                          ? `<div class="compare-stat"><strong>${actual.avg_hr} bpm</strong> avg HR</div>` : ""}
          ${isRun && actual.avg_pace               ? `<div class="compare-stat"><strong>${actual.avg_pace}/km</strong> pace</div>` : ""}
          ${actual.calories                        ? `<div class="compare-stat"><strong>${actual.calories} kcal</strong> burned</div>` : ""}
          ${actual.elevation_m                     ? `<div class="compare-stat"><strong>${actual.elevation_m} m</strong> elevation</div>` : ""}
        </div>
        <div class="compare-col">
          <div class="compare-col-label planned">📋 Planned</div>
          ${day.duration_min ? `<div class="compare-stat"><strong>${day.duration_min} min</strong> duration</div>` : ""}
          ${day.distance_km  ? `<div class="compare-stat"><strong>${day.distance_km} km</strong> distance</div>` : ""}
          ${day.hr_zone      ? `<div class="compare-stat"><strong>${day.hr_zone}</strong></div>` : ""}
          ${day.intensity    ? `<div class="compare-stat"><strong>${day.intensity}</strong> intensity</div>` : ""}
        </div>
      </div>` : "";

    const coachHtml = day.coach_analysis ? `
      <div class="coach-card">
        <div class="card-label">🧠 COACH ANALYSIS</div>
        <p class="text-sm text-mid" style="line-height:1.6">${day.coach_analysis}</p>
        ${day.coach_adjustment ? `
          <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(0,212,170,0.15)">
            <div class="text-xs" style="color:var(--orange);font-weight:700;margin-bottom:4px">⚡ SUGGESTED ADJUSTMENT</div>
            <p class="text-sm text-mid"><strong>${day.coach_adjustment.day}:</strong> ${day.coach_adjustment.change}</p>
            <p class="text-xs text-dim" style="margin-top:2px">${day.coach_adjustment.reason || ""}</p>
          </div>` : ""}
      </div>` : "";

    const swapBanner = day.day_swap ? `
      <div style="background:var(--surface2);border-radius:8px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:8px">
        <span style="font-size:18px">📅</span>
        <span class="text-sm text-dim">Day swap detected — you moved this run from ${day.swapped_from_date || "another day"} to here. Nice flexibility!</span>
      </div>` : "";

    const swappedDayBanner = (done && rating === "swapped") ? `
      <div style="background:var(--surface2);border-radius:8px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:8px">
        <span style="font-size:18px">🔄</span>
        <span class="text-sm text-dim">${day.coach_analysis || "You swapped this day — your run was credited to the planned run day."}</span>
      </div>` : "";

    document.getElementById("day-modal-body").innerHTML = `
      <div style="font-size:28px;margin-bottom:6px">${rating === "swapped" ? "🔄" : "✅"}</div>
      <h2 style="font-size:20px;font-weight:700;margin-bottom:2px">${day.title}</h2>
      <div class="text-sm text-mid" style="margin-bottom:10px">${day.day}${day.date ? " · " + day.date : ""}</div>
      <div style="margin-bottom:12px">
        <span class="done-badge" style="color:${_ratingColor(rating)}">${_ratingLabel(rating)}</span>
      </div>
      ${swapBanner}${swappedDayBanner}
      ${coachHtml}
      ${compareHtml}
      ${day.description ? `<p class="text-sm text-mid" style="line-height:1.6;margin-top:4px">${day.description}</p>` : ""}
      <button class="btn btn-ghost" onclick="closeModal()" style="margin-top:20px">Close</button>
    `;
    document.getElementById("day-modal").classList.add("open");
    return;
  }

  // ── Upcoming/planned session modal ──
  const manualSkip = day.date ? getManualSkips()[day.date] : null;

  const plannedStatsHtml = day.distance_km > 0 ? `
    <div class="stats-grid" style="margin-bottom:14px">
      <div class="stat-box"><div class="stat-val">${day.distance_km}<span class="stat-unit"> km</span></div><div class="stat-lbl">Distance</div></div>
      <div class="stat-box"><div class="stat-val">${day.duration_min}<span class="stat-unit"> min</span></div><div class="stat-lbl">Duration</div></div>
    </div>` : "";

  const skipBtnHtml = day.date ? (
    manualSkip
      ? `<button class="btn btn-ghost" onclick="unmarkDaySkipped('${day.date}')" style="margin-top:10px;color:var(--text-mid)">↩ Undo</button>`
      : `<button class="btn btn-ghost" onclick="showSkipOrRescheduleModal('${day.date}', \`${day.title.replace(/`/g,"'")}\`)" style="margin-top:10px;color:var(--text-dim)">⏭ Skip / Move to Another Day</button>`
  ) : "";

  const skippedBanner = manualSkip ? `
    <div style="background:var(--surface2);border-radius:8px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:8px">
      <span style="font-size:18px">⏭</span>
      <span class="text-sm text-dim">You marked this day as skipped / rest.</span>
    </div>` : "";

  document.getElementById("day-modal-body").innerHTML = `
    <div style="font-size:32px;margin-bottom:8px">${workoutEmoji(day.workout_type, day.intensity)}</div>
    <h2 style="font-size:20px;font-weight:700;margin-bottom:4px">${day.title}</h2>
    <div class="text-sm text-mid">${day.day}${day.date ? " · " + day.date : ""}</div>
    <div style="margin:12px 0"><span class="day-badge ${key}">${day.intensity}</span>${day.hr_zone ? ` <span class="day-badge easy" style="margin-left:6px">${day.hr_zone}</span>` : ""}</div>
    ${skippedBanner}
    ${plannedStatsHtml}
    <p class="text-sm text-mid" style="line-height:1.6;margin-bottom:10px">${day.description||""}</p>
    ${day.key_focus ? `<p class="text-sm"><strong>Focus:</strong> <span class="text-mid">${day.key_focus}</span></p>` : ""}
    ${day.notes ? `<p class="text-sm mt-8"><strong>Notes:</strong> <span class="text-mid">${day.notes}</span></p>` : ""}
    ${skipBtnHtml}
    <button class="btn btn-ghost" onclick="closeModal()" style="margin-top:10px">Close</button>
  `;
  document.getElementById("day-modal").classList.add("open");
}

// ── Render: ANALYSE ───────────────────────────────────────────────────────────

function svgBarChart(weeks) {
  if (!weeks || !weeks.length) return "";
  const W = 320, H = 120, pad = { l: 32, r: 8, t: 8, b: 24 };
  const inner = { w: W - pad.l - pad.r, h: H - pad.t - pad.b };
  const maxKm = Math.max(...weeks.map(w => w.total_km || 0), 1);
  const barW = Math.floor(inner.w / weeks.length) - 3;

  const bars = weeks.map((w, i) => {
    const bh = Math.round(((w.total_km || 0) / maxKm) * inner.h);
    const x = pad.l + i * (inner.w / weeks.length) + 1;
    const y = pad.t + inner.h - bh;
    const label = (w.week_start || "").slice(5); // MM-DD
    return `
      <rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="3" fill="var(--accent)" opacity="0.85"/>
      <text x="${x + barW/2}" y="${H - 4}" text-anchor="middle" font-size="8" fill="var(--text-dim)">${label}</text>
      ${bh > 14 ? `<text x="${x + barW/2}" y="${y + 12}" text-anchor="middle" font-size="9" fill="var(--bg)">${w.total_km}</text>` : ""}
    `;
  }).join("");

  const yLines = [0, 0.5, 1].map(t => {
    const y = pad.t + inner.h - Math.round(t * inner.h);
    const val = Math.round(t * maxKm);
    return `
      <line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="var(--border)" stroke-width="0.5"/>
      <text x="${pad.l - 4}" y="${y + 4}" text-anchor="end" font-size="8" fill="var(--text-dim)">${val}</text>
    `;
  }).join("");

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;overflow:visible">${yLines}${bars}</svg>`;
}

function svgLineChart(weeks, key, color) {
  if (!weeks || !weeks.length) return "";
  const points = weeks.map((w, i) => ({ x: i, y: w[key] })).filter(p => p.y != null);
  if (points.length < 2) return "<p class='text-xs text-dim'>Not enough data</p>";

  const W = 320, H = 90, pad = { l: 32, r: 8, t: 8, b: 20 };
  const inner = { w: W - pad.l - pad.r, h: H - pad.t - pad.b };
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeY = maxY - minY || 1;
  const n = weeks.length;

  const toX = x => pad.l + (x / (n - 1)) * inner.w;
  const toY = y => pad.t + inner.h - ((y - minY) / rangeY) * inner.h;

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.x).toFixed(1)},${toY(p.y).toFixed(1)}`).join(" ");
  const dots = points.map(p => `<circle cx="${toX(p.x).toFixed(1)}" cy="${toY(p.y).toFixed(1)}" r="3" fill="${color}"/>`).join("");
  const labels = points.map(p => {
    const w = weeks[p.x];
    return `<text x="${toX(p.x).toFixed(1)}" y="${H - 2}" text-anchor="middle" font-size="8" fill="var(--text-dim)">${(w.week_start||"").slice(5)}</text>`;
  }).join("");

  const yLines = [minY, (minY+maxY)/2, maxY].map(v => {
    const y = toY(v);
    return `
      <line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="var(--border)" stroke-width="0.5"/>
      <text x="${pad.l - 4}" y="${y + 4}" text-anchor="end" font-size="8" fill="var(--text-dim)">${Math.round(v)}</text>
    `;
  }).join("");

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;overflow:visible">
    ${yLines}
    <path d="${pathD}" fill="none" stroke="${color}" stroke-width="2"/>
    ${dots}
    ${labels}
  </svg>`;
}

function trendColor(trend) {
  return trend === "improving" ? "var(--green)" : trend === "declining" ? "var(--red)" : "var(--orange)";
}

function fatigueBadge(level) {
  const map = { low: "green", moderate: "orange", high: "red", critical: "red" };
  return `<span class="day-badge ${map[level]||"easy"}">${level}</span>`;
}

function renderAnalytics() {
  const el = document.getElementById("analyse-content");
  const a = currentAnalytics;

  if (!a) {
    el.innerHTML = `
      <div class="page-title">Analytics</div>
      <div class="page-sub">8-week performance overview</div>
      <div class="empty">
        <div class="empty-icon">📊</div>
        <h3>No analytics yet</h3>
        <p>Sync a session from Settings — analytics update automatically with every sync.</p>
        <button class="btn btn-ghost" onclick="navigate('settings')" style="margin-top:12px">Go to Settings →</button>
      </div>
    `;
    return;
  }

  const weeks = a.weeks_analysis || a.raw_weeks || [];
  const ratio = a.acute_chronic_ratio;
  const ratioColor = ratio > 1.3 ? "var(--red)" : ratio < 0.8 ? "var(--orange)" : "var(--green)";

  el.innerHTML = `
    <div class="page-title">Analytics</div>
    <div class="page-sub">${a.generated_at ? "Updated " + new Date(a.generated_at).toLocaleDateString() + " · auto-refreshes on sync" : "8-week performance overview"}</div>

    <!-- Status cards -->
    <div class="stats-grid" style="margin-bottom:14px">
      <div class="stat-box" style="border:1px solid var(--border)">
        <div class="stat-val" style="color:${trendColor(a.fitness_trend)};text-transform:capitalize">${a.fitness_trend || "—"}</div>
        <div class="stat-lbl">Fitness Trend</div>
      </div>
      <div class="stat-box" style="border:1px solid var(--border)">
        <div class="stat-val" style="text-transform:capitalize">${fatigueBadge(a.fatigue_level)}</div>
        <div class="stat-lbl">Fatigue Level</div>
      </div>
      <div class="stat-box" style="border:1px solid var(--border)">
        <div class="stat-val" style="color:${ratioColor}">${ratio != null ? ratio.toFixed(2) : "—"}</div>
        <div class="stat-lbl">Acute:Chronic</div>
      </div>
      <div class="stat-box" style="border:1px solid var(--border)">
        <div class="stat-val" style="color:${(a.hr_trend_bpm_per_week||0) < 0 ? "var(--green)" : "var(--orange)"}">
          ${a.hr_trend_bpm_per_week != null ? (a.hr_trend_bpm_per_week > 0 ? "+" : "") + a.hr_trend_bpm_per_week.toFixed(1) : "—"}<span class="stat-unit"> bpm/wk</span>
        </div>
        <div class="stat-lbl">HR Trend</div>
      </div>
    </div>

    <!-- Weekly Mileage Chart -->
    <div class="card">
      <div class="card-label" style="margin-bottom:12px">WEEKLY MILEAGE (km)</div>
      ${svgBarChart(weeks)}
    </div>

    <!-- HR Trend Chart -->
    <div class="card">
      <div class="card-label" style="margin-bottom:12px">AVG HEART RATE TREND (bpm)</div>
      ${svgLineChart(weeks, "avg_hr", "var(--red)")}
      <p class="text-xs text-dim" style="margin-top:6px">Falling HR at same effort = aerobic fitness improving</p>
    </div>

    <!-- VO2 Max Trend -->
    ${weeks.some(w => w.vo2_max) ? `
    <div class="card">
      <div class="card-label" style="margin-bottom:12px">VO₂ MAX TREND</div>
      ${svgLineChart(weeks, "vo2_max", "var(--blue)")}
    </div>` : ""}

    <!-- Key Observations -->
    ${a.key_observations?.length ? `
    <div class="card">
      <div class="card-label" style="margin-bottom:10px">🔍 KEY OBSERVATIONS</div>
      ${a.key_observations.map(o => `
        <div style="display:flex;gap:8px;margin-bottom:10px;align-items:flex-start">
          <span style="color:var(--accent);flex-shrink:0">→</span>
          <span class="text-sm text-mid" style="line-height:1.5">${o}</span>
        </div>`).join("")}
    </div>` : ""}

    <!-- Warnings -->
    ${a.warnings?.length ? `
    <div class="card" style="border-color:rgba(239,68,68,0.35)">
      <div class="card-label" style="color:var(--red);margin-bottom:10px">⚠️ WARNINGS</div>
      ${a.warnings.map(w => `<p class="text-sm text-mid" style="margin-bottom:6px">• ${w}</p>`).join("")}
    </div>` : ""}

    <!-- Recommendations -->
    ${a.recommendations?.length ? `
    <div class="card">
      <div class="card-label" style="margin-bottom:10px">💡 RECOMMENDATIONS</div>
      ${a.recommendations.map(r => `
        <div style="display:flex;gap:8px;margin-bottom:10px;align-items:flex-start">
          <span style="color:var(--green);flex-shrink:0">✓</span>
          <span class="text-sm text-mid" style="line-height:1.5">${r}</span>
        </div>`).join("")}
    </div>` : ""}

    <!-- Week-by-week table -->
    ${weeks.length ? `
    <div class="card">
      <div class="card-label" style="margin-bottom:10px">WEEK-BY-WEEK BREAKDOWN</div>
      ${weeks.map(w => `
        <div class="day-row" style="margin-bottom:6px">
          <div style="font-size:11px;color:var(--text-dim);min-width:50px">${(w.week_start||"").slice(5)}</div>
          <div class="day-name text-sm">${w.total_km} km</div>
          ${w.avg_hr ? `<div class="text-sm text-mid">${w.avg_hr} bpm</div>` : ""}
          ${w.assessment ? `<div class="text-xs text-dim" style="font-style:italic">${w.assessment}</div>` : ""}
        </div>`).join("")}
    </div>` : ""}
  `;
}

// ── Screen Router ─────────────────────────────────────────────────────────────

function renderScreen(id) {
  if (id === "today")    renderToday();
  if (id === "week")     renderWeek();
  if (id === "goals")    renderGoals();
  if (id === "analyse")  renderAnalytics();
  if (id === "settings") renderSettings();
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function showApp() {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("app").style.display = "flex";

  // Set greeting + date
  const now = new Date();
  document.getElementById("greeting").textContent = greeting();
  document.getElementById("today-date").textContent = formatDate(now);
  const dEl = document.getElementById("desktop-date");
  if (dEl) dEl.textContent = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  // Nav
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => navigate(btn.dataset.nav));
  });

  // Load plan + analytics + completed sessions + remote settings
  const [plan, analytics, completed, remoteSettings] = await Promise.all([
    fetchPlan(), fetchAnalytics(), fetchCompletedSessions(), fetchUserSettings(),
  ]);
  currentPlan = plan;
  currentAnalytics = analytics;
  completedSessions = completed;
  await restoreSettingsIfEmpty(remoteSettings);
  navigate("today");
}

async function boot() {
  if (localStorage.getItem("rc_auth") === "1") {
    await showApp();
  } else {
    document.getElementById("login-screen").style.display = "flex";
  }
}

document.addEventListener("DOMContentLoaded", boot);
