/**
 * Vercel serverless function: GitHub OAuth callback.
 * Exchanges the ?code= param for a GitHub access token,
 * then redirects back to the frontend with the token in the fragment.
 *
 * Required env vars (set in Vercel dashboard):
 *   GITHUB_CLIENT_ID
 *   GITHUB_CLIENT_SECRET
 *   ALLOWED_GITHUB_USER   (your GitHub username — only this user can log in)
 */
export default async function handler(req, res) {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send("Missing OAuth code");
  }

  // Exchange code for token
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  const tokenData = await tokenRes.json();
  if (tokenData.error) {
    return res.status(401).send(`OAuth error: ${tokenData.error_description}`);
  }

  const token = tokenData.access_token;

  // Verify this is the allowed user
  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `token ${token}` },
  });
  const user = await userRes.json();

  const allowed = process.env.ALLOWED_GITHUB_USER;
  if (allowed && user.login !== allowed) {
    return res.status(403).send(`Access denied. Only ${allowed} can use this app.`);
  }

  // Redirect to frontend with token — stored in fragment (never sent to server)
  res.redirect(302, `/?token=${token}&user=${encodeURIComponent(user.login)}`);
}
