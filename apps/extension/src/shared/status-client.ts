import {
  isCreditSummaryPayload,
  createEntropyRequestId,
  ENTROPY_WEB_SOURCE,
  isEntropyRuntimeResponse,
  isEntropyRuntimePushMessage,
  isNodeStatusPayload,
  type CreditSummaryPayload,
  type EntropyRuntimeMessage,
  type EntropyRuntimeResponse,
  type NodeStatusPayload
} from "./messaging";

async function sendRuntimeMessage(message: EntropyRuntimeMessage): Promise<EntropyRuntimeResponse> {
  return (await chrome.runtime.sendMessage(message)) as EntropyRuntimeResponse;
}

export async function requestNodeStatus(): Promise<NodeStatusPayload> {
  const requestId = createEntropyRequestId("ext");

  const response = await sendRuntimeMessage({
    source: ENTROPY_WEB_SOURCE,
    requestId,
    type: "GET_NODE_STATUS"
  });

  if (!isEntropyRuntimeResponse(response)) {
    throw new Error("Invalid runtime response payload received.");
  }

  if (response.requestId !== requestId) {
    throw new Error("Mismatched extension status response correlation id.");
  }

  if (response.type !== "GET_NODE_STATUS") {
    throw new Error("Unexpected runtime response type for node status request.");
  }

  if (!response.ok || !isNodeStatusPayload(response.payload)) {
    throw new Error(response.ok ? "Missing node status payload." : response.error);
  }

  return response.payload;
}

export async function requestCreditSummary(): Promise<CreditSummaryPayload> {
  const requestId = createEntropyRequestId("ext");

  const response = await sendRuntimeMessage({
    source: ENTROPY_WEB_SOURCE,
    requestId,
    type: "GET_CREDIT_SUMMARY"
  });

  if (!isEntropyRuntimeResponse(response)) {
    throw new Error("Invalid runtime response payload received.");
  }

  if (response.requestId !== requestId) {
    throw new Error("Mismatched extension credit response correlation id.");
  }

  if (response.type !== "GET_CREDIT_SUMMARY") {
    throw new Error("Unexpected runtime response type for credit summary request.");
  }

  if (!response.ok || !isCreditSummaryPayload(response.payload)) {
    throw new Error(response.ok ? "Missing credit summary payload." : response.error);
  }

  return response.payload;
}

export function subscribeNodeStatusUpdates(
  onUpdate: (status: NodeStatusPayload) => void
): () => void {
  const listener = (message: unknown): void => {
    if (!isEntropyRuntimePushMessage(message)) {
      return;
    }

    if (message.type !== "NODE_STATUS_UPDATE") {
      return;
    }

    onUpdate(message.payload);
  };

  chrome.runtime.onMessage.addListener(listener);

  return () => {
    chrome.runtime.onMessage.removeListener(listener);
  };
}

export function subscribeCreditUpdates(
  onUpdate: (summary: CreditSummaryPayload) => void
): () => void {
  const listener = (message: unknown): void => {
    if (!isEntropyRuntimePushMessage(message)) {
      return;
    }

    if (message.type !== "CREDIT_UPDATE") {
      return;
    }

    onUpdate(message.payload);
  };

  chrome.runtime.onMessage.addListener(listener);

  return () => {
    chrome.runtime.onMessage.removeListener(listener);
  };
}
