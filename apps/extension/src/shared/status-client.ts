import {
  isCreditSummaryPayload,
  createEntropyRequestId,
  ENTROPY_WEB_SOURCE,
  isNodeSettingsPayload,
  isPublicKeyPayload,
  isEntropyRuntimeResponse,
  isEntropyRuntimePushMessage,
  isNodeStatusPayload,
  type CreditSummaryPayload,
  type ImportKeypairPayload,
  type RelayUrlPayload,
  type SetSeedingActivePayload,
  type EntropyRuntimeMessage,
  type EntropyRuntimeResponse,
  type NodeSettingsPayload,
  type NodeStatusPayload,
  type PublicKeyPayload
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

export async function requestPublicKey(): Promise<PublicKeyPayload> {
  const requestId = createEntropyRequestId("ext");

  const response = await sendRuntimeMessage({
    source: ENTROPY_WEB_SOURCE,
    requestId,
    type: "GET_PUBLIC_KEY"
  });

  if (!isEntropyRuntimeResponse(response)) {
    throw new Error("Invalid runtime response payload received.");
  }

  if (response.requestId !== requestId) {
    throw new Error("Mismatched extension public-key response correlation id.");
  }

  if (response.type !== "GET_PUBLIC_KEY") {
    throw new Error("Unexpected runtime response type for public-key request.");
  }

  if (!response.ok || !isPublicKeyPayload(response.payload)) {
    throw new Error(response.ok ? "Missing public-key payload." : response.error);
  }

  return response.payload;
}

export async function importRuntimeKeypair(payload: ImportKeypairPayload): Promise<PublicKeyPayload> {
  const requestId = createEntropyRequestId("ext");

  const response = await sendRuntimeMessage({
    source: ENTROPY_WEB_SOURCE,
    requestId,
    type: "IMPORT_KEYPAIR",
    payload
  });

  if (!isEntropyRuntimeResponse(response)) {
    throw new Error("Invalid runtime response payload received.");
  }

  if (response.requestId !== requestId) {
    throw new Error("Mismatched extension import-keypair response correlation id.");
  }

  if (response.type !== "IMPORT_KEYPAIR") {
    throw new Error("Unexpected runtime response type for import-keypair request.");
  }

  if (!response.ok || !isPublicKeyPayload(response.payload)) {
    throw new Error(response.ok ? "Missing import-keypair payload." : response.error);
  }

  return response.payload;
}

async function requestNodeSettingsResponse(
  requestType: "GET_NODE_SETTINGS" | "ADD_RELAY" | "REMOVE_RELAY" | "SET_SEEDING_ACTIVE",
  payload?: RelayUrlPayload | SetSeedingActivePayload
): Promise<NodeSettingsPayload> {
  const requestId = createEntropyRequestId("ext");

  const message: EntropyRuntimeMessage = payload
    ? {
        source: ENTROPY_WEB_SOURCE,
        requestId,
        type: requestType,
        payload
      }
    : {
        source: ENTROPY_WEB_SOURCE,
        requestId,
        type: requestType
      };

  const response = await sendRuntimeMessage(message);

  if (!isEntropyRuntimeResponse(response)) {
    throw new Error("Invalid runtime response payload received.");
  }

  if (response.requestId !== requestId) {
    throw new Error("Mismatched extension node-settings response correlation id.");
  }

  if (response.type !== requestType) {
    throw new Error("Unexpected runtime response type for node-settings request.");
  }

  if (!response.ok || !isNodeSettingsPayload(response.payload)) {
    throw new Error(response.ok ? "Missing node-settings payload." : response.error);
  }

  return response.payload;
}

export async function requestNodeSettings(): Promise<NodeSettingsPayload> {
  return requestNodeSettingsResponse("GET_NODE_SETTINGS");
}

export async function addRuntimeRelay(payload: RelayUrlPayload): Promise<NodeSettingsPayload> {
  return requestNodeSettingsResponse("ADD_RELAY", payload);
}

export async function removeRuntimeRelay(payload: RelayUrlPayload): Promise<NodeSettingsPayload> {
  return requestNodeSettingsResponse("REMOVE_RELAY", payload);
}

export async function setRuntimeSeedingActive(
  payload: SetSeedingActivePayload
): Promise<NodeSettingsPayload> {
  return requestNodeSettingsResponse("SET_SEEDING_ACTIVE", payload);
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
