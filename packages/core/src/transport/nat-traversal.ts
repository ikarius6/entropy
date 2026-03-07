import type { IceServerConfig, PrivacySettingsPayload, TurnServerConfig } from "../types/extension-bridge";
import { DEFAULT_ICE_SERVERS_CONFIG } from "../types/extension-bridge";

export interface StunTurnConfig {
  iceServers: RTCIceServer[];
}

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];

export function createRtcConfiguration(custom: Partial<StunTurnConfig> = {}): RTCConfiguration {
  const iceServers = custom.iceServers ?? DEFAULT_ICE_SERVERS;

  return {
    iceServers,
    bundlePolicy: "balanced",
    iceCandidatePoolSize: 2
  };
}

// ---------------------------------------------------------------------------
// Privacy-aware RTC configuration
// ---------------------------------------------------------------------------

function turnServerToIceServer(turn: TurnServerConfig): RTCIceServer {
  const server: RTCIceServer = { urls: turn.urls };
  if (turn.username) server.username = turn.username;
  if (turn.credential) server.credential = turn.credential;
  return server;
}

function resolveStunServers(custom?: IceServerConfig[]): RTCIceServer[] {
  const configs = custom && custom.length > 0 ? custom : DEFAULT_ICE_SERVERS_CONFIG;
  return configs.map((c) => ({ urls: c.urls }));
}

export function createPrivacyRtcConfiguration(
  privacy: PrivacySettingsPayload
): RTCConfiguration {
  const iceServers: RTCIceServer[] = [];

  if (privacy.forceRelay && privacy.turnServers.length > 0) {
    // Relay-only mode: only TURN servers, no STUN
    for (const turn of privacy.turnServers) {
      iceServers.push(turnServerToIceServer(turn));
    }
  } else {
    // Normal mode: user-configured (or default) STUN + optional TURN
    iceServers.push(...resolveStunServers(privacy.customIceServers));
    for (const turn of privacy.turnServers) {
      iceServers.push(turnServerToIceServer(turn));
    }
  }

  return {
    iceServers,
    iceTransportPolicy: privacy.forceRelay ? "relay" : "all",
    bundlePolicy: "balanced",
    iceCandidatePoolSize: privacy.forceRelay ? 0 : 2
  };
}

// ---------------------------------------------------------------------------
// ICE candidate filtering
// ---------------------------------------------------------------------------

const LOCAL_IP_RE =
  /^(10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|127\.\d+\.\d+\.\d+|::1|fd[0-9a-f]{2}:)/i;

export function isLocalCandidate(candidate: RTCIceCandidate | RTCIceCandidateInit): boolean {
  const candidateStr = typeof candidate.candidate === "string" ? candidate.candidate : "";
  if (!candidateStr) return false;

  // host candidates always contain local IPs
  if (candidateStr.includes(" typ host ")) return true;

  // Check for local IPs in srflx candidates (shouldn't happen, but defense-in-depth)
  const ipMatch = candidateStr.match(/(\d+\.\d+\.\d+\.\d+|[0-9a-f:]+)\s+\d+\s+typ\s/i);
  if (ipMatch && LOCAL_IP_RE.test(ipMatch[1])) return true;

  return false;
}

export function shouldFilterCandidate(
  candidate: RTCIceCandidate | RTCIceCandidateInit,
  privacy: PrivacySettingsPayload
): boolean {
  if (!privacy.filterLocalCandidates) return false;
  return isLocalCandidate(candidate);
}
