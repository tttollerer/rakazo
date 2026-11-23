import type { PluginRepoFetcher } from "@rakazo/adapters";
import { describe, expect, it } from "vitest";
import {
  pluginFetchers,
  pluginSourceDeps,
  pluginSourceTokenWarning,
} from "./plugin-source-setup.js";

describe("plugin fetchers", () => {
  it("reads installs with the token and checks submissions without it", () => {
    const fetchers = pluginFetchers(undefined, "test-token-not-real");
    expect(fetchers.install).toBeTypeOf("function");
    // Undefined is the public reader.
    expect(fetchers.submission).toBeUndefined();
  });
  it("uses the public reader for both without a token", () => {
    expect(pluginFetchers(undefined, undefined)).toEqual({
      install: undefined,
      submission: undefined,
    });
  });
  it("uses a given fetcher for both", () => {
    const given: PluginRepoFetcher = async () => ({ resolvedSha: "a".repeat(40), files: [] });
    expect(pluginFetchers(given, "test-token-not-real")).toEqual({
      install: given,
      submission: given,
    });
  });
});

describe("plugin source token warning", () => {
  const token = "test-token-not-real";
  it("warns when anyone may sign up to a server holding the token", () => {
    for (const signupsEnabled of [undefined, "true", "1"]) {
      const warning = pluginSourceTokenWarning({
        pluginSourceToken: token,
        signupsEnabled,
        signupAllowlist: undefined,
      });
      expect(warning).toContain("PLUGIN_SOURCE_TOKEN");
      expect(warning).toContain("SIGNUPS_ENABLED=false");
      expect(warning).not.toContain(token);
    }
  });
  it("stays quiet without a token, with closed sign-up or with an allowlist", () => {
    for (const env of [
      { pluginSourceToken: undefined, signupsEnabled: "true", signupAllowlist: undefined },
      { pluginSourceToken: token, signupsEnabled: "false", signupAllowlist: undefined },
      { pluginSourceToken: token, signupsEnabled: "0", signupAllowlist: undefined },
      { pluginSourceToken: token, signupsEnabled: "true", signupAllowlist: "@example.com" },
    ]) {
      expect(pluginSourceTokenWarning(env)).toBeUndefined();
    }
  });
});

describe("plugin source token warning by sign-in setup", () => {
  const token = "test-token-not-real";
  const sso = { issuer: "https://idp.example.test", allowSignupBypass: false };
  it.each([
    // [what, env, warns, words the warning must name]
    ["no token", { pluginSourceToken: undefined }, false, []],
    ["closed sign-up", { signupsEnabled: "false" }, false, []],
    ["open sign-up", {}, true, ["anyone may sign up"]],
    ["a company allowlist", { signupAllowlist: "@acme.example" }, false, []],
    ["one person's address", { signupAllowlist: "ada@gmail.com" }, false, []],
    ["a free mail domain", { signupAllowlist: "@acme.example, @GMAIL.com" }, true, ["gmail.com"]],
    [
      "more free mail domains",
      { signupAllowlist: "@t-online.de,@posteo.de,@outlook.de,@live.com,@msn.com" },
      true,
      ["t-online.de", "posteo.de", "outlook.de", "live.com", "msn.com"],
    ],
    [
      "and the rest of them",
      { signupAllowlist: "@aol.com,@mail.de,@yandex.com,@protonmail.com,@me.com" },
      true,
      ["aol.com", "mail.de", "yandex.com", "protonmail.com", "me.com"],
    ],
    [
      "two free mail domains",
      { signupAllowlist: "@web.de,@proton.me" },
      true,
      ["web.de", "proton.me"],
    ],
    [
      "SSO only, the identity provider decides",
      { passwordAuth: false, oidc: { ...sso, allowSignupBypass: true } },
      false,
      [],
    ],
    [
      "SSO only, anyone the identity provider signs in",
      { passwordAuth: false, oidc: sso },
      true,
      ["identity provider"],
    ],
    [
      "SSO beside passwords",
      { passwordAuth: true, oidc: { ...sso, allowSignupBypass: true } },
      true,
      ["anyone may sign up"],
    ],
  ] as const)("%s", (_what, env, warns, words) => {
    const warning = pluginSourceTokenWarning({
      pluginSourceToken: token,
      signupsEnabled: undefined,
      signupAllowlist: undefined,
      passwordAuth: true,
      oidc: undefined,
      social: undefined,
      ...(env as object),
    } as Parameters<typeof pluginSourceTokenWarning>[0]);
    if (!warns) {
      expect(warning).toBeUndefined();
      return;
    }
    expect(warning).toContain("PLUGIN_SOURCE_TOKEN");
    expect(warning).not.toContain(token);
    for (const word of words) expect(warning).toContain(word);
  });
});

describe("plugin source deps", () => {
  it("limits reads and warns only with the token", () => {
    const warnings: string[] = [];
    const open = { signupsEnabled: undefined, signupAllowlist: undefined };
    const withToken = pluginSourceDeps(
      undefined,
      { ...open, pluginSourceToken: "test-token-not-real" },
      (warning) => warnings.push(warning),
    );
    expect(withToken.privatePluginSources).toBe(true);
    expect(withToken.pluginRepoFetcher).toBeTypeOf("function");
    expect(withToken.pluginSubmissionFetcher).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(
      pluginSourceDeps(undefined, { ...open, pluginSourceToken: undefined }, () => {
        throw new Error("no warning without a token");
      }),
    ).toEqual({
      pluginRepoFetcher: undefined,
      pluginSubmissionFetcher: undefined,
      privatePluginSources: false,
    });
  });
});
