# Entropy — Sistema de Tags Ocultos para Contenido y Preferencias

> Mecanismo de etiquetado invisible que permite categorización orgánica del contenido y filtrado personalizado del feed sin exponer los tags a los usuarios.

---

## 1. Principio Fundamental

Los tags son **metadatos internos** del contenido, nunca visibles en la UI de consumo. El input de tagging sí es visible para uploaders y seeders completos, pero los tags resultantes nunca se muestran como metadata del contenido a los consumidores. Esto previene manipulación (spam de tags populares, SEO gaming, etc.). La categorización emerge de forma orgánica: quien sube y quienes seedean completo un contenido contribuyen tags que reflejan lo que el contenido realmente es.

---

## 2. Estructura de un Tag

```typescript
interface ContentTag {
  name: string;       // El tag en sí — máximo 20 caracteres, lowercase, trimmed
  counter: number;    // Cantidad de veces que este tag ha sido asignado al contenido
  updatedAt: number;  // Timestamp (epoch seconds) de la última vez que se actualizó
}
```

**Reglas de `name`:**
- Máximo **20 caracteres**
- Se normaliza: `trim()` + `toLowerCase()`
- Sin espacios internos múltiples (colapsar a uno)
- Sin caracteres especiales excepto `-` y `_`
- Validación regex: `/^[a-z0-9áéíóúñü][a-z0-9áéíóúñü _-]{0,18}[a-z0-9áéíóúñü]$/` (o 1 solo carácter mínimo)

Implementación: `packages/core/src/tags/tag-validation.ts` (`validateTagName`, `normalizeTagName`)

---

## 3. Tags en el Contenido (Content Tags)

### 3.1 Quién puede asignar tags

| Actor | Momento | Tags permitidos | Mecanismo |
|---|---|---|---|
| **Uploader** (autor) | Al subir el contenido | **1 tag opcional** junto con título/descripción | Se incluye en el evento kind:7001 como `["entropy-tag", ...]` |
| **Seeder completo** | Al terminar de seedear **todos** los chunks | **1 tag** | Publica evento Nostr kind:37001 (tag vote) + almacena en extensión via `TAG_CONTENT` |

> Un seeder solo puede tagear un contenido **una vez**. La deduplicación opera en dos niveles:
> - **Nostr (kind:37001):** Es un evento parameterized replaceable — el relay mantiene solo el último por autor + `d`-tag (rootHash).
> - **Extensión (IndexedDB):** `UserTagActionRecord` registra localmente qué contenidos ya se tagearon.

### 3.2 Ciclo de vida de un tag en un contenido

```
 Uploader sube video + tag "música"
         │
         ▼
 Evento kind:7001 tiene: ["entropy-tag", "música", "1", "T1"]
         │
         │  Seeder A completa seed → tag "música"
         │  → Publica evento kind:37001 con ["entropy-tag", "música"]
         │  → TAG_CONTENT a extensión (P2P propagation)
         ▼
 Cualquier usuario que subscribe kind:37001 #d:[rootHash]
 ve: { música: 2 votos (uploader + Seeder A) }
         │
         │  Seeder B completa seed → tag "reggaeton"
         │  → Publica evento kind:37001 con ["entropy-tag", "reggaeton"]
         ▼
 Subscripción kind:37001 muestra:
   { música: 2 votos, reggaeton: 1 voto }
```

### 3.3 Límite de 30 tags y política de reemplazo (P2P local)

En el almacenamiento local de la extensión (IndexedDB), cada contenido puede tener un **máximo de 30 tags**. Cuando llega un tag nuevo y ya hay 30:

```
 Nuevo tag "electrónica" llega, 30 tags ya existen
         │
         ▼
 ┌──────────────────────────────────────────────────────────┐
 │  1. Buscar el tag candidato a reemplazo:                │
 │     - Ordenar tags por counter ASC, luego updatedAt ASC │
 │     - El primero de esa lista = el más débil            │
 │       (menor counter; si empatan, el más antiguo)       │
 │                                                          │
 │  2. ¿El nuevo tag tiene counter (1) >= candidato?       │
 │     SÍ → Reemplazar candidato con el nuevo tag          │
 │     NO → Descartar el nuevo tag (no entra)              │
 └──────────────────────────────────────────────────────────┘
```

