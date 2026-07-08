"""
Main orchestrator: fetch Garmin data → call Claude → save plan as JSON.
Run by GitHub Actions every Monday at 9 AM UTC.

Plan is saved to data/plan.json (committed to repo).
Frontend reads it and lets the user approve before calendar sync.
Calendar sync is triggered separately via workflow_dispatch.
"""
import os
import sys
import json
from datetime import datetime, timedelta
from pathlib import Path

import anthropic

from strava_client import fetch_stats_summary


def _parse_run_days(raw):
    if not raw:
        return []
    return [d.strip() for d in raw.split(",") if d.strip()]

TRAINING_CONFIG = {
    "goal":                os.environ.get("TRAINING_GOAL") or "Marathon",
    "target_time":         os.environ.get("TARGET_TIME") or "",
    "race_name":           os.environ.get("RACE_NAME") or "",
    "weekly_hours_budget": float(os.environ.get("WEEKLY_HOURS") or "7"),
    "race_date":           os.environ.get("RACE_DATE") or None,
    "start_date":          os.environ.get("START_DATE") or None,
    "run_days":            _parse_run_days(os.environ.get("RUN_DAYS") or ""),
    "sessions_per_week":   int(os.environ.get("SESSIONS_PER_WEEK") or "4"),
    "cross_training":      json.loads(os.environ.get("CROSS_TRAINING") or "[]"),
    "quality_sessions":    int(os.environ.get("QUALITY_SESSIONS") or "0"),
    "quality_types":       [t.strip() for t in (os.environ.get("QUALITY_TYPES") or "").split(",") if t.strip()],
    "weekly_skip_ct":      [t.strip() for t in (os.environ.get("WEEKLY_SKIP_CT") or "").split(",") if t.strip()],
}


def load_prompt_template():
    prompt_path = Path(__file__).parent / "training_prompt.md"
    return prompt_path.read_text()


# ── Training pace calculator ──────────────────────────────────────────────────

RACE_DISTANCES_KM = {
    "marathon":      42.195,
    "half marathon": 21.0975,
    "10km":          10.0,
    "10k":           10.0,
}

def _parse_time_to_seconds(time_str: str) -> int | None:
    """
    Parse a race target time to total seconds.
    Accepts: 'H:MM:SS', 'H:MM' (hours:minutes), 'H.MM' (hours.minutes).
    A two-part input is ALWAYS treated as H:MM — never MM:SS —
    because no meaningful race takes under 60 minutes for a marathon/half.
    """
    if not time_str:
        return None
    # Normalise separators
    cleaned = time_str.strip().replace(".", ":").replace(",", ":")
    parts = [p.strip() for p in cleaned.split(":")]
    try:
        if len(parts) == 3:
            total = int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        elif len(parts) == 2:
            # Always H:MM — e.g. "3:45" = 3 h 45 min
            total = int(parts[0]) * 3600 + int(parts[1]) * 60
        else:
            return None
        return total if total > 0 else None
    except ValueError:
        return None


def _fmt_pace(sec_per_km: float) -> str:
    """Format seconds-per-km as 'M:SS /km'."""
    sec_per_km = round(sec_per_km)
    return f"{sec_per_km // 60}:{sec_per_km % 60:02d} /km"


def _pace_str_to_sec(pace_str: str | None) -> float | None:
    """Convert 'M:SS' pace string from Strava to seconds-per-km."""
    if not pace_str:
        return None
    try:
        m, s = pace_str.split(":")
        return int(m) * 60 + int(s)
    except Exception:
        return None


def calculate_training_paces(target_time_str: str, goal: str) -> dict | None:
    """
    Derive athlete-specific training paces from target finish time.
    Uses Jack Daniels VDOT-inspired multipliers anchored to race pace.
    Returns None if target time is missing or produces an implausible pace.
    """
    total_sec = _parse_time_to_seconds(target_time_str)
    if not total_sec:
        return None

    dist_km = RACE_DISTANCES_KM.get("marathon")  # default
    for key, km in RACE_DISTANCES_KM.items():
        if key in goal.lower():
            dist_km = km
            break

    race_pace_sec = total_sec / dist_km  # sec/km at target race pace

    # Sanity check: realistic range 2:30/km (elite) to 9:00/km (walker)
    if not (150 <= race_pace_sec <= 540):
        print(f"Warning: computed race pace {_fmt_pace(race_pace_sec)} looks implausible for '{target_time_str}' — skipping pace block")
        return None

    # Jack Daniels multipliers applied to race pace (sec/km)
    # All "slower" paces have LARGER sec/km values (more time per km)
    return {
        "race_pace":     _fmt_pace(race_pace_sec),
        "easy_pace":     _fmt_pace(race_pace_sec * 1.30),   # 30% slower than race pace
        "long_run_pace": _fmt_pace(race_pace_sec * 1.20),   # 20% slower
        "marathon_pace": _fmt_pace(race_pace_sec * 1.05),   # 5% slower (for HM/10k plans)
        "tempo_pace":    _fmt_pace(race_pace_sec * 0.94),   # 6% faster (LT)
        "interval_pace": _fmt_pace(race_pace_sec * 0.87),   # 13% faster (VO2max)
    }


