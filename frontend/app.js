/* ===== Running Coach App ===== */

const GITHUB_REPO = "omrisi37/mygarmin";  // UPDATE: your repo
const PLAN_URL = "./data/plan.json";       // Served from repo root via Azure

// ─── Auth ────────────────────────────────────────────────────────────────────

async function checkAuth() {
  try {
    const res = await fetch("/.auth/me");
    if (!res.ok) return null;
    const data = await res.json();
    return data?.clientPrincipal || null;
  } catch {
    return null;
  }
}

function logout() {
  window.location.href = "/.auth/logout?post_logout_redirect_uri=/";
}

// ─── Navigation ──────────────────────────────────────────────────────────────

let currentScreen = "dashboard";

function navigate(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  document.getElementById(`screen-${id}`).classList.add("active");
  document.querySelector(`[data-nav="${id}"]`)?.classList.add("active");
  currentScreen = id;
}

// ─── Plan Data ───────────────────────────────────────────────────────────────

let currentPlan = null;

async function fetchPlan() {
  try {
    const res = await fetch(`${PLAN_URL}?t=${Date.now()}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ─── Approve → Trigger GitHub Actions ────────────────────────────────────────

async function approveAndSync() {
  const token = prompt(
    "Enter your GitHub Personal Access Token to trigger calendar sync.\n" +
    "(Needs workflow scope. You only need to do this once per device.)"
  );
  if (!token) return;

  const btn = document.getElementById("approve-btn");
  btn.disabled = true;
  btn.textContent = "Triggering sync…";

  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/sync-to-calendar.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `token ${token}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github+json",
        },
        body: JSON.stringify({ ref: "main" }),
      }
    );

    if (res.status === 204) {
      showToast("✅ Syncing to Google Calendar! Check back in a minute.");
      // Cache token in sessionStorage so user doesn't re-enter this session
      sessionStorage.setItem("gh_token", token);
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(`❌ Error: ${err.message || res.status}`);
    }
  } catch (e) {
    showToast(`❌ Network error: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "Approve & Sync to Calendar";
  }
}

async function triggerManualGenerate() {
  const token = sessionStorage.getItem("gh_token") ||
    prompt("Enter your GitHub Personal Access Token (workflow scope):");
  if (!token) return;
  sessionStorage.setItem("gh_token", token);

  showToast("⏳ Triggering weekly plan generation…");

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/weekly-plan.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `token ${token}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({ ref: "main" }),
    }
  );

  if (res.status === 204) {
    showToast("✅ Plan generation started! Refresh in ~60s.");
  } else {
    showToast("❌ Failed to trigger. Check your token.");
  }
}

// ─── UI Helpers ──────────────────────────────────────────────────────────────

function showToast(msg, duration = 3500) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), duration);
}

function intensityClass(intensity = "") {
  const map = {
    "Rest": "rest",
    "Easy": "easy",
    "Moderate": "moderate",
    "Tempo": "tempo",
    "Hard": "hard",
    "Long Run": "longrun",
    "Race": "hard",
  };
  return map[intensity] || "easy";
}

function intensityEmoji(type = "") {
  const map = {
    "Rest": "😴", "Easy": "🟢", "Moderate": "🟡",
    "Tempo": "🟠", "Hard": "🔴", "Long Run": "🔵", "Race": "🏁",
  };
  return map[type] || "🏃";
}

// ─── Render Dashboard ────────────────────────────────────────────────────────

