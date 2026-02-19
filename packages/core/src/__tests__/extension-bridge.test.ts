import { describe, expect, it } from "vitest";

import {
  createEntropyRequestId,
  ENTROPY_EXTENSION_SOURCE,
  ENTROPY_WEB_SOURCE,
  isCreditSummaryPayload,
  isEntropyExtensionResponseEvent,
  isEntropyRuntimePushMessage,
  isEntropyRuntimeResponse,
  isNodeStatusPayload,
  isEntropyRuntimeMessage
} from "../types/extension-bridge";

const VALID_NODE_STATUS = {
  delegatedCount: 2,
  delegatedRootHashes: ["root-a", "root-b"],
  uptimeMs: 1000,
  lastHeartbeatAt: 1700000000,
  signalingKindRange: "20000-29999",
  signalingRangeHealthy: true
};

const VALID_CREDIT_SUMMARY = {
  totalUploaded: 1024,
  totalDownloaded: 512,
  ratio: 2,
  balance: 512,
  entryCount: 1,
  coldStorageEligible: true,
  history: [
    {
      id: "credit-1",
      peerPubkey: "peer-a",
      direction: "up" as const,
      bytes: 1024,
      chunkHash: "chunk-a",
      timestamp: 1700000000
    }
  ]
};

const REQUEST_ID = "req-1";

describe("extension bridge protocol guards", () => {
  it("accepts valid runtime request messages", () => {
    expect(
      isEntropyRuntimeMessage({
        source: ENTROPY_WEB_SOURCE,
        requestId: REQUEST_ID,
        type: "GET_NODE_STATUS"
      })
    ).toBe(true);

    expect(
      isEntropyRuntimeResponse({
        ok: true,
        requestId: REQUEST_ID,
        type: "GET_CREDIT_SUMMARY",
        payload: VALID_CREDIT_SUMMARY
      })
    ).toBe(true);

    expect(
      isEntropyRuntimeMessage({
        source: ENTROPY_WEB_SOURCE,
        requestId: REQUEST_ID,
        type: "DELEGATE_SEEDING",
        payload: {
          rootHash: "abc123",
          chunkHashes: ["c1", "c2"],
          size: 10,
          chunkSize: 5,
          mimeType: "video/mp4"
        }
      })
    ).toBe(true);

    expect(
      isEntropyRuntimeMessage({
        source: ENTROPY_WEB_SOURCE,
        requestId: REQUEST_ID,
        type: "GET_CREDIT_SUMMARY"
      })
    ).toBe(true);
  });

  it("rejects invalid runtime request messages", () => {
    expect(
      isEntropyRuntimeMessage({
        source: "entropy-other",
        requestId: REQUEST_ID,
        type: "GET_NODE_STATUS"
      })
    ).toBe(false);

    expect(
      isEntropyRuntimeMessage({
        source: ENTROPY_WEB_SOURCE,
        requestId: REQUEST_ID,
        type: "DELEGATE_SEEDING",
        payload: {
          rootHash: "abc123",
          chunkHashes: [1, 2],
          size: 10,
          chunkSize: 5,
          mimeType: "video/mp4"
        }
      })
    ).toBe(false);

    expect(
      isEntropyRuntimeMessage({
        source: ENTROPY_WEB_SOURCE,
        type: "GET_NODE_STATUS"
      })
    ).toBe(false);
  });

  it("validates credit summary payload shape", () => {
    expect(isCreditSummaryPayload(VALID_CREDIT_SUMMARY)).toBe(true);

    expect(
      isCreditSummaryPayload({
        ...VALID_CREDIT_SUMMARY,
        history: [{ ...VALID_CREDIT_SUMMARY.history[0], direction: "sideways" }]
      })
    ).toBe(false);
  });

  it("validates extension response bridge events", () => {
    expect(
      isEntropyExtensionResponseEvent({
        source: ENTROPY_EXTENSION_SOURCE,
        type: "EXTENSION_RESPONSE",
        requestId: REQUEST_ID,
        requestType: "HEARTBEAT"
      })
    ).toBe(true);

    expect(
      isEntropyExtensionResponseEvent({
        source: ENTROPY_EXTENSION_SOURCE,
        type: "EXTENSION_RESPONSE",
        requestType: "HEARTBEAT"
      })
    ).toBe(false);

    expect(
      isEntropyExtensionResponseEvent({
        source: ENTROPY_EXTENSION_SOURCE,
        type: "EXTENSION_RESPONSE",
        requestId: REQUEST_ID,
        requestType: "UNKNOWN"
      })
    ).toBe(false);
  });

  it("validates runtime response envelopes", () => {
    expect(
      isEntropyRuntimeResponse({
        ok: true,
        requestId: REQUEST_ID,
        type: "GET_NODE_STATUS",
        payload: VALID_NODE_STATUS
      })
    ).toBe(true);

    expect(
      isEntropyRuntimeResponse({
        ok: false,
        requestId: REQUEST_ID,
        type: "GET_NODE_STATUS",
        error: "Bad request"
      })
    ).toBe(true);

    expect(
      isEntropyRuntimeResponse({
        ok: true,
        type: "GET_NODE_STATUS",
        payload: VALID_NODE_STATUS
      })
    ).toBe(false);

    expect(
      isEntropyRuntimeResponse({
        ok: true,
        requestId: REQUEST_ID,
        type: "GET_NODE_STATUS",
        payload: { delegatedCount: 1 }
      })
    ).toBe(false);

    expect(
      isEntropyRuntimeResponse({
        ok: true,
        requestId: REQUEST_ID,
        type: "GET_CREDIT_SUMMARY",
        payload: { totalUploaded: 1 }
      })
    ).toBe(false);
  });

  it("generates non-empty request ids", () => {
    const generated = createEntropyRequestId("test");
    expect(generated.startsWith("test-")).toBe(true);
    expect(generated.length).toBeGreaterThan("test-".length);
  });

  it("validates node status payload shape", () => {
    expect(isNodeStatusPayload(VALID_NODE_STATUS)).toBe(true);

    expect(
      isNodeStatusPayload({
        ...VALID_NODE_STATUS,
        delegatedRootHashes: ["root-a", 2]
      })
    ).toBe(false);
  });

  it("validates extension runtime push status updates", () => {
    expect(
      isEntropyRuntimePushMessage({
        source: ENTROPY_EXTENSION_SOURCE,
        type: "NODE_STATUS_UPDATE",
        payload: VALID_NODE_STATUS
      })
    ).toBe(true);

    expect(
      isEntropyRuntimePushMessage({
        source: ENTROPY_EXTENSION_SOURCE,
        type: "NODE_STATUS_UPDATE",
        payload: { delegatedCount: 1 }
      })
    ).toBe(false);

    expect(
      isEntropyRuntimePushMessage({
        source: ENTROPY_EXTENSION_SOURCE,
        type: "CREDIT_UPDATE",
        payload: VALID_CREDIT_SUMMARY
      })
    ).toBe(true);
  });
});
