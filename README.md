# Entropy Monorepo

Phase 1 baseline for Entropy:
- `@entropy/core` chunking, hashing, Merkle, and Nostr chunk-map helpers (`kind:7001`)
- `@entropy/web` React uploader PoC that generates chunk-map events and bridges to extension messaging
- `@entropy/extension` Manifest V3 skeleton with service worker seeding queue, content-script bridge, popup, and dashboard

## Run

1. Install dependencies

```bash
pnpm install
```

2. Start web app

```bash
pnpm dev:web
```

3. Build extension and load unpacked from `apps/extension/dist`

```bash
pnpm --filter @entropy/extension build
```

After loading, open the extension popup and use **Open dashboard** (or extension options) to inspect live node status updates.

4. Run tests

```bash
pnpm test
```
