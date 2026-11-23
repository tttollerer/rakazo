import type { PluginRepoFetcher } from "@rakazo/adapters";
import { pluginRepoFetcherFor } from "@rakazo/adapters";
import { signupPolicyFromEnv } from "@rakazo/core";
import type { AppEnv } from "../env.js";

/**
 * The repository fetchers the API runs with. Installs read private repositories with the
 * operator's token; submissions to the shared listing never do, so a private repository cannot
 * be approved into it. A given fetcher (tests) serves both. Undefined is the public reader.
 */
export function pluginFetchers(
  given: PluginRepoFetcher | undefined,
  token: string | undefined,
): { install: PluginRepoFetcher | undefined; submission: PluginRepoFetcher | undefined } {
  return { install: given ?? pluginRepoFetcherFor(token), submission: given };
}

/** Said at startup when anyone may sign up and then install what the operator's token reads. */
export function pluginSourceTokenWarning(
  env: Pick<AppEnv, "pluginSourceToken" | "signupsEnabled" | "signupAllowlist">,
): string | undefined {
  if (!env.pluginSourceToken) return undefined;
  const signups = signupPolicyFromEnv(env);
  if (!signups.enabled || signups.allowlist.length > 0) return undefined;
  return "PLUGIN_SOURCE_TOKEN is set and anyone may sign up, so anyone can install plugins from every repository the token reads. Set SIGNUPS_ENABLED=false, a SIGNUP_ALLOWLIST or single sign-on.";
}
