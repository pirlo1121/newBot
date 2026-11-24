# Finanzas Bot

Gestor de finanzas personales por Telegram. El usuario conversa con un bot, un modelo de IA interpreta el mensaje y ejecuta funciones del backend; el backend es el único que lee y escribe en SQLite.

La especificación completa está en [`AGENTS.md`](AGENTS.md) y el avance por fases en [`docs/PROGRESO.md`](docs/PROGRESO.md).

**Estado:** Fase 1 — esqueleto del backend (API base, configuración, autenticación interna y tests). Aún no hay base de datos ni bot.

## Requisitos

- Node.js 24 o superior (probado con Node 26).
- npm.

## Puesta en marcha

```bash
cp .env.example .env
# editar .env y definir INTERNAL_API_KEY (mínimo 16 caracteres)
npm install
npm run dev
```

El servidor escucha solo en `127.0.0.1:3000`. Para comprobar que está vivo:

```bash
curl http://127.0.0.1:3000/health
```

Las rutas bajo `/api` exigen el header `X-Api-Key` con el valor de `INTERNAL_API_KEY`:

```bash
curl -H "X-Api-Key: $INTERNAL_API_KEY" http://127.0.0.1:3000/api/context
```

## Comandos

```bash
npm run dev     # servidor con recarga automática
npm start       # servidor en modo normal
npm test        # pruebas unitarias y de integración
```

## Estructura

```text
src/
├── server.js           # arranque y apagado ordenado
├── app.js              # app Express (sin listen)
├── config.js           # validación de variables de entorno
├── middleware/
│   ├── auth.js         # X-Api-Key para /api
│   └── errorHandler.js # 404 y envelope de errores
└── ...
tests/
├── unit/
└── integration/
```

No se versionan `.env`, `node_modules/` ni `data/`.
