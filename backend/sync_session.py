"""
Session sync + analytics refresh.

1. Marks recent Strava activities as completed in plan.json with actual stats
   and a brief per-session coach analysis.
2. Refreshes analytics.json with 8-week trend data and recommendations.

Does NOT regenerate or overwrite the training plan.
"""
import os
import json
from datetime import datetime, timedelta
from pathlib import Path

import anthropic
from strava_client import get_access_token, fetch_recent_activities, fetch_stats_summary

import requests


ALL_ACTIVITY_TYPES = {
    "Run", "TrailRun",
    "WeightTraining", "Workout", "Crossfit",
    "Swim", "Swim",
    "Ride", "VirtualRide",
    "Soccer", "Tennis", "Basketball", "Boxing",
    "Yoga", "Pilates",
    "Walk", "Hike",
}


def fetch_recent_all_activities(days=2):
    """Fetch all Strava activities (not just runs) for the last N days."""
    token = get_access_token()
    after = int((datetime.now() - timedelta(days=days)).timestamp())

    activities = []
    page = 1
    while True:
        resp = requests.get(
            "https://www.strava.com/api/v3/athlete/activities",
            headers={"Authorization": f"Bearer {token}"},
            params={"after": after, "per_page": 100, "page": page},
        )
        resp.raise_for_status()
        data = resp.json()
        if not data:
            break
        activities.extend(data)
        if len(data) < 100:
            break
        page += 1

    result = []
    for act in sorted(activities, key=lambda a: a["start_date_local"]):
        speed = act.get("average_speed", 0)
        pace = None
        if speed and speed > 0:
            pace_s = 1000 / speed
            pace = f"{int(pace_s // 60)}:{int(pace_s % 60):02d}"
        result.append({
            "date":          act["start_date_local"][:10],
            "name":          act.get("name", ""),
            "type":          act.get("type", "Workout"),
            "distance_km":   round(act.get("distance", 0) / 1000, 2),
            "duration_min":  round(act.get("moving_time", 0) / 60, 1),
            "avg_hr":        act.get("average_heartrate"),
            "max_hr":        act.get("max_heartrate"),
            "calories":      act.get("calories"),
            "elevation_m":   act.get("total_elevation_gain"),
            "avg_pace":      pace,
        })
    return result


COMPLETED_SESSIONS_PATH = Path(__file__).parent.parent / "frontend" / "data" / "completed_sessions.json"


def load_completed_sessions():
    if not COMPLETED_SESSIONS_PATH.exists():
        return {}
    try:
        return json.loads(COMPLETED_SESSIONS_PATH.read_text())
    except Exception:
        return {}


def save_completed_session(date_str, completion):
    """Append/update a completed session in the persistent log."""
    sessions = load_completed_sessions()
    sessions[date_str] = {**completion, "logged_at": datetime.utcnow().isoformat() + "Z"}
    COMPLETED_SESSIONS_PATH.parent.mkdir(exist_ok=True)
    COMPLETED_SESSIONS_PATH.write_text(json.dumps(sessions, indent=2))


def load_plan():
    plan_path = Path(__file__).parent.parent / "frontend" / "data" / "plan.json"
    if not plan_path.exists():
        return None
    return json.loads(plan_path.read_text())


def save_plan(plan):
    plan_path = Path(__file__).parent.parent / "frontend" / "data" / "plan.json"
    plan["synced_at"] = datetime.utcnow().isoformat() + "Z"
    plan_path.write_text(json.dumps(plan, indent=2))
    print(f"Plan saved to {plan_path}")


def apply_completion_to_plan(plan, date_str, completion):
    """
    Write completion fields to every occurrence of this date in the plan
    (top-level days AND weeks[N].days are separate objects — both must be updated).
    Returns True if at least one day was found and updated.
    """
    found = False
    for day in plan.get("days", []):
        if day.get("date") == date_str:
            day.update(completion)
            found = True
    for week in plan.get("weeks", []):
        for day in week.get("days", []):
            if day.get("date") == date_str:
                day.update(completion)
                found = True
    return found


