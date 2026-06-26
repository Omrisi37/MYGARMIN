"""Garmin Connect data fetcher — uses token-based auth for CI environments."""
import os
import json
import base64
import tempfile
from pathlib import Path
from datetime import datetime, timedelta

import garth
from garminconnect import Garmin


def get_client():
    """
    Try token auth first (from GARMIN_TOKENS secret), fall back to password login.
    Token auth works reliably in CI; password login may fail with Garmin's MFA.
    """
    tokens_b64 = os.environ.get("GARMIN_TOKENS")

    if tokens_b64:
        # Restore saved session tokens (base64-encoded garth token dir)
        token_dir = Path(tempfile.mkdtemp())
        token_bytes = base64.b64decode(tokens_b64)
        # garth tokens are stored as a tar archive
        import tarfile, io
        with tarfile.open(fileobj=io.BytesIO(token_bytes)) as tar:
            tar.extractall(token_dir)
        client = Garmin()
        client.garth.load(str(token_dir))
        try:
            client.get_full_name()  # quick test that tokens are valid
            print("Garmin auth: using saved tokens")
            return client
        except Exception as e:
            print(f"Token auth failed ({e}), falling back to password login")

    # Password login fallback
    email = os.environ["GARMIN_EMAIL"]
    password = os.environ["GARMIN_PASSWORD"]
    client = Garmin(email, password)
    client.login()
    print("Garmin auth: password login successful")
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
