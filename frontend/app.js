/* ── Running Coach App ── */

const GITHUB_REPO = "omrisi37/mygarmin";
const APP_PASSWORD = "omrirun2026"; // Change this to your preferred password

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

async function refreshData() {
  showToast("Refreshing…");
  [currentPlan, currentAnalytics] = await Promise.all([fetchPlan(), fetchAnalytics()]);
  renderScreen(currentScreen);
  showToast("✓ Updated");
}

async function runDeepAnalysis() {
  showToast("⏳ Starting deep analysis…");
  const ok = await triggerWorkflow("deep-analysis.yml");
  if (ok) showToast("🧠 Analysis running — check back in ~2 min");
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

  const workoutHtml = todayWorkout ? `
    <div class="workout-hero">
      <div class="card-label">TODAY'S WORKOUT</div>
      <div class="wo-emoji">${workoutEmoji(todayWorkout.workout_type, todayWorkout.intensity)}</div>
      <div class="wo-title">${todayWorkout.title}</div>
      <div class="wo-sub">${todayWorkout.intensity === "Rest" ? "Recovery is training too" :
        `${todayWorkout.distance_km} km · ${todayWorkout.duration_min} min`}</div>
      ${todayWorkout.description ? `<div class="wo-desc">${todayWorkout.description}</div>` : ""}
    </div>` : `
    <div class="workout-hero">
      <div class="card-label">TODAY'S WORKOUT</div>
      <div class="wo-emoji">📭</div>
      <div class="wo-title">No plan yet</div>
      <div class="wo-sub">Generate your first plan below</div>
    </div>`;

  const weekHtml = plan ? (() => {
    const runs = plan.days?.filter(d => d.distance_km > 0) || [];
    const totalKm = plan.total_distance_km || 0;
    const totalRuns = runs.length;
    const startDate = plan.days?.[0]?.date;
    const endDate = plan.days?.[6]?.date;
    const dateRange = startDate ? `${new Date(startDate).toLocaleDateString("en-US",{month:"short",day:"numeric"})} – ${new Date(endDate).toLocaleDateString("en-US",{month:"short",day:"numeric"})}` : "";
    return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div class="card-label" style="margin-bottom:0">THIS WEEK</div>
        <div class="text-xs text-dim">${dateRange}</div>
      </div>
      <div class="stats-grid" style="margin-bottom:12px">
        <div class="stat-box">
          <div class="stat-val green">${totalKm}<span class="stat-unit"> km</span></div>
          <div class="stat-lbl">Kilometers</div>
        </div>
        <div class="stat-box">
          <div class="stat-val accent">${totalRuns}</div>
          <div class="stat-lbl">Runs</div>
        </div>
      </div>
      <div class="prog-row">
        <div class="prog-label"><span>Aerobic (Zone 1–2)</span><span>${plan.aerobic_percent}%</span></div>
        <div class="prog-track"><div class="prog-fill green" style="width:${plan.aerobic_percent}%"></div></div>
      </div>
      <div class="prog-row" style="margin-top:8px">
        <div class="prog-label"><span>Anaerobic (Zone 4–5)</span><span>${plan.anaerobic_percent}%</span></div>
        <div class="prog-track"><div class="prog-fill red" style="width:${plan.anaerobic_percent}%"></div></div>
      </div>
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
      ${plan.generated_at ? `<div class="text-xs text-dim mt-8">Last synced ${new Date(plan.generated_at).toLocaleDateString()}</div>` : ""}
    </div>` : "";

  el.innerHTML = `
    ${statusHtml}
    ${workoutHtml}
    ${weekHtml}
    ${stravaHtml}
    <button class="btn btn-ghost" onclick="generatePlan()" style="margin-top:4px">
      ⚡ Generate New Plan
    </button>
  `;
}

// ── Render: WEEK ──────────────────────────────────────────────────────────────

let weekView = "this-week"; // "this-week" | "4-week"

function renderWeek() {
  const el = document.getElementById("week-content");
  const plan = currentPlan;
  if (!plan?.days) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">📭</div><h3>No plan yet</h3><p>Generate a plan from the Today tab.</p></div>`;
    return;
  }

  const hasMonthPlan = Array.isArray(plan.weeks) && plan.weeks.length > 0;
  const toggleHtml = hasMonthPlan ? `
    <div class="view-toggle">
      <button class="view-toggle-btn${weekView === "this-week" ? " active" : ""}" onclick="setWeekView('this-week')">This Week</button>
      <button class="view-toggle-btn${weekView === "4-week" ? " active" : ""}" onclick="setWeekView('4-week')">4-Week Plan</button>
    </div>` : "";

  const legend = `
    <div class="legend" style="margin-top:8px">
      <div class="legend-label">INTENSITY LEGEND</div>
      <div class="legend-item"><div class="legend-dot" style="background:var(--green)"></div> Easy</div>
      <div class="legend-item"><div class="legend-dot" style="background:var(--orange)"></div> Tempo</div>
      <div class="legend-item"><div class="legend-dot" style="background:var(--red)"></div> Hard</div>
      <div class="legend-item"><div class="legend-dot" style="background:var(--blue)"></div> Long Run</div>
      <div class="legend-item"><div class="legend-dot" style="background:var(--surface3);border:1px solid var(--border)"></div> Rest</div>
    </div>`;

  if (hasMonthPlan && weekView === "4-week") {
    const monthHtml = plan.weeks.map((wk, wi) => {
      const totalKm = wk.total_distance_km || 0;
      const runs = (wk.days || []).filter(d => d.distance_km > 0).length;
      const dateRange = wk.days?.[0]?.date
        ? `${new Date(wk.days[0].date).toLocaleDateString("en-US",{month:"short",day:"numeric"})} – ${new Date(wk.days[6]?.date||wk.days[wk.days.length-1].date).toLocaleDateString("en-US",{month:"short",day:"numeric"})}`
        : "";
      const dayRows = (wk.days || []).map((day, di) => {
        const key = intensityKey(day.intensity);
        return `<div class="day-row" onclick="openMonthDayModal(${wi},${di})" style="margin-bottom:6px">
          <div class="day-abbr">${day.day.slice(0,3).toUpperCase()}</div>
          <div class="day-dot ${key}"></div>
          <div class="day-name">${day.title}</div>
          ${day.distance_km > 0 ? `<div class="text-sm text-mid">${day.distance_km}km</div>` : ""}
          <div class="day-badge ${key}">${day.intensity}</div>
          <div class="day-chevron">›</div>
        </div>`;
      }).join("");
      return `<div class="month-week" id="mw-${wi}">
        <div class="month-week-header" onclick="toggleMonthWeek(${wi})">
          <div>
            <div class="month-week-title">Week ${wi + 1} — ${wk.phase || ""}</div>
            <div class="month-week-meta">${dateRange} · ${totalKm} km · ${runs} runs</div>
          </div>
          <div class="month-week-chevron">›</div>
        </div>
        <div class="month-week-body">${dayRows}${wk.weekly_summary ? `<p class="text-sm text-mid" style="margin-top:10px;line-height:1.6">${wk.weekly_summary}</p>` : ""}</div>
      </div>`;
    }).join("");
    el.innerHTML = `
      <div class="page-title">Training Plan</div>
      <div class="page-sub">${plan.coaching_overview || "4-week personalised plan"}</div>
      ${toggleHtml}
      ${monthHtml}
      ${legend}`;
    return;
  }

  const today = todayDayName();
  el.innerHTML = `
    <div class="page-title">This Week</div>
    <div class="page-sub">Week ${plan.week_number || 1} · ${plan.phase || ""}</div>
    ${toggleHtml}
    ${plan.days.map((day, i) => {
      const key = intensityKey(day.intensity);
      const isToday = day.day === today;
      return `<div class="day-row${isToday ? " today" : ""}" onclick="openDayModal(${i})">
        <div class="day-abbr${isToday ? " today" : ""}">${day.day.slice(0,3).toUpperCase()}</div>
        <div class="day-dot ${key}"></div>
        <div class="day-name">${day.title}</div>
        ${day.distance_km > 0 ? `<div class="text-sm text-mid">${day.distance_km}km</div>` : ""}
        <div class="day-badge ${key}">${day.intensity}</div>
        <div class="day-chevron">›</div>
      </div>`;
    }).join("")}
    ${legend}
  `;
}

function setWeekView(v) {
  weekView = v;
  renderWeek();
}

function toggleMonthWeek(wi) {
  const el = document.getElementById(`mw-${wi}`);
  el?.classList.toggle("open");
}

function openMonthDayModal(wi, di) {
  const day = currentPlan?.weeks?.[wi]?.days?.[di];
  if (!day) return;
  const key = intensityKey(day.intensity);
  document.getElementById("day-modal-body").innerHTML = `
    <div style="font-size:32px;margin-bottom:8px">${workoutEmoji(day.workout_type, day.intensity)}</div>
    <h2 style="font-size:20px;font-weight:700;margin-bottom:4px">${day.title}</h2>
    <div class="text-sm text-mid">${day.day}${day.date ? " · " + day.date : ""}</div>
    <div style="margin:12px 0"><span class="day-badge ${key}">${day.intensity}</span>${day.hr_zone ? ` <span class="day-badge easy" style="margin-left:6px">${day.hr_zone}</span>` : ""}</div>
    ${day.distance_km > 0 ? `
    <div class="stats-grid" style="margin-bottom:14px">
      <div class="stat-box"><div class="stat-val">${day.distance_km}<span class="stat-unit"> km</span></div><div class="stat-lbl">Distance</div></div>
      <div class="stat-box"><div class="stat-val">${day.duration_min}<span class="stat-unit"> min</span></div><div class="stat-lbl">Duration</div></div>
    </div>` : ""}
    <p class="text-sm text-mid" style="line-height:1.6;margin-bottom:10px">${day.description||""}</p>
    ${day.key_focus ? `<p class="text-sm"><strong>Focus:</strong> <span class="text-mid">${day.key_focus}</span></p>` : ""}
    ${day.notes ? `<p class="text-sm mt-8"><strong>Notes:</strong> <span class="text-mid">${day.notes}</span></p>` : ""}
    <button class="btn btn-ghost" onclick="closeModal()" style="margin-top:20px">Close</button>
  `;
  document.getElementById("day-modal").classList.add("open");
}

// ── Render: GOALS ────────────────────────────────────────────────────────────

const CT_ACTIVITIES = [
  { id: "football",   label: "Football",   emoji: "⚽" },
  { id: "gym",        label: "Gym",        emoji: "🏋️" },
  { id: "pilates",    label: "Pilates",    emoji: "🧘" },
  { id: "swimming",   label: "Swimming",   emoji: "🏊" },
  { id: "cycling",    label: "Cycling",    emoji: "🚴" },
  { id: "tennis",     label: "Tennis",     emoji: "🎾" },
  { id: "basketball", label: "Basketball", emoji: "🏀" },
  { id: "yoga",       label: "Yoga",       emoji: "🧘" },
  { id: "boxing",     label: "Boxing",     emoji: "🥊" },
];

const QUALITY_TYPES = ["Intervals", "Tempo", "Fartlek", "Hills"];
const WEEK_DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

function renderGoals() {
  const el = document.getElementById("goals-content");
  const s = getSettings();
  const d2r = daysToRace(s.race_date);

  const days = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  const savedDays = s.run_days || ["Tuesday","Thursday","Saturday","Sunday"];

  // Cross-training data
  const ct = s.cross_training || [];
  const ctIds = ct.map(a => a.id);
  const weeklySkip = s.weekly_skip_ct || [];

  // Quality sessions data
  const qualityEnabled = s.quality_enabled !== false ? (s.quality_enabled || false) : false;
  const qualitySessions = s.quality_sessions || 2;
  const qualityTypes = s.quality_types || [];

  // Cross-training activities card
  const ctPills = CT_ACTIVITIES.map(a => `
    <span class="activity-pill${ctIds.includes(a.id) ? " active" : ""}" onclick="toggleCrossTraining('${a.id}')" id="ct-pill-${a.id}">
      ${a.emoji} ${a.label}
    </span>`).join("");

  const ctDayBlocks = ct.map(a => {
    const chips = WEEK_DAYS.map(d => {
      const short = d.slice(0,2);
      const active = (a.days || []).includes(d);
      return `<span class="day-chip${active ? " active" : ""}" onclick="toggleCTDay('${a.id}','${d}')" id="ct-day-${a.id}-${d}">${short}</span>`;
    }).join("");
    return `<div class="ct-activity-block">
      <div class="ct-activity-name">${a.emoji} ${a.label}</div>
      <div class="ct-days-row">${chips}</div>
    </div>`;
  }).join("");

  // Weekly override card (only if CT selected)
  const overrideCard = ct.length > 0 ? `
    <div class="card">
      <div class="card-label">🔄 THIS WEEK EXCEPTIONS</div>
      <p class="text-xs text-dim" style="margin-bottom:12px">Any changes to your cross-training this week?</p>
      ${ct.map(a => `
        <div class="override-row">
          <span class="override-row-name">${a.emoji} ${a.label}</span>
          <div class="skip-toggle">
            <button class="skip-toggle-btn doing${!weeklySkip.includes(a.id) ? " active" : ""}" onclick="toggleSkipCT('${a.id}',false)">Doing ✓</button>
            <button class="skip-toggle-btn skipping${weeklySkip.includes(a.id) ? " active" : ""}" onclick="toggleSkipCT('${a.id}',true)">Skipping ✗</button>
          </div>
        </div>`).join("")}
    </div>` : "";

  // Quality sessions card
  const qualityCard = `
    <div class="card">
      <div class="card-label">⚡ QUALITY SESSIONS</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <span class="text-sm" style="font-weight:500">Include quality/anaerobic sessions?</span>
        <div class="skip-toggle">
          <button class="skip-toggle-btn doing${qualityEnabled ? " active" : ""}" onclick="setQualityEnabled(true)">Yes</button>
          <button class="skip-toggle-btn skipping${!qualityEnabled ? " active" : ""}" onclick="setQualityEnabled(false)">No</button>
        </div>
      </div>
      ${qualityEnabled ? `
      <div class="form-group" style="margin-bottom:12px">
        <label class="form-label">Sessions per week: <span id="g-quality-sessions-val">${qualitySessions}</span></label>
        <input id="g-quality-sessions" type="range" min="1" max="3" step="1" value="${qualitySessions}"
          oninput="document.getElementById('g-quality-sessions-val').textContent=this.value;saveQualitySessions(this.value)"/>
      </div>
      <div class="form-group">
        <label class="form-label">Session Types</label>
        <div class="quality-chips-wrap">
          ${QUALITY_TYPES.map(t => `<span class="quality-chip${qualityTypes.includes(t) ? " active" : ""}" onclick="toggleQualityType('${t}')" id="qt-${t}">${t}</span>`).join("")}
        </div>
      </div>` : ""}
    </div>`;

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
        <input id="g-target-time" class="form-input" type="text" placeholder="e.g. 3:45:00 (marathon), 1:45:00 (half), 00:48:00 (10km)" value="${s.target_time||""}"/>
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

    <div class="card">
      <div class="card-label">💪 CROSS-TRAINING</div>
      <p class="text-xs text-dim" style="margin-bottom:10px">Select activities you do regularly. The AI coach will plan around them.</p>
      <div class="activity-pills-wrap">${ctPills}</div>
      ${ct.length > 0 ? `<div style="margin-top:4px">${ctDayBlocks}</div>` : ""}
    </div>

    ${overrideCard}
    ${qualityCard}

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

// ── Cross-Training Handlers ───────────────────────────────────────────────────

function toggleCrossTraining(id) {
  const s = getSettings();
  let ct = s.cross_training || [];
  const existing = ct.find(a => a.id === id);
  if (existing) {
    ct = ct.filter(a => a.id !== id);
    // Also remove from skip list
    const skip = (s.weekly_skip_ct || []).filter(x => x !== id);
    saveSettings({ cross_training: ct, weekly_skip_ct: skip });
  } else {
    const def = CT_ACTIVITIES.find(a => a.id === id);
    ct = [...ct, { id: def.id, label: def.label, emoji: def.emoji, days: [] }];
    saveSettings({ cross_training: ct });
  }
  renderGoals();
}

function toggleCTDay(actId, day) {
  const s = getSettings();
  const ct = (s.cross_training || []).map(a => {
    if (a.id !== actId) return a;
    const days = a.days || [];
    const newDays = days.includes(day) ? days.filter(d => d !== day) : [...days, day];
    return { ...a, days: newDays };
  });
  saveSettings({ cross_training: ct });
  // Update chip visually without full re-render
  const chip = document.getElementById(`ct-day-${actId}-${day}`);
  if (chip) {
    const act = ct.find(a => a.id === actId);
    const active = act?.days?.includes(day);
    chip.classList.toggle("active", !!active);
  }
}

// ── Weekly Override Handlers ─────────────────────────────────────────────────

function toggleSkipCT(id, skip) {
  const s = getSettings();
  let arr = s.weekly_skip_ct || [];
  if (skip) {
    if (!arr.includes(id)) arr = [...arr, id];
  } else {
    arr = arr.filter(x => x !== id);
  }
  saveSettings({ weekly_skip_ct: arr });
  // Update buttons visually
  const doing = document.querySelector(`[onclick="toggleSkipCT('${id}',false)"]`);
  const skipping = document.querySelector(`[onclick="toggleSkipCT('${id}',true)"]`);
  if (doing) doing.classList.toggle("active", !skip);
  if (skipping) skipping.classList.toggle("active", skip);
}

// ── Quality Session Handlers ─────────────────────────────────────────────────

function setQualityEnabled(val) {
  saveSettings({ quality_enabled: val });
  renderGoals();
}

function saveQualitySessions(val) {
  saveSettings({ quality_sessions: parseInt(val) });
}

function toggleQualityType(type) {
  const s = getSettings();
  let types = s.quality_types || [];
  types = types.includes(type) ? types.filter(t => t !== type) : [...types, type];
  saveSettings({ quality_types: types });
  const chip = document.getElementById(`qt-${type}`);
  if (chip) chip.classList.toggle("active", types.includes(type));
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
  document.querySelector(".text-xs.text-dim[style*='margin-top:2px']") &&
    (document.getElementById("g-sessions-val") &&
      document.querySelector(`[for="g-sessions"] + * + .text-xs`) &&
      (document.querySelector(".form-group .text-xs.text-dim").textContent =
        `AI will pick the best ${document.getElementById("g-sessions").value} days from your selected days above`));
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
  const s = getSettings();
  const ok = await triggerWorkflow("weekly-plan.yml", {
    start_date:        fields.start_date || "",
    run_days:          fields.run_days.join(","),
    sessions_per_week: String(fields.sessions_per_week),
    weekly_hours:      String(fields.weekly_hours),
    training_goal:     fields.goal || "",
    target_time:       fields.target_time || "",
    race_name:         fields.race_name || "",
    race_date:         fields.race_date || "",
    cross_training:    JSON.stringify(s.cross_training || []),
    weekly_skip_ct:    JSON.stringify(s.weekly_skip_ct || []),
    quality_enabled:   String(s.quality_enabled || false),
    quality_sessions:  String(s.quality_sessions || 2),
    quality_types:     (s.quality_types || []).join(","),
  });
  if (ok) showToast("✅ Plan generating — reload in ~90s");
}

function _saveGoalFields() {
  const fields = {
    goal:              document.getElementById("g-goal").value,
    race_name:         document.getElementById("g-race-name").value,
    race_date:         document.getElementById("g-race-date").value,
    target_time:       document.getElementById("g-target-time").value,
    start_date:        document.getElementById("g-start-date").value,
    run_days:          _getSelectedDays(),
    sessions_per_week: parseInt(document.getElementById("g-sessions").value),
    weekly_hours:      parseFloat(document.getElementById("g-hours").value),
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
        <button class="btn btn-accent" onclick="syncFromStrava()" style="margin-top:10px">🔄 Sync from Strava</button>
        <p class="text-xs text-dim" style="margin-top:6px">Pulls your latest runs and regenerates analytics</p>
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
  showToast("⏳ Syncing from Strava…");
  const ok = await triggerWorkflow("deep-analysis.yml");
  if (ok) showToast("✅ Sync started — check Analytics in ~2 min");
}

// ── Day Modal ─────────────────────────────────────────────────────────────────

function openDayModal(i) {
  const day = currentPlan?.days?.[i];
  if (!day) return;
  const key = intensityKey(day.intensity);
  document.getElementById("day-modal-body").innerHTML = `
    <div style="font-size:32px;margin-bottom:8px">${workoutEmoji(day.workout_type, day.intensity)}</div>
    <h2 style="font-size:20px;font-weight:700;margin-bottom:4px">${day.title}</h2>
    <div class="text-sm text-mid">${day.day}${day.date ? " · " + day.date : ""}</div>
    <div style="margin:12px 0"><span class="day-badge ${key}">${day.intensity}</span>${day.hr_zone ? ` <span class="day-badge easy" style="margin-left:6px">${day.hr_zone}</span>` : ""}</div>
    ${day.distance_km > 0 ? `
    <div class="stats-grid" style="margin-bottom:14px">
      <div class="stat-box"><div class="stat-val">${day.distance_km}<span class="stat-unit"> km</span></div><div class="stat-lbl">Distance</div></div>
      <div class="stat-box"><div class="stat-val">${day.duration_min}<span class="stat-unit"> min</span></div><div class="stat-lbl">Duration</div></div>
    </div>` : ""}
    <p class="text-sm text-mid" style="line-height:1.6;margin-bottom:10px">${day.description||""}</p>
    ${day.key_focus ? `<p class="text-sm"><strong>Focus:</strong> <span class="text-mid">${day.key_focus}</span></p>` : ""}
    ${day.notes ? `<p class="text-sm mt-8"><strong>Notes:</strong> <span class="text-mid">${day.notes}</span></p>` : ""}
    <button class="btn btn-ghost" onclick="closeModal()" style="margin-top:20px">Close</button>
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

  const analyseBtn = `
    <button class="btn btn-accent" onclick="runDeepAnalysis()" style="margin-bottom:16px">
      🧠 Analyse &amp; Improve
    </button>
    <p class="text-xs text-dim" style="text-align:center;margin-bottom:20px;margin-top:-10px">Fetches 8 weeks of Strava data · Generates deeper insights</p>
  `;

  if (!a) {
    el.innerHTML = `
      <div class="page-title">Analytics</div>
      <div class="page-sub">8-week performance overview</div>
      ${analyseBtn}
      <div class="empty"><div class="empty-icon">📊</div><h3>No analytics yet</h3><p>Tap "Analyse &amp; Improve" to generate insights from your Strava data.</p></div>
    `;
    return;
  }

  const weeks = a.weeks_analysis || a.raw_weeks || [];
  const ratio = a.acute_chronic_ratio;
  const ratioColor = ratio > 1.3 ? "var(--red)" : ratio < 0.8 ? "var(--orange)" : "var(--green)";

  el.innerHTML = `
    <div class="page-title">Analytics</div>
    <div class="page-sub">${a.generated_at ? "Last analysed " + new Date(a.generated_at).toLocaleDateString() : "8-week performance overview"}</div>

    ${analyseBtn}

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

  // Load plan + analytics
  [currentPlan, currentAnalytics] = await Promise.all([fetchPlan(), fetchAnalytics()]);
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
