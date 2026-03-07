import browser from "webextension-polyfill";
import { logger } from "@entropy/core";
import type { PrivacySettingsPayload } from "@entropy/core";

// ---------------------------------------------------------------------------
// Tor SOCKS5 proxy routing for relay WebSocket connections.
//
// Firefox:  browser.proxy.onRequest — per-request proxy decision
// Chrome:   chrome.proxy.settings    — PAC script based proxy
//
// When Tor is enabled, WebSocket connections to Nostr relays (ws:// / wss://)
// and especially .onion URLs are routed through the user's local Tor SOCKS5
// proxy (default 127.0.0.1:9150 for Tor Browser, 9050 for Tor daemon).
// ---------------------------------------------------------------------------

const isFirefox = typeof browser.proxy?.onRequest !== "undefined";

let torActive = false;
let proxyHost = "127.0.0.1";
let proxyPort = 9150;

function parseProxyAddress(address: string): { host: string; port: number } {
  const parts = address.split(":");
  const host = parts[0] || "127.0.0.1";
  const port = parseInt(parts[1] ?? "9150", 10);
  return { host, port: isNaN(port) ? 9150 : port };
}

// ---------------------------------------------------------------------------
// Firefox: per-request proxy via browser.proxy.onRequest
// ---------------------------------------------------------------------------

function firefoxProxyHandler(
  details: { url: string; type: string }
): { type: string; host: string; port: number; proxyDNS: boolean } | { type: string } {
  if (!torActive) {
    return { type: "direct" };
  }

  // Route WebSocket requests through Tor SOCKS5
  if (details.type === "websocket" || details.url.includes(".onion")) {
    return {
      type: "socks",
      host: proxyHost,
      port: proxyPort,
      proxyDNS: true, // Resolve DNS through Tor (critical for .onion)
    };
  }

  return { type: "direct" };
}

function enableFirefoxProxy(): void {
  if (!browser.proxy?.onRequest) return;

  // Remove previous listener if any, then add
  try {
    browser.proxy.onRequest.removeListener(firefoxProxyHandler as Parameters<typeof browser.proxy.onRequest.addListener>[0]);
  } catch {
    // Ignore if not registered
  }

  browser.proxy.onRequest.addListener(
    firefoxProxyHandler as Parameters<typeof browser.proxy.onRequest.addListener>[0],
    { urls: ["<all_urls>"] }
  );

  logger.log(`[tor-proxy] Firefox proxy enabled → socks5://${proxyHost}:${proxyPort}`);
}

function disableFirefoxProxy(): void {
  if (!browser.proxy?.onRequest) return;

  try {
    browser.proxy.onRequest.removeListener(firefoxProxyHandler as Parameters<typeof browser.proxy.onRequest.addListener>[0]);
  } catch {
    // Ignore
  }

  logger.log("[tor-proxy] Firefox proxy disabled");
}

// ---------------------------------------------------------------------------
// Chrome: PAC script via chrome.proxy.settings
// ---------------------------------------------------------------------------

function buildPacScript(host: string, port: number): string {
  return `
    function FindProxyForURL(url, host) {
      // Route .onion and wss:// relay connections through Tor SOCKS5
      if (shExpMatch(host, "*.onion") || url.substring(0, 4) === "wss:" || url.substring(0, 3) === "ws:") {
        return "SOCKS5 ${host}:${port}; DIRECT";
      }
      return "DIRECT";
    }
  `;
}

function enableChromeProxy(host: string, port: number): void {
  const chromeProxy = (globalThis as unknown as { chrome?: { proxy?: { settings?: { set: (config: unknown) => void } } } }).chrome?.proxy?.settings;
  if (!chromeProxy) return;

  chromeProxy.set({
    value: {
      mode: "pac_script",
      pacScript: {
        data: buildPacScript(host, port),
      },
    },
    scope: "regular",
  });

  logger.log(`[tor-proxy] Chrome proxy enabled → socks5://${host}:${port}`);
}

function disableChromeProxy(): void {
  const chromeProxy = (globalThis as unknown as { chrome?: { proxy?: { settings?: { clear: (config: unknown) => void } } } }).chrome?.proxy?.settings;
  if (!chromeProxy) return;

  chromeProxy.clear({ scope: "regular" });

  logger.log("[tor-proxy] Chrome proxy disabled");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function applyTorProxy(settings: PrivacySettingsPayload): void {
  const parsed = parseProxyAddress(settings.torProxyAddress);
  proxyHost = parsed.host;
  proxyPort = parsed.port;
  torActive = settings.torEnabled;

  if (settings.torEnabled) {
    if (isFirefox) {
      enableFirefoxProxy();
    } else {
      enableChromeProxy(proxyHost, proxyPort);
    }
  } else {
    if (isFirefox) {
      disableFirefoxProxy();
    } else {
      disableChromeProxy();
    }
  }
}

export function isTorActive(): boolean {
  return torActive;
}