function renderDashboard(plan) {
  const el = document.getElementById("dashboard-content");
  if (!plan) {
    el.innerHTML = `
      <div class="empty">
        <div class="empty-icon">📭</div>
        <h3>No plan yet</h3>
        <p>Your weekly plan will appear here every Monday. Or generate one now:</p>
      </div>
      <button class="btn btn-primary" onclick="triggerManualGenerate()" style="margin-top:12px">
        ⚡ Generate Plan Now
      </button>`;
    return;
  }

  const statusMap = {
    "pending_approval": { cls: "pending", icon: "⏳", title: "Plan Ready for Review", sub: "Review the week below, then approve to sync." },
    "approved": { cls: "approved", icon: "✅", title: "Plan Approved", sub: "Syncing to Google Calendar…" },
    "synced": { cls: "synced", icon: "📅", title: "Synced to Calendar", sub: `Synced ${plan.synced_at ? new Date(plan.synced_at).toLocaleDateString() : ""}` },
  };
  const status = statusMap[plan.status] || statusMap["pending_approval"];
  const today = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const todayDay = plan.days?.find(d => d.day === today);

  el.innerHTML = `
    <div class="plan-banner ${status.cls}">
      <div class="plan-banner-icon">${status.icon}</div>
      <div class="plan-banner-text">
        <div class="plan-banner-title">${status.title}</div>
        <div class="plan-banner-sub">${status.sub}</div>
      </div>
    </div>

    ${todayDay ? `
    <div class="card">
      <div class="card-title">Today — ${todayDay.day}</div>
      <div style="display:flex;align-items:center;gap:14px">
        <div class="day-dot ${intensityClass(todayDay.intensity)}" style="width:56px;height:56px;font-size:26px">
          ${intensityEmoji(todayDay.workout_type)}
        </div>
        <div style="flex:1">
          <div style="font-size:18px;font-weight:700">${todayDay.title}</div>
          <div style="color:var(--text-dim);font-size:14px;margin-top:3px">${todayDay.distance_km} km · ${todayDay.duration_min} min</div>
          <span class="badge ${intensityClass(todayDay.intensity)}">${todayDay.intensity}</span>
        </div>
      </div>
      <p style="font-size:14px;line-height:1.6;margin-top:12px;color:var(--text-dim)">${todayDay.description}</p>
    </div>` : ""}

    <div class="stats-grid">
      <div class="stat-box">
        <div class="stat-value">${plan.total_distance_km}<span class="stat-unit"> km</span></div>
        <div class="stat-label">This week</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${plan.days?.filter(d => d.distance_km > 0).length || 0}<span class="stat-unit"> runs</span></div>
        <div class="stat-label">Workouts</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Training Balance</div>
      <div class="polar-bar">
        <div class="polar-label"><span>Aerobic (Easy)</span><span>${plan.aerobic_percent}%</span></div>
        <div class="progress-track"><div class="progress-fill fill-green" style="width:${plan.aerobic_percent}%"></div></div>
      </div>
      <div class="polar-bar" style="margin-top:10px">
        <div class="polar-label"><span>Anaerobic (Hard)</span><span>${plan.anaerobic_percent}%</span></div>
        <div class="progress-track"><div class="progress-fill fill-orange" style="width:${plan.anaerobic_percent}%"></div></div>
      </div>
    </div>

    ${plan.garmin_averages ? `
    <div class="card">
      <div class="card-title">Recent Garmin Data</div>
      <div class="stats-grid" style="margin-bottom:0">
        <div class="stat-box">
          <div class="stat-value">${plan.garmin_summary?.distance_km || "—"}<span class="stat-unit"> km</span></div>
          <div class="stat-label">Last 14 days</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">${plan.garmin_averages?.latest_vo2_max || "—"}</div>
          <div class="stat-label">VO2 Max</div>
        </div>
      </div>
    </div>` : ""}

    <button class="btn btn-ghost" onclick="triggerManualGenerate()" style="margin-top:4px">
      🔄 Regenerate Plan
    </button>
  `;
}

// ─── Render Week Screen ───────────────────────────────────────────────────────

function renderWeek(plan) {
  const el = document.getElementById("week-content");
  if (!plan?.days) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">📭</div><h3>No plan yet</h3><p>Generate a plan first.</p></div>`;
    return;
  }

  el.innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <div class="card-title">Week ${plan.week_number || ""} · ${plan.phase || ""}</div>
      <p style="font-size:14px;line-height:1.6;color:var(--text-dim)">${plan.weekly_summary || ""}</p>
    </div>
    ${plan.days.map((day, i) => `
      <div class="day-card" onclick="openDayDetail(${i})">
        <div class="day-dot ${intensityClass(day.intensity)}">${intensityEmoji(day.workout_type)}</div>
        <div class="day-info">
          <div class="day-name">${day.day}</div>
          <div class="day-subtitle">${day.title}</div>
          <span class="badge ${intensityClass(day.intensity)}">${day.intensity}</span>
        </div>
        <div class="day-km">${day.distance_km > 0 ? day.distance_km + " km" : "—"}</div>
      </div>
    `).join("")}
    ${plan.coaching_notes ? `
    <div class="card" style="margin-top:4px">
      <div class="card-title">Coach's Notes</div>
      <p style="font-size:14px;line-height:1.6;color:var(--text-dim)">${plan.coaching_notes}</p>
    </div>` : ""}
  `;
}

// ─── Render Approve Screen ────────────────────────────────────────────────────

function renderApprove(plan) {
  const el = document.getElementById("approve-content");
  if (!plan) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">📭</div><h3>No plan to approve</h3></div>`;
    return;
  }

  const isApproved = plan.status === "approved" || plan.status === "synced";
  el.innerHTML = `
    <div class="card">
      <div class="card-title">Plan Generated</div>
      <div style="font-size:24px;font-weight:800;margin-bottom:4px">Week of ${plan.days?.[0]?.date || "—"}</div>
      <div style="color:var(--text-dim);font-size:14px">${plan.total_distance_km} km · ${plan.days?.filter(d=>d.distance_km>0).length} workouts</div>
      <p style="margin-top:10px;font-size:14px;line-height:1.6;color:var(--text-dim)">${plan.weekly_summary || ""}</p>
    </div>

    ${plan.recovery_flags?.length ? `
    <div class="card" style="border-color:rgba(231,76,60,0.3)">
      <div class="card-title" style="color:var(--accent-red)">⚠️ Recovery Flags</div>
      ${plan.recovery_flags.map(f => `<p style="font-size:14px;color:var(--text-dim);margin-bottom:4px">• ${f}</p>`).join("")}
    </div>` : ""}

    ${plan.next_week_preview ? `
    <div class="card">
      <div class="card-title">Next Week Preview</div>
      <p style="font-size:14px;line-height:1.6;color:var(--text-dim)">${plan.next_week_preview}</p>
    </div>` : ""}

    <div style="margin-top:16px">
      ${isApproved
        ? `<div class="plan-banner synced"><div class="plan-banner-icon">✅</div><div class="plan-banner-text"><div class="plan-banner-title">Already Synced</div><div class="plan-banner-sub">Check your Google Calendar.</div></div></div>`
        : `<button class="btn btn-success" id="approve-btn" onclick="approveAndSync()">
             ✅ Approve & Sync to Calendar
           </button>`
      }
      <button class="btn btn-ghost" onclick="navigate('week')" style="margin-top:10px">
        View Full Week
      </button>
    </div>
  `;
}

