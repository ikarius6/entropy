import {
  ENTROPY_EXTENSION_SOURCE,
  isEntropyRuntimePushMessage,
  isEntropyRuntimeMessage,
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
    payload: response.ok ? response.payload : undefined,
    error: response.ok ? undefined : response.error
  };
}

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
