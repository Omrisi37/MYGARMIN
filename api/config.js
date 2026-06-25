/**
 * Returns public config (Client ID only — never the secret).
 * Called by login.html to get the GitHub OAuth Client ID.
 */
export default function handler(req, res) {
  res.json({
    clientId: process.env.GITHUB_CLIENT_ID || "",
  });
}
