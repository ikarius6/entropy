import browser from "webextension-polyfill";
import {
  ENTROPY_EXTENSION_SOURCE,
  ENTROPY_WEB_SOURCE,
  isEntropyRuntimePushMessage,
  isEntropyRuntimeMessage,
  createEntropyRequestId,
  type EntropyExtensionResponseEvent,
  type EntropyRuntimeResponse
} from "../shared/messaging";

// ---------------------------------------------------------------------------
// Inject the NIP-07 inpage provider into the MAIN world.
// Chrome uses "world": "MAIN" in the manifest; Firefox does not support that,
// so we inject it manually via a <script> tag pointing to the web-accessible
// resource.  On Chrome this is a no-op because nostr-provider.js is already
// loaded by the manifest entry — the provider guards against double-init.
// ---------------------------------------------------------------------------
(function injectInpageProvider() {
  try {
    const url = browser.runtime.getURL("inpage/nostr-provider.js");
    const script = document.createElement("script");
    script.src = url;
    script.type = "module";
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();
  } catch {
    // Silently ignore — may fail in restricted contexts
  }
})();

function postResponseToPage(payload: EntropyExtensionResponseEvent): void {
  // Restrict to the current page origin — prevents cross-origin scripts from
  // intercepting extension responses (including keypair exports).
  window.postMessage(payload, window.location.origin);
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
  if (
    event.source !== window ||
    event.origin !== window.location.origin ||
    !event.data ||
    event.data.type !== ENTROPY_NIP07_REQUEST
  ) {
    return;
  }

  const { id, method, params } = event.data as { id: string; method: string; params?: unknown };

  try {
    let result: unknown;

    if (method === "getPublicKey") {
      const requestId = createEntropyRequestId("nip07");
      const msg = { source: ENTROPY_WEB_SOURCE, requestId, type: "GET_PUBLIC_KEY" as const };
      const response = (await browser.runtime.sendMessage(msg)) as EntropyRuntimeResponse;
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
      const response = (await browser.runtime.sendMessage(msg)) as EntropyRuntimeResponse;
      if (!response.ok) throw new Error(response.error ?? "SIGN_EVENT failed");
      result = response.payload;

    } else {
      throw new Error(`Unknown NIP-07 method: ${method}`);
    }

    window.postMessage({ type: ENTROPY_NIP07_RESPONSE, id, result }, window.location.origin);
  } catch (err) {
    const error = err instanceof Error ? err.message : "NIP-07 relay error";
    window.postMessage({ type: ENTROPY_NIP07_RESPONSE, id, error }, window.location.origin);
  }
});

// ---------------------------------------------------------------------------
// Bridge: relay window.postMessage requests to the service worker
// ---------------------------------------------------------------------------

window.addEventListener("message", async (event: MessageEvent) => {
  if (event.source !== window || event.origin !== window.location.origin) {
    return;
  }

  if (!isEntropyRuntimeMessage(event.data)) {
    return;
  }

  try {
    console.log("[content-script] forwarding to SW:", event.data.type, event.data.type === "GET_CHUNK" ? JSON.stringify(event.data.payload).slice(0, 200) : "");
    const response = (await browser.runtime.sendMessage(event.data)) as EntropyRuntimeResponse;
    console.log("[content-script] SW response for", event.data.type, ":", JSON.stringify(response).slice(0, 300));
    postResponseToPage(buildResponseEvent(response));
  } catch (caughtError) {
    console.error("[content-script] SW error for", event.data.type, ":", caughtError);
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

browser.runtime.onMessage.addListener((message: unknown) => {
  if (isEntropyRuntimePushMessage(message)) {
    window.postMessage(message, window.location.origin);
    return;
  }

  window.postMessage(
    {
      source: ENTROPY_EXTENSION_SOURCE,
      type: "EXTENSION_EVENT",
      payload: message
    },
    window.location.origin
  );
});
