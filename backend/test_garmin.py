"""
Quick Garmin connection test.
Run in Codespace terminal:

  export GARMIN_EMAIL="your@email.com"
  export GARMIN_PASSWORD="yourpassword"
  python backend/test_garmin.py
"""
import os, json
from garmin_client import fetch_stats_summary

def main():
    email = os.environ.get("GARMIN_EMAIL")
    password = os.environ.get("GARMIN_PASSWORD")

    if not email or not password:
        print("❌ Set GARMIN_EMAIL and GARMIN_PASSWORD environment variables first.")
        print("   export GARMIN_EMAIL='your@email.com'")
        print("   export GARMIN_PASSWORD='yourpassword'")
        return

    print(f"🔌 Connecting to Garmin as {email}...")
    try:
        data = fetch_stats_summary(days=14)
    except Exception as e:
        print(f"❌ Connection failed: {e}")
        print("\nCommon causes:")
        print("  - Wrong email or password")
        print("  - Garmin 2FA enabled (disable temporarily or whitelist this IP)")
        print("  - Garmin servers temporarily down")
        return

    totals = data["totals"]
    avgs   = data["averages"]
    acts   = data["activities"]

    print(f"\n✅ Connected! Last 14 days:")
    print(f"   Runs:          {totals['runs']}")
    print(f"   Total distance: {totals['distance_km']} km")
    print(f"   Total time:     {totals['duration_hours']} hours")
    print(f"   Avg HR:         {avgs.get('avg_hr', '—')} bpm")
    print(f"   VO2 Max:        {avgs.get('latest_vo2_max', '—')}")

    if acts:
        print(f"\n   Most recent run:")
        r = acts[-1]
        print(f"   📅 {r['date']} — {r['distance_km']} km in {r['duration_min']} min @ {r['avg_pace_min_km'] or '—'}/km (HR {r['avg_hr']})")

    print("\n✅ Garmin is connected and ready. You can now run:")
    print("   python backend/run_coach_agent.py")

if __name__ == "__main__":
    main()
