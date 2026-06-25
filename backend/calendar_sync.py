"""Google Calendar sync for approved training plans."""
import os
import json
from datetime import datetime, timedelta
from google.oauth2.credentials import Credentials
from google.oauth2 import service_account
from googleapiclient.discovery import build


SCOPES = ["https://www.googleapis.com/auth/calendar"]

INTENSITY_COLORS = {
    "Rest": "8",       # graphite
    "Easy": "2",       # sage/green
    "Moderate": "5",   # banana/yellow
    "Tempo": "6",      # tangerine/orange
    "Hard": "11",      # tomato/red
    "Long Run": "9",   # blueberry
    "Race": "4",       # flamingo
}


def _get_service():
    creds_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if creds_json:
        info = json.loads(creds_json)
        creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    else:
        # Fallback: use oauth token from env (for local dev)
        token = os.environ["GOOGLE_OAUTH_TOKEN"]
        creds = Credentials(token=token)
    return build("calendar", "v3", credentials=creds)


def sync_plan_to_calendar(plan: dict) -> list[str]:
    """
    Write each day of the plan to Google Calendar.
    Returns list of created event IDs.
    """
    service = _get_service()
    calendar_id = os.environ["GOOGLE_CALENDAR_ID"]
    event_ids = []

    for day in plan.get("days", []):
        if day["workout_type"] == "Rest" and day["distance_km"] == 0:
            continue  # Skip full rest days (optional: set as all-day events)

        date_str = day.get("date")
        if not date_str:
            continue

        # Build event times (use reasonable defaults: 6am start)
        start_dt = datetime.strptime(date_str, "%Y-%m-%d").replace(hour=6, minute=0)
        end_dt = start_dt + timedelta(minutes=day.get("duration_min", 60))

        description_parts = [
            day.get("description", ""),
            "",
            f"Distance: {day['distance_km']} km",
            f"Duration: {day['duration_min']} min",
            f"Intensity: {day['intensity']}",
        ]
        if day.get("hr_zone"):
            description_parts.append(f"HR Zone: {day['hr_zone']}")
        if day.get("key_focus"):
            description_parts.append(f"Focus: {day['key_focus']}")
        if day.get("notes"):
            description_parts.append(f"\nNotes: {day['notes']}")

        color = INTENSITY_COLORS.get(day["intensity"], "1")

        event = {
            "summary": f"🏃 {day['title']}",
            "description": "\n".join(description_parts),
            "start": {"dateTime": start_dt.isoformat(), "timeZone": "UTC"},
            "end": {"dateTime": end_dt.isoformat(), "timeZone": "UTC"},
            "colorId": color,
            "reminders": {
                "useDefault": False,
                "overrides": [{"method": "popup", "minutes": 30}],
            },
        }

        created = service.events().insert(calendarId=calendar_id, body=event).execute()
        event_ids.append(created["id"])
        print(f"Created: {day['day']} — {day['title']}")

    return event_ids


def delete_future_workout_events(days_ahead=14):
    """Delete existing coaching events to avoid duplicates before re-syncing."""
    service = _get_service()
    calendar_id = os.environ["GOOGLE_CALENDAR_ID"]
    now = datetime.utcnow().isoformat() + "Z"
    end = (datetime.utcnow() + timedelta(days=days_ahead)).isoformat() + "Z"

    events_result = service.events().list(
        calendarId=calendar_id,
        timeMin=now,
        timeMax=end,
        q="🏃",
        singleEvents=True,
    ).execute()

    for event in events_result.get("items", []):
        service.events().delete(calendarId=calendar_id, eventId=event["id"]).execute()
        print(f"Deleted: {event.get('summary')}")
