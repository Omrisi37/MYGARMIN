"""
Deep analysis agent — fetches 8 weeks of Garmin data, sends to Claude
for pattern recognition, generates insights + improved training plan.

Triggered by the "Analyse & Improve" button in the app.
"""
import os
import json
from datetime import datetime, timedelta
from pathlib import Path

import anthropic
from strava_client import fetch_stats_summary, fetch_recent_activities


TRAINING_CONFIG = {
    "goal":          os.environ.get("TRAINING_GOAL") or "Marathon",
    "target_time":   os.environ.get("TARGET_TIME") or "",
    "race_name":     os.environ.get("RACE_NAME") or "",
    "weekly_hours":  float(os.environ.get("WEEKLY_HOURS") or "7"),
    "race_date":     os.environ.get("RACE_DATE") or None,
}

ANALYSIS_SYSTEM_PROMPT = """
You are an elite endurance coach and sports scientist. You analyse running data
with the same depth as a professional coach working with Olympic athletes.

Your job:
1. Identify fitness trends from heart rate + pace + volume patterns
2. Detect fatigue, overtraining, or undertraining signals
3. Recommend an optimal next 2 weeks of training
4. Generate a complete 7-day plan for the upcoming week

## Key metrics you analyse

**Cardiac Drift / Fitness Signal**
- If avg HR is DECREASING at the same pace → athlete is getting fitter
- If avg HR is INCREASING at same effort → fatigue or overtraining
- Compare HR across same-distance runs over time

**Training Load**
- Acute load (last 7 days) vs Chronic load (last 28 days)
- Acute:Chronic ratio > 1.3 = overtraining risk
- Ratio 0.8–1.3 = optimal training zone
- Ratio < 0.8 = undertraining / detraining

**Volume Progression**
- Safe weekly mileage increase: max 10% per week
- Flag if any week jumped >15%
- Identify build → peak → taper pattern

**Heart Rate Zones**
- Zone 1: <65% MaxHR — Recovery
- Zone 2: 65-75% MaxHR — Aerobic base (should be 80% of volume)
- Zone 3: 75-85% — Tempo / threshold
- Zone 4: 85-92% — VO2 max work
- Zone 5: >92% — Neuromuscular / sprint

**VO2 Max Trend**
- Improving = good training response
- Flat = maintaining
- Declining = too much fatigue or too little intensity

## Output Format

Respond ONLY with valid JSON:

```json
{
  "fitness_trend": "improving|maintaining|declining",
  "fatigue_level": "low|moderate|high|critical",
  "acute_chronic_ratio": 1.05,
  "hr_trend_bpm_per_week": -1.2,
  "weekly_km_trend": "building|maintaining|tapering",
  "key_observations": [
    "Your avg HR at easy pace dropped 4 bpm over 8 weeks — clear aerobic fitness gain",
    "Week 6 had a 22% mileage spike — slightly aggressive but no HR alarm",
    "VO2 max up from 52 to 54.3 — responding well to training"
  ],
  "warnings": [],
  "recommendations": [
    "Keep 80% of this week's runs in Zone 2",
    "Ready for a longer tempo session — lactate threshold is improving"
  ],
  "weeks_analysis": [
    {
      "week_start": "2026-04-28",
      "total_km": 42.0,
      "avg_hr": 151,
      "assessment": "solid base week",
      "load_score": 78
    }
  ],
  "plan": {
    "week_number": 5,
    "phase": "Aerobic Development",
    "weekly_summary": "...",
    "total_distance_km": 55.0,
    "aerobic_percent": 80,
    "anaerobic_percent": 20,
    "coaching_notes": "...",
    "recovery_flags": [],
    "next_week_preview": "...",
    "days": [
      {
        "day": "Monday",
        "date": "2026-06-29",
        "workout_type": "Rest",
        "title": "Full Recovery",
        "distance_km": 0,
        "duration_min": 0,
        "intensity": "Rest",
        "hr_zone": null,
        "description": "...",
        "key_focus": "Recovery",
        "notes": ""
      }
    ]
  }
}
```
"""


def build_weekly_buckets(activities):
    """Group activities into weekly buckets for trend analysis."""
    if not activities:
        return []

    buckets = {}
    for act in activities:
        date = datetime.strptime(act["date"], "%Y-%m-%d")
        # Monday of that week
        week_start = (date - timedelta(days=date.weekday())).strftime("%Y-%m-%d")
        if week_start not in buckets:
            buckets[week_start] = []
        buckets[week_start].append(act)

    weeks = []
    for week_start in sorted(buckets.keys()):
        runs = buckets[week_start]
        total_km   = sum(r["distance_km"] for r in runs)
        total_min  = sum(r["duration_min"] for r in runs)
        hrs        = [r["avg_hr"] for r in runs if r.get("avg_hr")]
        vo2s       = [r["vo2_max"] for r in runs if r.get("vo2_max")]
        weeks.append({
            "week_start":   week_start,
            "runs":         len(runs),
            "total_km":     round(total_km, 1),
            "total_hours":  round(total_min / 60, 1),
            "avg_hr":       round(sum(hrs) / len(hrs)) if hrs else None,
            "vo2_max":      round(vo2s[-1], 1) if vo2s else None,
            "activities":   runs,
        })
    return weeks


