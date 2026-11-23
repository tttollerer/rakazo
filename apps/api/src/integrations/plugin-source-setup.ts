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

/** What the router gets for plugin sources; a warning about open sign-up goes to `warn`. */
export function pluginSourceDeps(
  given: PluginRepoFetcher | undefined,
  env: Parameters<typeof pluginSourceTokenWarning>[0],
  warn: (warning: string) => void,
) {
  const warning = pluginSourceTokenWarning(env);
  if (warning) warn(warning);
  const fetchers = pluginFetchers(given, env.pluginSourceToken);
  return {
    pluginRepoFetcher: fetchers.install,
    pluginSubmissionFetcher: fetchers.submission,
    privatePluginSources: Boolean(env.pluginSourceToken),
  };
}

/** Domains anyone can get an address at; allowing one of them is open sign-up in effect. */
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
  "gmx.de",
  "web.de",
  "proton.me",
]);

const ADVICE =
  "Set SIGNUPS_ENABLED=false, a SIGNUP_ALLOWLIST of your own domains or single sign-on.";

/**
 * Said at startup when people the operator does not know can create an account and then install
 * what the operator's token reads. Sign-up is judged the way the auth package admits it: closed,
 * an allowlist, or single sign-on alone where the identity provider decides who joins.
 */
export function pluginSourceTokenWarning(
  env: Pick<AppEnv, "pluginSourceToken" | "signupsEnabled" | "signupAllowlist"> &
    Partial<Pick<AppEnv, "passwordAuth" | "oidc" | "social">>,
): string | undefined {
  if (!env.pluginSourceToken) return undefined;
  const signups = signupPolicyFromEnv(env);
  if (!signups.enabled) return undefined;
  const freeMail = signups.allowlist
    .filter((entry) => entry.startsWith("@") && FREE_MAIL_DOMAINS.has(entry.slice(1)))
    .map((entry) => entry.slice(1));
  if (freeMail.length > 0)
    return `PLUGIN_SOURCE_TOKEN is set and SIGNUP_ALLOWLIST admits anyone at ${freeMail.join(", ")}, so they can install plugins from every repository the token reads. ${ADVICE}`;
  const ssoOnly = env.passwordAuth === false && !env.social?.providers.length && env.oidc;
  if (ssoOnly) {
    // The identity provider decides who joins, or the allowlist does.
    if (env.oidc?.allowSignupBypass || signups.allowlist.length > 0) return undefined;
    return `PLUGIN_SOURCE_TOKEN is set and anyone your identity provider signs in can create an account, so they can install plugins from every repository the token reads. Limit who the identity provider admits or set a SIGNUP_ALLOWLIST.`;
  }
  if (signups.allowlist.length > 0) return undefined;
  return `PLUGIN_SOURCE_TOKEN is set and anyone may sign up, so anyone can install plugins from every repository the token reads. ${ADVICE}`;
}