Implementación: `packages/core/src/tags/content-tags.ts` (`addContentTag`, `mergeContentTags`)

> **Nota:** Este límite aplica al almacenamiento P2P local. Los tag votes en Nostr (kind:37001) no tienen este límite — la agregación se hace en el cliente al subscribir.

---

## 4. Transporte: Cómo viajan los tags

Los tags viajan por **dos canales complementarios**:

| Canal | Alcance | Contenido |
|---|---|---|
| **Nostr (relays)** | Todos los usuarios conectados | Tag del uploader (kind:7001) + tag votes de seeders (kind:37001) |
| **P2P (WebRTC)** | Solo peers que intercambian chunks | Tags acumulados localmente (TAG_UPDATE binary) |

### 4.1 Tags del uploader en el Chunk Map (kind:7001)

El uploader puede incluir su tag inicial en el evento Nostr. Se serializa como tag Nostr `entropy-tag`:

```json
{
  "kind": 7001,
  "tags": [
    ["x-hash", "<root_hash>"],
    ["chunk", "<hash_0>", "0"],
    ["size", "157286400"],
    ["mime", "video/mp4"],
    ["title", "Mi Video"],
    ["entropy-tag", "música", "1", "1700000000"]
  ]
}
```

Formato: `["entropy-tag", "<name>", "<counter>", "<updatedAt>"]`

Implementación: `packages/core/src/nostr/nip-entropy.ts` (`buildEntropyChunkMapTags`, `parseEntropyChunkMapTags`)

### 4.2 Tag votes de seeders (kind:37001) — Mecanismo principal

Cuando un seeder agrega un tag, se publica un **evento Nostr parameterized replaceable** (NIP-33):

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

**Características:**
- **Parameterized replaceable:** El relay mantiene solo el último evento por `pubkey` + `d`-tag. Un usuario solo puede tener un voto activo por contenido.
- **Descubrible:** Cualquier usuario puede subscribir `{ kinds: [37001], "#d": ["<rootHash>"] }` para obtener todos los tag votes de un contenido.
- **Sin P2P necesario:** Los tags llegan a todos los usuarios via relays, incluso si nunca descargaron el contenido.

Implementación:
- Builder/parser: `packages/core/src/nostr/nip-entropy.ts` (`buildTagVoteTags`, `parseTagVoteTags`)
- Publicación: `apps/web/src/components/SeederTagInput.tsx` (firma via NIP-07 `window.nostr.signEvent`)
- Subscripción: `apps/web/src/hooks/useContentTags.ts` (hook que agrega votos por pubkey)

### 4.3 Tags como metadato P2P — Mecanismo secundario

Adicionalmente, los tags se intercambian vía WebRTC durante transferencia de chunks usando TAG_UPDATE:

```
 TAG_UPDATE (type=0x08)
 ┌──────┬──────────────┬────────────┬──────────────────────────────────┐
 │ 0x08 │ root_hash    │ tag_count  │ tag_entries[]                    │
 │ 1B   │ 32B (SHA256) │ 1B (u8)   │ variable                         │
 └──────┴──────────────┴────────────┴──────────────────────────────────┘

 Cada tag_entry:
 ┌───────────┬──────────────┬──────────────┬───────────────────────┐
 │ name_len  │ name (UTF-8) │ counter      │ updatedAt             │
 │ 1B (u8)   │ ≤20B         │ 4B (u32)     │ 4B (u32, epoch secs)  │
 └───────────┴──────────────┴──────────────┴───────────────────────┘
```

Implementación: `packages/core/src/tags/tag-transfer.ts` (`encodeTagUpdate`, `decodeTagUpdate`)

El P2P propaga tags acumulados con counters (útil para la política de reemplazo local), mientras que Nostr propaga votos individuales por usuario. Ambos mecanismos coexisten: el P2P enriquece el almacenamiento local de la extensión, y Nostr garantiza que todos los usuarios vean los tags sin necesidad de descargar el contenido.

### 4.4 Flujo de sincronización P2P (merge local)

