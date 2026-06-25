# Setup Guide — Omri's AI Running Coach

## Prerequisites
- GitHub repo: `omrisi37/mygarmin` (private)
- Azure account (free tier is fine)
- Garmin Connect account
- Google Cloud project
- Anthropic API key

---

## 1. GitHub Secrets

Go to **Settings → Secrets and variables → Actions** and add:

| Secret | Value |
|--------|-------|
| `GARMIN_EMAIL` | Your Garmin Connect email |
| `GARMIN_PASSWORD` | Your Garmin Connect password |
| `ANTHROPIC_API_KEY` | `sk-ant-...` from console.anthropic.com |
| `GOOGLE_CALENDAR_ID` | Your calendar ID (e.g. `abc@group.calendar.google.com`) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Full JSON of your Google service account key |
| `RACE_DATE` | Optional. Your next race date: `2025-10-05` |

---

## 2. Google Calendar API

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project → Enable **Google Calendar API**
3. Create a **Service Account** → Download JSON key
4. In Google Calendar settings, share your target calendar with the service account email (give it **Make changes to events** permission)
5. Copy the service account email and calendar ID into your secrets

---

## 3. Azure Static Web Apps Deployment

1. Go to [portal.azure.com](https://portal.azure.com) → Create **Static Web App**
2. Connect to GitHub repo: `omrisi37/mygarmin`
3. Set:
   - App location: `/frontend`
   - API location: (leave empty)
   - Output location: (leave empty)
4. Add environment variables in Azure portal:
   - `GITHUB_CLIENT_ID` — from your GitHub OAuth App
   - `GITHUB_CLIENT_SECRET` — from your GitHub OAuth App

### Create GitHub OAuth App
1. GitHub → Settings → Developer Settings → OAuth Apps → New OAuth App
2. Homepage URL: `https://your-app.azurestaticapps.net`
3. Callback URL: `https://your-app.azurestaticapps.net/.auth/login/github/callback`
4. Copy Client ID and Secret → add to Azure app settings

---

## 4. Update app.js

In `frontend/app.js`, update line 4:
```js
const GITHUB_REPO = "omrisi37/mygarmin";
```

---

## 5. First Run

1. Push all files to `main` branch
2. Azure will auto-deploy the frontend
3. Go to **Actions** tab → Run `Generate Weekly Running Plan` manually
4. Wait ~60 seconds, then refresh the dashboard
5. Review the plan → tap **Approve & Sync to Calendar**

---

## Adjust Schedule

In `.github/workflows/weekly-plan.yml`:
```yaml
- cron: "0 7 * * 1"  # Monday 7 AM UTC = 9 AM Israel time
```
Common adjustments:
- Israel (UTC+3): `0 6 * * 1` (9 AM IST)
- US Eastern (UTC-5): `0 14 * * 1` (9 AM EST)

---

## iPhone Homescreen

1. Open the deployed URL in Safari
2. Tap Share → **Add to Home Screen**
3. App launches in fullscreen with no browser chrome
