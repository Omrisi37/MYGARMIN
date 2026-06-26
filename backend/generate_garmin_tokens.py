"""
One-time script: logs into Garmin, saves session tokens, prints the base64
value to store as GARMIN_TOKENS GitHub secret.

Run this ONCE on your local machine or Codespace:

  pip install garminconnect garth
  python backend/generate_garmin_tokens.py your@email.com yourpassword

Then copy the printed value into:
  GitHub repo → Settings → Secrets and variables → Actions → New secret
  Name: GARMIN_TOKENS
"""
import sys
import base64
import io
import tarfile
import tempfile
from pathlib import Path

from garminconnect import Garmin

if len(sys.argv) != 3:
    print("Usage: python backend/generate_garmin_tokens.py <email> <password>")
    print("Example: python backend/generate_garmin_tokens.py omri@email.com MyPassword123")
    sys.exit(1)

email = sys.argv[1]
password = sys.argv[2]

print(f"Logging in to Garmin Connect as {email}...")
client = Garmin(email, password)
client.login()
print(f"Success! Logged in as: {client.get_full_name()}")

# Save tokens to a temp dir
token_dir = Path(tempfile.mkdtemp())
client.garth.dump(str(token_dir))

# Pack into a tar.gz and base64-encode
buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode="w:gz") as tar:
    for f in token_dir.iterdir():
        tar.add(f, arcname=f.name)
encoded = base64.b64encode(buf.getvalue()).decode()

print("\n" + "=" * 60)
print("Add this as GitHub secret GARMIN_TOKENS:")
print("=" * 60)
print(encoded)
print("=" * 60)
print("\nSteps:")
print("1. Copy the long string above")
print("2. Go to github.com → your repo → Settings")
print("   → Secrets and variables → Actions → New repository secret")
print("   Name:  GARMIN_TOKENS")
print("   Value: (paste the string)")
print("3. Save — done!")