```
 Seeder A tiene contenido X con tags [música:3, rock:2]
 Seeder B tiene contenido X con tags [música:2, pop:1]
         │
         │  Durante transferencia de chunks,
         │  ambos intercambian TAG_UPDATE messages
         ▼
 ┌──────────────────────────────────────────────────────────┐
 │  Merge Strategy (por cada tag):                         │
 │                                                          │
 │  Si el tag existe en ambos:                             │
 │    counter = max(local.counter, remote.counter)          │
 │    updatedAt = max(local.updatedAt, remote.updatedAt)    │
 │                                                          │
 │  Si el tag solo existe en uno:                          │
 │    Agregar al set (respetando límite de 30)             │
 │                                                          │
 │  Resultado merged para ambos:                            │
 │    [música:3, rock:2, pop:1]                            │
 └──────────────────────────────────────────────────────────┘
```

Implementación: `packages/core/src/tags/content-tags.ts` (`mergeContentTags`)

---

## 5. Preferencias de Usuario (User Tag Preferences)

Los tags del contenido sirven como fuente de señales para construir un perfil de preferencias invisible por usuario.

### 5.1 Estructura

```typescript
interface UserTagPreference {
  name: string;       // Tag name (normalizado)
  score: number;      // Puntaje acumulado (puede ser negativo)
  updatedAt: number;  // Última interacción
}
```

El usuario tiene una lista local de **UserTagPreference** almacenada en `localStorage` (nunca se publica a Nostr).

Implementación: `apps/web/src/hooks/useTagPreferences.ts` (hook con `recordSignal` callback)

### 5.2 Señales que modifican preferencias

| Acción del usuario | Efecto sobre los tags del contenido | Implementación |
|---|---|---|
| **Like** un post | `+1` al score de cada tag del contenido | `PostCard.tsx` → `emitSignal("like")` |
| **Share** un post | `+2` al score de cada tag del contenido | `PostCard.tsx` → `emitSignal("share")` |
| **"No me interesa"** en un post | `-1` al score de cada tag del contenido | `PostCard.tsx` → `emitSignal("not_interested")` |

> Los valores de peso están definidos en `packages/core/src/tags/user-preferences.ts` (`SIGNAL_WEIGHTS`).

### 5.3 Fuente de tags para señales

Cuando el usuario interactúa con un post, `PostCard` combina tags de **dos fuentes** antes de emitir la señal:

```
 PostCard renderiza un kind:7001
         │
         ├─ eventTags: tags del uploader (extraídos del evento Nostr)
         │  → (displayItem.chunkMap as EntropyChunkMap).entropyTags
         │
         ├─ voteTags: tag votes de seeders (subscripción kind:37001)
         │  → useContentTags(rootHash).tags
         │
         ▼
 emitSignal(): merge deduplicado (por nombre, voteTags tiene prioridad)
         │
         ▼
 onSignal(mergedTags, "like") → useTagPreferences.recordSignal()
```

Esto garantiza que las preferencias del usuario reflejan **todos** los tags conocidos del contenido, incluyendo los agregados por seeders después de la publicación original.

### 5.4 Ejemplo de evolución de preferencias

```
 Usuario da like a video con tags [música:5, rock:3, en-vivo:1]
         │
         ▼
 UserPreferences:
   música  → score: 1, updatedAt: now
   rock    → score: 1, updatedAt: now
   en-vivo → score: 1, updatedAt: now
         │
 Usuario da like a otro video con tags [música:8, pop:2]
         ▼
 UserPreferences:
   música  → score: 2, updatedAt: now    ← incrementó
   rock    → score: 1, updatedAt: prev
   en-vivo → score: 1, updatedAt: prev
   pop     → score: 1, updatedAt: now    ← nuevo
         │
 Usuario marca "no me interesa" en post con tags [reggaeton:4, música:3]
         ▼
 UserPreferences:
   música    → score: 1, updatedAt: now  ← decrementó de 2 a 1
   rock      → score: 1, updatedAt: prev
   en-vivo   → score: 1, updatedAt: prev
   pop       → score: 1, updatedAt: prev
   reggaeton → score: -1, updatedAt: now ← negativo = señal de rechazo
```

### 5.5 Límite de preferencias

Las preferencias de usuario se limitan a **100 tags**. Política de evicción:
1. Cuando llegan nuevos tags y hay 100, eliminar el tag con menor `|score|` y `updatedAt` más antiguo.
2. Tags con score 0 y sin actividad reciente (>30 días) se purgan automáticamente.

---

## 6. Filtrado del Feed

### 6.1 Algoritmo de relevancia

