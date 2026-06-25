# Setup Guide — Omri's AI Running Coach

## Prerequisites
- GitHub repo: `omrisi37/mygarmin` (private)
- Vercel account (free)
- Garmin Connect account
- Google Cloud project
- Anthropic API key

---

## 1. GitHub OAuth App

Go to **GitHub → Settings → Developer Settings → OAuth Apps → New OAuth App**:

| Field | Value |
|-------|-------|
| Application name | Running Coach |
| Homepage URL | `https://your-app.vercel.app` |
| Callback URL | `https://your-app.vercel.app/api/auth/callback` |

Copy the **Client ID** and **Client Secret**.

---

## 2. GitHub Secrets (for Actions)

Go to **Settings → Secrets and variables → Actions** and add:

| Secret | Value |
|--------|-------|
| `GARMIN_EMAIL` | Your Garmin Connect email |
| `GARMIN_PASSWORD` | Your Garmin Connect password |
| `ANTHROPIC_API_KEY` | `sk-ant-...` from console.anthropic.com |
| `GOOGLE_CALENDAR_ID` | e.g. `abc@group.calendar.google.com` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Full JSON of Google service account key |
| `RACE_DATE` | Optional: `2025-10-05` |

---

## 3. Google Calendar API

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project → Enable **Google Calendar API**
3. Create a **Service Account** → Download JSON key
4. In Google Calendar, share your calendar with the service account email
   - Grant: **Make changes to events**
5. Copy the Calendar ID from Google Calendar settings → into GitHub Secrets

---

## 4. Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) → Import from GitHub
2. Select `omrisi37/mygarmin`
3. Set **Root Directory** to `frontend`
4. Add Environment Variables in Vercel dashboard:

| Variable | Value |
|----------|-------|
| `GITHUB_CLIENT_ID` | From GitHub OAuth App |
| `GITHUB_CLIENT_SECRET` | From GitHub OAuth App |
| `ALLOWED_GITHUB_USER` | `omrisi37` (only you can log in) |

5. Click **Deploy**

> The `api/auth/callback.js` serverless function handles the OAuth exchange automatically.

---

## 5. First Run

1. Open your Vercel URL in Safari → **Sign in with GitHub**
2. Authorize the app (one-time)
3. Go to **Actions** tab in GitHub → Run `Generate Weekly Running Plan` manually
4. Wait ~90 seconds → refresh the dashboard
5. Review the plan → tap **Approve & Sync to Calendar**

---

## 6. iPhone Homescreen PWA

1. Open Vercel URL in Safari
2. Tap **Share → Add to Home Screen**
3. App launches fullscreen with no browser chrome

---

## Cost

Using Claude Haiku 4.5 with prompt caching:
- ~$0.03–0.05 per weekly plan generation
- Prompt caching gives ~90% discount on the static methodology prompt
- Well under $1/month total

---

## Adjust Schedule

In `.github/workflows/weekly-plan.yml`:
```yaml
- cron: "0 7 * * 1"  # Monday 7 AM UTC = 9 AM Israel time (UTC+2/+3)
```

Common timezones:
- Israel (UTC+3 summer): `0 6 * * 1`
- UK (UTC+1 summer): `0 8 * * 1`
- US Eastern (UTC-4 summer): `0 13 * * 1`