// ─── Day Detail Modal ─────────────────────────────────────────────────────────

function openDayDetail(index) {
  if (!currentPlan?.days?.[index]) return;
  const day = currentPlan.days[index];
  const modal = document.getElementById("day-modal");
  const content = document.getElementById("day-modal-content");

  content.innerHTML = `
    <div class="modal-handle"></div>
    <h2>${intensityEmoji(day.workout_type)} ${day.title}</h2>
    <div style="color:var(--text-dim);font-size:14px">${day.day}${day.date ? " · " + day.date : ""}</div>
    <div class="meta-row">
      <span class="badge ${intensityClass(day.intensity)}">${day.intensity}</span>
      ${day.hr_zone ? `<span class="badge easy">${day.hr_zone}</span>` : ""}
    </div>
    <div class="stats-grid" style="margin-top:12px">
      <div class="stat-box"><div class="stat-value">${day.distance_km || "—"}<span class="stat-unit"> km</span></div><div class="stat-label">Distance</div></div>
      <div class="stat-box"><div class="stat-value">${day.duration_min || "—"}<span class="stat-unit"> min</span></div><div class="stat-label">Duration</div></div>
    </div>
    <p class="description">${day.description || ""}</p>
    ${day.key_focus ? `<p style="margin-top:12px;font-size:13px"><strong>Focus:</strong> <span style="color:var(--text-dim)">${day.key_focus}</span></p>` : ""}
    ${day.notes ? `<p style="margin-top:8px;font-size:13px"><strong>Notes:</strong> <span style="color:var(--text-dim)">${day.notes}</span></p>` : ""}
    <button class="btn btn-ghost" onclick="closeModal()" style="margin-top:20px">Close</button>
  `;

  modal.classList.add("open");
}

function closeModal() {
  document.getElementById("day-modal").classList.remove("open");
}

// ─── Pull to Refresh ──────────────────────────────────────────────────────────

let ptStartY = 0;
function initPullToRefresh() {
  document.querySelectorAll(".screen").forEach(el => {
    el.addEventListener("touchstart", e => { ptStartY = e.touches[0].clientY; }, { passive: true });
    el.addEventListener("touchend", e => {
      const dy = e.changedTouches[0].clientY - ptStartY;
      if (dy > 80 && el.scrollTop === 0) refreshData();
    }, { passive: true });
  });
}

async function refreshData() {
  showToast("🔄 Refreshing…");
  currentPlan = await fetchPlan();
  renderAll();
  showToast("✅ Updated");
}

function renderAll() {
  renderDashboard(currentPlan);
  renderWeek(currentPlan);
  renderApprove(currentPlan);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function boot() {
  // Check Azure auth
  const user = await checkAuth();
  if (!user) {
    // Not logged in — Azure will redirect, but show a fallback login screen
    document.getElementById("screen-login").style.display = "flex";
    document.getElementById("main-ui").style.display = "none";
    return;
  }

  // Update header with username
  document.getElementById("user-display").textContent = user.userDetails || "Omri";

  // Load plan
  currentPlan = await fetchPlan();
  renderAll();

  // Nav setup
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => navigate(btn.dataset.nav));
  });

  initPullToRefresh();
  navigate("dashboard");
}

document.addEventListener("DOMContentLoaded", boot);
