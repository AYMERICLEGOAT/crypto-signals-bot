/**
 * Client minimal pour l'API REST GitHub — utilisé uniquement pour
 * redéclencher un workflow Actions resté inactif (voir
 * cron/monitorSignalsHeartbeat.ts). GITHUB_ACTIONS_TOKEN est un Personal
 * Access Token (fine-grained, scope "Actions: write" sur ce dépôt
 * uniquement) créé manuellement sur github.com/settings/tokens — aucune
 * API ne permet d'en générer un par programmation.
 */

const GITHUB_REPO = "AYMERICLEGOAT/crypto-signals-bot";

export async function triggerWorkflowDispatch(token: string, workflowFile: string, ref = "main"): Promise<void> {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${workflowFile}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "signal-subscription-bot-worker",
    },
    body: JSON.stringify({ ref }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API workflow_dispatch (${workflowFile}) a répondu ${res.status}: ${body}`);
  }
}
