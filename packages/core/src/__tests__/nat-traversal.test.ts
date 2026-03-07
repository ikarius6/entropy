import { describe, expect, it } from "vitest";

import {
  DEFAULT_ICE_SERVERS,
  createRtcConfiguration,
  createPrivacyRtcConfiguration,
  isLocalCandidate,
  shouldFilterCandidate
} from "../transport/nat-traversal";
import type { PrivacySettingsPayload } from "../types/extension-bridge";
import { DEFAULT_PRIVACY_SETTINGS } from "../types/extension-bridge";

describe("nat traversal", () => {
  it("creates RTC configuration with default STUN servers", () => {
    const config = createRtcConfiguration();

    expect(config.iceServers).toEqual(DEFAULT_ICE_SERVERS);
    expect(config.bundlePolicy).toBe("balanced");
    expect(config.iceCandidatePoolSize).toBe(2);
  });

  it("uses custom ICE servers when provided", () => {
    const customIceServers: RTCIceServer[] = [{ urls: "stun:stun.example.com:3478" }];

    const config = createRtcConfiguration({ iceServers: customIceServers });

    expect(config.iceServers).toBe(customIceServers);
  });
});

describe("createPrivacyRtcConfiguration", () => {
  it("returns default STUN servers when privacy is disabled", () => {
    const config = createPrivacyRtcConfiguration(DEFAULT_PRIVACY_SETTINGS);

    expect(config.iceServers).toEqual(DEFAULT_ICE_SERVERS);
    expect(config.iceTransportPolicy).toBe("all");
    expect(config.iceCandidatePoolSize).toBe(2);
  });

  it("uses relay-only transport policy when forceRelay is true with TURN servers", () => {
    const settings: PrivacySettingsPayload = {
      ...DEFAULT_PRIVACY_SETTINGS,
      forceRelay: true,
      turnServers: [{ urls: "turn:my-turn.example.com:3478", username: "user", credential: "pass" }]
    };

    const config = createPrivacyRtcConfiguration(settings);

    expect(config.iceTransportPolicy).toBe("relay");
    expect(config.iceCandidatePoolSize).toBe(0);
    expect(config.iceServers).toHaveLength(1);
    expect(config.iceServers![0]).toEqual({
      urls: "turn:my-turn.example.com:3478",
      username: "user",
      credential: "pass"
    });
  });

  it("includes STUN + TURN when forceRelay is false but TURN servers are provided", () => {
    const settings: PrivacySettingsPayload = {
      ...DEFAULT_PRIVACY_SETTINGS,
      forceRelay: false,
      turnServers: [{ urls: "turn:relay.example.com:443" }]
    };

    const config = createPrivacyRtcConfiguration(settings);

    expect(config.iceTransportPolicy).toBe("all");
    expect(config.iceServers).toHaveLength(3); // 2 STUN + 1 TURN
  });

  it("omits STUN servers in relay-only mode", () => {
    const settings: PrivacySettingsPayload = {
      ...DEFAULT_PRIVACY_SETTINGS,
      forceRelay: true,
      turnServers: [
        { urls: "turn:a.example.com:3478" },
        { urls: "turn:b.example.com:3478" }
      ]
    };

    const config = createPrivacyRtcConfiguration(settings);

    // Should only have TURN servers, no STUN
    for (const server of config.iceServers!) {
      expect((server as { urls: string }).urls).toMatch(/^turn:/);
    }
  });

  it("falls back to default STUN when forceRelay is true but no TURN servers", () => {
    const settings: PrivacySettingsPayload = {
      ...DEFAULT_PRIVACY_SETTINGS,
      forceRelay: true,
      turnServers: []
    };

    const config = createPrivacyRtcConfiguration(settings);

    // No TURN available → falls back to STUN defaults
    expect(config.iceServers).toEqual(DEFAULT_ICE_SERVERS);
  });
});

describe("isLocalCandidate", () => {
  it("detects host candidates", () => {
    const candidate = { candidate: "candidate:1 1 udp 2113937151 192.168.1.100 54321 typ host" };
    expect(isLocalCandidate(candidate)).toBe(true);
  });

  it("does not flag srflx candidates with public IPs", () => {
    const candidate = { candidate: "candidate:2 1 udp 1677729535 203.0.113.5 54321 typ srflx raddr 192.168.1.100 rport 54321" };
    expect(isLocalCandidate(candidate)).toBe(false);
  });

  it("detects 10.x.x.x local IPs", () => {
    const candidate = { candidate: "candidate:1 1 udp 2113937151 10.0.0.1 54321 typ host" };
    expect(isLocalCandidate(candidate)).toBe(true);
  });

  it("detects 172.16-31.x.x local IPs", () => {
    const candidate = { candidate: "candidate:1 1 udp 2113937151 172.16.0.1 54321 typ host" };
    expect(isLocalCandidate(candidate)).toBe(true);
  });

  it("returns false for relay candidates", () => {
    const candidate = { candidate: "candidate:3 1 udp 33562367 198.51.100.1 59000 typ relay raddr 203.0.113.5 rport 54321" };
    expect(isLocalCandidate(candidate)).toBe(false);
  });

  it("returns false for empty candidate string", () => {
    expect(isLocalCandidate({ candidate: "" })).toBe(false);
  });
});

describe("shouldFilterCandidate", () => {
  it("does not filter when filterLocalCandidates is false", () => {
    const candidate = { candidate: "candidate:1 1 udp 2113937151 192.168.1.100 54321 typ host" };
    const settings: PrivacySettingsPayload = { ...DEFAULT_PRIVACY_SETTINGS, filterLocalCandidates: false };

    expect(shouldFilterCandidate(candidate, settings)).toBe(false);
  });

  it("filters host candidates when filterLocalCandidates is true", () => {
    const candidate = { candidate: "candidate:1 1 udp 2113937151 192.168.1.100 54321 typ host" };
    const settings: PrivacySettingsPayload = { ...DEFAULT_PRIVACY_SETTINGS, filterLocalCandidates: true };

    expect(shouldFilterCandidate(candidate, settings)).toBe(true);
  });

  it("does not filter relay candidates even when filterLocalCandidates is true", () => {
    const candidate = { candidate: "candidate:3 1 udp 33562367 198.51.100.1 59000 typ relay" };
    const settings: PrivacySettingsPayload = { ...DEFAULT_PRIVACY_SETTINGS, filterLocalCandidates: true };

    expect(shouldFilterCandidate(candidate, settings)).toBe(false);
  });
});
