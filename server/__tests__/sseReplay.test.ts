import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../server.ts";

async function readUntilEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  eventName: string,
  initialText = ""
): Promise<string> {
  let text = initialText;
  const timeout = setTimeout(() => {
    void reader.cancel();
  }, 2_000);

  try {
    while (!text.includes(`event: ${eventName}\n`)) {
      const { done, value } = await reader.read();
      if (done) throw new Error(`SSE stream closed before the ${eventName} event arrived.`);
      text += decoder.decode(value, { stream: true });
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

function getUpdateId(frame: string): number {
  const match = frame.match(/^id: (\d+)$/m);
  if (!match) throw new Error("SSE workflow update did not include an event ID.");
  return Number(match[1]);
}

function getUpdatePayload(frame: string): { eventType: string; workflowId: string } {
  const updateFrame = frame.split("\n\n").find((event) => event.includes("event: workflow_update\n"));
  if (!updateFrame) throw new Error("SSE stream did not contain a workflow update event.");
  const match = updateFrame.match(/^data: (.+)$/m);
  if (!match) throw new Error("SSE workflow update did not include a data payload.");
  return JSON.parse(match[1]) as { eventType: string; workflowId: string };
}

function getResyncReason(frame: string): string {
  const resyncFrame = frame.split("\n\n").find((event) => event.includes("event: resync_required\n"));
  if (!resyncFrame) throw new Error("SSE stream did not contain a resync-required event.");
  const match = resyncFrame.match(/^data: (.+)$/m);
  if (!match) throw new Error("SSE resync-required event did not include a data payload.");
  return (JSON.parse(match[1]) as { reason: string }).reason;
}

describe("workflow SSE replay", () => {
  let server: http.Server;
  let baseUrl = "";

  beforeAll(async () => {
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("keeps live clients connected and replays events newer than Last-Event-ID", async () => {
    let liveReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let replayReader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const liveResponse = await fetch(`${baseUrl}/api/v1/workflows/events`);
      expect(liveResponse.headers.get("content-type")).toContain("text/event-stream");
      liveReader = liveResponse.body?.getReader();
      if (!liveReader) throw new Error("SSE response did not provide a readable stream.");

      const decoder = new TextDecoder();
      const connectedChunk = await liveReader.read();
      expect(connectedChunk.done).toBe(false);
      let liveText = decoder.decode(connectedChunk.value, { stream: true });
      expect(liveText).toContain("event: connected");

      const firstMutation = await fetch(`${baseUrl}/api/v1/infra/simulate-drift`, {
        method: "POST",
      });
      expect(firstMutation.status).toBe(200);
      liveText = await readUntilEvent(liveReader, decoder, "workflow_update", liveText);

      const firstId = getUpdateId(liveText);
      const firstPayload = getUpdatePayload(liveText);
      expect(firstPayload.eventType).toBe("INFRA_DRIFT");
      expect(firstPayload.workflowId).toBeTruthy();
      await liveReader.cancel();
      liveReader = undefined;

      const secondMutation = await fetch(`${baseUrl}/api/v1/infra/simulate-drift`, {
        method: "POST",
      });
      expect(secondMutation.status).toBe(200);

      const replayResponse = await fetch(`${baseUrl}/api/v1/workflows/events`, {
        headers: { "Last-Event-ID": String(firstId) },
      });
      replayReader = replayResponse.body?.getReader();
      if (!replayReader) throw new Error("SSE replay response did not provide a readable stream.");

      const replayDecoder = new TextDecoder();
      const replayConnectedChunk = await replayReader.read();
      expect(replayConnectedChunk.done).toBe(false);
      const replayInitialText = replayDecoder.decode(replayConnectedChunk.value, { stream: true });
      const replayText = await readUntilEvent(
        replayReader,
        replayDecoder,
        "workflow_update",
        replayInitialText
      );

      const replayedId = getUpdateId(replayText);
      expect(replayedId).toBeGreaterThan(firstId);
      expect(getUpdatePayload(replayText).eventType).toBe("INFRA_DRIFT");
      await replayReader.cancel();
      replayReader = undefined;

      const futureResponse = await fetch(`${baseUrl}/api/v1/workflows/events`, {
        headers: { "Last-Event-ID": String(replayedId + 1) },
      });
      replayReader = futureResponse.body?.getReader();
      if (!replayReader) throw new Error("SSE future-cursor response did not provide a stream.");
      const futureDecoder = new TextDecoder();
      const futureConnectedChunk = await replayReader.read();
      expect(futureConnectedChunk.done).toBe(false);
      const futureInitialText = futureDecoder.decode(futureConnectedChunk.value, { stream: true });
      const futureText = await readUntilEvent(
        replayReader,
        futureDecoder,
        "resync_required",
        futureInitialText
      );
      expect(getResyncReason(futureText)).toBe("cursor_ahead");
      expect(getUpdateId(futureText)).toBe(replayedId);
      await replayReader.cancel();
      replayReader = undefined;

      const invalidCursorResponse = await fetch(`${baseUrl}/api/v1/workflows/events`, {
        headers: { "Last-Event-ID": "1trailing" },
      });
      replayReader = invalidCursorResponse.body?.getReader();
      if (!replayReader) throw new Error("SSE invalid-cursor response did not provide a stream.");
      const invalidCursorDecoder = new TextDecoder();
      const invalidConnectedChunk = await replayReader.read();
      expect(invalidConnectedChunk.done).toBe(false);
      const invalidInitialText = invalidCursorDecoder.decode(invalidConnectedChunk.value, {
        stream: true,
      });
      const invalidText = await readUntilEvent(
        replayReader,
        invalidCursorDecoder,
        "resync_required",
        invalidInitialText
      );
      expect(getResyncReason(invalidText)).toBe("invalid_cursor");
      await replayReader.cancel();
      replayReader = undefined;

      for (let event = 0; event < 100; event++) {
        const mutation = await fetch(`${baseUrl}/api/v1/infra/simulate-drift`, {
          method: "POST",
        });
        expect(mutation.status).toBe(200);
      }

      const expiredCursorResponse = await fetch(`${baseUrl}/api/v1/workflows/events`, {
        headers: { "Last-Event-ID": String(firstId) },
      });
      replayReader = expiredCursorResponse.body?.getReader();
      if (!replayReader) throw new Error("SSE expired-cursor response did not provide a stream.");
      const expiredDecoder = new TextDecoder();
      const expiredConnectedChunk = await replayReader.read();
      expect(expiredConnectedChunk.done).toBe(false);
      const expiredInitialText = expiredDecoder.decode(expiredConnectedChunk.value, {
        stream: true,
      });
      const expiredText = await readUntilEvent(
        replayReader,
        expiredDecoder,
        "resync_required",
        expiredInitialText
      );
      expect(getResyncReason(expiredText)).toBe("cursor_expired");
    } finally {
      await Promise.all([liveReader?.cancel(), replayReader?.cancel()]);
    }
  });
});
