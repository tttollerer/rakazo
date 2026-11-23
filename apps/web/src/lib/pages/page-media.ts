import { pageMediaAllowed } from "@rakazo/core";
import { bestEffort } from "@rakazo/logging/best-effort";
import { rpc } from "../query/rpc";
import type { ArtifactTarget } from "./artifact-open";
import { decodeArtifactBase64 } from "./artifact-open";

const MEDIA_DATA = "rakazo-page:media-data";

/**
 * The answer to a page asking for an attached file: its bytes, handed over without a copy, when
 * the reader may open it and it is a picture, sound or video; otherwise that there is none, so
 * the page shows its placeholder. Without a target, as on a shared page, nothing is loaded.
 */
export async function pageMediaAnswer(
  target: ArtifactTarget | undefined,
  request: { id: string; artifactId: string },
): Promise<{ message: object; transfer?: Transferable[] }> {
  const reply = { type: MEDIA_DATA, id: request.id, ref: request.artifactId };
  const none = { message: { ...reply, error: "unavailable" } };
  if (!target) return none;
  const artifact = await bestEffort(
    "load a page's attached file",
    rpc.artifacts.get({ ...target, artifactId: request.artifactId }),
  );
  if (!artifact) return none;
  const bytes = decodeArtifactBase64(artifact.contentBase64);
  if (!pageMediaAllowed({ mimeType: artifact.mimeType, size: bytes.byteLength })) return none;
  const buffer = bytes.buffer as ArrayBuffer;
  return { message: { ...reply, mime: artifact.mimeType, buffer }, transfer: [buffer] };
}
