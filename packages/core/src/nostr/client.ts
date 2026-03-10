import type { NostrEventDraft } from "./events";
import { verifyEventSignature } from "./identity";
import { logger } from "../logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** NIP-01 subscription filter. */
export interface NostrFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  /** Generic tag filters — e.g. "#e", "#p", "#x-hash" */
  [tagFilter: `#${string}`]: string[] | undefined;
}

/** A signed Nostr event as returned by relays. */
export interface NostrEvent extends NostrEventDraft {
  id: string;
  pubkey: string;
  sig: string;
}

export type RelayStatus = "connecting" | "connected" | "disconnected" | "error";

export interface RelayInfo {
  url: string;
  status: RelayStatus;
}

/** Callback types */
export type EventCallback = (event: NostrEvent) => void;
export type EoseCallback = () => void;

export interface Subscription {
  id: string;
  unsubscribe: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let subscriptionCounter = 0;

function nextSubscriptionId(): string {
  subscriptionCounter += 1;
  return `entropy-${subscriptionCounter}-${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// Relay — single WebSocket connection
// ---------------------------------------------------------------------------

export class Relay {
  readonly url: string;
  private ws: WebSocket | null = null;
  private status: RelayStatus = "disconnected";
  private eventListeners = new Map<string, EventCallback>();
  private eoseListeners = new Map<string, EoseCallback>();
  private pendingMessages: string[] = [];

  constructor(url: string) {
    this.url = url.replace(/\/+$/, "");
  }

  getStatus(): RelayStatus {
    return this.status;
  }

  connect(): void {
    if (this.ws) {
      logger.log(`[Relay] already connected/connecting to ${this.url}`);
      return;
    }

    this.status = "connecting";
    logger.log(`[Relay] connecting to ${this.url}`);
    this.ws = new WebSocket(this.url);

    this.ws.addEventListener("open", () => {
      this.status = "connected";
      logger.log(`[Relay] connected to ${this.url}, flushing ${this.pendingMessages.length} pending messages`);

      for (const message of this.pendingMessages) {
        this.ws?.send(message);
      }

      this.pendingMessages = [];
    });

    this.ws.addEventListener("message", (event: MessageEvent) => {
      this.handleRelayMessage(event.data as string);
    });

    this.ws.addEventListener("close", (event) => {
      logger.log(`[Relay] disconnected from ${this.url}, code=${(event as CloseEvent).code}`);
      this.status = "disconnected";
      this.ws = null;
    });

    this.ws.addEventListener("error", (event) => {
      logger.error(`[Relay] error on ${this.url}:`, event);
      this.status = "error";
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.status = "disconnected";
    this.pendingMessages = [];
    this.eventListeners.clear();
    this.eoseListeners.clear();
  }

  /** Publish an event — ["EVENT", event] */
  publish(event: NostrEvent): void {
    this.send(JSON.stringify(["EVENT", event]));
  }

  /** Subscribe — ["REQ", subId, ...filters] */
  subscribe(
    subId: string,
    filters: NostrFilter[],
    onEvent: EventCallback,
    onEose?: EoseCallback
  ): void {
    this.eventListeners.set(subId, onEvent);

    if (onEose) {
      this.eoseListeners.set(subId, onEose);
    }

    this.send(JSON.stringify(["REQ", subId, ...filters]));
  }

  /** Close a subscription — ["CLOSE", subId] */
  closeSubscription(subId: string): void {
    this.eventListeners.delete(subId);
    this.eoseListeners.delete(subId);

    // Purge any queued REQ for this subId that hasn't been sent yet.
    // Without this, the relay would receive REQ→CLOSE in sequence, and events
    // arriving between those two messages would have no local listener
    // (hasListener=false race condition).
    this.pendingMessages = this.pendingMessages.filter((msg) => {
      try {
        const parsed = JSON.parse(msg) as unknown[];
        return !(parsed[0] === "REQ" && parsed[1] === subId);
      } catch {
        return true;
      }
    });

    // Only send CLOSE if the connection is open (the REQ was already sent)
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send(JSON.stringify(["CLOSE", subId]));
    }
    // If not open, the REQ was purged above so no CLOSE is needed
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private send(data: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      logger.log(`[Relay] ${this.url} not open (readyState=${this.ws?.readyState}), queuing message (${this.pendingMessages.length + 1} pending)`);
      this.pendingMessages.push(data);
    }
  }

  private handleRelayMessage(raw: string): void {
    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    if (!Array.isArray(parsed) || parsed.length < 2) {
      return;
    }

    const [type, ...rest] = parsed as [string, ...unknown[]];

    switch (type) {
      case "EVENT": {
        const [subId, event] = rest as [string, NostrEvent];
        const hasListener = this.eventListeners.has(subId);
        logger.log(`[Relay] ${this.url} EVENT for sub=${subId}, hasListener=${hasListener}, kind=${event?.kind}, from=${event?.pubkey?.slice(0, 8)}…`);

        if (!event || !event.id || !event.sig || !event.pubkey) {
          logger.warn(`[Relay] ${this.url} dropping malformed event (missing id/sig/pubkey)`);
          break;
        }

        if (!verifyEventSignature(event)) {
          logger.warn(`[Relay] ${this.url} dropping event with invalid signature id=${event.id.slice(0, 12)}… from=${event.pubkey.slice(0, 8)}…`);
          break;
        }

        this.eventListeners.get(subId)?.(event);
        break;
      }

      case "EOSE": {
        const [subId] = rest as [string];
        logger.log(`[Relay] ${this.url} EOSE for sub=${subId}`);
        this.eoseListeners.get(subId)?.();
        break;
      }

      case "OK": {
        const [eventId, success, message] = rest as [string, boolean, string];
        logger.log(`[Relay] ${this.url} OK event=${eventId?.slice(0, 12)}… success=${success} msg=${message}`);
        break;
      }

      case "NOTICE": {
        logger.log(`[Relay] ${this.url} NOTICE:`, rest[0]);
        break;
      }

      case "CLOSED": {
        const [subId, message] = rest as [string, string];
        logger.log(`[Relay] ${this.url} CLOSED sub=${subId}: ${message}`);
        // Treat CLOSED as an implicit EOSE — the relay won't send more events
        this.eoseListeners.get(subId)?.();
        this.eventListeners.delete(subId);
        this.eoseListeners.delete(subId);
        break;
      }

      default:
        logger.log(`[Relay] ${this.url} unknown message type: ${type}`);
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// RelayPool — manages multiple Relay connections
// ---------------------------------------------------------------------------

export class RelayPool {
  private relays = new Map<string, Relay>();
  private subscriptions = new Map<string, { filters: NostrFilter[]; onEvent: EventCallback; onEose?: EoseCallback }>();

  /** Connect to a set of relay URLs. */
  connect(urls: string[]): void {
    for (const url of urls) {
      if (this.relays.has(url)) {
        continue;
      }

      const relay = new Relay(url);
      this.relays.set(url, relay);
      relay.connect();
    }
  }

  /** Disconnect from all relays. */
  disconnect(): void {
    for (const relay of this.relays.values()) {
      relay.disconnect();
    }

    this.relays.clear();
    this.subscriptions.clear();
  }

  /** Get status info for all relays. */
  getRelayStatuses(): RelayInfo[] {
    return Array.from(this.relays.entries()).map(([url, relay]) => ({
      url,
      status: relay.getStatus()
    }));
  }

  /** How many relay connections are currently managed by this pool. */
  getRelayCount(): number {
    return this.relays.size;
  }

  /** Publish a signed event to all connected relays. */
  publish(event: NostrEvent): void {
    for (const relay of this.relays.values()) {
      relay.publish(event);
    }
  }

  /** Subscribe to events across all relays. Returns an unsubscribe handle.
   *  The onEose callback fires only once — after ALL relays have sent EOSE. */
  subscribe(
    filters: NostrFilter[],
    onEvent: EventCallback,
    onEose?: EoseCallback
  ): Subscription {
    const subId = nextSubscriptionId();

    this.subscriptions.set(subId, { filters, onEvent, onEose });

    const relayCount = this.relays.size;
    let eoseReceived = 0;
    let eoseFired = false;

    let eoseTimeout: ReturnType<typeof setTimeout> | undefined;

    const fireEose = () => {
      if (!eoseFired) {
        eoseFired = true;
        if (eoseTimeout) clearTimeout(eoseTimeout);
        onEose?.();
      }
    };

    const aggregatedEose: EoseCallback | undefined = onEose
      ? () => {
          eoseReceived++;
          if (eoseReceived >= relayCount) {
            fireEose();
          }
        }
      : undefined;

    // Safety timeout: fire onEose after 15s even if some relays never respond
    if (onEose && relayCount > 0) {
      eoseTimeout = setTimeout(fireEose, 15_000);
    }

    for (const relay of this.relays.values()) {
      relay.subscribe(subId, filters, onEvent, aggregatedEose);
    }

    return {
      id: subId,
      unsubscribe: () => {
        if (eoseTimeout) clearTimeout(eoseTimeout);
        this.subscriptions.delete(subId);

        for (const relay of this.relays.values()) {
          relay.closeSubscription(subId);
        }
      }
    };
  }
}
