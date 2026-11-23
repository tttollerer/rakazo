import type { ArtifactWithContent } from "@rakazo/contracts";
import { pageMediaAllowed } from "@rakazo/core";
import { bestEffort } from "@rakazo/logging/best-effort";
import { rpc } from "../query/rpc";
import type { ArtifactTarget } from "./artifact-open";
import { decodeArtifactBase64 } from "./artifact-open";

const MEDIA_DATA = "rakazo-page:media-data";
/** Different files one page may load; it asks for more only to make the app do work. */
const PAGE_MEDIA_FILES = 32;
/** Files of one page loading at the same time. */
const PAGE_MEDIA_PARALLEL = 4;

type MediaRequest = { id: string; artifactId: string };
type MediaAnswer = { message: object; transfer?: Transferable[] };
type GetArtifact = (
  input: ArtifactTarget & { artifactId: string },
) => Promise<Pick<ArtifactWithContent, "mimeType" | "size" | "contentBase64">>;

/**
 * Answers one page document's requests for attached files: each file's bytes, handed over
 * without a copy, when the reader may open it and it is a picture, sound or video; otherwise
 * that there is none, so the page shows its placeholder. A file loads once for the document
 * however often it is asked for. Without a target, as on a shared page, nothing is loaded.
 */
export function pageMediaLoader(
  target: ArtifactTarget | undefined,
  get: GetArtifact = (input) => rpc.artifacts.get(input),
): (request: MediaRequest) => Promise<MediaAnswer> {
  const files = new Map<string, Promise<{ mime: string; bytes: Uint8Array } | undefined>>();
  const waiting: (() => void)[] = [];
  let running = 0;

  async function inTurn<T>(work: () => Promise<T>): Promise<T> {
    if (running < PAGE_MEDIA_PARALLEL) running += 1;
    else await new Promise<void>((go) => waiting.push(go));
    try {
      return await work();
    } finally {
      // The turn passes straight to the next file waiting, or is given back.
      const next = waiting.shift();
      if (next) next();
      else running -= 1;
    }
  }

  async function fetchFile(scope: ArtifactTarget, artifactId: string) {
    const artifact = await bestEffort("load a page's attached file", get({ ...scope, artifactId }));
    // Checked before decoding, so a file too large or of the wrong kind is never unpacked.
    if (!artifact || !pageMediaAllowed(artifact)) return undefined;
    const bytes = decodeArtifactBase64(artifact.contentBase64);
    if (!pageMediaAllowed({ mimeType: artifact.mimeType, size: bytes.byteLength }))
      return undefined;
    return { mime: artifact.mimeType, bytes };
  }

  return async (request) => {
    const reply = { type: MEDIA_DATA, id: request.id, ref: request.artifactId };
    const none = { message: { ...reply, error: "unavailable" } };
    if (!target) return none;
    let file = files.get(request.artifactId);
    if (!file) {
      if (files.size >= PAGE_MEDIA_FILES) return none;
      file = inTurn(() => fetchFile(target, request.artifactId));
      files.set(request.artifactId, file);
    }
    const found = await file;
    if (!found) return none;
    // Each answer hands over its own copy, so the next request for the file still has one.
    const buffer = found.bytes.slice().buffer;
    return { message: { ...reply, mime: found.mime, buffer }, transfer: [buffer] };
  };
}
