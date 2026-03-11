# Entropy — Sistema de Tags Ocultos para Contenido y Preferencias

> Plan de diseño para un mecanismo de etiquetado invisible que permite categorización orgánica del contenido y filtrado personalizado del feed sin exponer los tags a los usuarios.

---

## 1. Principio Fundamental

Los tags son **metadatos internos** del contenido, nunca visibles en la UI. Esto previene manipulación por parte de los usuarios (spam de tags populares, SEO gaming, etc.). La categorización emerge de forma orgánica: quien sube y quienes seedean completo un contenido contribuyen tags que reflejan lo que el contenido realmente es.

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

---

## 3. Tags en el Contenido (Content Tags)

### 3.1 Quién puede asignar tags

| Actor | Momento | Tags permitidos |
|---|---|---|
| **Uploader** (autor) | Al subir el contenido | **1 tag opcional** junto con título/descripción |
| **Seeder completo** | Al terminar de seedear **todos** los chunks de un contenido | **1 tag** |

> Un seeder solo puede tagear un contenido **una vez**. Se registra localmente qué contenidos ya se tagearon para evitar duplicados.

### 3.2 Ciclo de vida de un tag en un contenido

```
 Uploader sube video + tag "música"
         │
         ▼
 ContentTags = [{ name: "música", counter: 1, updatedAt: 1700000000 }]
         │
         │  Seeder A completa seed → tag "música"
         ▼
 ContentTags = [{ name: "música", counter: 2, updatedAt: 1700003600 }]
         │                                          ↑ counter +1, fecha actualizada
         │
         │  Seeder B completa seed → tag "reggaeton"
         ▼
 ContentTags = [
   { name: "música",    counter: 2, updatedAt: 1700003600 },
   { name: "reggaeton", counter: 1, updatedAt: 1700007200 }
 ]
         │
         │  Seeder C completa seed → tag "música"
         ▼
 ContentTags = [
   { name: "música",    counter: 3, updatedAt: 1700010800 },
   { name: "reggaeton", counter: 1, updatedAt: 1700007200 }
 ]
```

### 3.3 Límite de 30 tags y política de reemplazo

Cada contenido puede tener un **máximo de 30 tags**. Cuando llega un tag nuevo (nombre que no existe aún) y ya hay 30 tags:

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

**Ejemplo:**

```
Tags actuales (30 en total), el más débil es:
  { name: "random", counter: 1, updatedAt: 1699900000 }

Nuevo tag: { name: "electrónica", counter: 1, updatedAt: 1700020000 }

→ counter nuevo (1) >= counter candidato (1) → REEMPLAZAR
→ "random" sale, "electrónica" entra

Esto preserva:
  ✓ Tags con counter alto (populares) → nunca se reemplazan fácilmente
  ✓ Tags recientes con mismo counter → sobreviven sobre los antiguos
  ✓ El tag pool se renueva orgánicamente
```

---

## 4. Transporte: Cómo viajan los tags

### 4.1 Tags en el Chunk Map (kind:7001)

El uploader puede incluir su tag inicial en el evento Nostr. Se añade un tag Nostr `entropy-tag`:

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

Formato del tag Nostr: `["entropy-tag", "<name>", "<counter>", "<updatedAt>"]`

> **Nota:** Los tags `entropy-tag` en el evento kind:7001 son la semilla inicial. La evolución de los tags ocurre fuera del relay.

### 4.2 Tags como metadato P2P (fuera de Nostr)

Cuando un peer solicita un contenido o completa un seed, los tags actualizados se intercambian **vía el canal WebRTC existente** usando un nuevo tipo de mensaje en el protocolo de chunk transfer:

```
 TAG_UPDATE (type=4)
 ┌──────┬──────────────┬────────────┬──────────────────────────────────┐
 │ 0x04 │ root_hash    │ tag_count  │ tag_entries[]                    │
 │ 1B   │ 32B (SHA256) │ 1B (u8)   │ variable                         │
 └──────┴──────────────┴────────────┴──────────────────────────────────┘

 Cada tag_entry:
 ┌───────────┬──────────────┬──────────────┬───────────────────────┐
 │ name_len  │ name (UTF-8) │ counter      │ updatedAt             │
 │ 1B (u8)   │ ≤20B         │ 4B (u32)     │ 4B (u32, epoch secs)  │
 └───────────┴──────────────┴──────────────┴───────────────────────┘
```

### 4.3 Flujo de sincronización de tags

