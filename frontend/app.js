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

function getGithubToken() {
  return localStorage.getItem("rc_gh_token") || "";
}

// ── Navigation ────────────────────────────────────────────────────────────────

let currentScreen = "today";

function navigate(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  document.getElementById(`screen-${id}`).classList.add("active");
  document.querySelector(`[data-nav="${id}"]`).classList.add("active");
  currentScreen = id;
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
  const s = getSettings();
  if (!s.garmin_email || !s.garmin_password) {
    showToast("⚠️ Add Garmin credentials in Settings first");
    navigate("settings");
    return;
  }
  showToast("⏳ Starting deep analysis…");
  const ok = await triggerWorkflow("deep-analysis.yml", {
    garmin_email: s.garmin_email,
    garmin_password: s.garmin_password,
  });
  if (ok) showToast("🧠 Analysis running — check back in ~2 min");
  else showToast("❌ Failed. Check your GitHub token.");
}

// ── Workflow Trigger ──────────────────────────────────────────────────────────

async function triggerWorkflow(file, inputs = {}) {
  const token = getGithubToken();
  if (!token) {
    showToast("⚠️ Add your GitHub token in Settings first");
    navigate("settings");
    return false;
  }
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${file}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `token ${token}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({ ref: "main", inputs }),
    }
  );
  return res.status === 204;
}

async function generatePlan() {
  const s = getSettings();
  if (!s.garmin_email || !s.garmin_password) {
    showToast("⚠️ Add Garmin credentials in Settings first");
    navigate("settings");
    return;
  }
  showToast("⏳ Generating plan…");
  const ok = await triggerWorkflow("weekly-plan.yml", {
    garmin_email: s.garmin_email,
    garmin_password: s.garmin_password,
  });
  if (ok) showToast("✅ Plan generating — check back in ~90s");
  else showToast("❌ Failed. Check your GitHub token.");
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
      pending_approval: { cls:"pending",  icon:"⏳", title:"Plan ready for review", sub:"Go to Approve tab to sync to calendar" },
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

  const garminHtml = plan?.garmin_summary ? `
    <div class="card">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        <div class="card-label" style="margin-bottom:0">GARMIN — LAST 14 DAYS</div>
      </div>
      <div class="stats-grid" style="margin-bottom:0">
        <div class="stat-box">
          <div class="stat-val">${plan.garmin_summary.distance_km} <span class="stat-unit">km</span></div>
          <div class="stat-lbl">Total Distance</div>
        </div>
        <div class="stat-box">
          <div class="stat-val">${plan.garmin_summary.runs}</div>
          <div class="stat-lbl">Total Runs</div>
        </div>
        <div class="stat-box">
          <div class="stat-val">${plan.garmin_averages?.avg_hr || "—"} <span class="stat-unit">bpm</span></div>
          <div class="stat-lbl">Avg Heart Rate</div>
        </div>
        <div class="stat-box">
          <div class="stat-val">${plan.garmin_averages?.latest_vo2_max || "—"}</div>
          <div class="stat-lbl">VO₂ Max</div>
        </div>
      </div>
      ${plan.generated_at ? `<div class="text-xs text-dim mt-8">Last synced ${new Date(plan.generated_at).toLocaleDateString()}</div>` : ""}
    </div>` : "";

  el.innerHTML = `
    ${statusHtml}
    ${workoutHtml}
    ${weekHtml}
    ${garminHtml}
    <button class="btn btn-ghost" onclick="generatePlan()" style="margin-top:4px">
      ⚡ Generate New Plan
    </button>
  `;
}

// ── Render: WEEK ──────────────────────────────────────────────────────────────

function renderWeek() {
  const el = document.getElementById("week-content");
  const plan = currentPlan;
  if (!plan?.days) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">📭</div><h3>No plan yet</h3><p>Generate a plan from the Today tab.</p></div>`;
    return;
  }
  const today = todayDayName();
  el.innerHTML = `
    <div style="margin-bottom:16px">
      <div style="font-size:20px;font-weight:700">This Week</div>
      <div class="text-sm text-dim">Week ${plan.week_number || 1} · ${plan.phase || ""}</div>
    </div>
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

// ── Render: APPROVE ───────────────────────────────────────────────────────────

function renderApprove() {
  const el = document.getElementById("approve-content");
  const plan = currentPlan;

  if (!plan) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">📭</div><h3>No plan to approve</h3><p>Generate a plan first.</p></div>
      <button class="btn btn-ghost mt-12" onclick="generatePlan()">⚡ Generate Plan</button>`;
    return;
  }

  const isApproved = plan.status === "approved" || plan.status === "synced";
  const totalHrs = plan.days ? (plan.days.reduce((s,d) => s + (d.duration_min||0), 0) / 60).toFixed(1) : 0;
  const runDays = plan.days?.filter(d => d.distance_km > 0).length || 0;
  const startDate = plan.days?.[0]?.date ? new Date(plan.days[0].date).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—";

  el.innerHTML = `
    <div style="margin-bottom:16px">
      <div style="font-size:20px;font-weight:700">Approve Plan</div>
      <div class="text-sm text-dim">Week starting ${startDate}</div>
    </div>

    ${isApproved ? `
    <div class="banner approved">
      <span class="banner-icon">✅</span>
      <div><div class="banner-title">Plan Approved</div><div class="banner-sub">Ready to sync to Google Calendar.</div></div>
    </div>` : `
    <div class="banner pending">
      <span class="banner-icon">⏳</span>
      <div><div class="banner-title">Awaiting your approval</div><div class="banner-sub">Review the plan then approve.</div></div>
    </div>`}

    <div class="card">
      <div class="card-label">WEEK SUMMARY</div>
      <div class="stats-grid three" style="margin-bottom:12px">
        <div class="stat-box">
          <div class="stat-val green">${plan.total_distance_km}<span class="stat-unit"> km</span></div>
          <div class="stat-lbl">Total Distance</div>
        </div>
        <div class="stat-box">
          <div class="stat-val accent">${totalHrs}<span class="stat-unit"> hrs</span></div>
          <div class="stat-lbl">Total Time</div>
        </div>
        <div class="stat-box">
          <div class="stat-val orange">${runDays}</div>
          <div class="stat-lbl">Running Days</div>
        </div>
      </div>
      <div class="form-row">
        <span class="form-row-label">Phase</span>
        <span class="form-row-value">${plan.phase || "—"}</span>
      </div>
      <div class="form-row">
        <span class="form-row-label">Aerobic / Anaerobic</span>
        <span class="form-row-value">${plan.aerobic_percent}% / ${plan.anaerobic_percent}%</span>
      </div>
    </div>

    ${plan.coaching_notes ? `
    <div class="card">
      <div class="card-label">COACH'S NOTES</div>
      <p class="text-sm text-mid" style="line-height:1.6">${plan.coaching_notes}</p>
    </div>` : ""}

    ${plan.recovery_flags?.length ? `
    <div class="card" style="border-color:rgba(239,68,68,0.3)">
      <div class="card-label" style="color:var(--red)">⚠️ RECOVERY FLAGS</div>
      ${plan.recovery_flags.map(f => `<p class="text-sm text-mid" style="margin-bottom:4px">• ${f}</p>`).join("")}
    </div>` : ""}

    <div class="card" style="margin-top:4px">
      <div class="card-label">ADD TO GOOGLE CALENDAR</div>
      <p class="text-sm text-mid" style="margin-bottom:12px;line-height:1.5">Tap any workout to open Google Calendar on your device and save it with one tap.</p>
      ${plan.days.filter(d => d.distance_km > 0).map(day => {
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
    </div>

    ${plan.generated_at ? `<p class="text-xs text-dim" style="text-align:center;margin-top:12px">Generated ${new Date(plan.generated_at).toLocaleDateString()} by Claude AI</p>` : ""}
  `;
}

