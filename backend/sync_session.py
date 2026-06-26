"""
Lightweight session sync — does NOT regenerate the full plan.

Fetches the last 48h of Strava activities, matches each to the current
plan day, marks it as completed with actual stats, and asks Claude for
a brief session analysis. Only adjusts upcoming sessions if something
was significantly off from what was planned.
"""
import os
import json
from datetime import datetime, timedelta
from pathlib import Path

import anthropic
from strava_client import get_access_token

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


def find_matching_day(plan, date_str):
    """Return (day_dict, week_idx_or_None, day_idx_or_None)."""
    for di, day in enumerate(plan.get("days", [])):
        if day.get("date") == date_str:
            return day, None, di
    for wi, week in enumerate(plan.get("weeks", [])):
        for di, day in enumerate(week.get("days", [])):
            if day.get("date") == date_str:
                return day, wi, di
    return None, None, None


def analyze_session(planned_day, actual):
    """Ask Claude for a brief coaching take on the session."""
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    actual_parts = []
    if actual.get("distance_km"):
        actual_parts.append(f"Distance: {actual['distance_km']} km")
    if actual.get("duration_min"):
        actual_parts.append(f"Duration: {actual['duration_min']} min")
    if actual.get("avg_hr"):
        actual_parts.append(f"Avg HR: {actual['avg_hr']} bpm")
    if actual.get("avg_pace"):
        actual_parts.append(f"Avg Pace: {actual['avg_pace']} /km")
    actual_summary = ", ".join(actual_parts) or "No detailed stats"

    prompt = f"""You are a running coach. A session just completed — give a brief coaching analysis.

WHAT WAS PLANNED:
- Type: {planned_day.get('workout_type', 'Run')}
- Title: {planned_day.get('title', '')}
- Distance: {planned_day.get('distance_km', 0)} km
- Duration: {planned_day.get('duration_min', 0)} min
- Intensity: {planned_day.get('intensity', '')}
- HR Zone: {planned_day.get('hr_zone', '')}
- Description: {planned_day.get('description', '')}

WHAT ACTUALLY HAPPENED (Strava):
- Activity: {actual.get('name', '')} ({actual.get('type', 'Workout')})
- {actual_summary}

Respond ONLY with valid JSON:
{{
  "session_analysis": "2-3 sentences: how did the athlete execute? Specific, personal, encouraging but honest.",
  "execution_rating": "on-plan|slightly-hard|too-hard|too-easy|great|skipped",
  "adjustment": null
}}

Set "adjustment" (not null) ONLY if effort deviated significantly (>20% from target HR/pace) AND a specific upcoming session should change. Format: {{"day": "Wednesday", "change": "Reduce tempo from 8km to 6km", "reason": "HR ran high today — allow extra recovery"}}. Otherwise keep null — minor variations are normal and the plan should stay intact."""

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
    for activity in activities:
        date_str = activity["date"]
        planned_day, week_idx, day_idx = find_matching_day(plan, date_str)

        if not planned_day:
            print(f"No plan day for {date_str} ({activity['type']}: {activity['name']}) — skipping")
            continue

        if planned_day.get("completed"):
            print(f"{date_str} already marked complete — skipping")
            continue

        print(f"Matching {activity['type']} '{activity['name']}' → plan day '{planned_day.get('title')}' on {date_str}")
        print("Asking Claude for session analysis...")

        try:
            analysis = analyze_session(planned_day, activity)
        except Exception as e:
            print(f"Analysis failed: {e}")
            analysis = {"session_analysis": "Session recorded.", "execution_rating": "on-plan", "adjustment": None}

        planned_day["completed"] = True
        planned_day["actual_stats"] = {
            "distance_km":  activity.get("distance_km"),
            "duration_min": activity.get("duration_min"),
            "avg_hr":       activity.get("avg_hr"),
            "avg_pace":     activity.get("avg_pace"),
            "calories":     activity.get("calories"),
            "activity_name": activity.get("name"),
            "activity_type": activity.get("type"),
        }
        planned_day["coach_analysis"]  = analysis.get("session_analysis", "")
        planned_day["execution_rating"] = analysis.get("execution_rating", "on-plan")

        adj = analysis.get("adjustment")
        if adj:
            planned_day["coach_adjustment"] = adj
            print(f"Minor adjustment suggested for {adj.get('day')}: {adj.get('change')}")

        updated += 1

    if updated > 0:
        save_plan(plan)
        print(f"✅ Marked {updated} session(s) complete with coach analysis")
    else:
        print("No new sessions to update")


if __name__ == "__main__":
    sync_session()
