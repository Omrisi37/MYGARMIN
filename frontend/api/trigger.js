// Vercel serverless function — proxies GitHub Actions workflow_dispatch
// GITHUB_TOKEN is set as a Vercel environment variable (never exposed to client)

const GITHUB_REPO = "omrisi37/mygarmin";

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return res.status(500).json({ error: "GITHUB_TOKEN not configured on server" });
  }

  const { workflow, inputs = {} } = req.body;
  if (!workflow) {
    return res.status(400).json({ error: "Missing workflow parameter" });
  }

  // Only allow known workflows (security: prevent arbitrary dispatch)
  const allowed = ["weekly-plan.yml", "deep-analysis.yml"];
  if (!allowed.includes(workflow)) {
    return res.status(400).json({ error: "Unknown workflow" });
  }

  const ghRes = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `token ${token}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({ ref: "main", inputs }),
    }
  );

  if (ghRes.status === 204) {
    return res.status(200).json({ ok: true });
  }

  const err = await ghRes.json().catch(() => ({}));
  return res.status(ghRes.status).json({ error: err.message || "GitHub API error" });
}
