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

def _parse_json_env(key, default):
    raw = os.environ.get(key, "")
    if not raw or raw.strip() in ("", "[]", "{}"):
        return default
    try:
        return json.loads(raw)
    except Exception:
        return default

TRAINING_CONFIG = {
    "goal":                os.environ.get("TRAINING_GOAL") or "Marathon",
    "target_time":         os.environ.get("TARGET_TIME") or "",
    "race_name":           os.environ.get("RACE_NAME") or "",
    "weekly_hours_budget": float(os.environ.get("WEEKLY_HOURS") or "7"),
    "race_date":           os.environ.get("RACE_DATE") or None,
    "start_date":          os.environ.get("START_DATE") or None,
    "run_days":            _parse_run_days(os.environ.get("RUN_DAYS") or ""),
    "sessions_per_week":   int(os.environ.get("SESSIONS_PER_WEEK") or "4"),
    "cross_training":      _parse_json_env("CROSS_TRAINING", []),
    "weekly_skip_ct":      _parse_json_env("WEEKLY_SKIP_CT", []),
    "quality_enabled":     os.environ.get("QUALITY_ENABLED", "false").lower() == "true",
    "quality_sessions":    int(os.environ.get("QUALITY_SESSIONS") or "2"),
    "quality_types":       [t.strip() for t in (os.environ.get("QUALITY_TYPES") or "").split(",") if t.strip()],
}


def load_prompt_template():
    prompt_path = Path(__file__).parent / "training_prompt.md"
    return prompt_path.read_text()


