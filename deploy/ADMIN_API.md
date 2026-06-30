# TVMIX Admin API

Base URL:

```text
https://api.tvmix.it/api/v1/admin
```

Tutte le richieste richiedono:

```http
Authorization: Bearer <JWT>
Content-Type: application/json
```

I ruoli `EDITOR` e `ADMIN` possono gestire video, categorie e dirette.
Solo `ADMIN` può leggere, modificare o eliminare utenti.

## Video

```text
GET    /videos
GET    /videos/:id
POST   /videos
PATCH  /videos/:id
DELETE /videos/:id
```

Filtri disponibili: `page`, `limit`, `search`, `categoryId`, `published`.

Esempio creazione:

```json
{
  "title": "Senza Filtri",
  "slug": "senza-filtri",
  "description": "Interviste e approfondimenti",
  "thumbnailUrl": "https://cdn.tvmix.it/poster/senza-filtri.jpg",
  "hlsUrl": "https://cdn.tvmix.it/hls/senza-filtri/master.m3u8",
  "duration": 3120,
  "published": true,
  "categoryId": "UUID_CATEGORIA"
}
```

## Categorie

```text
GET    /categories
GET    /categories/:id
POST   /categories
PATCH  /categories/:id
DELETE /categories/:id
```

Filtri disponibili: `page`, `limit`, `search`.

```json
{
  "name": "Attualità",
  "slug": "attualita",
  "description": "Informazione e approfondimento"
}
```

Una categoria associata a video non può essere eliminata.

## Canali live

```text
GET    /live-streams
GET    /live-streams/:id
POST   /live-streams
PATCH  /live-streams/:id
DELETE /live-streams/:id
```

Filtri disponibili: `page`, `limit`, `search`, `status`.

```json
{
  "name": "TVMIX Live",
  "slug": "tvmix-live",
  "hlsUrl": "https://live.tvmix.it/live/stream.m3u8",
  "status": "LIVE",
  "posterUrl": "https://cdn.tvmix.it/poster/live.jpg"
}
```

Stati validi: `OFFLINE`, `LIVE`, `SCHEDULED`.

## Utenti

```text
GET    /users
GET    /users/:id
PATCH  /users/:id
DELETE /users/:id
```

Filtri disponibili: `page`, `limit`, `search`, `role`.

```json
{
  "name": "Redazione TVMIX",
  "role": "EDITOR"
}
```

Ruoli validi: `USER`, `EDITOR`, `ADMIN`.
Un amministratore non può eliminare il proprio account o rimuovere da sé il
ruolo `ADMIN`.
