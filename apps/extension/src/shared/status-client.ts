import browser from "webextension-polyfill";

import {
  isColdStorageStatusPayload,
  isCreditSummaryPayload,
  isNodeMetricsPayload,
  createEntropyRequestId,
  ENTROPY_WEB_SOURCE,
  isNodeSettingsPayload,
  isPublicKeyPayload,
  isEntropyRuntimeResponse,
  isEntropyRuntimePushMessage,
  isNodeStatusPayload,
  type CreditSummaryPayload,
  type ColdStorageStatusPayload,
  type ImportKeypairPayload,
  type NodeMetricsPayload,
  type ReleaseColdAssignmentPayload,
  type RelayUrlPayload,
  type SetSeedingActivePayload,
  type EntropyRuntimeMessage,
  type EntropyRuntimeResponse,
  type NodeSettingsPayload,
  type NodeStatusPayload,
  type PublicKeyPayload
} from "./messaging";

async function sendRuntimeMessage(message: EntropyRuntimeMessage): Promise<EntropyRuntimeResponse> {
  return (await browser.runtime.sendMessage(message)) as EntropyRuntimeResponse;
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

async function validateColdStorageResponse(
  requestId: string,
  requestType: "GET_COLD_STORAGE_ASSIGNMENTS" | "RELEASE_COLD_ASSIGNMENT",
  response: unknown
): Promise<ColdStorageStatusPayload> {
  if (!isEntropyRuntimeResponse(response)) {
    throw new Error("Invalid runtime response payload received.");
  }

  if (response.requestId !== requestId) {
    throw new Error("Mismatched extension cold-storage response correlation id.");
  }

  if (response.type !== requestType) {
    throw new Error("Unexpected runtime response type for cold-storage request.");
  }

  if (!response.ok || !isColdStorageStatusPayload(response.payload)) {
    throw new Error(response.ok ? "Missing cold-storage payload." : response.error);
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

async function validateNodeSettingsResponse(
  requestId: string,
  requestType: "GET_NODE_SETTINGS" | "ADD_RELAY" | "REMOVE_RELAY" | "SET_SEEDING_ACTIVE",
  response: unknown
): Promise<NodeSettingsPayload> {
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
  const requestId = createEntropyRequestId("ext");
  const response = await sendRuntimeMessage({
    source: ENTROPY_WEB_SOURCE,
    requestId,
    type: "GET_NODE_SETTINGS"
  });
  return validateNodeSettingsResponse(requestId, "GET_NODE_SETTINGS", response);
}

export async function addRuntimeRelay(payload: RelayUrlPayload): Promise<NodeSettingsPayload> {
  const requestId = createEntropyRequestId("ext");
  const response = await sendRuntimeMessage({
    source: ENTROPY_WEB_SOURCE,
    requestId,
    type: "ADD_RELAY",
    payload
  });
  return validateNodeSettingsResponse(requestId, "ADD_RELAY", response);
}

export async function removeRuntimeRelay(payload: RelayUrlPayload): Promise<NodeSettingsPayload> {
  const requestId = createEntropyRequestId("ext");
  const response = await sendRuntimeMessage({
    source: ENTROPY_WEB_SOURCE,
    requestId,
    type: "REMOVE_RELAY",
    payload
  });
  return validateNodeSettingsResponse(requestId, "REMOVE_RELAY", response);
}

export async function setRuntimeSeedingActive(
  payload: SetSeedingActivePayload
): Promise<NodeSettingsPayload> {
  const requestId = createEntropyRequestId("ext");
  const response = await sendRuntimeMessage({
    source: ENTROPY_WEB_SOURCE,
    requestId,
    type: "SET_SEEDING_ACTIVE",
    payload
  });
  return validateNodeSettingsResponse(requestId, "SET_SEEDING_ACTIVE", response);
}

export async function requestColdStorageAssignments(): Promise<ColdStorageStatusPayload> {
  const requestId = createEntropyRequestId("ext");

  const response = await sendRuntimeMessage({
    source: ENTROPY_WEB_SOURCE,
    requestId,
    type: "GET_COLD_STORAGE_ASSIGNMENTS"
  });

  return validateColdStorageResponse(requestId, "GET_COLD_STORAGE_ASSIGNMENTS", response);
}

export async function releaseColdStorageAssignment(
  payload: ReleaseColdAssignmentPayload
): Promise<ColdStorageStatusPayload> {
  const requestId = createEntropyRequestId("ext");

  const response = await sendRuntimeMessage({
    source: ENTROPY_WEB_SOURCE,
    requestId,
    type: "RELEASE_COLD_ASSIGNMENT",
    payload
  });

  return validateColdStorageResponse(requestId, "RELEASE_COLD_ASSIGNMENT", response);
}

export async function requestNodeMetrics(): Promise<NodeMetricsPayload> {
  const requestId = createEntropyRequestId("ext");

  const response = await sendRuntimeMessage({
    source: ENTROPY_WEB_SOURCE,
    requestId,
    type: "GET_NODE_METRICS"
  });

  if (!isEntropyRuntimeResponse(response)) {
    throw new Error("Invalid runtime response payload received.");
  }

  if (response.requestId !== requestId) {
    throw new Error("Mismatched extension metrics response correlation id.");
  }

  if (response.type !== "GET_NODE_METRICS") {
    throw new Error("Unexpected runtime response type for node metrics request.");
  }

  if (!response.ok || !isNodeMetricsPayload(response.payload)) {
    throw new Error(response.ok ? "Missing node metrics payload." : response.error);
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

  browser.runtime.onMessage.addListener(listener);

  return () => {
    browser.runtime.onMessage.removeListener(listener);
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

  browser.runtime.onMessage.addListener(listener);

  return () => {
    browser.runtime.onMessage.removeListener(listener);
  };
}
