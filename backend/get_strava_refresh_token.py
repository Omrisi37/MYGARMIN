"""
One-time script to get a Strava refresh token with activity:read_all scope.

Steps:
1. Run: python backend/get_strava_refresh_token.py <client_id> <client_secret>
2. Open the printed URL in your browser
3. Authorize the app — you'll be redirected to localhost (page won't load, that's fine)
4. Copy the `code=` value from the URL bar and paste it here
5. Copy the printed REFRESH TOKEN into your GitHub secret STRAVA_REFRESH_TOKEN
"""
import sys
import requests

if len(sys.argv) != 3:
    print("Usage: python backend/get_strava_refresh_token.py <client_id> <client_secret>")
    sys.exit(1)

client_id     = sys.argv[1]
client_secret = sys.argv[2]

auth_url = (
    f"https://www.strava.com/oauth/authorize"
    f"?client_id={client_id}"
    f"&response_type=code"
    f"&redirect_uri=http://localhost"
    f"&approval_prompt=force"
    f"&scope=activity:read_all"
)

print("\n" + "="*60)
print("STEP 1: Open this URL in your browser and authorize:")
print("="*60)
print(auth_url)
print("="*60)
print("\nAfter authorizing, the browser will redirect to localhost")
print("(the page won't load — that's fine).")
print("Copy the full URL from the address bar.\n")

redirect_url = input("Paste the full redirect URL here: ").strip()

# Extract code from URL
if "code=" not in redirect_url:
    print("Error: no 'code=' found in URL")
    sys.exit(1)

code = redirect_url.split("code=")[1].split("&")[0]
print(f"\nExtracted code: {code}")

# Exchange code for tokens
resp = requests.post("https://www.strava.com/oauth/token", data={
    "client_id":     client_id,
    "client_secret": client_secret,
    "code":          code,
    "grant_type":    "authorization_code",
})

if not resp.ok:
    print(f"Error {resp.status_code}: {resp.text}")
    sys.exit(1)

data = resp.json()

print("\n" + "="*60)
print("SUCCESS! Add this to GitHub Secrets as STRAVA_REFRESH_TOKEN:")
print("="*60)
print(data["refresh_token"])
print("="*60)
print(f"\nScope granted: {data.get('scope', 'unknown')}")
print(f"Athlete: {data.get('athlete', {}).get('firstname', '')} {data.get('athlete', {}).get('lastname', '')}")
