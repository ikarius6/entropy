# Entropy — Hidden Tag System for Content and Preferences

> Invisible tagging mechanism that enables organic content categorization and personalized feed filtering without exposing tags to users.

---

## 1. Fundamental Principle

Tags are **internal metadata** of the content, never visible in the consumption UI. The tagging input *is* visible to uploaders and full seeders, but the resulting tags are never shown as content metadata to consumers. This prevents manipulation (popular tag spamming, SEO gaming, etc.). Categorization emerges organically: whoever uploads and whoever fully seeds content contributes tags that reflect what the content actually is.

---

## 2. Tag Structure

```typescript
interface ContentTag {
  name: string;       // The tag itself — max 20 characters, lowercase, trimmed
  counter: number;    // Number of times this tag has been assigned to the content
  updatedAt: number;  // Timestamp (epoch seconds) of the last time it was updated
}
```

**Rules for `name`:**
- Maximum **20 characters**
- Normalized: `trim()` + `toLowerCase()`
- No multiple internal spaces (collapse to one)
- No special characters except `-` and `_`
- Regex validation: `/^[a-z0-9áéíóúñü][a-z0-9áéíóúñü _-]{0,18}[a-z0-9áéíóúñü]$/` (or 1 character minimum)

Implementation: `packages/core/src/tags/tag-validation.ts` (`validateTagName`, `normalizeTagName`)

---

## 3. Tags on Content (Content Tags)

### 3.1 Who can assign tags

| Actor | When | Allowed Tags | Mechanism |
|---|---|---|---|
| **Uploader** (author) | When uploading the content | **1 optional tag** along with title/description | Included in the kind:7001 event as `["entropy-tag", ...]` |
| **Full Seeder** | When finishing seeding **all** chunks | **1 tag** | Publishes Nostr event kind:37001 (tag vote) + stores in extension via `TAG_CONTENT` |

> A seeder can only tag a content **once**. Deduplication operates on two levels:
> - **Nostr (kind:37001):** It's a parameterized replaceable event — the relay only keeps the latest one per author + `d`-tag (rootHash).
> - **Extension (IndexedDB):** `UserTagActionRecord` locally records which contents have already been tagged.

### 3.2 Lifecycle of a tag on a content

```
 Uploader uploads video + tag "music"
         │
         ▼
 kind:7001 event has: ["entropy-tag", "music", "1", "T1"]
         │
         │  Seeder A completes seed → tag "music"
         │  → Publishes kind:37001 event with ["entropy-tag", "music"]
         │  → TAG_CONTENT to extension (P2P propagation)
         ▼
 Any user subscribing to kind:37001 #d:[rootHash]
 sees: { music: 2 votes (uploader + Seeder A) }
         │
         │  Seeder B completes seed → tag "reggaeton"
         │  → Publishes kind:37001 event with ["entropy-tag", "reggaeton"]
         ▼
 kind:37001 subscription shows:
   { music: 2 votes, reggaeton: 1 vote }
```

### 3.3 30-tag Limit and Replacement Policy (Local P2P)

In the extension's local storage (IndexedDB), each content can have a **maximum of 30 tags**. When a new tag arrives and there are already 30:

```
 New tag "electronic" arrives, 30 tags already exist
         │
         ▼
 ┌──────────────────────────────────────────────────────────┐
 │  1. Find the candidate tag for replacement:             │
 │     - Sort tags by counter ASC, then updatedAt ASC      │
 │     - The first one in that list = the weakest one      │
 │       (lowest counter; if tied, the oldest)             │
 │                                                          │
 │  2. Does the new tag have counter (1) >= candidate?     │
 │     YES → Replace candidate with the new tag            │
 │     NO → Discard the new tag (doesn't enter)            │
 └──────────────────────────────────────────────────────────┘
```

Implementation: `packages/core/src/tags/content-tags.ts` (`addContentTag`, `mergeContentTags`)

> **Note:** This limit applies to local P2P storage. Tag votes on Nostr (kind:37001) do not have this limit — aggregation is done on the client when subscribing.

