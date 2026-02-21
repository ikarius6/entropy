// Minimal Chrome API types for the offscreen document (Chrome-only context).
// The offscreen document does not use webextension-polyfill.

declare namespace chrome {
  namespace storage {
    namespace local {
      function get(
        keys: string | string[],
        callback: (items: Record<string, unknown>) => void
      ): void;
    }
  }

  namespace runtime {
    interface MessageSender {
      tab?: { id?: number };
      id?: string;
    }

    function sendMessage(message: unknown): Promise<unknown>;

    const onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void
        ) => boolean | undefined | void
      ): void;
    };
  }
}