def find_matching_day(plan, date_str):
    """Return first matching day dict (for reading planned details only)."""
    for day in plan.get("days", []):
        if day.get("date") == date_str:
            return day
    for week in plan.get("weeks", []):
        for day in week.get("days", []):
            if day.get("date") == date_str:
                return day
    return None


def _all_plan_days(plan):
    """Yield every day dict across both top-level days and weeks arrays."""
    seen = set()
    for day in plan.get("days", []):
        d = day.get("date")
        if d and d not in seen:
            seen.add(d)
            yield day
    for week in plan.get("weeks", []):
        for day in week.get("days", []):
            d = day.get("date")
            if d and d not in seen:
                seen.add(d)
                yield day


def _is_run_workout(day):
    """True if this plan day is a run (not rest/cross-training)."""
    wtype = (day.get("workout_type") or "").lower()
    title = (day.get("title") or "").lower()
    intensity = (day.get("intensity") or "").lower()
    non_run_keywords = {"rest", "cross", "pilates", "yoga", "gym", "swim", "cycl", "football",
                        "basketball", "tennis", "boxing", "walk", "hike"}
    if any(k in wtype for k in non_run_keywords):
        return False
    if any(k in title for k in non_run_keywords):
        return False
    if intensity == "rest":
        return False
    return True


def find_swapped_run_day(plan, activity_date_str, lookback_days=3):
    """
    When a run was logged on a cross-training/rest day, look back up to
    lookback_days to find a planned (not yet completed) run day.
    Returns the swap candidate day dict, or None.
    """
    act_date = datetime.strptime(activity_date_str, "%Y-%m-%d").date()
    candidates = []
    for day in _all_plan_days(plan):
        d = day.get("date")
        if not d or day.get("completed"):
            continue
        day_date = datetime.strptime(d, "%Y-%m-%d").date()
        delta = (act_date - day_date).days
        if 1 <= delta <= lookback_days and _is_run_workout(day):
            candidates.append((delta, day))
    if not candidates:
        return None
    # Return the closest preceding run day
    candidates.sort(key=lambda x: x[0])
    return candidates[0][1]


RUNNING_TYPES = {"Run", "TrailRun", "VirtualRun"}

def _activity_label(act_type: str) -> str:
    labels = {
        "WeightTraining": "Gym / Weight Training",
        "Workout": "Workout",
        "Crossfit": "CrossFit",
        "Swim": "Swimming",
        "Ride": "Cycling",
        "VirtualRide": "Cycling (Indoor)",
        "Soccer": "Football",
        "Tennis": "Tennis",
        "Basketball": "Basketball",
        "Boxing": "Boxing",
        "Yoga": "Yoga",
        "Pilates": "Pilates",
        "Walk": "Walk",
        "Hike": "Hike",
        "Run": "Run",
        "TrailRun": "Trail Run",
    }
    return labels.get(act_type, act_type)