Al recibir eventos del feed (kind:7001), cada contenido se puntúa contra las preferencias del usuario:

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
      // Peso = score del usuario × log(counter del tag + 1)
      // Tags con más consenso (counter alto) pesan más
      score += pref.score * Math.log2(tag.counter + 1);
    }
  }

  return score;
}
```

Implementación: `packages/core/src/tags/tag-scoring.ts` (`scoreContent`)

### 6.2 Ordenamiento del feed

```
 Eventos recibidos del relay
         │
         ▼
 ┌──────────────────────────────────────────────────────────┐
 │  Para cada kind:7001:                                    │
 │    1. Extraer contentTags del evento (uploader tags)     │
 │    2. Merge con tag votes (kind:37001 subscription)      │
 │    3. Calcular relevanceScore con preferencias           │
 │    4. Calcular recencyScore = 1 / (ahora - created_at)   │
 │    5. finalScore = α·relevanceScore + β·recencyScore     │
 │       (α=0.6, β=0.4 por defecto, ajustable)             │
 │                                                          │
 │  Ordenar feed por finalScore DESC                        │
 │                                                          │
 │  Contenido con relevanceScore < 0 (tags rechazados):     │
 │    → Se mueve al final o se filtra si score < umbral     │
 └──────────────────────────────────────────────────────────┘
```

### 6.3 Modos de feed

| Modo | Comportamiento |
|---|---|
| **Latest** | Sin filtrado por tags, orden por `created_at` |
| **For You** (default) | Ordenado por `finalScore` usando preferencias |
| **Explore** | Muestra contenido con tags populares (counter alto) que el usuario NO ha visto |

Implementación: `apps/web/src/hooks/useNostrFeed.ts` + `apps/web/src/components/feed/Feed.tsx`

---

## 7. Almacenamiento

### 7.1 IndexedDB (extensión) — Tablas de tags

```typescript
// En packages/core/src/tags/tag-store.ts — Dexie schema

// Tags de un contenido específico (almacenamiento P2P local)
interface ContentTagRecord {
  id: string;           // `${rootHash}:${tagName}` — PK compuesto
  rootHash: string;     // Hash raíz del contenido
  name: string;         // Tag name normalizado
  counter: number;      // Conteo acumulado
  updatedAt: number;    // Epoch seconds
}

// Preferencias del usuario (web app — localStorage, no IndexedDB)
interface UserTagPreferenceRecord {
  name: string;         // PK — Tag name normalizado
  score: number;        // Puntaje acumulado
  updatedAt: number;    // Última modificación
}

