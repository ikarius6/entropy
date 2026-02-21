/**
 * Runs in the page's MAIN world — has direct access to window.
 * Communicates with the content script (ISOLATED world) via window.postMessage.
 */

const ENTROPY_NIP07_REQUEST = "ENTROPY_NIP07_REQUEST";
const ENTROPY_NIP07_RESPONSE = "ENTROPY_NIP07_RESPONSE";

type Nip07Request =
  | { id: string; method: "getPublicKey" }
  | { id: string; method: "signEvent"; params: object };

type Nip07Response =
  | { id: string; result: unknown }
  | { id: string; error: string };

function generateId(): string {
  return `nip07-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sendRequest<T>(method: string, params?: object): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = generateId();

    const request: Nip07Request = params
      ? ({ id, method, params } as Nip07Request)
      : ({ id, method } as Nip07Request);

    function handleResponse(event: MessageEvent): void {
      if (
        event.source !== window ||
        !event.data ||
        event.data.type !== ENTROPY_NIP07_RESPONSE ||
        event.data.id !== id
      ) {
        return;
      }

      window.removeEventListener("message", handleResponse);

      const response = event.data as Nip07Response;
      if ("error" in response) {
        reject(new Error(response.error));
      } else {
        resolve(response.result as T);
      }
    }

    window.addEventListener("message", handleResponse);
    window.postMessage({ type: ENTROPY_NIP07_REQUEST, ...request }, "*");
  });
}

const nostr = {
  getPublicKey(): Promise<string> {
    return sendRequest<string>("getPublicKey");
  },

  signEvent(event: object): Promise<object> {
    return sendRequest<object>("signEvent", event);
  }
};

if (!("nostr" in window)) {
  Object.defineProperty(window, "nostr", {
    value: nostr,
    writable: false,
    configurable: false
  });

  console.log("[Entropy] window.nostr NIP-07 provider injected");
}