---

## 4. Transport: How tags travel

Tags travel via **two complementary channels**:

| Channel | Scope | Content |
|---|---|---|
| **Nostr (relays)** | All connected users | Uploader's tag (kind:7001) + seeder tag votes (kind:37001) |
| **P2P (WebRTC)** | Only peers exchanging chunks | Locally accumulated tags (TAG_UPDATE binary) |

### 4.1 Uploader's tags in the Chunk Map (kind:7001)

The uploader can include their initial tag in the Nostr event. It is serialized as a Nostr tag `entropy-tag`:

```json
{
  "kind": 7001,
  "tags": [
    ["x-hash", "<root_hash>"],
    ["chunk", "<hash_0>", "0"],
    ["size", "157286400"],
    ["mime", "video/mp4"],
    ["title", "My Video"],
    ["entropy-tag", "music", "1", "1700000000"]
  ]
}
```

Format: `["entropy-tag", "<name>", "<counter>", "<updatedAt>"]`

Implementation: `packages/core/src/nostr/nip-entropy.ts` (`buildEntropyChunkMapTags`, `parseEntropyChunkMapTags`)

### 4.2 Seeder tag votes (kind:37001) — Primary Mechanism

When a seeder adds a tag, a **parameterized replaceable Nostr event** (NIP-33) is published:

```json
{
  "kind": 37001,
  "content": "",
  "tags": [
    ["d", "<root_hash>"],
    ["t", "entropy"],
    ["x-hash", "<root_hash>"],
    ["entropy-tag", "<tag_name>"]
  ]
}
```

**Features:**
- **Parameterized replaceable:** The relay keeps only the latest event per `pubkey` + `d`-tag. A user can only have one active vote per content.
- **Discoverable:** Any user can subscribe to `{ kinds: [37001], "#d": ["<rootHash>"] }` to get all tag votes for a content.
- **No P2P required:** Tags reach all users via relays, even if they never downloaded the content.

Implementation:
- Builder/parser: `packages/core/src/nostr/nip-entropy.ts` (`buildTagVoteTags`, `parseTagVoteTags`)
- Publishing: `apps/web/src/components/SeederTagInput.tsx` (signature via NIP-07 `window.nostr.signEvent`)
- Subscription: `apps/web/src/hooks/useContentTags.ts` (hook that aggregates votes by pubkey)

### 4.3 Tags as P2P metadata — Secondary Mechanism

Additionally, tags are exchanged via WebRTC during chunk transfer using TAG_UPDATE:

```
 TAG_UPDATE (type=0x08)
 ┌──────┬──────────────┬────────────┬──────────────────────────────────┐
 │ 0x08 │ root_hash    │ tag_count  │ tag_entries[]                    │
 │ 1B   │ 32B (SHA256) │ 1B (u8)   │ variable                         │
 └──────┴──────────────┴────────────┴──────────────────────────────────┘

 Each tag_entry:
 ┌───────────┬──────────────┬──────────────┬───────────────────────┐
 │ name_len  │ name (UTF-8) │ counter      │ updatedAt             │
 │ 1B (u8)   │ ≤20B         │ 4B (u32)     │ 4B (u32, epoch secs)  │
 └───────────┴──────────────┴──────────────┴───────────────────────┘
```

Implementation: `packages/core/src/tags/tag-transfer.ts` (`encodeTagUpdate`, `decodeTagUpdate`)

P2P propagates accumulated tags with counters (useful for local replacement policy), while Nostr propagates individual votes per user. Both mechanisms coexist: P2P enriches the extension's local storage, and Nostr ensures all users see the tags without needing to download the content.

### 4.4 P2P Synchronization Flow (local merge)

