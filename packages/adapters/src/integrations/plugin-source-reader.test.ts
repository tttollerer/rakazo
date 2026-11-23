import { inspect } from "node:util";
import { ClientError } from "@rakazo/core";
import { createLogger, createTestSink, installLogger } from "@rakazo/logging";
import { describe, expect, it, vi } from "vitest";
import { fetchGitHubRepo } from "./plugin-connectors.js";
import {
  githubTokenReader,
  PluginSourceUnreadableError,
  pluginRepoFetcherFor,
} from "./plugin-source-reader.js";

// Never a real token, nor anything shaped like one.
const TOKEN = "test-token-not-real";
const publicResolver = async () => [{ address: "203.0.113.10", family: 4 as const }];

/** A web the reader talks to, recording what each request carried. */
function web(respond: (url: URL) => Response = () => new Response("ok")) {
  const seen: { url: string; authorization: string | null }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    seen.push({ url: url.href, authorization: new Headers(init?.headers).get("authorization") });
    return respond(url);
  };
  return {
    seen,
    read: githubTokenReader(TOKEN, { fetch, resolveHostname: publicResolver }),
  };
}

/** The fetcher installs get with the token, over a web that answers as `respond` says. */
function tokenFetcher(respond: (url: URL) => Response) {
  const fetch: typeof globalThis.fetch = async (input) => respond(new URL(String(input)));
  return pluginRepoFetcherFor(TOKEN, { fetch, resolveHostname: publicResolver })!;
}

/** Every way an error can end up in a log or an answer. */
function everyRendering(error: unknown): string[] {
  const value = error as Error;
  return [
    String(value),
    value.message,
    value.stack ?? "",
    String(value.cause ?? ""),
    JSON.stringify(value),
    JSON.stringify(value, Object.getOwnPropertyNames(value)),
    inspect(value, { depth: 10, showHidden: true }),
  ];
}

