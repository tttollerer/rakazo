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
/** Bytes of one page's loaded files kept for its next requests; older files go first. */
const PAGE_MEDIA_BYTES = 64 * 1024 * 1024;
/** Loads one page may cause in all, counting files loaded again after they were let go. */
const PAGE_MEDIA_CALLS = 64;

type MediaRequest = { id: string; artifactId: string };
type MediaAnswer = { message: object; transfer?: Transferable[] };
type Loaded = { mime: string; bytes: Uint8Array; size: number };
type Kept = { file: Promise<Loaded | undefined>; loaded?: Loaded; used: number };
export type PageMediaLoader = ((request: MediaRequest) => Promise<MediaAnswer>) & {
  /** Bytes of loaded files the loader is keeping. */
  heldBytes: () => number;
};
type GetArtifact = (
  input: ArtifactTarget & { artifactId: string },
) => Promise<Pick<ArtifactWithContent, "mimeType" | "size" | "contentBase64">>;

/**
 * Answers one page document's requests for attached files: each file's bytes, handed over
 * without a copy, when the reader may open it and it is a picture, sound or video; otherwise
 * that there is none, so the page shows its placeholder. A file loads once for the document
 * however often it is asked for, as long as it stays among the files the loader keeps. Without a
 * target, as on a shared page, nothing is loaded.
 */
export function pageMediaLoader(
  target: ArtifactTarget | undefined,
  get: GetArtifact = (input) => rpc.artifacts.get(input),
): PageMediaLoader {
  const files = new Map<string, Kept>();
  // Every file the page ever asked for, kept or let go, counts toward its limit.
  const asked = new Set<string>();
  const waiting: (() => void)[] = [];
  let running = 0;
  let calls = 0;
  let held = 0;
  let clock = 0;

  /** Lets go of the least recently used loaded files until the rest fit; a loading one stays. */
  function makeRoom() {
    while (held > PAGE_MEDIA_BYTES) {
      let oldest: [string, Kept] | undefined;
      for (const entry of files) {
        if (entry[1].loaded && (!oldest || entry[1].used < oldest[1].used)) oldest = entry;
      }
      if (!oldest) return;
      files.delete(oldest[0]);
      held -= oldest[1].loaded!.size;
    }
  }

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
    return { mime: artifact.mimeType, bytes, size: Math.max(artifact.size, bytes.byteLength) };
  }

  async function load(request: MediaRequest): Promise<MediaAnswer> {
    const ref = request.artifactId;
    const reply = { type: MEDIA_DATA, id: request.id, ref };
    const none = { message: { ...reply, error: "unavailable" } };
    if (!target) return none;
    if (!asked.has(ref)) {
      if (asked.size >= PAGE_MEDIA_FILES) return none;
      asked.add(ref);
    }
    let kept = files.get(ref);
    if (!kept) {
      if (calls >= PAGE_MEDIA_CALLS) return none;
      calls += 1;
      const entry: Kept = { file: inTurn(() => fetchFile(target, ref)), used: 0 };
      void entry.file.then((loaded) => {
        // Let go of meanwhile, it no longer counts; a refused file stays known as refused.
        if (!loaded || files.get(ref) !== entry) return;
        entry.loaded = loaded;
        held += loaded.size;
        makeRoom();
      });
      files.set(ref, entry);
      kept = entry;
    }
    clock += 1;
    kept.used = clock;
    const found = await kept.file;
    if (!found) return none;
    // Each answer hands over its own copy, so the next request for the file still has one.
    const buffer = found.bytes.slice().buffer;
    return { message: { ...reply, mime: found.mime, buffer }, transfer: [buffer] };
  }
  return Object.assign(load, { heldBytes: () => held });
}