```
 Seeder A has content X with tags [music:3, rock:2]
 Seeder B has content X with tags [music:2, pop:1]
         │
         │  During chunk transfer,
         │  both exchange TAG_UPDATE messages
         ▼
 ┌──────────────────────────────────────────────────────────┐
 │  Merge Strategy (for each tag):                         │
 │                                                          │
 │  If the tag exists in both:                             │
 │    counter = max(local.counter, remote.counter)          │
 │    updatedAt = max(local.updatedAt, remote.updatedAt)    │
 │                                                          │
 │  If the tag only exists in one:                         │
 │    Add to set (respecting limit of 30)                  │
 │                                                          │
 │  Merged result for both:                                 │
 │    [music:3, rock:2, pop:1]                             │
 └──────────────────────────────────────────────────────────┘
```

Implementation: `packages/core/src/tags/content-tags.ts` (`mergeContentTags`)

---

## 5. User Preferences (User Tag Preferences)

Content tags serve as a source of signals to build an invisible preference profile per user.

### 5.1 Structure

```typescript
interface UserTagPreference {
  name: string;       // Tag name (normalized)
  score: number;      // Accumulated score (can be negative)
  updatedAt: number;  // Last interaction
}
```

The user has a local list of **UserTagPreference** stored in `localStorage` (never published to Nostr).

Implementation: `apps/web/src/hooks/useTagPreferences.ts` (hook with `recordSignal` callback)

### 5.2 Signals that modify preferences

| User Action | Effect on content tags | Implementation |
|---|---|---|
| **Like** a post | `+1` to the score of each content tag | `PostCard.tsx` → `emitSignal("like")` |
| **Share** a post | `+2` to the score of each content tag | `PostCard.tsx` → `emitSignal("share")` |
| **"Not interested"** in a post | `-1` to the score of each content tag | `PostCard.tsx` → `emitSignal("not_interested")` |

> Weight values are defined in `packages/core/src/tags/user-preferences.ts` (`SIGNAL_WEIGHTS`).

### 5.3 Tag source for signals

When the user interacts with a post, `PostCard` combines tags from **two sources** before emitting the signal:

```
 PostCard renders a kind:7001
         │
         ├─ eventTags: uploader's tags (extracted from Nostr event)
         │  → (displayItem.chunkMap as EntropyChunkMap).entropyTags
         │
         ├─ voteTags: seeder tag votes (kind:37001 subscription)
         │  → useContentTags(rootHash).tags
         │
         ▼
 emitSignal(): deduplicated merge (by name, voteTags take priority)
         │
         ▼
 onSignal(mergedTags, "like") → useTagPreferences.recordSignal()
```

This ensures that the user's preferences reflect **all** known tags of the content, including those added by seeders after the original publication.

### 5.4 Preference evolution example

```
 User likes video with tags [music:5, rock:3, live:1]
         │
         ▼
 UserPreferences:
   music → score: 1, updatedAt: now
   rock  → score: 1, updatedAt: now
   live  → score: 1, updatedAt: now
         │
 User likes another video with tags [music:8, pop:2]
         ▼
 UserPreferences:
   music → score: 2, updatedAt: now    ← incremented
   rock  → score: 1, updatedAt: prev
   live  → score: 1, updatedAt: prev
   pop   → score: 1, updatedAt: now    ← new
         │
 User marks "not interested" on post with tags [reggaeton:4, music:3]
         ▼
 UserPreferences:
   music     → score: 1, updatedAt: now  ← decreased from 2 to 1
   rock      → score: 1, updatedAt: prev
   live      → score: 1, updatedAt: prev
   pop       → score: 1, updatedAt: prev
   reggaeton → score: -1, updatedAt: now ← negative = rejection signal
```

### 5.5 Preference limit

User preferences are limited to **100 tags**. Eviction policy:
1. When new tags arrive and there are 100, remove the tag with lowest `|score|` and oldest `updatedAt`.
2. Tags with a score of 0 and no recent activity (>30 days) are automatically purged.

---

## 6. Feed Filtering

### 6.1 Relevance Algorithm

When receiving events from the feed (kind:7001), each content is scored against the user's preferences:

