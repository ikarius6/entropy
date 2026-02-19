import { describe, expect, it } from "vitest";

import { DEFAULT_ICE_SERVERS, createRtcConfiguration } from "../transport/nat-traversal";

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
