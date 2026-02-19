# Entropy - Next Steps (Resume Notes)

## 1) Environment bootstrap

1. Install dependencies:

```bash
pnpm install
```

2. Verify monorepo tasks:

```bash
pnpm typecheck
pnpm test
pnpm build
```

---

## 2) Validate current Phase 1 flow end-to-end

### Web app

```bash
pnpm --filter @entropy/web dev
```

- Open the uploader UI.
- Pick a file and generate chunk map (`kind:7001`).
- Confirm generated event JSON is shown.
- Confirm extension warnings are empty when extension is loaded.

### Extension

```bash
pnpm --filter @entropy/extension build
```

- Load `apps/extension/dist` as unpacked extension.
- Open popup and click **Refresh status**.
- Click **Open dashboard** and confirm dashboard renders.
- Trigger upload delegation from web and verify live status updates in popup/dashboard.

---

## 3) Current protocol baseline to keep

Shared bridge contract now lives in:
- `packages/core/src/types/extension-bridge.ts`

Important invariants:
- Runtime request/response messages require `requestId`.
- Chunk map event kind is `7001`.
- Signaling range is `20000-29999`.
- `NODE_STATUS_UPDATE` push events are used for live extension/web status sync.

---

## 4) Recommended next implementation block

1. **Core package**
   - Implement `packages/core/src/nostr/client.ts` relay connection helpers.
   - Start `packages/core/src/transport/*` primitives (peer manager + signaling envelope handling).

2. **Web package**
   - Split uploader into focused components (`uploader`, `event-preview`, `node-status`).
   - Add a small integration test for event generation + delegation message emit.

3. **Extension package**
   - Persist delegation state with `chrome.storage` so background state survives worker restarts.
   - Add scheduler policy knobs (prune interval / max age) via constants.

---

## 5) If something fails first

- If TypeScript/JSX errors mention missing `react`, `vitest`, or `vite` modules, run `pnpm install` first.
- If extension build fails, run:

```bash
pnpm --filter @entropy/extension run prepare:manifest
```

then rebuild.
