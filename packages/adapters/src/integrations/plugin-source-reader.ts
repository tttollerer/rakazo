import { inspect } from "node:util";
import { getLogger } from "@rakazo/logging";
import type { SafeWebFetchOptions } from "../web/web-ssrf.js";
import { fetchSafeWebText } from "../web/web-ssrf.js";
import type { PluginRepoFetcher, PluginTextReader } from "./plugin-connectors.js";
import { fetchGitHubRepo } from "./plugin-connectors.js";

export { PluginSourceUnreadableError } from "./plugin-source-errors.js";

/** The only hosts that ever see the token: GitHub's API and its raw file host. */
const TOKEN_HOSTS = new Set(["api.github.com", "raw.githubusercontent.com"]);
/** How long a reader goes without a token GitHub rejected before offering it again. */
const REJECTED_TOKEN_PAUSE_MS = 5 * 60_000;

function carriesToken(error: unknown, token: string): boolean {
  if (!(error instanceof Error)) return inspect(error).includes(token);
  return [
    error.message,
    error.stack ?? "",
    JSON.stringify(error, Object.getOwnPropertyNames(error)),
    inspect(error, { depth: 10, showHidden: true }),
  ].some((text) => text.includes(token));
}

/**
 * Reads plugin sources with the operator's read-only token, so private repositories it can read
 * install like public ones. The token goes only over https to GitHub's API and raw file host on
 * their default port; the safe web fetch drops it when a redirect leaves that origin. When GitHub
 * rejects the token (expired or revoked), the read is tried once more without it, so public
 * repositories keep working, and the reader goes without it for a while, warning once. A failure
 * that somehow names the token is replaced by one that does not.
 */
export function githubTokenReader(
  token: string,
  options: Pick<SafeWebFetchOptions, "fetch" | "resolveHostname"> & {
    now?: () => number;
  } = {},
): PluginTextReader {
  const { now = Date.now, ...fetchOptions } = options;
  let rejectedUntil = 0;
  return async (url, maxBytes, signal) => {
    const target = new URL(url);
    const trusted =
      now() >= rejectedUntil &&
      target.protocol === "https:" &&
      target.port === "" &&
      TOKEN_HOSTS.has(target.hostname);
    const fetch = (withToken: boolean) =>
      fetchSafeWebText(url, {
        ...fetchOptions,
        maxBytes,
        signal,
        headers: withToken ? { authorization: `Bearer ${token}` } : undefined,
      });
    try {
      try {
        return (await fetch(trusted)).body;
      } catch (error) {
        if (!trusted || !(error instanceof Error) || error.message !== "Request failed: HTTP 401")
          throw error;
        if (now() >= rejectedUntil) getLogger().warn("PLUGIN_SOURCE_TOKEN rejected by GitHub");
        rejectedUntil = now() + REJECTED_TOKEN_PAUSE_MS;
        return (await fetch(false)).body;
      }
    } catch (error) {
      if (carriesToken(error, token)) throw new Error("Plugin source request failed");
      throw error;
    }
  };
}

/** The repository fetcher for a configured token; without one the public reader stays. */
export function pluginRepoFetcherFor(
  token: string | undefined,
  options: Parameters<typeof githubTokenReader>[1] = {},
): PluginRepoFetcher | undefined {
  if (!token) return undefined;
  const read = githubTokenReader(token, options);
  return (source, signal) => fetchGitHubRepo(source, signal, read, true);
}
