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

    # Determine plan start date
    if config.get("start_date"):
        week_start = datetime.strptime(config["start_date"], "%Y-%m-%d")
    else:
        week_start = today - timedelta(days=today.weekday())  # Monday

    # Generate 4 weeks of dates
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

    run_days = config.get("run_days") or []
    sessions = config.get("sessions_per_week") or 4
    phase = current_training_phase(weeks_left)

    schedule_note = ""
    if run_days:
        schedule_note = f"- Preferred running days: {', '.join(run_days)}\n- Sessions per week: {sessions} (choose the best {sessions} from the preferred days above — assign rest to the others)"

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

## Last 14 Days of Training (from Strava)
{json.dumps(strava_data, indent=2)}

## 4-Week Schedule to Fill
{json.dumps(all_weeks_dates, indent=2)}

## Cross-Training Schedule (FIXED COMMITMENTS — do not place runs on these days)
{_format_cross_training(config.get('cross_training', []), config.get('weekly_skip_ct', []))}

## Quality Sessions Requested
- Quality sessions per week: {config['quality_sessions']} (0 = only easy/tempo based on plan)
- Types preferred: {', '.join(config['quality_types']) if config['quality_types'] else 'Coach decides'}

## This Week Exceptions (Week 1)
Skipping cross-training: {', '.join(config['weekly_skip_ct']) if config['weekly_skip_ct'] else 'None — all usual activities happening'}

## Instructions
Generate the complete 4-week training plan for the block above.
- Respect the athlete's time budget ({config['weekly_hours_budget']} hrs/week)
- Apply polarized training (80% easy, 20% hard)
- Adapt intensity based on recent training load and fatigue signals
- Include exact dates from the week schedule provided
- Build progressively across the 4 weeks
- Return ONLY valid JSON matching the schema in your system prompt
"""


def save_plan(result: dict):
    data_dir = Path(__file__).parent.parent / "frontend" / "data"
    data_dir.mkdir(exist_ok=True)
    plan_path = data_dir / "plan.json"

    if plan_path.exists():
        backup = data_dir / f"plan_{datetime.today().strftime('%Y%m%d')}_backup.json"
        backup.write_text(plan_path.read_text())

    # Build the plan object
    weeks = result.get("weeks", [])
    first_week = weeks[0] if weeks else {}

    plan = {
        # 4-week structure
        "weeks": weeks,
        "coaching_overview": result.get("coaching_overview", ""),
        "total_plan_distance_km": result.get("total_plan_distance_km", 0),
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
    plan_path.write_text(json.dumps(plan, indent=2))
    print(f"Plan saved to {plan_path}")
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
