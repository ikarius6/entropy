import { vi } from "vitest";

// ---------------------------------------------------------------------------
// Shared state that survives vi.resetModules() re-evaluations.
// vi.resetModules() invalidates the module cache, causing this file to be
// re-executed on the next dynamic import.  By anchoring the storage Map and
// spy functions on globalThis we guarantee that the same instances are reused
// across evaluations so that assertions in tests hit the correct spy.
// ---------------------------------------------------------------------------

interface MockState {
  storage: Map<string, unknown>;
  storageGet: ReturnType<typeof vi.fn>;
  storageSet: ReturnType<typeof vi.fn>;
  storageRemove: ReturnType<typeof vi.fn>;
  storageClear: ReturnType<typeof vi.fn>;
  runtimeSendMessage: ReturnType<typeof vi.fn>;
  runtimeOnMessageAddListener: ReturnType<typeof vi.fn>;
  runtimeOnMessageRemoveListener: ReturnType<typeof vi.fn>;
  runtimeOnMessageHasListener: ReturnType<typeof vi.fn>;
  runtimeOnInstalledAddListener: ReturnType<typeof vi.fn>;
  runtimeOnStartupAddListener: ReturnType<typeof vi.fn>;
  runtimeOpenOptionsPage: ReturnType<typeof vi.fn>;
  alarmsCreate: ReturnType<typeof vi.fn>;
  alarmsClear: ReturnType<typeof vi.fn>;
  alarmsOnAlarmAddListener: ReturnType<typeof vi.fn>;
  alarmsOnAlarmRemoveListener: ReturnType<typeof vi.fn>;
}

const g = globalThis as unknown as { __webextPolyfillMock?: MockState };

if (!g.__webextPolyfillMock) {
  const s = new Map<string, unknown>();
  g.__webextPolyfillMock = {
    storage: s,
    storageGet: vi.fn(async (keys: string | string[]) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      const result: Record<string, unknown> = {};
      for (const k of keyList) {
        result[k] = s.get(k);
      }
      return result;
    }),
    storageSet: vi.fn(async (value: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(value)) {
        if (v === undefined) {
          s.delete(k);
        } else {
          s.set(k, v);
        }
      }
    }),
    storageRemove: vi.fn(async (key: string | string[]) => {
      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) {
        s.delete(k);
      }
    }),
    storageClear: vi.fn(async () => { s.clear(); }),
    runtimeSendMessage: vi.fn(async () => undefined),
    runtimeOnMessageAddListener: vi.fn(),
    runtimeOnMessageRemoveListener: vi.fn(),
    runtimeOnMessageHasListener: vi.fn(() => false),
    runtimeOnInstalledAddListener: vi.fn(),
    runtimeOnStartupAddListener: vi.fn(),
    runtimeOpenOptionsPage: vi.fn(async () => undefined),
    alarmsCreate: vi.fn(),
    alarmsClear: vi.fn(async () => true),
    alarmsOnAlarmAddListener: vi.fn(),
    alarmsOnAlarmRemoveListener: vi.fn()
  };
}

const m = g.__webextPolyfillMock;

const browser = {
  storage: {
    local: {
      get: m.storageGet,
      set: m.storageSet,
      remove: m.storageRemove,
      clear: m.storageClear
    }
  },
  runtime: {
    sendMessage: m.runtimeSendMessage,
    onMessage: {
      addListener: m.runtimeOnMessageAddListener,
      removeListener: m.runtimeOnMessageRemoveListener,
      hasListener: m.runtimeOnMessageHasListener
    },
    onInstalled: {
      addListener: m.runtimeOnInstalledAddListener
    },
    onStartup: {
      addListener: m.runtimeOnStartupAddListener
    },
    openOptionsPage: m.runtimeOpenOptionsPage
  },
  alarms: {
    create: m.alarmsCreate,
    clear: m.alarmsClear,
    onAlarm: {
      addListener: m.alarmsOnAlarmAddListener,
      removeListener: m.alarmsOnAlarmRemoveListener
    }
  }
};

/**
 * Reset the in-memory storage backing the mock.
 * Call this in beforeEach to isolate tests.
 */
export function __resetMockStorage(): void {
  m.storage.clear();
}

/**
 * Seed a value into mock storage (for test setup).
 */
export function __setMockStorageValue(key: string, value: unknown): void {
  m.storage.set(key, value);
}

/**
 * Read a raw value from mock storage (for test assertions).
 */
export function __getMockStorageValue(key: string): unknown {
  return m.storage.get(key);
}

export default browser;