// Registro de qué contenidos ya tageó este usuario (deduplicación)
interface UserTagActionRecord {
  rootHash: string;     // PK — Hash del contenido
  tag: string;          // Tag que asignó
  taggedAt: number;     // Cuándo lo tageó
}
```

### 7.2 Persistencia por capa

| Dato | Dónde | Cómo |
|---|---|---|
| **Content tags (P2P)** | Extensión IndexedDB | `TagStore.setContentTags()` — se sincronizan vía TAG_UPDATE P2P |
| **Tag votes (Nostr)** | Relays Nostr | Eventos kind:37001 — se leen via subscripción `useContentTags` |
| **User preferences** | Web app `localStorage` | `useTagPreferences` hook — nunca salen del dispositivo |
| **Tag actions** | Extensión IndexedDB | `TagStore.recordTagAction()` — deduplicación local |

---

## 8. Implementación por Módulos

### 8.1 `@entropy/core`

| Archivo | Responsabilidad |
|---|---|
| `src/nostr/nip-entropy.ts` | Constantes `ENTROPY_TAG_VOTE_KIND` (37001), `buildTagVoteTags`, `parseTagVoteTags`, `buildEntropyChunkMapTags` (incluye `entropy-tag`) |
| `src/nostr/events.ts` | Re-exports de kinds y builders; `buildEntropyChunkMapEvent` |
| `src/tags/content-tags.ts` | CRUD de ContentTag[], merge, política de reemplazo (cap 30) |
| `src/tags/user-preferences.ts` | Señales (`applySignal`), pesos (`SIGNAL_WEIGHTS`), evicción (cap 100) |
| `src/tags/tag-scoring.ts` | Algoritmo de scoring de contenido contra preferencias |
| `src/tags/tag-validation.ts` | Normalización y validación de tag names |
| `src/tags/tag-transfer.ts` | Encode/decode de TAG_UPDATE para protocolo binario P2P |
| `src/tags/tag-store.ts` | Persistencia en IndexedDB (`IndexedDbTagStore`) |
| `src/types/extension-bridge.ts` | Mensajes bridge: `TAG_CONTENT`, `GET_CONTENT_TAGS` |

### 8.2 `@entropy/web`

| Archivo | Responsabilidad |
|---|---|
| `src/hooks/useContentTags.ts` | **Hook principal.** Subscribe a kind:37001 por rootHash. Agrega votos por pubkey → retorna `{ tags, userTagged, userTag }` |
| `src/hooks/useTagPreferences.ts` | Lee/escribe preferencias en localStorage. Expone `recordSignal(contentTags, signal)` |
| `src/hooks/useNostrFeed.ts` | Integra scoring por tags al ordenar el feed (modos Latest / For You / Explore) |
| `src/components/SeederTagInput.tsx` | UI para seeders. Publica evento kind:37001 via NIP-07 + `TAG_CONTENT` bridge (P2P). Usa `useContentTags` para detectar voto previo |
| `src/components/feed/PostCard.tsx` | Merge `eventTags` (kind:7001) + `voteTags` (`useContentTags`) → `emitSignal()` al like/share/not_interested |
| `src/components/CreditGate.tsx` | Muestra `SeederTagInput` al completar seed via credit gate |
| `src/pages/WatchPage.tsx` | Muestra `SeederTagInput` al completar descarga |
| `src/pages/UploadPage.tsx` | Campo de tag opcional al subir contenido |
| `src/components/feed/Feed.tsx` | Selector de modo de feed, pasa `recordSignal` a cada PostCard |
| `src/lib/extension-bridge.ts` | Funciones bridge: `tagContent()`, `getContentTags()` |
| `src/lib/constants.ts` | `KINDS.ENTROPY_TAG_VOTE = 37001` |

### 8.3 `@entropy/extension`

| Archivo | Responsabilidad |
|---|---|
| `background/chunk-server.ts` | Envía TAG_UPDATE al completar transferencia de chunks |
| `background/chunk-ingest.ts` | `addContentTagFromUser()` — almacena tag + registra acción de deduplicación |
| `background/service-worker.ts` | Handlers para `TAG_CONTENT` y `GET_CONTENT_TAGS` bridge messages |

---

## 9. Seguridad y Anti-Manipulación

| Amenaza | Mitigación |
|---|---|
| **Tag spam** (un user crea miles de contenidos con el mismo tag) | Tags son por contenido, no globales; kind:37001 es parameterized replaceable → un voto por usuario por contenido |
| **Sybil attack** (crear identidades falsas para inflar counter) | Los votos kind:37001 requieren una identidad Nostr firmada; el costo de crear identidades + seedear todos los chunks desincentiva Sybil |
| **Tag visible = manipulable** | El input de tagging es visible solo para seeders, pero los tags resultantes **nunca** se muestran como metadata del contenido a consumidores |
| **Observabilidad en relays** | Los eventos kind:37001 son visibles en relays públicos. Un observador puede ver qué tags se votaron para cada contenido. Esto es un trade-off aceptable: la categorización orgánica requiere que los votos sean descubribles, y los tags individuales no revelan información sensible |
| **Gaming de preferencias** | Las preferencias son 100% locales (localStorage); no hay incentivo para manipular tu propio perfil |

---

## 10. Flujo Completo (Ejemplo E2E)

```
 1. Alice sube un video y escribe tag "surf" en UploadPage
    → useUploadPipeline incluye entropyTags en el EntropyChunkMap
    → Evento kind:7001 publicado con ["entropy-tag", "surf", "1", "T1"]
    → tagContent("surf") almacena en extensión para P2P

 2. Bob descarga el video (ve el evento en su feed)
    → Bob seedea todos los chunks via CreditGate
    → Al completar, SeederTagInput aparece → Bob escribe "playa"
    → SeederTagInput publica evento kind:37001:
      { kind: 37001, tags: [["d", rootHash], ["entropy-tag", "playa"], ...] }
    → Firmado via window.nostr.signEvent (NIP-07) → publicado a relays
    → tagContent("playa") almacena en extensión para P2P

 3. Carol descarga el video, seedea completo → tag "surf"
    → Publica kind:37001 con ["entropy-tag", "surf"]
    → Ahora hay 2 eventos kind:37001 + el tag original del kind:7001

 4. 50 personas más seedean y tagean
    → 50 eventos kind:37001 publicados en relays
    → useContentTags(rootHash) agrega: { surf: 30, playa: 8, ocean: 5, ... }
    → Tags evolucionan orgánicamente sin límite de 30 (Nostr)
    → La política de cap 30 solo aplica al almacenamiento P2P local

 5. Dave navega el feed (nunca descargó este contenido):
    → PostCard monta → useContentTags subscribe kind:37001 #d:[rootHash]
    → Recibe todos los tag votes de relays → voteTags = [surf:30, playa:8, ...]
    → PostCard merge: eventTags (kind:7001) + voteTags (kind:37001)
    → Dave da like:
      emitSignal("like") → onSignal([surf:30, playa:8, ocean:5, ...], "like")
      → useTagPreferences.recordSignal() actualiza:
        { surf: +1, playa: +1, ocean: +1, ... }

 6. Dave marca "no me interesa" en un video de cocina
    → PostCard merge eventTags + voteTags → [recetas:10, cocina:5]
    → emitSignal("not_interested") → { recetas: -1, cocina: -1 }
    → Futuros videos de cocina aparecen más abajo o se filtran
