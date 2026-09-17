// ~/.claude/.credentials.json holds both account-specific OAuth state and
// machine-shared integration logins (MCP server tokens) as siblings in the
// same JSON object. A swap must move the former and leave the latter alone,
// or switching Claude accounts silently logs the user out of every MCP
// server on the machine.
export const SHARED_CREDENTIAL_KEYS = [
  "mcpOAuth",
  "mcpOAuthClientConfig",
  "mcpXaaIdp",
  "mcpXaaIdpConfig",
  "pluginSecrets",
] as const;

export function splitCredentialFields(credentials: Record<string, unknown>): {
  accountScoped: Record<string, unknown>;
  shared: Record<string, unknown>;
} {
  const shared: Record<string, unknown> = {};
  const accountScoped: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(credentials)) {
    if ((SHARED_CREDENTIAL_KEYS as readonly string[]).includes(key)) {
      shared[key] = value;
    } else {
      accountScoped[key] = value;
    }
  }

  return { accountScoped, shared };
}

export function composeCredentials(
  targetAccountScoped: Record<string, unknown>,
  liveShared: Record<string, unknown>
): Record<string, unknown> {
  return { ...targetAccountScoped, ...liveShared };
}