```typescript
function scoreContent(
  contentTags: ContentTag[],
  userPrefs: UserTagPreference[]
): number {
  let score = 0;
  const prefMap = new Map(userPrefs.map(p => [p.name, p]));

  for (const tag of contentTags) {
    const pref = prefMap.get(tag.name);
    if (pref) {
      // Weight = user score × log(tag counter + 1)
      // Tags with more consensus (high counter) weigh more
      score += pref.score * Math.log2(tag.counter + 1);
    }
  }

  return score;
}
```

Implementation: `packages/core/src/tags/tag-scoring.ts` (`scoreContent`)

### 6.2 Feed Ordering

```
 Events received from relay
         │
         ▼
 ┌──────────────────────────────────────────────────────────┐
 │  For each kind:7001:                                     │
 │    1. Extract contentTags from event (uploader tags)     │
 │    2. Merge with tag votes (kind:37001 subscription)     │
 │    3. Calculate relevanceScore with preferences          │
 │    4. Calculate recencyScore = 1 / (now - created_at)    │
 │    5. finalScore = α·relevanceScore + β·recencyScore     │
 │       (α=0.6, β=0.4 by default, adjustable)             │
 │                                                          │
 │  Sort feed by finalScore DESC                            │
 │                                                          │
 │  Content with relevanceScore < 0 (rejected tags):        │
 │    → Moved to the end or filtered out if score < threshold │
 └──────────────────────────────────────────────────────────┘
```

### 6.3 Feed Modes

| Mode | Behavior |
|---|---|
| **Latest** | No tag filtering, ordered by `created_at` |
| **For You** (default) | Ordered by `finalScore` using preferences |
| **Explore** | Shows content with popular tags (high counter) that the user HAS NOT seen |

Implementation: `apps/web/src/hooks/useNostrFeed.ts` + `apps/web/src/components/feed/Feed.tsx`

---

## 7. Storage

### 7.1 IndexedDB (extension) — Tag Tables

```typescript
// In packages/core/src/tags/tag-store.ts — Dexie schema

// Tags of a specific content (local P2P storage)
interface ContentTagRecord {
  id: string;           // `${rootHash}:${tagName}` — Composite PK
  rootHash: string;     // Root hash of the content
  name: string;         // Normalized tag name
  counter: number;      // Accumulated count
  updatedAt: number;    // Epoch seconds
}

// User preferences (web app — localStorage, not IndexedDB)
interface UserTagPreferenceRecord {
  name: string;         // PK — Normalized tag name
  score: number;        // Accumulated score
  updatedAt: number;    // Last modification
}

// Record of which contents this user has already tagged (deduplication)
interface UserTagActionRecord {
  rootHash: string;     // PK — Content hash
  tag: string;          // Assigned tag
  taggedAt: number;     // When it was tagged
}
```

### 7.2 Persistence by Layer

| Data | Where | How |
|---|---|---|
| **Content tags (P2P)** | Extension IndexedDB | `TagStore.setContentTags()` — synced via TAG_UPDATE P2P |
| **Tag votes (Nostr)** | Nostr Relays | kind:37001 events — read via `useContentTags` subscription |
| **User preferences** | Web app `localStorage` | `useTagPreferences` hook — never leave the device |
| **Tag actions** | Extension IndexedDB | `TagStore.recordTagAction()` — local deduplication |

---

## 8. Implementation by Modules

### 8.1 `@entropy/core`

| File | Responsibility |
|---|---|
| `src/nostr/nip-entropy.ts` | Constants `ENTROPY_TAG_VOTE_KIND` (37001), `buildTagVoteTags`, `parseTagVoteTags`, `buildEntropyChunkMapTags` (includes `entropy-tag`) |
| `src/nostr/events.ts` | Re-exports of kinds and builders; `buildEntropyChunkMapEvent` |
| `src/tags/content-tags.ts` | CRUD of ContentTag[], merge, replacement policy (cap 30) |
| `src/tags/user-preferences.ts` | Signals (`applySignal`), weights (`SIGNAL_WEIGHTS`), eviction (cap 100) |
| `src/tags/tag-scoring.ts` | Content scoring algorithm against preferences |
| `src/tags/tag-validation.ts` | Normalization and validation of tag names |
| `src/tags/tag-transfer.ts` | Encode/decode of TAG_UPDATE for P2P binary protocol |
| `src/tags/tag-store.ts` | IndexedDB persistence (`IndexedDbTagStore`) |
| `src/types/extension-bridge.ts` | Bridge messages: `TAG_CONTENT`, `GET_CONTENT_TAGS` |