```

---

## 11. Fases de Implementación

### Fase A — Core Tag Engine ✅
- [x] `tag-validation.ts` — normalización y validación
- [x] `content-tags.ts` — merge, cap 30, política de reemplazo
- [x] `user-preferences.ts` — señales, cap 100, evicción
- [x] `tag-scoring.ts` — scoring de contenido
- [x] `tag-store.ts` — persistencia IndexedDB
- [x] Tests unitarios para todos los módulos

### Fase B — Transporte P2P ✅
- [x] `tag-transfer.ts` — encode/decode binario TAG_UPDATE
- [x] Integrar envío de TAG_UPDATE en `chunk-server.ts`
- [x] Integrar recepción de TAG_UPDATE en `chunk-ingest.ts`
- [x] Merge de tags recibidos con tags locales
- [x] `TAG_CONTENT` bridge message + service-worker handler
- [x] `GET_CONTENT_TAGS` bridge message + service-worker handler
- [x] `entropy-tag` en `nip-entropy.ts` (build/parse kind:7001)

### Fase C — Web App Integration ✅
- [x] Campo de tag opcional en upload pipeline (`UploadPage.tsx`)
- [x] Tag al completar seed en la web (`useUploadPipeline.ts` → `tagContent()`)
- [x] `useTagPreferences` hook (localStorage persistence)
- [x] Integrar scoring en `useNostrFeed` (for_you / explore modes)
- [x] Acciones de Like/Share/Not-interested → actualizar preferencias (`PostCard.tsx`)
- [x] Selector de modo de feed: Latest / For You / Explore (`Feed.tsx`)

### Fase D — Propagación Nostr de Seeder Tags ✅
- [x] `ENTROPY_TAG_VOTE_KIND = 37001` — evento parameterized replaceable (NIP-33)
- [x] `buildTagVoteTags` / `parseTagVoteTags` en `nip-entropy.ts`
- [x] `ENTROPY_TAG_VOTE: 37001` en `KINDS` constants
- [x] `useContentTags` hook — subscribe kind:37001, agrega votos por pubkey
- [x] `SeederTagInput` refactorizado: publica kind:37001 + TAG_CONTENT (P2P backup)
- [x] `PostCard` refactorizado: merge `eventTags` + `voteTags` en `emitSignal()`
- [x] Detección de voto previo via `useContentTags.userTagged`
- [x] Tests: `tag-vote-event.test.ts` (11 tests), `useContentTags.test.ts` (14 tests)

### Fase E — Refinamiento
- [ ] Ajuste de pesos (α, β, signal weights) basado en uso real
- [ ] Purga automática de preferencias stale (>30 días, score 0)
- [ ] Analytics locales: mostrar al usuario resumen de "tus intereses" (sin revelar tags específicos por contenido)
- [ ] Modo "Explorar" con tags trending (counter alto reciente)
- [ ] Tests E2E del flujo completo