def save_analytics(data: dict):
    data_dir = Path(__file__).parent.parent / "frontend" / "data"
    data_dir.mkdir(exist_ok=True)
    path = data_dir / "analytics.json"
    data["generated_at"] = datetime.utcnow().isoformat() + "Z"
    path.write_text(json.dumps(data, indent=2))
    print(f"Analytics saved to {path}")


def save_plan(plan: dict):
    data_dir = Path(__file__).parent.parent / "frontend" / "data"
    plan_path = data_dir / "plan.json"
    if plan_path.exists():
        backup = data_dir / f"plan_{datetime.today().strftime('%Y%m%d')}_backup.json"
        backup.write_text(plan_path.read_text())
    plan["generated_at"] = datetime.utcnow().isoformat() + "Z"
    plan["status"] = "pending_approval"
    plan_path.write_text(json.dumps(plan, indent=2))
    print(f"Plan saved to {plan_path}")


def run_deep_analysis():
    print("Fetching 8 weeks of Strava data...")
    activities = fetch_recent_activities(days=56)
    print(f"  → {len(activities)} activities found")

    weeks = build_weekly_buckets(activities)
    config = TRAINING_CONFIG

    # Compute today's week for plan dates
    today = datetime.today()
    week_start = today - timedelta(days=today.weekday())
    days_of_week = [
        {"day": (week_start + timedelta(days=i)).strftime("%A"),
         "date": (week_start + timedelta(days=i)).strftime("%Y-%m-%d")}
        for i in range(7)
    ]

    weeks_to_race = None
    if config.get("race_date"):
        race = datetime.strptime(config["race_date"], "%Y-%m-%d")
        weeks_to_race = max(0, (race - today).days // 7)

    user_message = f"""
## Athlete Profile
- Goal: {config['goal']}
{f"- Race: {config['race_name']}" if config.get('race_name') else ""}
{f"- Target time: {config['target_time']}" if config.get('target_time') else ""}
- Weekly time budget: {config['weekly_hours']} hours
{f"- Weeks until race: {weeks_to_race}" if weeks_to_race is not None else "- No race date set"}

## 8-Week Training History (from Strava)

### Weekly Summaries
{json.dumps(weeks, indent=2)}

### All Individual Runs (most recent first)
{json.dumps(list(reversed(activities)), indent=2)}

## Next Week Schedule
{json.dumps(days_of_week, indent=2)}

## Your Task
1. Analyse all 8 weeks of data — identify fitness trends, fatigue signals, HR patterns
2. Generate key observations (what's working, what's not)
3. Generate the 7-day plan for next week based on what the data tells you
4. Return ONLY valid JSON matching the schema in your system prompt
"""

    print("Calling Claude for deep analysis...")
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=6000,
        system=[{"type": "text", "text": ANALYSIS_SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": user_message}],
    )

    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    result = json.loads(raw)

    # Save analytics (charts data + insights)
    analytics = {
        "fitness_trend":        result.get("fitness_trend"),
        "fatigue_level":        result.get("fatigue_level"),
        "acute_chronic_ratio":  result.get("acute_chronic_ratio"),
        "hr_trend_bpm_per_week":result.get("hr_trend_bpm_per_week"),
        "weekly_km_trend":      result.get("weekly_km_trend"),
        "key_observations":     result.get("key_observations", []),
        "warnings":             result.get("warnings", []),
        "recommendations":      result.get("recommendations", []),
        "weeks_analysis":       result.get("weeks_analysis", weeks),
        "raw_weeks":            weeks,
        "raw_activities":       activities,
    }
    save_analytics(analytics)

    # Save improved plan
    plan = result.get("plan", {})
    plan["source"] = "deep_analysis"
    save_plan(plan)

    print(f"\n✅ Analysis complete")
    print(f"   Fitness trend:  {result.get('fitness_trend')}")
    print(f"   Fatigue level:  {result.get('fatigue_level')}")
    print(f"   HR trend:       {result.get('hr_trend_bpm_per_week')} bpm/week")
    print(f"   Observations:   {len(result.get('key_observations', []))}")

    return result


if __name__ == "__main__":
    run_deep_analysis()
