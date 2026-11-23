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

/**
 * Turns the safe web fetch's 404, 410 and 422 for a commit into the missing-or-private answer, so
 * a token never tells which private repositories or refs exist; any other failure stays. A 403 is
 * left out: GitHub also answers its rate limit with it, and the failure carries no headers to
 * tell the two apart.
 */
export function unreadableWhenMissing(error: unknown): never {
  if (error instanceof Error && /^Request failed: HTTP (404|410|422)$/.test(error.message))
    throw new PluginSourceUnreadableError();
  throw error;
}
