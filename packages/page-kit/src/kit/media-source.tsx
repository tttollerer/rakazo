import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

/** The page asks the app for a file the bot attached; the app checks the reader may see it. */
const MEDIA_MESSAGE = "rakazo-page:media";
const MEDIA_DATA_MESSAGE = "rakazo-page:media-data";
/** A file of the largest size an attachment may have still arrives well within this. */
const MEDIA_TIMEOUT_MS = 30_000;

const ATTACHMENT = /^attachment:([A-Za-z0-9_-]{1,64})$/;

/** The artifact id in `attachment:<id>`, the form `attach_file` gives the bot. */
export function attachmentRef(value: unknown): string | undefined {
  return typeof value === "string" ? ATTACHMENT.exec(value)?.[1] : undefined;
}

/** The viewer loads nothing from the network: pictures come embedded or attached by the bot. */
export function imageSource(value: unknown): string | undefined {
  return typeof value === "string" &&
    (/^data:image\/[a-z0-9.+-]+[;,]/i.test(value) || attachmentRef(value))
    ? value
    : undefined;
}

/** Sound and video may also be a blob the page made itself. */
export function mediaSource(value: unknown, kind: "audio" | "video"): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.startsWith("blob:") || attachmentRef(value)) return value;
  return new RegExp(`^data:${kind}/[a-z0-9.+-]+[;,]`, "i").test(value) ? value : undefined;
}

type Held = {
  users: number;
  url?: string;
  mime?: string;
  done: boolean;
  redraws: Set<() => void>;
  stop: () => void;
};

/** One request and one blob address per file, shared by every component showing it. */
const held = new Map<string, Held>();
let requests = 0;

function hold(ref: string): Held {
  const known = held.get(ref);
  if (known) {
    known.users += 1;
    return known;
  }
  requests += 1;
  const id = `media-${requests}`;
  const entry: Held = { users: 1, done: false, redraws: new Set(), stop: () => {} };
  function finish(result?: { mime: string; buffer: ArrayBuffer }) {
    entry.stop();
    entry.done = true;
    if (result) {
      entry.mime = result.mime;
      entry.url = URL.createObjectURL(new Blob([result.buffer], { type: result.mime }));
    }
    for (const redraw of entry.redraws) redraw();
  }
  function answer(event: MessageEvent) {
    const data = event.data as {
      type?: unknown;
      id?: unknown;
      ref?: unknown;
      mime?: unknown;
      buffer?: unknown;
    } | null;
    if (data?.type !== MEDIA_DATA_MESSAGE || data.id !== id || data.ref !== ref) return;
    // The buffer comes from the app's realm, where this page's ArrayBuffer is not its class.
    const ok =
      typeof data.mime === "string" &&
      Object.prototype.toString.call(data.buffer) === "[object ArrayBuffer]";
    finish(ok ? { mime: data.mime as string, buffer: data.buffer as ArrayBuffer } : undefined);
  }
  // A host that cannot show attachments never answers.
  const timer = setTimeout(() => finish(), MEDIA_TIMEOUT_MS);
  entry.stop = () => {
    clearTimeout(timer);
    window.removeEventListener("message", answer);
  };
  held.set(ref, entry);
  window.addEventListener("message", answer);
  window.parent?.postMessage({ type: MEDIA_MESSAGE, id, ref }, "*");
  return entry;
}

function release(ref: string, entry: Held) {
  entry.users -= 1;
  if (entry.users > 0) return;
  entry.stop();
  held.delete(ref);
  if (entry.url) URL.revokeObjectURL(entry.url);
}

/**
 * What to show for a picture, sound or video source: any other source as it is, and for
 * `attachment:<id>` the file once the app has sent it, while `waiting` until then. Neither
 * means the file cannot be shown here.
 */
export function useAttachment(
  src: string | undefined,
  kind: "image" | "audio" | "video",
): { src?: string; waiting?: boolean } {
  const ref = attachmentRef(src);
  const [, setDrawn] = useState(0);
  useEffect(() => {
    if (!ref) return;
    const entry = hold(ref);
    const redraw = () => setDrawn((count) => count + 1);
    entry.redraws.add(redraw);
    redraw();
    return () => {
      entry.redraws.delete(redraw);
      release(ref, entry);
    };
  }, [ref]);
  if (!ref) return { src };
  const entry = held.get(ref);
  if (!entry?.done) return { waiting: true };
  return entry.url && entry.mime?.startsWith(`${kind}/`) ? { src: entry.url } : {};
}

/** Where an attached file is still on its way or cannot be shown: its shape and its name. */
export function MediaPlaceholder({
  alt,
  waiting,
  style,
}: {
  alt: string;
  waiting?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      className="rk-picture rk-media-missing"
      role="img"
      aria-label={alt || undefined}
      aria-busy={waiting || undefined}
      data-loading={waiting || undefined}
      style={style}
    >
      {alt ? <span aria-hidden="true">{alt}</span> : null}
    </div>
  );
}

export const ATTACHMENT_CSS = `
.rk-media-missing{display:flex;align-items:center;justify-content:center;min-height:96px;padding:12px;color:var(--rk-secondary);text-align:center;overflow-wrap:anywhere}
`;
