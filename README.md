# Finanzas Bot

Gestor de finanzas personales por Telegram. Le escribes al bot en lenguaje natural ("gasté 45.000 en una cena", "¿cuánto me queda?"); un modelo de IA interpreta el mensaje y llama funciones del backend; el backend es el único que lee y escribe en SQLite y hace todos los cálculos.

La especificación completa está en [`AGENTS.md`](AGENTS.md) y el avance por fases en [`docs/PROGRESO.md`](docs/PROGRESO.md).

**Estado:** v1 completa (API, cierres mensuales, ahorro, avisos de límite, IA y bot). Falta probarla con un token real de Telegram y el modelo definitivo.

## Qué puedes hacer desde Telegram

| Escribe algo como… | Qué pasa |
|---|---|
| "Mi salario es 3.500.000 y me pagan el día 1" | Configura el salario (te pide confirmación). |
| "El arriendo es 900.000 y se paga el 1" | Crea un gasto fijo y su factura pendiente del mes. |
| "Pagué el arriendo" | Busca la factura, te pide confirmación y la marca pagada. |
| "Gasté 45.000 en una cena" | Registra un gasto extra (categoría comida). |
| "Me pagaron 500.000 por una venta" | Registra un ingreso extra. |
| "¿Cuánto me queda este mes?" | Saldo: salario + ingresos − fijos pagados − gastos extras. |
| "¿Qué facturas tengo pendientes?" | Lista facturas del mes y cuáles están vencidas. |
| "Gastos de hoy y de los últimos 3 días" | Gastos por día con subtotales. |
| "Gastos por categoría" / "de mayor a menor" | Totales con porcentajes / listado por monto. |
| "Pon mi límite mensual en 600.000" | Límite de gastos extras; te avisa al 80 % y al 100 %. |
| "¿Cuánto llevo ahorrado?" | Ahorro general acumulado por los cierres. |
| "Borra el gasto del taxi" | Lo busca, te pide confirmación y lo elimina. |

Categorías de gastos extras: `salidas`, `comida`, `transporte`, `emergencias`, `lujo` (opcional).

Cada mes, al llegar el día de pago del salario siguiente (00:05, hora de Bogotá), el bot cierra el mes: guarda el resumen, suma el sobrante al ahorro, crea las facturas del mes nuevo y te envía el reporte. Los meses cerrados ya no se pueden modificar.

Comandos: `/start` y `/ayuda`.

## Requisitos

- Node.js 24 o superior (probado con Node 26).
- Un bot de Telegram (token de [@BotFather](https://t.me/BotFather)) y tu ID numérico de Telegram.
- Un proveedor de IA con API compatible con OpenAI (*chat completions* con *tools*).

## Puesta en marcha

```bash
cp .env.example .env
# editar .env: INTERNAL_API_KEY, TELEGRAM_BOT_TOKEN, ALLOWED_TELEGRAM_USER_IDS,
#              AI_BASE_URL, AI_API_KEY, AI_MODEL
npm install
npm run migrate
npm run dev
```

Si faltan `TELEGRAM_BOT_TOKEN`, `ALLOWED_TELEGRAM_USER_IDS` o `AI_MODEL`, el proceso corre solo la API y lo indica en el log.

La API escucha solo en `127.0.0.1:3000`:

```bash
curl http://127.0.0.1:3000/health
curl -H "X-Api-Key: $INTERNAL_API_KEY" http://127.0.0.1:3000/api/context
curl -H "X-Api-Key: $INTERNAL_API_KEY" http://127.0.0.1:3000/api/balance
```

## Comandos

```bash
npm run dev            # servidor + bot con recarga automática
npm start              # servidor + bot
npm test               # pruebas unitarias, de integración y e2e
npm run migrate        # aplica migraciones pendientes
npm run seed           # datos de ejemplo (solo desarrollo)
npm run closure:run    # cierra los meses vencidos (-- --dry-run para simular)
npm run backup         # copia en data/backups con retención de 30 días
```

## Producción

En `deploy/` hay unidades systemd de usuario para el servicio y para un backup diario:

```bash
mkdir -p ~/.config/systemd/user
cp deploy/finanzas-bot.service deploy/finanzas-backup.* ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now finanzas-bot finanzas-backup.timer
journalctl --user -u finanzas-bot -f
```

**Restaurar un backup:** detener el servicio, copiar `data/backups/finanzas-<fecha>.db` sobre el archivo de `DB_PATH` (borrando los `-wal` y `-shm` viejos) y volver a arrancar.

## Estructura

```text
src/
├── server.js        # arranque: migraciones, cierres, API, bot y job diario
├── app.js           # app Express (sin listen, testeable)
├── config.js        # variables de entorno validadas
├── scheduler.js     # job 00:05 America/Bogota
├── db/              # conexión, migraciones, transacciones
├── domain/          # dinero, fechas, categorías, cierre (funciones puras)
├── repositories/    # SQL parametrizado
├── services/        # reglas de negocio
├── routes/          # contrato HTTP
├── middleware/      # auth, errores, contexto, idempotencia, rate limit
├── ai/              # herramientas, prompt, orquestador, cliente HTTP
└── telegram/        # bot, historial, rate limit, entrega de avisos
tests/               # unit, integration, e2e (reloj inyectado, IA falsa)
```

No se versionan `.env`, `node_modules/` ni `data/`.
