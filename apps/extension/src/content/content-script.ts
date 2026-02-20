import {
  ENTROPY_EXTENSION_SOURCE,
  ENTROPY_WEB_SOURCE,
  isEntropyRuntimePushMessage,
  isEntropyRuntimeMessage,
  createEntropyRequestId,
  type EntropyExtensionResponseEvent,
  type EntropyRuntimeResponse
} from "../shared/messaging";

function postResponseToPage(payload: EntropyExtensionResponseEvent): void {
  window.postMessage(payload, "*");
}

function buildResponseEvent(
  response: EntropyRuntimeResponse
): EntropyExtensionResponseEvent {
  return {
    source: ENTROPY_EXTENSION_SOURCE,
    type: "EXTENSION_RESPONSE",
    requestId: response.requestId,
    requestType: response.type,
    payload: response.ok ? (response.payload ?? undefined) : undefined,
    error: response.ok ? undefined : response.error
  };
}

// ---------------------------------------------------------------------------
// NIP-07 relay — forward inpage postMessage requests to the service worker
// The inpage script (main world) cannot call chrome.runtime directly, so it
// sends ENTROPY_NIP07_REQUEST messages that we relay here.
// ---------------------------------------------------------------------------

const ENTROPY_NIP07_REQUEST = "ENTROPY_NIP07_REQUEST";
const ENTROPY_NIP07_RESPONSE = "ENTROPY_NIP07_RESPONSE";

window.addEventListener("message", async (event: MessageEvent) => {
  if (event.source !== window || !event.data || event.data.type !== ENTROPY_NIP07_REQUEST) {
    return;
  }

  const { id, method, params } = event.data as { id: string; method: string; params?: unknown };

  try {
    let result: unknown;

    if (method === "getPublicKey") {
      const requestId = createEntropyRequestId("nip07");
      const msg = { source: ENTROPY_WEB_SOURCE, requestId, type: "GET_PUBLIC_KEY" as const };
      const response = (await chrome.runtime.sendMessage(msg)) as EntropyRuntimeResponse;
      if (!response.ok) throw new Error(response.error ?? "GET_PUBLIC_KEY failed");
      result = (response.payload as { pubkey: string }).pubkey;

    } else if (method === "signEvent") {
      const requestId = createEntropyRequestId("nip07");
      const msg = {
        source: ENTROPY_WEB_SOURCE,
        requestId,
        type: "SIGN_EVENT" as const,
        payload: params
      };
      const response = (await chrome.runtime.sendMessage(msg)) as EntropyRuntimeResponse;
      if (!response.ok) throw new Error(response.error ?? "SIGN_EVENT failed");
      result = response.payload;

    } else {
      throw new Error(`Unknown NIP-07 method: ${method}`);
    }

    window.postMessage({ type: ENTROPY_NIP07_RESPONSE, id, result }, "*");
  } catch (err) {
    const error = err instanceof Error ? err.message : "NIP-07 relay error";
    window.postMessage({ type: ENTROPY_NIP07_RESPONSE, id, error }, "*");
  }
});

// ---------------------------------------------------------------------------
// Bridge: relay window.postMessage requests to the service worker
// ---------------------------------------------------------------------------

window.addEventListener("message", async (event: MessageEvent) => {
  if (event.source !== window) {
    return;
  }

  if (!isEntropyRuntimeMessage(event.data)) {
    return;
  }

  try {
    const response = (await chrome.runtime.sendMessage(event.data)) as EntropyRuntimeResponse;
    postResponseToPage(buildResponseEvent(response));
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : "Failed to reach extension runtime.";

    postResponseToPage({
      source: ENTROPY_EXTENSION_SOURCE,
      type: "EXTENSION_RESPONSE",
      requestId: event.data.requestId,
      requestType: event.data.type,
      error: message
    });
  }
});

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (isEntropyRuntimePushMessage(message)) {
    window.postMessage(message, "*");
    return;
  }

  window.postMessage(
    {
      source: ENTROPY_EXTENSION_SOURCE,
      type: "EXTENSION_EVENT",
      payload: message
    },
    "*"
  );
});