def analyze_session(planned_day, actual, swapped_from=None):
    """Ask Claude for a brief coaching take on the session — works for all activity types."""
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    act_type   = actual.get("type", "Workout")
    act_label  = _activity_label(act_type)
    is_running = act_type in RUNNING_TYPES

    actual_parts = []
    if actual.get("duration_min"):
        actual_parts.append(f"Duration: {actual['duration_min']} min")
    if is_running and actual.get("distance_km"):
        actual_parts.append(f"Distance: {actual['distance_km']} km")
    if actual.get("avg_hr"):
        actual_parts.append(f"Avg HR: {actual['avg_hr']} bpm")
    if is_running and actual.get("avg_pace"):
        actual_parts.append(f"Avg Pace: {actual['avg_pace']} /km")
    if actual.get("calories"):
        actual_parts.append(f"Calories: {actual['calories']} kcal")
    if actual.get("elevation_m"):
        actual_parts.append(f"Elevation: {actual['elevation_m']} m")
    actual_summary = ", ".join(actual_parts) or "Activity recorded — no detailed stats available"

    swap_note = ""
    if swapped_from:
        swap_note = (
            f"\nNOTE: The athlete intentionally swapped days — they moved their planned "
            f"'{swapped_from.get('title', 'run')}' (originally scheduled for "
            f"{swapped_from.get('day', swapped_from.get('date', ''))}) to today. "
            f"The planned activity for today was different. Acknowledge the flexibility positively."
        )

    if is_running:
        context = f"You are an elite running coach. Give a brief analysis of this run vs what was planned.{swap_note}"
        adjustment_note = "Set 'adjustment' (not null) ONLY if effort deviated significantly (>20% from target HR/pace) AND a specific upcoming running session should change."
    else:
        context = (
            f"You are a sports coach. The athlete just completed a {act_label} session. "
            "This is a cross-training activity that supports their running program. "
            "Give a brief, relevant analysis — focus on recovery impact, energy levels, and how it fits into the overall training week."
        )
        adjustment_note = "Set 'adjustment' (not null) ONLY if this session was so demanding it should affect the next day's running (e.g. heavy leg day before a tempo run)."

    prompt = f"""{context}

WHAT WAS PLANNED:
- Type: {planned_day.get('workout_type', 'Cross-Training')}
- Title: {planned_day.get('title', '')}
- Description: {planned_day.get('description', '')}

WHAT ACTUALLY HAPPENED (Strava):
- Activity: {actual.get('name', '')} ({act_label})
- {actual_summary}

Respond ONLY with valid JSON:
{{
  "session_analysis": "2-3 sentences. Be specific, personal, encouraging but honest.",
  "execution_rating": "on-plan|slightly-hard|too-hard|too-easy|great|skipped",
  "adjustment": null
}}

{adjustment_note}
If adjustment needed: {{"day": "Wednesday", "change": "brief change", "reason": "why"}}
Otherwise keep null."""

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw.strip())


def _build_weekly_buckets(activities):
    buckets = {}
    for act in activities:
        date = datetime.strptime(act["date"], "%Y-%m-%d")
        week_start = (date - timedelta(days=date.weekday())).strftime("%Y-%m-%d")
        buckets.setdefault(week_start, []).append(act)
    weeks = []
    for ws in sorted(buckets.keys()):
        runs = buckets[ws]
        hrs  = [r["avg_hr"] for r in runs if r.get("avg_hr")]
        weeks.append({
            "week_start":  ws,
            "runs":        len(runs),
            "total_km":    round(sum(r["distance_km"] for r in runs), 1),
            "total_hours": round(sum(r["duration_min"] for r in runs) / 60, 1),
            "avg_hr":      round(sum(hrs) / len(hrs)) if hrs else None,
            "vo2_max":     None,
        })
    return weeks


def apply_coach_adjustment(plan, adjustment):
    """
    Rewrite the specific future plan day the coach flagged.
    Finds the next upcoming occurrence of the named day, calls Claude to
    update just that session, and patches it in-place in plan (both locations).
    """
    target_day_name = (adjustment.get("day") or "").strip()
    change = adjustment.get("change", "")
    reason = adjustment.get("reason", "")
    if not target_day_name or not change:
        return False

    today = datetime.utcnow().date().isoformat()

    # Find the next upcoming, not-yet-completed occurrence of that day name
    target_day = None
    target_date = None

    all_days = list(plan.get("days", []))
    for week in plan.get("weeks", []):
        all_days.extend(week.get("days", []))

    for day in sorted(all_days, key=lambda d: d.get("date", "")):
        if (day.get("day", "").lower() == target_day_name.lower()
                and day.get("date", "") > today
                and not day.get("completed")):
            target_day = day
            target_date = day["date"]
            break

    if not target_day:
        print(f"No upcoming {target_day_name} found to adjust")
        return False

    print(f"Applying adjustment to {target_day_name} ({target_date}): {change}")

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    prompt = f"""A running coach is adjusting one planned training session based on athlete performance.

COACH INSTRUCTION:
- Adjustment: {change}
- Reason: {reason}

CURRENT PLANNED SESSION ({target_day_name}, {target_date}):
{json.dumps(target_day, indent=2)}

Rewrite this session to implement the adjustment. Preserve all JSON field names.
Only change what is necessary: title, description, intensity, distance_km, duration_min, hr_zone.
Add a note in `notes` explaining this was coach-adjusted.
Respond ONLY with the updated JSON object for this single day — no extra text."""

    try:
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=512,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        updated = json.loads(raw.strip())
        # Lock date/day so the AI can't shift them
        updated["date"] = target_date
        updated["day"] = target_day_name
        updated["coach_adjusted"] = True
        updated["adjustment_note"] = change

        # Apply to both plan.days and plan.weeks[N].days
        for day in plan.get("days", []):
            if day.get("date") == target_date:
                day.update(updated)
        for week in plan.get("weeks", []):
            for day in week.get("days", []):
                if day.get("date") == target_date:
                    day.update(updated)

        print(f"✅ Adjusted {target_day_name} ({target_date}) → {updated.get('title', '')}")
        return True
    except Exception as e:
        print(f"Adjustment apply failed: {e}")
        return False


