import {
  ENTROPY_EXTENSION_SOURCE,
  isEntropyRuntimePushMessage,
  isEntropyRuntimeMessage,
  type EntropyExtensionResponseEvent,
  type EntropyRuntimeResponse
} from "../shared/messaging";

const CS_PREFIX = "[entropy-cs]";

function csLog(...args: unknown[]): void {
  console.log(CS_PREFIX, ...args);
}

function csWarn(...args: unknown[]): void {
  console.warn(CS_PREFIX, ...args);
}

function csError(...args: unknown[]): void {
  console.error(CS_PREFIX, ...args);
}

csLog("Content script loaded on:", window.location.href);

function postResponseToPage(payload: EntropyExtensionResponseEvent): void {
  csLog("Posting response to page:", payload);
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
    payload: response.ok ? response.payload : undefined,
    error: response.ok ? undefined : response.error
  };
}

window.addEventListener("message", async (event: MessageEvent) => {
  if (event.source !== window) {
    return;
  }

  // Log any messages with a source property
  if (typeof event.data === "object" && event.data !== null && event.data.source) {
    csLog("Received window message:", {
      source: event.data.source,
      type: event.data.type,
      requestId: event.data.requestId
    });
  }

  if (!isEntropyRuntimeMessage(event.data)) {
    if (typeof event.data === "object" && event.data !== null && event.data.source === "entropy-web") {
      csWarn("Message from entropy-web REJECTED by isEntropyRuntimeMessage()", event.data);
    }
    return;
  }

  csLog("Valid runtime message — forwarding to service worker:", event.data.type, event.data.requestId);

  try {
    const response = (await chrome.runtime.sendMessage(event.data)) as EntropyRuntimeResponse;
    csLog("Service worker response received:", response);
    postResponseToPage(buildResponseEvent(response));
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : "Failed to reach extension runtime.";
    csError("chrome.runtime.sendMessage failed:", message);

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
  csLog("Received runtime push message:", message);

  if (isEntropyRuntimePushMessage(message)) {
    csLog("Valid push status update, forwarding to page");
    window.postMessage(message, "*");
    return;
  }

  csLog("Non-push runtime message, forwarding as EXTENSION_EVENT");
  window.postMessage(
    {
      source: ENTROPY_EXTENSION_SOURCE,
      type: "EXTENSION_EVENT",
      payload: message
    },
    "*"
  );
});

csLog("Content script fully initialized — listeners registered");

