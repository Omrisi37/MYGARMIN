"""Strava API client — uses OAuth refresh token, no rate limiting issues."""
import os
import requests
from datetime import datetime, timedelta


def get_access_token():
    resp = requests.post("https://www.strava.com/oauth/token", data={
        "client_id":     os.environ["STRAVA_CLIENT_ID"],
        "client_secret": os.environ["STRAVA_CLIENT_SECRET"],
        "refresh_token": os.environ["STRAVA_REFRESH_TOKEN"],
        "grant_type":    "refresh_token",
    })
    if not resp.ok:
        print(f"Strava token error {resp.status_code}: {resp.text}")
    resp.raise_for_status()
    return resp.json()["access_token"]


def fetch_recent_activities(days=14):
    """Return running activity summaries for the last N days."""
    token = get_access_token()
    after = int((datetime.now() - timedelta(days=days)).timestamp())

    runs = []
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
        runs.extend([a for a in data if a.get("type") in ("Run", "TrailRun")])
        if len(data) < 100:
            break
        page += 1

    summaries = []
    for act in sorted(runs, key=lambda a: a["start_date_local"]):
        summaries.append({
            "date":                    act["start_date_local"][:10],
            "name":                    act.get("name", ""),
            "distance_km":             round(act.get("distance", 0) / 1000, 2),
            "duration_min":            round(act.get("moving_time", 0) / 60, 1),
            "avg_hr":                  act.get("average_heartrate"),
            "max_hr":                  act.get("max_heartrate"),
            "calories":                act.get("calories"),
            "elevation_gain_m":        act.get("total_elevation_gain"),
            "avg_pace_min_km":         _pace(act.get("average_speed")),
            "training_effect_aerobic": None,
            "vo2_max":                 None,
        })
    return summaries


def fetch_stats_summary(days=14):
    """Return aggregated stats for the period."""
    activities = fetch_recent_activities(days)
    if not activities:
        return {"activities": [], "totals": {}, "averages": {}}

    total_km  = sum(a["distance_km"] for a in activities)
    total_min = sum(a["duration_min"] for a in activities)
    hr_values = [a["avg_hr"] for a in activities if a["avg_hr"]]

    return {
        "activities": activities,
        "totals": {
            "runs":           len(activities),
            "distance_km":    round(total_km, 1),
            "duration_hours": round(total_min / 60, 1),
        },
        "averages": {
            "distance_per_run_km": round(total_km / len(activities), 1) if activities else 0,
            "avg_hr":              round(sum(hr_values) / len(hr_values)) if hr_values else None,
            "latest_vo2_max":      None,
        },
    }


def _pace(speed_m_s):
    if not speed_m_s or speed_m_s <= 0:
        return None
    pace_s = 1000 / speed_m_s
    return f"{int(pace_s // 60)}:{int(pace_s % 60):02d}"
