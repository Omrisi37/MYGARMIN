# Omri's AI Running Coach

Private, iPhone-friendly marathon training coach powered by Garmin data + Claude AI.

## What it does
- Pulls your Garmin activity data every Monday
- Generates a 7-day polarized training plan via Claude AI
- Shows the plan on a mobile dashboard (installable as iPhone PWA)
- You review and approve → syncs to Google Calendar

## Stack
- **Frontend**: Plain HTML/JS, deployed on Azure Static Web Apps
- **Auth**: GitHub OAuth (only you can log in)
- **Backend**: Python scripts running on GitHub Actions
- **AI**: Claude API
- **Data**: Garmin Connect API + Google Calendar API
- **Schedule**: Every Monday 7 AM UTC

## Setup
See [docs/SETUP.md](docs/SETUP.md) for full setup instructions.

## Structure
```
.github/workflows/    GitHub Actions (generate plan + calendar sync)
backend/              Python scripts (Garmin, Claude, Calendar)
frontend/             Mobile dashboard (HTML/CSS/JS)
data/                 Generated plan.json (committed by Actions)
docs/                 Setup guide
```