def generate_analytics():
    """Fetch 8 weeks of running data and produce analytics.json (no plan changes)."""
    print("Generating analytics from last 8 weeks of Strava runs...")
    activities = fetch_recent_activities(days=56)
    if not activities:
        print("No activities found — skipping analytics")
        return

    weeks = _build_weekly_buckets(activities)
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    # Build these outside the f-string to avoid {{}} escaping issues
    weeks_json    = json.dumps(weeks, indent=2)
    acts_json     = json.dumps(activities[-30:], indent=2)
    weeks_summary = json.dumps(
        [{"week_start": w["week_start"], "total_km": w["total_km"], "avg_hr": w["avg_hr"], "assessment": "brief"}
         for w in weeks],
        indent=2,
    )

    prompt = f"""You are an elite running coach analysing an athlete's last 8 weeks of Strava data.

## Weekly data (running only)
{weeks_json}

## All activities (last 8 weeks)
{acts_json}

Analyse fitness trends, fatigue signals, and training load. Be specific and personal.

Respond ONLY with valid JSON:
{{
  "fitness_trend": "improving|maintaining|declining",
  "fatigue_level": "low|moderate|high|critical",
  "acute_chronic_ratio": 1.05,
  "hr_trend_bpm_per_week": -1.2,
  "weekly_km_trend": "building|maintaining|tapering",
  "key_observations": ["3 bullet points max, specific and data-driven"],
  "warnings": [],
  "recommendations": ["3 bullet points max, actionable"],
  "weeks_analysis": {weeks_summary}
}}"""

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()
    # Attempt to recover a truncated JSON response
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        # Find the last complete top-level key by truncating to the last '}'
        last_brace = raw.rfind("}")
        if last_brace != -1:
            data = json.loads(raw[:last_brace + 1])
        else:
            raise
    data["generated_at"] = datetime.utcnow().isoformat() + "Z"
    data["raw_weeks"] = weeks

    out = Path(__file__).parent.parent / "frontend" / "data" / "analytics.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(data, indent=2))
    print(f"Analytics saved to {out}")