```
 Seeder A tiene contenido X con tags [música:3, rock:2]
 Seeder B tiene contenido X con tags [música:2, pop:1]
         │
         │  Durante transferencia de chunks o al completar seed,
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

El usuario tiene una lista local de **UserTagPreference** almacenada en IndexedDB (nunca se publica a Nostr).

### 5.2 Señales que modifican preferencias

| Acción del usuario | Efecto sobre los tags del contenido |
|---|---|
| **Like** un post | `+1` al score de cada tag del contenido |
| **Share** un post | `+2` al score de cada tag del contenido |
| **Watch >50%** de un video | `+1` al score de cada tag |
| **Seed completo** de un contenido | `+1` al score de cada tag |
| **"No me interesa"** en un post | `-1` al score de cada tag del contenido |
| **Block/Mute** un autor | `-3` al score de cada tag del último contenido visto |

> Los valores de peso son configurables y se pueden ajustar con el tiempo.

### 5.3 Ejemplo de evolución de preferencias

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

### 5.4 Límite de preferencias

Las preferencias de usuario también se limitan a **100 tags**. Política de evicción:
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

### 6.2 Ordenamiento del feed

```
 Eventos recibidos del relay
         │
         ▼
 ┌──────────────────────────────────────────────────────────┐
 │  Para cada kind:7001:                                    │
 │    1. Extraer contentTags (del evento + cache P2P)       │
 │    2. Calcular relevanceScore con preferencias           │
 │    3. Calcular recencyScore = 1 / (ahora - created_at)   │
 │    4. finalScore = α·relevanceScore + β·recencyScore     │
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
| **Cronológico** | Sin filtrado por tags, orden por `created_at` |
| **Para ti** (default) | Ordenado por `finalScore` usando preferencias |
| **Explorar** | Muestra contenido con tags populares (counter alto) que el usuario NO ha visto |

---

## 7. Almacenamiento

### 7.1 IndexedDB — Nuevas tablas

```typescript
// En @entropy/core — Dexie schema

// Tags de un contenido específico
interface ContentTagRecord {
  id: string;           // `${rootHash}:${tagName}` — PK compuesto
  rootHash: string;     // Hash raíz del contenido
  name: string;         // Tag name normalizado
  counter: number;      // Conteo acumulado
  updatedAt: number;    // Epoch seconds
}

// Preferencias del usuario
interface UserTagPreferenceRecord {
  name: string;         // PK — Tag name normalizado
  score: number;        // Puntaje acumulado
  updatedAt: number;    // Última modificación
}

// Registro de qué contenidos ya tageó este usuario (evitar duplicados)
interface UserTagActionRecord {
  rootHash: string;     // PK — Hash del contenido
  tag: string;          // Tag que asignó
  taggedAt: number;     // Cuándo lo tageó
}
```

**Índices Dexie:**

```typescript
contentTags: '&id, rootHash, name, counter, updatedAt'
userTagPreferences: '&name, score, updatedAt'
userTagActions: '&rootHash'
```

### 7.2 Persistencia

- **Content tags**: Se persisten en IndexedDB y se sincronizan vía P2P durante intercambios.
- **User preferences**: Solo locales, nunca salen del dispositivo.
- **Tag actions**: Solo locales, para deduplicación.

---

## 8. Implementación por Módulos

### 8.1 `@entropy/core` — Nuevos módulos

| Archivo | Responsabilidad |
|---|---|
| `src/tags/content-tags.ts` | CRUD de ContentTag[], merge, política de reemplazo (cap 30) |
| `src/tags/user-preferences.ts` | CRUD de UserTagPreference[], señales, evicción (cap 100) |
| `src/tags/tag-scoring.ts` | Algoritmo de scoring de contenido contra preferencias |
| `src/tags/tag-validation.ts` | Normalización y validación de tag names |
| `src/tags/tag-transfer.ts` | Encode/decode de TAG_UPDATE para protocolo binario P2P |
| `src/storage/tag-store.ts` | Persistencia en IndexedDB (ContentTagRecord, UserTagPreferenceRecord, UserTagActionRecord) |

### 8.2 `@entropy/web` — Cambios

| Archivo | Cambio |
|---|---|
| `src/hooks/useTagPreferences.ts` | Hook para leer/escribir preferencias locales |
| `src/hooks/useNostrFeed.ts` | Integrar scoring por tags al ordenar el feed |
| Upload pipeline | Agregar campo opcional de tag (input con límite 20 chars) |
| PostCard actions | Like/share/not-interested → actualizar preferencias |
| Settings page | Modo de feed (cronológico / para ti / explorar) |

