import { resolve } from "node:path";

export default {
  test: {
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    alias: {
      "webextension-polyfill": resolve("src/__tests__/__mocks__/webextension-polyfill.ts")
    }
  }
};