// ── Render: SETTINGS ──────────────────────────────────────────────────────────

function renderSettings() {
  const el = document.getElementById("settings-content");
  const s = getSettings();
  const token = getGithubToken();
  const d2r = daysToRace(s.race_date);

  el.innerHTML = `
    <!-- Training Config -->
    <div class="settings-section">
      <div class="settings-header"><span class="icon">🎯</span> Training Config</div>
      <div class="settings-body">
        <div class="form-group">
          <label class="form-label">Goal</label>
          <select id="s-goal" class="form-input">
            <option value="Marathon" ${s.goal==="Marathon"?"selected":""}>Marathon</option>
            <option value="Half Marathon" ${s.goal==="Half Marathon"?"selected":""}>Half Marathon</option>
            <option value="10km" ${s.goal==="10km"?"selected":""}>10 km Race</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Race Name</label>
          <input id="s-race-name" class="form-input" type="text" placeholder="e.g. Tel Aviv Marathon 2026" value="${s.race_name||""}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Race Date</label>
          <input id="s-race-date" class="form-input" type="date" value="${s.race_date||""}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Target Time</label>
          <input id="s-target-time" class="form-input" type="text" placeholder="e.g. 3:45:00 for marathon, 1:45:00 for half, 00:48:00 for 10km" value="${s.target_time||""}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Weekly Hours Budget: <span id="s-hours-val">${s.weekly_hours||7}</span>h</label>
          <input id="s-hours" type="range" min="3" max="15" step="0.5" value="${s.weekly_hours||7}"
            oninput="document.getElementById('s-hours-val').textContent=this.value"/>
        </div>
        ${d2r !== null ? `<div class="info-box">📅 ${d2r >= 0 ? `${d2r} days to race` : `Race was ${Math.abs(d2r)} days ago`}</div>` : ""}
      </div>
    </div>

    <!-- Garmin -->
    <div class="settings-section">
      <div class="settings-header"><span class="icon">⌚</span> Garmin Connect</div>
      <div class="settings-body">
        <div class="form-group">
          <label class="form-label">Email</label>
          <input id="s-garmin-email" class="form-input" type="email" placeholder="your@email.com" value="${s.garmin_email||""}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Password</label>
          <input id="s-garmin-pw" class="form-input" type="password" placeholder="Garmin password" value="${s.garmin_password||""}"/>
        </div>
        <div class="warning-box">🔒 Stored locally on your device. Used only when generating a plan.</div>
      </div>
    </div>

    <!-- GitHub Token -->
    <div class="settings-section">
      <div class="settings-header"><span class="icon">🔑</span> GitHub Token</div>
      <div class="settings-body">
        <div class="form-group">
          <label class="form-label">Personal Access Token (workflow scope)</label>
          <input id="s-gh-token" class="form-input" type="password" placeholder="ghp_xxxxxxxxxxxx" value="${token||""}"/>
        </div>
        <div class="info-box">Needed to trigger plan generation and calendar sync. Create at github.com → Settings → Developer Settings → Personal access tokens → Fine-grained → workflow permission.</div>
      </div>
    </div>

    <!-- Google Calendar -->
    <div class="settings-section">
      <div class="settings-header"><span class="icon">📅</span> Google Calendar</div>
      <div class="settings-body">
        <div class="info-box">Tap any workout in the Approve tab to open Google Calendar on your device and add it with one tap. No API keys needed.</div>
      </div>
    </div>

    <button class="btn btn-green" onclick="saveAllSettings()" style="margin-bottom:12px">💾 Save Settings</button>
    <button class="btn btn-ghost" onclick="if(confirm('Log out?'))logout()">Log Out</button>
  `;
}