### 8.3 `@entropy/extension` — Cambios

| Archivo | Cambio |
|---|---|
| `background/chunk-server.ts` | Enviar TAG_UPDATE al completar transferencia |
| `background/chunk-ingest.ts` | Almacenar content tags recibidos vía P2P |
| Bridge protocol | Nuevo mensaje `TAG_CONTENT` para que la web envíe un tag al completar seed |

---

## 9. Seguridad y Anti-Manipulación

| Amenaza | Mitigación |
|---|---|
| **Tag spam** (un user crea miles de contenidos con el mismo tag) | Tags son por contenido, no globales; el counter solo sube cuando **diferentes** seeders confirman |
| **Sybil attack** (crear peers falsos para inflar counter) | Solo peers que completan seed de **todos** los chunks pueden tagear; el costo de ancho de banda desincentiva Sybil |
| **Tag visible = manipulable** | Tags **nunca** se muestran en la UI; el usuario no sabe qué tags tiene un contenido |
| **Reverse engineering de tags** | Los tags viajan en P2P (no en relay público); un observador externo solo ve el tag inicial del evento kind:7001 |
| **Gaming de preferencias** | Las preferencias son locales; no hay incentivo para manipular tu propio perfil |

---

## 10. Flujo Completo (Ejemplo E2E)

```
 1. Alice sube un video y opcionalmente escribe tag "surf"
    → ContentTags: [{ name: "surf", counter: 1, updatedAt: T1 }]
    → Evento kind:7001 publicado con ["entropy-tag", "surf", "1", "T1"]

 2. Bob descarga el video (ve el evento en su feed)
    → Bob seedea todos los chunks
    → Al completar, Bob puede agregar 1 tag → escribe "playa"
    → ContentTags: [surf:1, playa:1]
    → Bob envía TAG_UPDATE a peers durante futuros intercambios

 3. Carol descarga el video, seedea completo → tag "surf"
    → ContentTags: [surf:2, playa:1]  (surf counter incrementa)

 4. 50 personas más seedean y tagean, mix de "surf", "ocean", "travel", etc.
    → ContentTags evoluciona orgánicamente, cap en 30 tags
    → Tags débiles (counter bajo + antiguos) se reemplazan

 5. Dave navega el feed:
    → Dave antes dio like a contenido con tags [surf:5, travel:3]
    → Sus preferencias: { surf: +3, travel: +2 }
    → El video de Alice tiene tags [surf:30, playa:8, ocean:5, travel:3]
    → relevanceScore = 3 × log2(31) + 2 × log2(4) = ~18.8
    → El video aparece alto en el feed "Para ti" de Dave

 6. Dave marca "no me interesa" en un video de cocina con tags [recetas:10, cocina:5]
    → Sus preferencias: { recetas: -1, cocina: -1 }
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
- [x] Tests unitarios para todos los módulos (54 tests)

### Fase B — Transporte P2P ✅
- [x] `tag-transfer.ts` — encode/decode binario TAG_UPDATE
- [x] Integrar envío de TAG_UPDATE en `chunk-server.ts`
- [x] Integrar recepción de TAG_UPDATE en `chunk-ingest.ts`
- [x] Merge de tags recibidos con tags locales
- [x] `TAG_CONTENT` bridge message + service-worker handler
- [x] `entropy-tag` en `nip-entropy.ts` (build/parse kind:7001)

### Fase C — Web App Integration ✅
- [x] Campo de tag opcional en upload pipeline (`UploadPage.tsx`)
- [x] Tag al completar seed en la web (`useUploadPipeline.ts` → `tagContent()`)
- [x] `useTagPreferences` hook (localStorage persistence)
- [x] Integrar scoring en `useNostrFeed` (for_you / explore modes)
- [x] Acciones de Like/Share/Not-interested → actualizar preferencias (`PostCard.tsx`)
- [x] Selector de modo de feed: Latest / For You / Explore (`Feed.tsx`)
- [ ] Tests E2E del flujo completo

### Fase D — Refinamiento
- [ ] Ajuste de pesos (α, β, signal weights) basado en uso real
- [ ] Purga automática de preferencias stale (>30 días, score 0)
- [ ] Analytics locales: mostrar al usuario resumen de "tus intereses" (sin revelar tags específicos por contenido)
- [ ] Modo "Explorar" con tags trending (counter alto reciente)
