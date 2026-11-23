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
  // Thirty-two files four at a time take eight rounds; each starts once four calls are open.
  for (let round = 0; round < 8; round += 1) {
    await vi.waitFor(() => expect(calls.open).toHaveLength(4));
    for (const call of calls.open.splice(0)) call.answer(photo);
  }
  // Settled before awaiting the answers, so a missing limit fails here rather than hanging.
  await flush();
  // The eight files past the limit are refused without a call of their own.
  expect(calls.get).toHaveBeenCalledTimes(32);
  expect(calls.open).toEqual([]);
  expect(calls.most()).toBe(4);
  const sent = await Promise.all(answers);
  const refused = sent.filter(({ message }) => "error" in message);
  expect(refused.map(({ message }) => (message as { ref: string }).ref)).toEqual(
    Array.from({ length: 8 }, (_, n) => `file${32 + n}`),
  );
});

const MiB = 1024 * 1024;
/** A file as large as a page may show; the RPC says its size, the bytes stay small. */
const big = (name: string): File => ({
  mimeType: "image/jpeg",
  size: 10 * MiB,
  contentBase64: btoa(name),
});

it("keeps at most 64 MiB of a page's files, letting the least recently used go first", async () => {
  const get = vi.fn(async ({ artifactId }: { artifactId: string }) => big(artifactId));
  const load = pageMediaLoader({ botId: "bot-1" }, get);
  for (let n = 0; n < 8; n += 1) await load({ id: `m${n}`, artifactId: `big${n}` });
  expect(load.heldBytes()).toBeLessThanOrEqual(64 * MiB);
  expect(load.heldBytes()).toBe(60 * MiB);
  // The newest is still there; the oldest went and loads again when asked for.
  await load({ id: "newest", artifactId: "big7" });
  expect(get).toHaveBeenCalledTimes(8);
  const again = await load({ id: "oldest", artifactId: "big0" });
  expect(get).toHaveBeenCalledTimes(9);
  expect(again.message).toMatchObject({ id: "oldest", ref: "big0", mime: "image/jpeg" });
  expect(new TextDecoder().decode(again.transfer?.[0] as ArrayBuffer)).toBe("big0");
});

it("stops loading for a page after 64 calls, however its files push each other out", async () => {
  const get = vi.fn(async ({ artifactId }: { artifactId: string }) => big(artifactId));
  const load = pageMediaLoader({ botId: "bot-1" }, get);
  // Seven files of 10 MiB never fit together, so going round them misses every time.
  const sent = [];
  for (let n = 0; n < 100; n += 1) {
    sent.push(await load({ id: `m${n}`, artifactId: `big${n % 7}` }));
  }
  expect(get).toHaveBeenCalledTimes(64);
  expect(sent.slice(0, 64).every(({ message }) => "mime" in message)).toBe(true);
  // Past that, files it still keeps answer and one it let go is refused without a call.
  const letGo = sent.slice(64).filter(({ message }) => "error" in message);
  expect(letGo.length).toBeGreaterThan(0);
  expect(await load({ id: "late", artifactId: "big1" })).toMatchObject({
    message: { error: "unavailable" },
  });
  expect(get).toHaveBeenCalledTimes(64);
});

it("counts a file the page asked for once toward its 32, even after it was let go", async () => {
  const get = vi.fn(async ({ artifactId }: { artifactId: string }) => big(artifactId));
  const load = pageMediaLoader({ botId: "bot-1" }, get);
  for (let n = 0; n < 32; n += 1) await load({ id: `m${n}`, artifactId: `big${n}` });
  // big0 was let go long ago but still counts; a 33rd file is refused, big0 loads again.
  const refused = await load({ id: "new", artifactId: "big32" });
  expect(refused.message).toMatchObject({ error: "unavailable" });
  const again = await load({ id: "old", artifactId: "big0" });
  expect(again.message).toMatchObject({ mime: "image/jpeg" });
  expect(get).toHaveBeenCalledTimes(33);
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