function saveAllSettings() {
  const goal = document.getElementById("s-goal").value;
  const raceName = document.getElementById("s-race-name").value;
  const raceDate = document.getElementById("s-race-date").value;
  const targetTime = document.getElementById("s-target-time").value;
  const hours = document.getElementById("s-hours").value;
  const garminEmail = document.getElementById("s-garmin-email").value;
  const garminPw = document.getElementById("s-garmin-pw").value;
  const ghToken = document.getElementById("s-gh-token").value;

  saveSettings({ goal, race_name: raceName, race_date: raceDate, target_time: targetTime, weekly_hours: parseFloat(hours), garmin_email: garminEmail, garmin_password: garminPw });
  if (ghToken) localStorage.setItem("rc_gh_token", ghToken);

  showToast("✅ Settings saved");
  renderSettings();
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
    <p class="text-xs text-dim" style="text-align:center;margin-bottom:20px;margin-top:-10px">Fetches 8 weeks of Garmin data · Generates deeper plan</p>
  `;

  if (!a) {
    el.innerHTML = `
      <div style="margin-bottom:16px">
        <div style="font-size:20px;font-weight:700">Analytics</div>
        <div class="text-sm text-dim">8-week performance overview</div>
      </div>
      ${analyseBtn}
      <div class="empty"><div class="empty-icon">📊</div><h3>No analytics yet</h3><p>Tap "Analyse &amp; Improve" to generate insights from your Garmin data.</p></div>
    `;
    return;
  }

  const weeks = a.weeks_analysis || a.raw_weeks || [];
  const ratio = a.acute_chronic_ratio;
  const ratioColor = ratio > 1.3 ? "var(--red)" : ratio < 0.8 ? "var(--orange)" : "var(--green)";

  el.innerHTML = `
    <div style="margin-bottom:16px">
      <div style="font-size:20px;font-weight:700">Analytics</div>
      <div class="text-sm text-dim">${a.generated_at ? "Last analysed " + new Date(a.generated_at).toLocaleDateString() : "8-week performance overview"}</div>
    </div>

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
  if (id === "approve")  renderApprove();
  if (id === "analyse")  renderAnalytics();
  if (id === "settings") renderSettings();
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function showApp() {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("app").style.display = "flex";

  // Set greeting + date
  document.getElementById("greeting").textContent = greeting();
  document.getElementById("today-date").textContent = formatDate(new Date());

  // Nav
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => navigate(btn.dataset.nav));
  });

  // Load plan + analytics
  [currentPlan, currentAnalytics] = await Promise.all([fetchPlan(), fetchAnalytics()]);
  renderScreen("today");
}

async function boot() {
  if (localStorage.getItem("rc_auth") === "1") {
    await showApp();
  } else {
    document.getElementById("login-screen").style.display = "flex";
  }
}

document.addEventListener("DOMContentLoaded", boot);
