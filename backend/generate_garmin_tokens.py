"""
One-time script: logs into Garmin, saves session tokens, prints the base64
value to store as GARMIN_TOKENS GitHub secret.

Run this ONCE on your local machine (not in CI):
  pip install garminconnect garth
  python backend/generate_garmin_tokens.py

Then copy the printed value into GitHub → Settings → Secrets → GARMIN_TOKENS
"""
import base64
import getpass
import io
import tarfile
import tempfile
from pathlib import Path

from garminconnect import Garmin

email = input("Garmin email: ")
password = getpass.getpass("Garmin password: ")

print("Logging in to Garmin Connect...")
client = Garmin(email, password)
client.login()
print(f"Logged in as: {client.get_full_name()}")

# Save tokens to a temp dir
token_dir = Path(tempfile.mkdtemp())
client.garth.dump(str(token_dir))
print(f"Tokens saved to: {token_dir}")

# Pack into a tar and base64-encode
buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode="w:gz") as tar:
    for f in token_dir.iterdir():
        tar.add(f, arcname=f.name)
encoded = base64.b64encode(buf.getvalue()).decode()

print("\n" + "="*60)
print("Copy this value as GitHub secret GARMIN_TOKENS:")
print("="*60)
print(encoded)
print("="*60)
print("\nGitHub → your repo → Settings → Secrets and variables → Actions → New secret")
print("Name: GARMIN_TOKENS")
print("Value: (paste the long string above)")