### 8.2 `@entropy/web`

| File | Responsibility |
|---|---|
| `src/hooks/useContentTags.ts` | **Main hook.** Subscribes to kind:37001 by rootHash. Aggregates votes by pubkey → returns `{ tags, userTagged, userTag }` |
| `src/hooks/useTagPreferences.ts` | Reads/writes preferences in localStorage. Exposes `recordSignal(contentTags, signal)` |
| `src/hooks/useNostrFeed.ts` | Integrates scoring by tags when sorting the feed (Latest / For You / Explore modes) |
| `src/components/SeederTagInput.tsx` | UI for seeders. Publishes kind:37001 event via NIP-07 + `TAG_CONTENT` bridge (P2P). Uses `useContentTags` to detect previous vote |
| `src/components/feed/PostCard.tsx` | Merges `eventTags` (kind:7001) + `voteTags` (`useContentTags`) → `emitSignal()` on like/share/not_interested |
| `src/components/CreditGate.tsx` | Shows `SeederTagInput` when completing seed via credit gate |
| `src/pages/WatchPage.tsx` | Shows `SeederTagInput` when completing download |
| `src/pages/UploadPage.tsx` | Optional tag field when uploading content |
| `src/components/feed/Feed.tsx` | Feed mode selector, passes `recordSignal` to each PostCard |
| `src/lib/extension-bridge.ts` | Bridge functions: `tagContent()`, `getContentTags()` |
| `src/lib/constants.ts` | `KINDS.ENTROPY_TAG_VOTE = 37001` |

### 8.3 `@entropy/extension`

| File | Responsibility |
|---|---|
| `background/chunk-server.ts` | Sends TAG_UPDATE upon completing chunk transfer |
| `background/chunk-ingest.ts` | `addContentTagFromUser()` — stores tag + records deduplication action |
| `background/service-worker.ts` | Handlers for `TAG_CONTENT` and `GET_CONTENT_TAGS` bridge messages |

---

## 9. Security and Anti-Manipulation

| Threat | Mitigation |
|---|---|
| **Tag spam** (a user creates thousands of contents with the same tag) | Tags are per-content, not global; kind:37001 is parameterized replaceable → one vote per user per content |
| **Sybil attack** (creating fake identities to inflate counter) | kind:37001 votes require a signed Nostr identity; the cost of creating identities + seeding all chunks disincentivizes Sybil |
| **Visible tag = manipulable** | Tagging input is visible only to seeders, but resulting tags are **never** shown as content metadata to consumers |
| **Observability in relays** | kind:37001 events are visible in public relays. An observer can see which tags were voted for each content. This is an acceptable trade-off: organic categorization requires votes to be discoverable, and individual tags do not reveal sensitive information |
| **Preference gaming** | Preferences are 100% local (localStorage); there is no incentive to manipulate your own profile |

---

## 10. Complete Flow (E2E Example)