def sync_session():
    print("Fetching recent Strava activities (last 48h)...")
    activities = fetch_recent_all_activities(days=2)

    if not activities:
        print("No recent activities found on Strava")
        return

    plan = load_plan()
    if not plan:
        print("No plan.json found — generate a plan first")
        return

    updated = 0
    pending_adjustments = []

    for activity in activities:
        date_str = activity["date"]
        act_type = activity.get("type", "")
        planned_day = find_matching_day(plan, date_str)

        if not planned_day:
            print(f"No plan day for {date_str} ({act_type}: {activity['name']}) — skipping")
            continue

        if planned_day.get("completed"):
            print(f"{date_str} already marked complete — skipping")
            continue

        # ── Day-swap detection ─────────────────────────────────────────────
        # If a run was logged on a day planned as rest/cross-training,
        # look back up to 3 days for a planned run day the athlete likely moved.
        swapped_from = None
        if act_type in RUNNING_TYPES and not _is_run_workout(planned_day):
            swap_candidate = find_swapped_run_day(plan, date_str, lookback_days=3)
            if swap_candidate:
                swapped_from = swap_candidate
                original_planned_day = planned_day  # cross-training day stays untouched
                planned_day = swap_candidate         # run will be credited here
                print(
                    f"Day-swap detected: run on {date_str} (planned '{original_planned_day.get('title')}') "
                    f"→ crediting to planned run '{planned_day.get('title')}' on {planned_day.get('date')}"
                )
                # Mark the cross-training day as swapped (not completed, but noted)
                apply_completion_to_plan(plan, date_str, {
                    "completed": True,
                    "swapped": True,
                    "execution_rating": "swapped",
                    "actual_stats": {"activity_type": act_type, "activity_name": activity.get("name")},
                    "coach_analysis": (
                        f"You moved your {swap_candidate.get('title', 'run')} from "
                        f"{swap_candidate.get('day', swap_candidate.get('date', ''))} "
                        f"to today — the planned {original_planned_day.get('title', 'cross-training')} "
                        f"was skipped. Day-swap recorded automatically."
                    ),
                })
                save_completed_session(date_str, {
                    "completed": True,
                    "swapped": True,
                    "execution_rating": "swapped",
                    "actual_stats": {"activity_type": act_type, "activity_name": activity.get("name")},
                })

        print(f"Matching {act_type} '{activity['name']}' → plan day '{planned_day.get('title')}' on {planned_day.get('date')}")
        print("Asking Claude for session analysis...")

        try:
            analysis = analyze_session(planned_day, activity, swapped_from=swapped_from)
        except Exception as e:
            print(f"Analysis failed: {e}")
            analysis = {"session_analysis": "Session recorded.", "execution_rating": "on-plan", "adjustment": None}

        completion = {
            "completed": True,
            "actual_stats": {
                "distance_km":   activity.get("distance_km"),
                "duration_min":  activity.get("duration_min"),
                "avg_hr":        activity.get("avg_hr"),
                "avg_pace":      activity.get("avg_pace"),
                "calories":      activity.get("calories"),
                "elevation_m":   activity.get("elevation_m"),
                "activity_name": activity.get("name"),
                "activity_type": activity.get("type"),
            },
            "coach_analysis":   analysis.get("session_analysis", ""),
            "execution_rating": analysis.get("execution_rating", "on-plan"),
        }
        if swapped_from:
            completion["day_swap"] = True
            completion["swapped_from_date"] = date_str
        adj = analysis.get("adjustment")
        if adj:
            completion["coach_adjustment"] = adj
            pending_adjustments.append(adj)
            print(f"Adjustment suggested for {adj.get('day')}: {adj.get('change')}")

        # Update ALL occurrences of this date (top-level days + weeks array are separate copies)
        apply_completion_to_plan(plan, date_str, completion)
        # Persist to completed_sessions.json so completions survive plan regeneration
        save_completed_session(date_str, completion)
        updated += 1

    # Apply real plan adjustments to future days before saving
    adjustments_applied = 0
    for adj in pending_adjustments:
        if apply_coach_adjustment(plan, adj):
            adjustments_applied += 1

    # Always refresh 14-day Strava summary in plan.json so the Today tab stays current
    try:
        print("Refreshing 14-day Strava summary...")
        stats = fetch_stats_summary(days=14)
        plan["strava_summary"]  = stats.get("totals", {})
        plan["strava_averages"] = stats.get("averages", {})
    except Exception as e:
        print(f"Strava summary refresh failed (non-fatal): {e}")

    if updated > 0:
        save_plan(plan)
        print(f"✅ Marked {updated} session(s) complete with coach analysis")
        if adjustments_applied:
            print(f"✅ Applied {adjustments_applied} coach adjustment(s) to future plan days")
    else:
        save_plan(plan)  # Still save to persist refreshed Strava summary
        print("No new sessions to update — saved refreshed Strava stats")

    # Always refresh analytics regardless of whether a new session was found
    generate_analytics()


if __name__ == "__main__":
    sync_session()