describe("plugin sources read with the operator's token", () => {
  it("sends the token to GitHub's API and raw file hosts over https", async () => {
    const { seen, read } = web();
    await read("https://api.github.com/repos/acme/private/commits/HEAD", 1000);
    await read("https://raw.githubusercontent.com/acme/private/abc/SKILL.md", 1000);
    expect(seen.map((request) => request.authorization)).toEqual([
      `Bearer ${TOKEN}`,
      `Bearer ${TOKEN}`,
    ]);
  });

  it("sends no token to any other host, or to GitHub over plain http", async () => {
    const { seen, read } = web();
    for (const url of [
      "https://example.com/repos/acme/private",
      "https://api.github.com.example.com/repos",
      "https://example.com/api.github.com/repos",
      "https://github.com/acme/private",
      "http://api.github.com/repos/acme/private/commits/HEAD",
      "http://raw.githubusercontent.com/acme/private/abc/SKILL.md",
    ]) {
      await read(url, 1000);
    }
    expect(seen.map((request) => request.authorization)).toEqual(Array(6).fill(null));
  });

  it("drops the token after a redirect to another host and keeps it within the same one", async () => {
    const { seen, read } = web((url) => {
      if (url.pathname === "/away")
        return new Response(null, {
          status: 302,
          headers: { location: "https://example.com/caught" },
        });
      if (url.pathname === "/moved")
        return new Response(null, { status: 302, headers: { location: "/here" } });
      return new Response("ok");
    });
    await read("https://api.github.com/away", 1000);
    await read("https://raw.githubusercontent.com/moved", 1000);
    expect(seen).toEqual([
      { url: "https://api.github.com/away", authorization: `Bearer ${TOKEN}` },
      { url: "https://example.com/caught", authorization: null },
      { url: "https://raw.githubusercontent.com/moved", authorization: `Bearer ${TOKEN}` },
      { url: "https://raw.githubusercontent.com/here", authorization: `Bearer ${TOKEN}` },
    ]);
  });

  it("keeps the token out of every error and log line, whatever fails", async () => {
    const logged = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );
    const failures = [
      web(() => new Response("missing", { status: 404 })).read,
      web(() => new Response("broken", { status: 500 })).read,
      web(() => {
        throw new TypeError(`fetch failed for Bearer ${TOKEN}`);
      }).read,
    ];
    const errors: unknown[] = [];
    for (const read of failures) {
      errors.push(await read("https://api.github.com/repos/a/b", 1000).catch((e) => e));
    }
    const { read } = web(() => new Response("late"));
    errors.push(
      await read("https://api.github.com/repos/a/b", 1000, AbortSignal.abort()).catch((e) => e),
    );
    expect(errors.every((error) => error instanceof Error)).toBe(true);
    for (const error of errors) {
      for (const text of everyRendering(error)) expect(text).not.toContain(TOKEN);
    }
    for (const spy of logged) {
      for (const call of spy.mock.calls) expect(inspect(call)).not.toContain(TOKEN);
      spy.mockRestore();
    }
  });

  it("says a repository the token cannot read is missing or private, with a stable code", async () => {
    const answer = {
      kind: "NOT_FOUND",
      code: "PLUGIN_SOURCE_UNREADABLE",
      message: "This repository was not found. If it is private, the server needs access to it.",
    };
    // GitHub answers 404 for a missing or hidden repository and 422 for a ref it cannot find;
    // both get one answer, so the token never tells which private repositories exist.
    for (const status of [404, 422]) {
      const fetcher = tokenFetcher(() => new Response("missing", { status }));
      const error = await fetcher({ gitUrl: "https://github.com/acme/private" }).catch((e) => e);
      expect(error).toBeInstanceOf(PluginSourceUnreadableError);
      expect(error).toBeInstanceOf(ClientError);
      expect(error).toMatchObject(answer);
      for (const text of everyRendering(error)) expect(text).not.toContain(TOKEN);
    }
    // Any other failure keeps its own meaning.
    await expect(
      tokenFetcher(() => new Response("broken", { status: 500 }))({
        gitUrl: "https://github.com/acme/private",
      }),
    ).rejects.not.toBeInstanceOf(PluginSourceUnreadableError);
  });

  it("answers a missing repository without a token exactly as before", async () => {
    // The public reader's failure for a missing repository, unchanged.
    const read = async () => {
      throw new Error("Request failed: HTTP 404");
    };
    const error = await fetchGitHubRepo(
      { gitUrl: "https://github.com/acme/missing" },
      undefined,
      read,
    ).catch((e) => e);
    expect(error).not.toBeInstanceOf(ClientError);
    expect(error).toMatchObject({ message: "Request failed: HTTP 404" });
  });

  it("reads again without a token GitHub rejects, warning once without its value", async () => {
    const sink = createTestSink();
    installLogger(createLogger({ service: "rakazo-api", sinks: [sink] }));
    const commit = { sha: "a".repeat(40), commit: { tree: { sha: "b".repeat(40) } } };
    // An expired token: GitHub refuses it even for a public repository.
    const seen: (string | null)[] = [];
    const rejecting = githubTokenReader(TOKEN, {
      fetch: async (_input, init) => {
        const authorization = new Headers(init?.headers).get("authorization");
        seen.push(authorization);
        return authorization
          ? new Response("Bad credentials", { status: 401 })
          : new Response(JSON.stringify(commit));
      },
      resolveHostname: publicResolver,
    });
    // Public: the read without the token succeeds.
    const body = await rejecting("https://api.github.com/repos/a/b/commits/HEAD", 1000);
    expect(JSON.parse(body)).toEqual(commit);
    expect(seen).toEqual([`Bearer ${TOKEN}`, null]);
    const warnings = sink.events.filter((event) => event.level === "warn");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toBe("PLUGIN_SOURCE_TOKEN rejected by GitHub");
    expect(inspect(sink.events, { depth: 10 })).not.toContain(TOKEN);
    // Private: without the token it is missing, which is the missing-or-private answer.
    const fetcher = pluginRepoFetcherFor(TOKEN, {
      fetch: async (_input, init) =>
        new Headers(init?.headers).get("authorization")
          ? new Response("Bad credentials", { status: 401 })
          : new Response("missing", { status: 404 }),
      resolveHostname: publicResolver,
    })!;
    await expect(fetcher({ gitUrl: "https://github.com/acme/private" })).rejects.toBeInstanceOf(
      PluginSourceUnreadableError,
    );
    expect(inspect(sink.events, { depth: 10 })).not.toContain(TOKEN);
  });

  it("leaves the public reader in place when no token is set", () => {
    expect(pluginRepoFetcherFor(undefined)).toBeUndefined();
    expect(pluginRepoFetcherFor("")).toBeUndefined();
    expect(pluginRepoFetcherFor(TOKEN)).toBeTypeOf("function");
  });
});