def _extract_current_fitness_paces(strava_data: dict) -> dict | None:
    """
    Derive current easy and tempo paces from the athlete's recent Strava runs.
    Uses the median pace across recent runs as a proxy for current easy aerobic pace.
    """
    activities = strava_data.get("activities", [])
    if not activities:
        return None
    pace_secs = [_pace_str_to_sec(a.get("avg_pace_min_km")) for a in activities]
    pace_secs = sorted([p for p in pace_secs if p and 120 < p < 600])
    if not pace_secs:
        return None
    # Median recent pace ≈ easy/aerobic pace (most training is easy)
    median_pace = pace_secs[len(pace_secs) // 2]
    return {
        "current_easy_pace": _fmt_pace(median_pace),
        "current_tempo_estimate": _fmt_pace(median_pace * 0.88),
    }


def weeks_to_race(race_date_str: str | None) -> int | None:
    if not race_date_str:
        return None
    race = datetime.strptime(race_date_str, "%Y-%m-%d")
    return max(0, (race - datetime.today()).days // 7)


def current_training_phase(weeks_left: int | None) -> str:
    """Map weeks-to-race to the correct periodization phase."""
    if weeks_left is None:
        return "Base Building"
    if weeks_left >= 13:
        return "Base Building"
    if weeks_left >= 9:
        return "Aerobic Development"
    if weeks_left >= 5:
        return "Peak Training"
    if weeks_left >= 2:
        return "Taper"
    return "Race Week"


def _format_cross_training(cross_training: list, weekly_skip: list) -> str:
    if not cross_training:
        return "None"
    lines = []
    blocked_days = {}
    for act in cross_training:
        skipped = act["id"] in weekly_skip
        for day in act.get("days", []):
            status = " (SKIPPED THIS WEEK — day is FREE)" if skipped else " ← BLOCKED, assign Cross-Training here"
            key = day
            if key not in blocked_days:
                blocked_days[key] = []
            blocked_days[key].append(f"{act.get('emoji','')} {act['label']}{status}")
    for day, acts in blocked_days.items():
        lines.append(f"- {day}: " + ", ".join(acts))
    if not lines:
        return "None"
    return "\n".join(lines)


def build_user_message(strava_data: dict, config: dict) -> str:
    weeks_left = weeks_to_race(config.get("race_date"))
    today = datetime.today()

    # Determine plan start date — prefer explicit config, then existing plan's
    # stored start_date, then fall back to the current Monday so the cron
    # trigger never silently resets a Thursday-anchored (or any non-Monday) plan.
    if config.get("start_date"):
        week_start = datetime.strptime(config["start_date"], "%Y-%m-%d")
    else:
        existing_start = _load_existing_plan_start_date()
        if existing_start:
            # Advance to the next 4-week block from the original anchor
            weeks_since = max(0, (today - existing_start).days // 7)
            block_offset = (weeks_since // 4) * 4
            week_start = existing_start + timedelta(weeks=block_offset)
        else:
            week_start = today - timedelta(days=today.weekday())  # Monday

    # Generate 4 weeks of dates (full detail)
    all_weeks_dates = []
    for w in range(4):
        ws = week_start + timedelta(weeks=w)
        week_days = [
            {
                "day": (ws + timedelta(days=i)).strftime("%A"),
                "date": (ws + timedelta(days=i)).strftime("%Y-%m-%d")
            }
            for i in range(7)
        ]
        all_weeks_dates.append({"week": w + 1, "days": week_days})

    # Generate roadmap week slots: week 5 → race (max 24 weeks ahead, summary only)
    roadmap_slots = []
    if weeks_left and weeks_left > 4:
        for w in range(4, min(weeks_left, 28)):
            ws = week_start + timedelta(weeks=w)
            wtr = weeks_left - w
            roadmap_slots.append({
                "week": w + 1,
                "week_start": ws.strftime("%Y-%m-%d"),
                "weeks_to_race": wtr,
                "phase": current_training_phase(wtr),
            })

    run_days = config.get("run_days") or []
    sessions = config.get("sessions_per_week") or 4
    phase = current_training_phase(weeks_left)

    schedule_note = ""
    if run_days:
        schedule_note = f"- Preferred running days: {', '.join(run_days)}\n- Sessions per week: {sessions} (choose the best {sessions} from the preferred days above — assign rest to the others)"

    paces = calculate_training_paces(config.get("target_time", ""), config.get("goal", "Marathon"))
    current_fitness = _extract_current_fitness_paces(strava_data)

    paces_block = ""
    if paces or current_fitness:
        lines = ["## Training Paces"]
        if current_fitness:
            lines.append(f"### Current Fitness (from Strava)")
            lines.append(f"- Current easy/aerobic pace:    {current_fitness['current_easy_pace']}")
            lines.append(f"- Current tempo estimate:       {current_fitness['current_tempo_estimate']}")
            lines.append("")
        if paces:
            lines.append(f"### Target Paces (derived from {config.get('target_time','')} {config.get('goal','')})")
            lines.append(f"- Easy / Zone 1-2:        {paces['easy_pace']}")
            lines.append(f"- Long Run:               {paces['long_run_pace']}")
            lines.append(f"- Marathon Pace (MP):     {paces['marathon_pace']}")
            lines.append(f"- Tempo / LT:             {paces['tempo_pace']}")
            lines.append(f"- Interval / VO2max:      {paces['interval_pace']}")
            lines.append(f"- Target Race Pace:       {paces['race_pace']}")
            lines.append("")
            if current_fitness:
                lines.append("START sessions at paces close to current fitness, progressing toward target paces over the 4-week block. Do not prescribe target paces the athlete cannot yet sustain.")
            lines.append("USE THESE PACES explicitly in every session description — no generic ranges.")
        else:
            lines.append("No target time set — base all paces on the current Strava fitness paces above.")
            lines.append("Easy runs: at or slightly slower than current easy pace.")
            lines.append("Tempo runs: ~12% faster than current easy pace.")
        paces_block = "\n".join(lines) + "\n"

    return f"""
## Athlete Profile
- Goal: {config['goal']}
{f"- Race: {config['race_name']}" if config.get('race_name') else ""}
{f"- Target time: {config['target_time']}" if config.get('target_time') else ""}
- Weekly time budget: {config['weekly_hours_budget']} hours
- Plan start: {week_start.strftime('%Y-%m-%d')} (4-week block)
{f"- Weeks until race: {weeks_left} → Current phase: **{phase}**" if weeks_left is not None else "- No specific race date set → Current phase: Base Building"}
- IMPORTANT: Label all 4 weeks with the correct phase for their position in the training cycle. Week 1 starts at phase "{phase}" (with {weeks_left if weeks_left is not None else "unknown"} weeks to race). Progress appropriately through the block.
{schedule_note}
{paces_block}

## Last 14 Days of Training (from Strava)
{json.dumps(strava_data, indent=2)}

## 4-Week Schedule to Fill (full day detail required)
{json.dumps(all_weeks_dates, indent=2)}

## Roadmap Week Slots (weeks 5 → race — brief summary only, no days array)
{json.dumps(roadmap_slots, indent=2) if roadmap_slots else "No race date set — generate 4-week block only."}

## Cross-Training Schedule (FIXED COMMITMENTS — do not place runs on these days)
{_format_cross_training(config.get('cross_training', []), config.get('weekly_skip_ct', []))}

## Quality Sessions Requested
- Quality sessions per week: {config['quality_sessions']} (0 = only easy/tempo based on plan)
- Types preferred: {', '.join(config['quality_types']) if config['quality_types'] else 'Coach decides'}

## This Week Exceptions (Week 1)
Skipping cross-training: {', '.join(config['weekly_skip_ct']) if config['weekly_skip_ct'] else 'None — all usual activities happening'}

## Volume Progression for This Block
- Week 1: establish base load from recent Strava data
- Week 2: increase total volume by ~8-10% vs Week 1
- Week 3: increase by ~5-8% vs Week 2 (cumulative peak)
- Week 4: RECOVERY — reduce volume by 20-25% vs Week 3; keep one quality session; shorten long run by 20%
- Long run: grow by at most 1-2 km per week, never jump more than 2 km in one step
- Hard sessions: max 2 per week; never on consecutive days; never the day before/after the long run

## Instructions
Generate the complete 4-week training plan for the block above.
- Respect the athlete's time budget ({config['weekly_hours_budget']} hrs/week)
- Apply polarized training (80% easy, 20% hard)
- Use the exact training paces provided above in every session description
- Adapt intensity based on recent training load and fatigue signals
- Include exact dates from the week schedule provided
- Build progressively following the volume progression rules above
- Return ONLY valid JSON matching the schema in your system prompt
"""


def _update_plan_versions_index(data_dir: Path, today_str: str):
    """Rebuild plan_versions.json listing all backup files for the frontend."""
    versions = []
    for f in sorted(data_dir.glob("plan_*_backup.json"), reverse=True):
        date_part = f.stem.replace("plan_", "").replace("_backup", "")
        try:
            label = datetime.strptime(date_part, "%Y%m%d").strftime("%b %d, %Y")
        except Exception:
            label = date_part
        try:
            snap = json.loads(f.read_text())
            weeks = snap.get("weeks", [])
            start = weeks[0]["days"][0]["date"] if weeks and weeks[0].get("days") else ""
            end = weeks[-1]["days"][-1]["date"] if weeks and weeks[-1].get("days") else ""
            generated = snap.get("generated_at", "")[:10]
        except Exception:
            start = end = generated = ""
        versions.append({
            "filename": f.name,
            "date": date_part,
            "label": label,
            "plan_start": start,
            "plan_end": end,
            "generated_at": generated,
        })
    versions_path = data_dir / "plan_versions.json"
    versions_path.write_text(json.dumps(versions, indent=2))
    print(f"plan_versions.json updated ({len(versions)} versions)")


def _load_existing_plan_start_date() -> datetime | None:
    """Read start_date from the current plan.json so cron runs preserve the anchor."""
    plan_path = Path(__file__).parent.parent / "frontend" / "data" / "plan.json"
    if not plan_path.exists():
        return None
    try:
        plan = json.loads(plan_path.read_text())
        sd = plan.get("start_date")
        if sd:
            return datetime.strptime(sd, "%Y-%m-%d")
    except Exception:
        pass
    return None


def _load_completed_sessions(data_dir: Path) -> dict:
    """Load persistent completed sessions log (survives plan regeneration)."""
    path = data_dir / "completed_sessions.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


def _apply_completed_sessions_to_plan(plan: dict, completed: dict):
    """Merge completed session flags into matching plan days."""
    if not completed:
        return
    completion_fields = ["completed", "actual_stats", "coach_analysis", "execution_rating", "coach_adjustment"]
    for day in plan.get("days", []):
        date = day.get("date")
        if date and date in completed:
            for field in completion_fields:
                if field in completed[date]:
                    day[field] = completed[date][field]
    for week in plan.get("weeks", []):
        for day in week.get("days", []):
            date = day.get("date")
            if date and date in completed:
                for field in completion_fields:
                    if field in completed[date]:
                        day[field] = completed[date][field]


def save_plan(result: dict):
    data_dir = Path(__file__).parent.parent / "frontend" / "data"
    data_dir.mkdir(exist_ok=True)
    plan_path = data_dir / "plan.json"

    today_str = datetime.today().strftime("%Y%m%d")
    if plan_path.exists():
        backup = data_dir / f"plan_{today_str}_backup.json"
        backup.write_text(plan_path.read_text())

    # Build the plan object
    weeks = result.get("weeks", [])
    first_week = weeks[0] if weeks else {}

    # Derive start_date and week_start_day from the generated weeks
    plan_start_date = TRAINING_CONFIG.get("start_date") or ""
    week_start_day = ""
    if weeks and weeks[0].get("days"):
        first_day_date = weeks[0]["days"][0].get("date", "")
        if first_day_date:
            plan_start_date = plan_start_date or first_day_date
            try:
                week_start_day = datetime.strptime(first_day_date, "%Y-%m-%d").strftime("%A")
            except Exception:
                pass

    plan = {
        # 4-week structure + full roadmap to race
        "weeks": weeks,
        "roadmap": result.get("roadmap", []),
        "coaching_overview": result.get("coaching_overview", ""),
        "total_plan_distance_km": result.get("total_plan_distance_km", 0),
        # Anchor — preserved across regenerations so cron never shifts week day
        "start_date":        plan_start_date,
        "week_start_day":    week_start_day,
        # Backward compat — first week at top level
        "week_number":       first_week.get("week_number", 1),
        "phase":             first_week.get("phase", ""),
        "weekly_summary":    first_week.get("weekly_summary", ""),
        "total_distance_km": first_week.get("total_distance_km", 0),
        "aerobic_percent":   first_week.get("aerobic_percent", 80),
        "anaerobic_percent": first_week.get("anaerobic_percent", 20),
        "coaching_notes":    first_week.get("coaching_notes", ""),
        "recovery_flags":    first_week.get("recovery_flags", []),
        "days":              first_week.get("days", []),
        "strava_summary":    result.get("strava_summary", {}),
        "strava_averages":   result.get("strava_averages", {}),
        "generated_at":      datetime.utcnow().isoformat() + "Z",
        "status":            "pending_approval",
    }
    # Re-apply any previously completed sessions so regenerating the plan
    # doesn't wipe workout completions that were recorded by sync_session.py
    completed = _load_completed_sessions(data_dir)
    _apply_completed_sessions_to_plan(plan, completed)

    plan_path.write_text(json.dumps(plan, indent=2))
    print(f"Plan saved to {plan_path}")

    # Update plan_versions.json index for the frontend version picker
    _update_plan_versions_index(data_dir, today_str)

    # Save settings to user_settings.json so any device can restore them
    settings = {
        "goal":              TRAINING_CONFIG.get("goal", ""),
        "race_name":         TRAINING_CONFIG.get("race_name", ""),
        "race_date":         TRAINING_CONFIG.get("race_date", ""),
        "target_time":       TRAINING_CONFIG.get("target_time", ""),
        "start_date":        TRAINING_CONFIG.get("start_date", ""),
        "run_days":          TRAINING_CONFIG.get("run_days", []),
        "sessions_per_week": TRAINING_CONFIG.get("sessions_per_week", 4),
        "weekly_hours":      TRAINING_CONFIG.get("weekly_hours_budget", 7),
        "cross_training":    TRAINING_CONFIG.get("cross_training", []),
        "quality_enabled":   TRAINING_CONFIG.get("quality_sessions", 0) > 0,
        "quality_sessions":  TRAINING_CONFIG.get("quality_sessions", 2),
        "quality_types":     TRAINING_CONFIG.get("quality_types", []),
        "weekly_skip_ct":    TRAINING_CONFIG.get("weekly_skip_ct", []),
        "saved_at":          datetime.utcnow().isoformat() + "Z",
    }
    settings_path = data_dir / "user_settings.json"
    settings_path.write_text(json.dumps(settings, indent=2))
    print(f"Settings saved to {settings_path}")

    return plan


def generate_plan():
    print("Fetching Strava data...")
    strava_data = fetch_stats_summary(days=14)
    print(f"Fetched {strava_data['totals'].get('runs', 0)} runs")

    system_prompt = load_prompt_template()
    user_message = build_user_message(strava_data, TRAINING_CONFIG)

    print("Calling Claude API...")
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    # Prompt caching: mark the large static methodology prompt as cacheable.
    # On subsequent weekly runs the cache hit saves ~90% of input token cost.
    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=8192,
        system=[
            {
                "type": "text",
                "text": system_prompt,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": user_message}],
    )
    cache_stats = getattr(message.usage, "cache_read_input_tokens", 0)
    print(f"Cache read tokens: {cache_stats} (${cache_stats * 0.000000025:.6f} saved)")

    raw = message.content[0].text.strip()

    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    result = json.loads(raw)
    result["strava_summary"] = strava_data["totals"]
    result["strava_averages"] = strava_data["averages"]

    plan = save_plan(result)
    print("Done! Plan is saved and awaiting your approval in the dashboard.")
    return plan


if __name__ == "__main__":
    plan = generate_plan()
    print(f"\nWeek {plan.get('week_number')} — {plan.get('phase')}")
    print(f"Total distance: {plan.get('total_distance_km')} km")
    print(f"Aerobic: {plan.get('aerobic_percent')}% / Anaerobic: {plan.get('anaerobic_percent')}%")
