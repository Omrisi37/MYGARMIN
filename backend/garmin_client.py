"""Garmin Connect data fetcher."""
import os
import json
from datetime import datetime, timedelta
from garminconnect import Garmin


def get_client():
    email = os.environ["GARMIN_EMAIL"]
    password = os.environ["GARMIN_PASSWORD"]
    client = Garmin(email, password)
    client.login()
    return client


def fetch_recent_activities(days=14):
    """Return activity summaries for the last N days."""
    client = get_client()
    end_date = datetime.today()
    start_date = end_date - timedelta(days=days)

    activities = client.get_activities_by_date(
        start_date.strftime("%Y-%m-%d"),
        end_date.strftime("%Y-%m-%d"),
        "running",
    )

    summaries = []
    for act in activities:
        summaries.append({
            "date": act.get("startTimeLocal", "")[:10],
            "name": act.get("activityName", ""),
            "distance_km": round((act.get("distance", 0) or 0) / 1000, 2),
            "duration_min": round((act.get("duration", 0) or 0) / 60, 1),
            "avg_hr": act.get("averageHR"),
            "max_hr": act.get("maxHR"),
            "calories": act.get("calories"),
            "elevation_gain_m": act.get("elevationGain"),
            "avg_pace_min_km": _pace(act.get("averageSpeed")),
            "training_effect_aerobic": act.get("aerobicTrainingEffect"),
            "training_effect_anaerobic": act.get("anaerobicTrainingEffect"),
            "vo2_max": act.get("vO2MaxValue"),
        })

    return summaries


def fetch_stats_summary(days=14):
    """Return aggregated stats for the period."""
    activities = fetch_recent_activities(days)
    if not activities:
        return {"activities": [], "totals": {}, "averages": {}}

    total_km = sum(a["distance_km"] for a in activities)
    total_min = sum(a["duration_min"] for a in activities)
    hr_values = [a["avg_hr"] for a in activities if a["avg_hr"]]
    vo2_values = [a["vo2_max"] for a in activities if a["vo2_max"]]

    return {
        "activities": activities,
        "totals": {
            "runs": len(activities),
            "distance_km": round(total_km, 1),
            "duration_hours": round(total_min / 60, 1),
        },
        "averages": {
            "distance_per_run_km": round(total_km / len(activities), 1),
            "avg_hr": round(sum(hr_values) / len(hr_values)) if hr_values else None,
            "latest_vo2_max": vo2_values[-1] if vo2_values else None,
        },
    }


def _pace(speed_m_s):
    """Convert m/s to min/km string."""
    if not speed_m_s or speed_m_s <= 0:
        return None
    pace_s = 1000 / speed_m_s
    return f"{int(pace_s // 60)}:{int(pace_s % 60):02d}"