```
 1. Alice uploads a video and types tag "surf" on UploadPage
    → useUploadPipeline includes entropyTags in EntropyChunkMap
    → kind:7001 event published with ["entropy-tag", "surf", "1", "T1"]
    → tagContent("surf") stored in extension for P2P

 2. Bob downloads the video (sees the event in his feed)
    → Bob completely seeds all chunks via CreditGate
    → Upon completion, SeederTagInput appears → Bob types "beach"
    → SeederTagInput publishes kind:37001 event:
      { kind: 37001, tags: [["d", rootHash], ["entropy-tag", "beach"], ...] }
    → Signed via window.nostr.signEvent (NIP-07) → published to relays
    → tagContent("beach") stored in extension for P2P

 3. Carol downloads the video, fully seeds it → tag "surf"
    → Publishes kind:37001 with ["entropy-tag", "surf"]
    → Now there are 2 kind:37001 events + the original tag from kind:7001

 4. 50 more people seed and tag
    → 50 kind:37001 events published in relays
    → useContentTags(rootHash) aggregates: { surf: 30, beach: 8, ocean: 5, ... }
    → Tags evolve organically with no limit of 30 (Nostr)
    → The 30 cap policy only applies to local P2P storage

 5. Dave browses the feed (never downloaded this content):
    → PostCard mounts → useContentTags subscribes kind:37001 #d:[rootHash]
    → Receives all tag votes from relays → voteTags = [surf:30, beach:8, ...]
    → PostCard merges: eventTags (kind:7001) + voteTags (kind:37001)
    → Dave likes it:
      emitSignal("like") → onSignal([surf:30, beach:8, ocean:5, ...], "like")
      → useTagPreferences.recordSignal() updates:
        { surf: +1, beach: +1, ocean: +1, ... }

 6. Dave marks "not interested" on a cooking video
    → PostCard merges eventTags + voteTags → [recipes:10, cooking:5]
    → emitSignal("not_interested") → { recipes: -1, cooking: -1 }
    → Future cooking videos appear lower or are filtered out
```

---

## 11. Implementation Phases

### Phase A — Core Tag Engine ✅
- [x] `tag-validation.ts` — normalization and validation
- [x] `content-tags.ts` — merge, cap 30, replacement policy
- [x] `user-preferences.ts` — signals, cap 100, eviction
- [x] `tag-scoring.ts` — content scoring
- [x] `tag-store.ts` — IndexedDB persistence
- [x] Unit tests for all modules

### Phase B — P2P Transport ✅
- [x] `tag-transfer.ts` — binary TAG_UPDATE encode/decode
- [x] Integrate TAG_UPDATE sending into `chunk-server.ts`
- [x] Integrate TAG_UPDATE receiving into `chunk-ingest.ts`
- [x] Merge received tags with local tags
- [x] `TAG_CONTENT` bridge message + service-worker handler
- [x] `GET_CONTENT_TAGS` bridge message + service-worker handler
- [x] `entropy-tag` in `nip-entropy.ts` (build/parse kind:7001)

### Phase C — Web App Integration ✅
- [x] Optional tag field in upload pipeline (`UploadPage.tsx`)
- [x] Tag upon completing seed in web (`useUploadPipeline.ts` → `tagContent()`)
- [x] `useTagPreferences` hook (localStorage persistence)
- [x] Integrate scoring in `useNostrFeed` (for_you / explore modes)
- [x] Like/Share/Not-interested actions → update preferences (`PostCard.tsx`)
- [x] Feed mode selector: Latest / For You / Explore (`Feed.tsx`)

### Phase D — Nostr Propagation of Seeder Tags ✅
- [x] `ENTROPY_TAG_VOTE_KIND = 37001` — parameterized replaceable event (NIP-33)
- [x] `buildTagVoteTags` / `parseTagVoteTags` in `nip-entropy.ts`
- [x] `ENTROPY_TAG_VOTE: 37001` in `KINDS` constants
- [x] `useContentTags` hook — subscribe kind:37001, aggregate votes by pubkey
- [x] `SeederTagInput` refactored: publishes kind:37001 + TAG_CONTENT (P2P backup)
- [x] `PostCard` refactored: merge `eventTags` + `voteTags` in `emitSignal()`
- [x] Previous vote detection via `useContentTags.userTagged`
- [x] Tests: `tag-vote-event.test.ts` (11 tests), `useContentTags.test.ts` (14 tests)

### Phase E — Refinement
- [ ] Weight adjustment (α, β, signal weights) based on real usage
- [ ] Automatic purge of stale preferences (>30 days, score 0)
- [ ] Local analytics: show user summary of "your interests" (without revealing specific tags per content)
- [ ] "Explore" mode with trending tags (recent high counter)
- [ ] Full flow E2E tests
