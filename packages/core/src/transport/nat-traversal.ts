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
