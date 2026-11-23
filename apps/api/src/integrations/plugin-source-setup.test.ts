import type { PluginRepoFetcher } from "@rakazo/adapters";
import { describe, expect, it } from "vitest";
import { pluginFetchers, pluginSourceTokenWarning } from "./plugin-source-setup.js";

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
