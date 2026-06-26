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

async function fetchPlan() {
  try {
    const res = await fetch(`/data/plan.json?t=${Date.now()}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function refreshData() {
  showToast("Refreshing…");
  currentPlan = await fetchPlan();
  renderScreen(currentScreen);
  showToast("✓ Updated");
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

async function syncToCalendar() {
  showToast("⏳ Syncing to Google Calendar…");
  const ok = await triggerWorkflow("sync-to-calendar.yml");
  if (ok) showToast("✅ Syncing! Events appear in ~60s");
  else showToast("❌ Failed. Check your GitHub token.");
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

    <div style="margin-top:16px">
      ${plan.status === "synced"
        ? `<div class="banner synced"><span class="banner-icon">📅</span><div><div class="banner-title">Synced to Google Calendar</div><div class="banner-sub">Events are in your calendar.</div></div></div>`
        : `<button class="btn btn-green" id="approve-btn" onclick="syncToCalendar()">
             ${isApproved ? "📅 Sync to Google Calendar" : "✅ Approve & Sync to Calendar"}
           </button>`
      }
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
        <p class="text-sm text-mid" style="line-height:1.6;margin-bottom:12px">Calendar sync happens automatically when you approve a plan. The <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> and <code>GOOGLE_CALENDAR_ID</code> secrets need to be set in GitHub Actions.</p>
        <a href="https://github.com/${GITHUB_REPO}/settings/secrets/actions" target="_blank" class="btn btn-ghost text-sm">Open GitHub Secrets →</a>
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

// ── Screen Router ─────────────────────────────────────────────────────────────

function renderScreen(id) {
  if (id === "today")    renderToday();
  if (id === "week")     renderWeek();
  if (id === "approve")  renderApprove();
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

  // Load plan
  currentPlan = await fetchPlan();
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
