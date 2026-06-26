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


TRAINING_CONFIG = {
    "goal":                os.environ.get("TRAINING_GOAL") or "Marathon",
    "target_time":         os.environ.get("TARGET_TIME") or "",
    "race_name":           os.environ.get("RACE_NAME") or "",
    "weekly_hours_budget": float(os.environ.get("WEEKLY_HOURS") or "7"),
    "race_date":           os.environ.get("RACE_DATE") or None,
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
    week_start = today - timedelta(days=today.weekday())  # Monday

    days_of_week = []
    for i in range(7):
        d = week_start + timedelta(days=i)
        days_of_week.append({"day": d.strftime("%A"), "date": d.strftime("%Y-%m-%d")})

    return f"""
## Athlete Profile
- Goal: {config['goal']}
{f"- Race: {config['race_name']}" if config.get('race_name') else ""}
{f"- Target time: {config['target_time']}" if config.get('target_time') else ""}
- Weekly time budget: {config['weekly_hours_budget']} hours
- Target week: {week_start.strftime('%Y-%m-%d')} to {(week_start + timedelta(days=6)).strftime('%Y-%m-%d')}
{f"- Weeks until race: {weeks_left}" if weeks_left is not None else "- No specific race date set"}

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
    plan_path.write_text(json.dumps(plan, indent=2))
    print(f"Plan saved to {plan_path}")


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
        max_tokens=4096,
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
    print(f"\nWeek {plan.get('week_number')} — {plan.get('phase')}")
    print(f"Total distance: {plan.get('total_distance_km')} km")
    print(f"Aerobic: {plan.get('aerobic_percent')}% / Anaerobic: {plan.get('anaerobic_percent')}%")
