# Distribuzione TVMIX-BACKEND

Il reverse proxy Nginx espone il servizio Node.js tramite:

```text
https://api.tvmix.it
```

In produzione il processo Express deve ascoltare su `127.0.0.1:5000` o
`0.0.0.0:5000`, come configurato in `deploy/nginx/api.tvmix.it.conf`.

## Variabili ambiente

```env
NODE_ENV=production
PORT=5000
PUBLIC_API_URL=https://api.tvmix.it
CORS_ALLOWED_ORIGINS=https://tvmix.it,https://www.tvmix.it
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/tvmix?schema=public
JWT_SECRET=UN_SEGRETO_CASUALE_DI_ALMENO_32_CARATTERI
JWT_EXPIRES_IN=1h
BCRYPT_ROUNDS=12
```

## Aggiornamento applicazione

```bash
npm ci
npm run prisma:generate
npm run prisma:deploy
npm run build
sudo systemctl restart tvmix-backend
```

## Creazione del primo amministratore

Registrare prima l'utente tramite `POST /api/v1/auth/register`, quindi:

```bash
npm run admin:promote -- admin@tvmix.it
```

Il pannello rifiuta utenti con ruolo diverso da `ADMIN`.

## Verifica

```bash
curl https://api.tvmix.it/health
curl -i https://api.tvmix.it/api/v1/auth/me
```

La seconda richiesta deve restituire `401 Autenticazione richiesta`, non `404`.
