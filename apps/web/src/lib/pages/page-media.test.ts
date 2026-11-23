import { flush } from "@rakazo/core/test-async";
import { expect, it, vi } from "vitest";
import { pageMediaLoader } from "./page-media";

vi.mock("../query/rpc", () => ({ rpc: {} }));

type File = { mimeType: string; size: number; contentBase64: string };
const photo: File = { mimeType: "image/png", size: 4, contentBase64: btoa("png!") };

/** A stand-in for the RPC that holds every call open until the test lets it answer. */
function heldCalls() {
  const open: { artifactId: string; answer: (file: File) => void }[] = [];
  let running = 0;
  let most = 0;
  const get = vi.fn(
    (input: { artifactId: string }) =>
      new Promise<File>((resolve) => {
        running += 1;
        most = Math.max(most, running);
        open.push({
          artifactId: input.artifactId,
          answer: (file) => {
            running -= 1;
            resolve(file);
          },
        });
      }),
  );
  return { get, open, most: () => most };
}

it("loads a file once however often the page asks for it, and answers every request", async () => {
  const calls = heldCalls();
  const load = pageMediaLoader({ botId: "bot-1" }, calls.get);
  const answers = Array.from({ length: 200 }, (_, n) =>
    load({ id: `media-${n}`, artifactId: "photo" }),
  );
  await flush();
  expect(calls.get).toHaveBeenCalledTimes(1);
  expect(calls.get).toHaveBeenCalledWith({ botId: "bot-1", artifactId: "photo" });
  calls.open[0]!.answer(photo);
  const sent = await Promise.all(answers);
  expect(sent.map(({ message }) => (message as { id: string }).id)).toEqual(
    answers.map((_, n) => `media-${n}`),
  );
  // Each answer hands over its own copy, so one going to the page leaves the next intact.
  const buffers = sent.map(({ transfer }) => transfer?.[0] as ArrayBuffer);
  expect(new Set(buffers).size).toBe(200);
  expect(new TextDecoder().decode(buffers[199])).toBe("png!");
  await load({ id: "again", artifactId: "photo" });
  expect(calls.get).toHaveBeenCalledTimes(1);
});

it("loads at most 32 files for a page, four at a time", async () => {
  const calls = heldCalls();
  const load = pageMediaLoader({ groupId: "group-1" }, calls.get);
  const answers = Array.from({ length: 40 }, (_, n) =>
    load({ id: `media-${n}`, artifactId: `file${n}` }),
  );
  // Thirty-two files four at a time take eight rounds.
  for (let round = 0; round < 8; round += 1) {
    await flush();
    expect(calls.open).toHaveLength(4);
    for (const call of calls.open.splice(0)) call.answer(photo);
  }
  const sent = await Promise.all(answers);
  expect(calls.get).toHaveBeenCalledTimes(32);
  expect(calls.most()).toBe(4);
  const refused = sent.filter(({ message }) => "error" in message);
  expect(refused.map(({ message }) => (message as { ref: string }).ref)).toEqual(
    Array.from({ length: 8 }, (_, n) => `file${32 + n}`),
  );
});

it("refuses a file that is too large or no picture, sound or video before decoding it", async () => {
  const decode = vi.spyOn(globalThis, "atob");
  const files: Record<string, File> = {
    huge: { mimeType: "video/mp4", size: 10 * 1024 * 1024 + 1, contentBase64: "AAAA" },
    page: { mimeType: "text/html", size: 4, contentBase64: btoa("<p/>") },
  };
  const load = pageMediaLoader({ botId: "bot-1" }, async ({ artifactId }) => files[artifactId]!);
  for (const artifactId of ["huge", "page"]) {
    const { message, transfer } = await load({ id: artifactId, artifactId });
    expect(message).toEqual({
      type: "rakazo-page:media-data",
      id: artifactId,
      ref: artifactId,
      error: "unavailable",
    });
    expect(transfer).toBeUndefined();
  }
  expect(decode).not.toHaveBeenCalled();
  decode.mockRestore();
});

it("loads nothing for a frame that names no bot or group", async () => {
  const get = vi.fn();
  const { message } = await pageMediaLoader(undefined, get)({ id: "m", artifactId: "photo" });
  expect(message).toEqual({
    type: "rakazo-page:media-data",
    id: "m",
    ref: "photo",
    error: "unavailable",
  });
  expect(get).not.toHaveBeenCalled();
});
