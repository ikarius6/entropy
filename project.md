Este es el documento fundacional de lo que podríamos llamar **Entropy**. Es una propuesta técnica para resolver el dilema de la escalabilidad multimedia en redes descentralizadas como Nostr, priorizando la soberanía del usuario y la accesibilidad web.

---

# 📜 Especificación de Proyecto: Entropy

## 1. Visión General

**Entropy Multimedia Layer** es un protocolo de capa 2 para redes sociales descentralizadas que permite el intercambio de contenido multimedia pesado (Video/4K/Audio) sin depender de servidores centralizados o relays de almacenamiento costosos. Utiliza una arquitectura **Browser-as-a-Node** (Navegador como Nodo) y un sistema de incentivos basado en la reciprocidad de ancho de banda.

## 2. Pilares Arquitectónicos

### A. Capa de Metadatos (Nostr)

Se utiliza Nostr para el descubrimiento y la integridad. No se sube el video al relay; se sube un **"Mapa de Chunks"**.

* **NIP-Custom (Propuesto):** Un evento tipo `kind: 7001` que contiene:
* `x-hash`: Hash raíz del archivo completo.
* `chunks`: Lista de hashes  de cada fragmento de 5MB.
* `size`: Tamaño total.
* `gatekeepers`: Lista de `pubkeys` que actualmente tienen fragmentos activos.



### B. Capa de Transporte (WebRTC + WebTorrent)

El intercambio real de datos ocurre entre navegadores de forma encriptada.

* **Fragmentación Ciega:** Los archivos se dividen en trozos de 5MB sin formato. Un nodo que hace *seeding* solo posee "ruido binario", lo que otorga **negación plausible** ante contenido sensible o con copyright.
* **Reensamblaje en Cliente:** El navegador del receptor es el único que une los trozos y les da formato (`.mp4`, `.jpg`) usando el Mapa de Chunks de Nostr.

### C. Sistema de Incentivos: Ratio 1:1

Para evitar el "leeching" (descargar sin compartir), se implementa una economía de ancho de banda:

* **Proof of Upstream:** Para descargar el Chunk B, el usuario debe presentar una prueba firmada de que ya entregó el Chunk A a otro par de la red.
* **Créditos de Bienvenida:** Los nuevos usuarios realizan un proceso de "Onboarding Seeder" donde ayudan a la red a mover contenido frío mientras aprenden a usar la plataforma, acumulando sus primeros 50-100MB de crédito.

---

## 3. Gestión de Contenido "Frío" (Estrategia de Redundancia)

Para asegurar que el contenido menos popular no desaparezca:

1. **Exceso de Seeding:** Si un usuario tiene un ratio muy positivo (), el sistema le asigna automáticamente la custodia de chunks "fríos".
2. **Prueba de Custodia:** Los usuarios que mantienen contenido frío reciben "Créditos Premium" que les permiten descargar contenido viral con prioridad de ancho de banda o menor latencia.

---

## 4. Retos Técnicos y Mitigaciones

| Reto | Mitigación |
| --- | --- |
| **Persistencia Web** | Implementación de una **Extensión de Navegador** con Service Workers para seeding en segundo plano. |
| **NAT Traversal** | Uso de servidores STUN/TURN comunitarios o federados (solo para señalización, no datos). |
| **Veracidad de Datos** | Verificación de Hash  inmediata tras recibir cada Chunk. Si falla, el nodo emisor es marcado como malicioso. |
| **Privacidad de IP** | Opción de enrutar tráfico sensible a través de la red **Tor** (integrable en la extensión Entropy). |

---

## 5. Próximos Pasos (Roadmap)

### Fase 1: Prototipo de Concepto (PoC)

* **Desarrollo del NIP Custom:** Definir la estructura exacta del evento de Nostr para el mapeo de archivos.
* **WebRTC Handshake:** Crear una página web simple donde dos usuarios puedan intercambiar un archivo de 5MB usando sus llaves de Nostr como identidad.

### Fase 2: El Motor de Créditos

* **Firmas de Recibo:** Implementar la lógica para que el receptor firme un "ticket" por cada megabyte recibido.
* **Base de Datos Local (IndexedDB):** Optimizar el almacenamiento de chunks en el navegador para que no sature el disco del usuario.

### Fase 3: La Extensión de Navegador

* **Background Seeding:** Desarrollar la extensión que permita seguir compartiendo datos aunque la pestaña de la red social esté cerrada.
* **Interfaz de Usuario:** Crear un "Dashboard de Nodo" donde el usuario vea cuántos megas ha compartido y qué contenido está ayudando a preservar.

---

> **Nota de Seguridad:** Al usar chunks de 5MB "ciegos", estamos convirtiendo cada computadora en una pieza de un rompecabezas global. Ningún usuario posee el rompecabezas completo a menos que decida verlo, lo cual es fundamental para la descentralización ética.

**¿Te gustaría que empezáramos a prototipar el código en JavaScript para el "Chunking" y la generación del Mapa de Chunks para Nostr?** Esto sería el corazón técnico del proyecto.