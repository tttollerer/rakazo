import { ClientError } from "@rakazo/core";

/**
 * A plugin repository the server cannot read: it does not exist, or it is private and the
 * server has no access to it. GitHub answers both the same way, so the message names both.
 */
export class PluginSourceUnreadableError extends ClientError {
  constructor() {
    super(
      "NOT_FOUND",
      "This repository was not found. If it is private, the server needs access to it.",
      "PLUGIN_SOURCE_UNREADABLE",
    );
    this.name = "PluginSourceUnreadableError";
  }
}

/** Turns the safe web fetch's 404 into the missing-or-private answer; any other failure stays. */
export function unreadableWhenMissing(error: unknown): never {
  if (error instanceof Error && error.message === "Request failed: HTTP 404")
    throw new PluginSourceUnreadableError();
  throw error;
}
