import { inspect } from "node:util";
import type { SafeWebFetchOptions } from "../web/web-ssrf.js";
import { fetchSafeWebText } from "../web/web-ssrf.js";
import type { PluginRepoFetcher, PluginTextReader } from "./plugin-connectors.js";
import { fetchGitHubRepo } from "./plugin-connectors.js";

export { PluginSourceUnreadableError } from "./plugin-source-errors.js";

/** The only hosts that ever see the token: GitHub's API and its raw file host. */
const TOKEN_HOSTS = new Set(["api.github.com", "raw.githubusercontent.com"]);

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
 * their default port; the safe web fetch drops it when a redirect leaves that origin. A failure
 * that somehow names the token is replaced by one that does not.
 */
export function githubTokenReader(
  token: string,
  options: Pick<SafeWebFetchOptions, "fetch" | "resolveHostname"> = {},
): PluginTextReader {
  return async (url, maxBytes, signal) => {
    const target = new URL(url);
    const trusted =
      target.protocol === "https:" && target.port === "" && TOKEN_HOSTS.has(target.hostname);
    try {
      const response = await fetchSafeWebText(url, {
        ...options,
        maxBytes,
        signal,
        headers: trusted ? { authorization: `Bearer ${token}` } : undefined,
      });
      return response.body;
    } catch (error) {
      if (carriesToken(error, token)) throw new Error("Plugin source request failed");
      throw error;
    }
  };
}

/** The repository fetcher for a configured token; without one the public reader stays. */
export function pluginRepoFetcherFor(token: string | undefined): PluginRepoFetcher | undefined {
  if (!token) return undefined;
  const read = githubTokenReader(token);
  return (source, signal) => fetchGitHubRepo(source, signal, read);
}