def weeks_to_race(race_date_str: str | None) -> int | None:
    if not race_date_str:
        return None
    race = datetime.strptime(race_date_str, "%Y-%m-%d")
    return max(0, (race - datetime.today()).days // 7)


def build_user_message(strava_data: dict, config: dict) -> str:
    weeks_left = weeks_to_race(config.get("race_date"))
    today = datetime.today()

    # Determine plan start date
    if config.get("start_date"):
        week_start = datetime.strptime(config["start_date"], "%Y-%m-%d")
    else:
        week_start = today - timedelta(days=today.weekday())  # Monday

    days_of_week = []
    for i in range(7):
        d = week_start + timedelta(days=i)
        days_of_week.append({"day": d.strftime("%A"), "date": d.strftime("%Y-%m-%d")})

    run_days = config.get("run_days") or []
    sessions = config.get("sessions_per_week") or 4

    schedule_note = ""
    if run_days:
        schedule_note = f"- Preferred running days: {', '.join(run_days)}\n- Sessions per week: {sessions} (choose the best {sessions} from the preferred days above — assign rest to the others)"

    # Cross-training notes
    ct = config.get("cross_training") or []
    skip_ct = config.get("weekly_skip_ct") or []
    ct_note = ""
    if ct:
        ct_lines = []
        for a in ct:
            days_str = ", ".join(a.get("days", [])) if a.get("days") else "days not specified"
            skip_note = " (SKIPPING THIS WEEK)" if a["id"] in skip_ct else ""
            ct_lines.append(f"  - {a['label']}: {days_str}{skip_note}")
        ct_note = "## Cross-Training Activities (already scheduled — do not add running on these days)\n" + "\n".join(ct_lines)

    # Quality sessions notes
    quality_note = ""
    if config.get("quality_enabled"):
        types = ", ".join(config.get("quality_types") or []) or "any"
        quality_note = f"## Quality Sessions\nInclude {config['quality_sessions']} quality/anaerobic session(s) per week. Preferred types: {types}."

    return f"""
## Athlete Profile
- Goal: {config['goal']}
{f"- Race: {config['race_name']}" if config.get('race_name') else ""}
{f"- Target time: {config['target_time']}" if config.get('target_time') else ""}
- Weekly time budget: {config['weekly_hours_budget']} hours
- Target week: {week_start.strftime('%Y-%m-%d')} to {(week_start + timedelta(days=6)).strftime('%Y-%m-%d')}
{f"- Weeks until race: {weeks_left}" if weeks_left is not None else "- No specific race date set"}
{schedule_note}

{ct_note}

{quality_note}

## Last 14 Days of Training (from Strava)
{json.dumps(strava_data, indent=2)}

## Week Schedule to Fill
{json.dumps(days_of_week, indent=2)}

## Instructions
Generate the complete 7-day training plan for the week above.
- Respect the athlete's time budget ({config['weekly_hours_budget']} hrs/week)
- Apply polarized training (80% easy, 20% hard)
- Adapt intensity based on recent training load and fatigue signals
- Include exact dates from the week schedule provided
- On days with cross-training activities, assign "Cross-Training" or "Rest" (not a run), unless the athlete is skipping that activity this week
- If quality sessions are enabled, include the specified number of hard/interval/tempo workouts
- Return ONLY valid JSON matching the schema in your system prompt
"""


def save_plan(plan: dict):
    data_dir = Path(__file__).parent.parent / "frontend" / "data"
    data_dir.mkdir(exist_ok=True)
    plan_path = data_dir / "plan.json"

    # Keep last plan as backup
    if plan_path.exists():
        backup_path = data_dir / f"plan_{datetime.today().strftime('%Y%m%d')}_backup.json"
        backup_path.write_text(plan_path.read_text())

    plan["generated_at"] = datetime.utcnow().isoformat() + "Z"
    plan["status"] = "pending_approval"

    # Backward-compat: if 4-week format, copy week 1 fields to top level
    if "weeks" in plan and plan["weeks"]:
        w1 = plan["weeks"][0]
        for field in ("week_number", "phase", "weekly_summary", "total_distance_km",
                      "aerobic_percent", "anaerobic_percent", "days", "coaching_notes",
                      "recovery_flags", "next_week_preview"):
            if field in w1 and field not in plan:
                plan[field] = w1[field]

    plan_path.write_text(json.dumps(plan, indent=2))
    print(f"Plan saved to {plan_path}")


def build_four_week_message(strava_data: dict, config: dict) -> str:
    """Build user message asking Claude for a full 4-week plan."""
    weeks_left = weeks_to_race(config.get("race_date"))
    today = datetime.today()

    if config.get("start_date"):
        week_start = datetime.strptime(config["start_date"], "%Y-%m-%d")
    else:
        week_start = today - timedelta(days=today.weekday())

    # Build 4 weeks of dates
    four_weeks = []
    for w in range(4):
        ws = week_start + timedelta(weeks=w)
        days_of_week = []
        for i in range(7):
            d = ws + timedelta(days=i)
            days_of_week.append({"day": d.strftime("%A"), "date": d.strftime("%Y-%m-%d")})
        four_weeks.append({"week": w + 1, "days": days_of_week})

    run_days = config.get("run_days") or []
    sessions = config.get("sessions_per_week") or 4
    schedule_note = ""
    if run_days:
        schedule_note = f"- Preferred running days: {', '.join(run_days)}\n- Sessions per week: {sessions}"

    ct = config.get("cross_training") or []
    skip_ct = config.get("weekly_skip_ct") or []
    ct_note = ""
    if ct:
        ct_lines = []
        for a in ct:
            days_str = ", ".join(a.get("days", [])) if a.get("days") else "days not specified"
            skip_note = " (SKIPPING WEEK 1)" if a["id"] in skip_ct else ""
            ct_lines.append(f"  - {a['label']}: {days_str}{skip_note}")
        ct_note = "## Cross-Training Activities\n" + "\n".join(ct_lines)

    quality_note = ""
    if config.get("quality_enabled"):
        types = ", ".join(config.get("quality_types") or []) or "any"
        quality_note = f"## Quality Sessions\nInclude {config['quality_sessions']} quality session(s) per week. Preferred types: {types}."

    return f"""
## Athlete Profile
- Goal: {config['goal']}
{f"- Race: {config['race_name']}" if config.get('race_name') else ""}
{f"- Target time: {config['target_time']}" if config.get('target_time') else ""}
- Weekly time budget: {config['weekly_hours_budget']} hours
{f"- Weeks until race: {weeks_left}" if weeks_left is not None else "- No specific race date set"}
{schedule_note}

{ct_note}

{quality_note}

## Last 14 Days of Training (from Strava)
{json.dumps(strava_data, indent=2)}

## 4-Week Schedule to Fill
{json.dumps(four_weeks, indent=2)}

## Instructions
Generate a complete 4-week periodized training plan.
- Apply progressive overload: build volume weeks 1-3, recovery/adaptation week 4
- Respect the athlete's time budget and preferred days
- Apply polarized training (80% easy, 20% hard)
- On cross-training days assign Rest/Cross-Training (not a run)
- Return ONLY valid JSON in this exact format:
{{
  "coaching_overview": "2-3 sentence overview of the 4-week block",
  "weeks": [
    {{
      "week_number": 1,
      "phase": "Base Building",
      "weekly_summary": "...",
      "total_distance_km": 50.0,
      "aerobic_percent": 82,
      "anaerobic_percent": 18,
      "days": [ ... same day schema as single-week format ... ],
      "coaching_notes": "...",
      "recovery_flags": [],
      "next_week_preview": "..."
    }},
    ... (4 weeks total)
  ]
}}
"""


def generate_plan():
    print("Fetching Strava data...")
    strava_data = fetch_stats_summary(days=14)
    print(f"Fetched {strava_data['totals'].get('runs', 0)} runs")

    system_prompt = load_prompt_template()
    user_message = build_four_week_message(strava_data, TRAINING_CONFIG)

    print("Calling Claude API for 4-week plan...")
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

    plan = json.loads(raw)
    plan["strava_summary"] = strava_data["totals"]
    plan["strava_averages"] = strava_data["averages"]

    save_plan(plan)
    print("Done! Plan is saved and awaiting your approval in the dashboard.")
    return plan


if __name__ == "__main__":
    plan = generate_plan()
    if "weeks" in plan:
        print(f"\n4-Week Plan generated: {plan.get('coaching_overview','')}")
        for w in plan["weeks"]:
            print(f"  Week {w.get('week_number')} ({w.get('phase')}): {w.get('total_distance_km')} km")
    else:
        print(f"\nWeek {plan.get('week_number')} — {plan.get('phase')}")
        print(f"Total distance: {plan.get('total_distance_km')} km")
        print(f"Aerobic: {plan.get('aerobic_percent')}% / Anaerobic: {plan.get('anaerobic_percent')}%")
