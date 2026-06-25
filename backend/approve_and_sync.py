"""
Triggered manually via GitHub Actions workflow_dispatch after user approves
the plan in the dashboard. Reads data/plan.json and syncs to Google Calendar.
"""
import json
import sys
from pathlib import Path
from datetime import datetime

from calendar_sync import sync_plan_to_calendar, delete_future_workout_events


def main():
    plan_path = Path(__file__).parent.parent / "data" / "plan.json"
    if not plan_path.exists():
        print("No plan.json found. Run generate plan first.")
        sys.exit(1)

    plan = json.loads(plan_path.read_text())

    if plan.get("status") != "approved":
        print(f"Plan status is '{plan.get('status')}' — must be 'approved' to sync.")
        sys.exit(1)

    print("Deleting existing future workout events...")
    delete_future_workout_events(days_ahead=14)

    print("Syncing approved plan to Google Calendar...")
    event_ids = sync_plan_to_calendar(plan)

    plan["status"] = "synced"
    plan["synced_at"] = datetime.utcnow().isoformat() + "Z"
    plan["calendar_event_ids"] = event_ids
    plan_path.write_text(json.dumps(plan, indent=2))

    print(f"Synced {len(event_ids)} events to Google Calendar.")


if __name__ == "__main__":
    main()
