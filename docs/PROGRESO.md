# Progreso y plan de implementación — Finanzas Bot

Bitácora de trabajo y ruta paso a paso. Cualquier agente que retome el proyecto debe leer primero [`AGENTS.md`](../AGENTS.md) y después este archivo.

- **Última actualización:** 2026-11-24
- **Fase actual:** 0–11 completadas (v1)
- **Siguiente paso:** prueba manual con token real de Telegram y proveedor de IA; confirmar las decisiones abiertas. Fase 12 opcional.
- **Código existente:** API completa, cierres, outbox, herramientas de IA, orquestador, bot de Telegram, scheduler, backups y 82 tests

---

## Estado actual

| Aspecto | Estado |
|---|---|
| Documentación maestra | ✅ `AGENTS.md` |
| Plan y bitácora | ✅ este archivo |
| Repositorio git | ✅ inicializado, rama `main` |
| Código | ✅ Fases 1–11 |
| Migraciones | ✅ `001_init.sql`, `002_idempotency.sql` |
| API | ✅ todos los endpoints de `AGENTS.md` §9 |
| IA | ✅ 19 herramientas, orquestador probado con servidor falso; 🟡 falta probar con el proveedor real |
| Bot de Telegram | ✅ grammY, lista blanca, outbox; 🟡 falta prueba manual con token real |
| Operación | ✅ scheduler 00:05, backup + restauración, systemd de ejemplo |
| Decisiones abiertas | ⬜ 6 puntos en `AGENTS.md` §17 |

---

## Cómo retomar en una sesión nueva

1. Leer `AGENTS.md` completo (reglas, modelo de datos, API) y la sección **Estado actual** de este archivo.
2. Revisar `git log --oneline -10` y `git status` para ver el último avance real.
3. Confirmar que las **decisiones abiertas** (`AGENTS.md` §17) siguen iguales o si el usuario cambió alguna.
4. Ejecutar `npm test` (cuando exista `package.json`) antes de tocar código; si falla, arreglar eso primero.
5. Implementar **solo la fase marcada como siguiente**, sin adelantar fases ni refactorizar de más.
6. Al terminar: actualizar checkboxes, tabla de estado, bitácora y la fecha; correr tests; hacer commit.
7. Si cambia una regla de negocio: actualizar `AGENTS.md` (RN/D) antes o junto con el código, y anotarlo en la bitácora.

### Reglas del proceso

- Una fase por sesión salvo que el usuario pida otra cosa.
- Nada de secretos, bases de datos ni `.env` en git.
- Cada fase termina con tests verdes y un commit convencional (`feat:`, `fix:`, `docs:`, `test:`).
- No se cambia el contrato de la API sin actualizar `AGENTS.md` §9 y la tabla de herramientas (§10.3).
- Las cifras de dinero se prueban con centavos explícitos; nunca con decimales flotantes.
- El reloj se inyecta en tests; no se usa la fecha real del sistema para reglas de cierre.

### Criterios globales de terminado

- [x] Tests unitarios, integración y e2e verdes (`npm test`, 82 tests).
- [x] Documentación actualizada (reglas, endpoints, herramientas).
- [x] Sin `console.log` de depuración ni secretos (los scripts de CLI usan `console` para su salida).
- [x] Commit hecho y bitácora actualizada.

---

## Fases

### Fase 0 — Documentación y decisiones ✅ (2026-11-24)

- [x] Escribir `AGENTS.md` con arquitectura, modelo de datos, reglas y API.
- [x] Crear este plan con fases, criterios y bitácora.
- [x] Inicializar repositorio git y commit inicial.
- [ ] Confirmar con el usuario los 6 puntos de `AGENTS.md` §17 (puede hacerse durante la Fase 1).

**Criterio de aceptación:** los documentos describen todo lo que la app debe hacer y cómo se implementará, sin contradicciones internas.

---

### Fase 1 — Esqueleto del backend ✅ (2026-11-24)

- [x] `package.json` con ESM, `engines.node >= 24` y scripts base: `dev`, `start`, `test`, `test:watch`. Los scripts de datos (`migrate`, `seed`, `closure:run`, `backup`) se agregan en su fase.
- [x] Dependencias: `express@5`, `zod`, `dayjs`, `dotenv`, `pino`, `pino-http`; desarrollo: `supertest`.
- [x] `.gitignore` (node_modules, .env, data, coverage) y `.env.example` con todas las variables de `AGENTS.md` §11.
- [x] `.env` local generado con una API key aleatoria; no se versiona.
- [x] `src/config.js`: validación con zod, defaults, parseo de IDs de Telegram y error claro si falta `INTERNAL_API_KEY`.
- [x] `src/app.js`: Express con `request_id`, logs pino, JSON, `GET /health`, 404 y manejador de errores central.
- [x] `src/middleware/auth.js`: `X-Api-Key` con comparación de tiempo constante para `/api`.
- [x] `src/middleware/errorHandler.js`: envelope de errores y 400 para JSON inválido.
- [x] `src/server.js`: `listen` en `HOST`/`PORT` y apagado ordenado por `SIGINT`/`SIGTERM`.
- [x] Logs sin `x-api-key`, `authorization` ni `cookie` (probado).
- [x] `tests/unit/config.test.js` y `tests/integration/health.test.js` (13 tests).
- [x] `README.md` mínimo: instalar, configurar `.env`, correr y probar.

**Criterio de aceptación:** `npm run dev` levanta el servidor; `GET http://127.0.0.1:3000/health` responde 200; `/api` sin key responde 401 y con key responde 404; `npm test` pasa; sin `INTERNAL_API_KEY` el arranque falla con un mensaje entendible.

---

### Fase 2 — Base de datos y migraciones ✅ (2026-11-24)

- [x] `src/db/connection.js`: abre SQLite, crea el directorio de datos, aplica `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.
- [x] `src/db/migrate.js`: runner con tabla `schema_migrations`, transaccional, idempotente.
- [x] `src/db/migrations/001_init.sql`: esquema completo de `AGENTS.md` §7 (13 tablas, CHECK, FKs, índices).
- [x] `src/db/transaction.js`: helper `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`.
- [x] `scripts/seed.js` (implementado sobre los servicios para que genere facturas y periodos igual que la app): usuario de desarrollo, salario $3.500.000 día 1, arriendo $900.000 día 1, crédito $200.000 día 10, límite $600.000 y 2 gastos extras de ejemplo.
- [x] Tests: migrar dos veces no falla; existen las tablas; FKs activas; seed reproducible.

**Criterio de aceptación:** base nueva creada desde cero con `npm run migrate`, seed cargado, y una segunda ejecución no duplica ni rompe nada.

---

### Fase 3 — Dominio: dinero, fechas, periodos y categorías ✅ (2026-11-24)

- [x] `src/domain/money.js`: `parseCop`, `formatCop`, `assertAmount`, máximo `1_000_000_000_000` centavos.
- [x] `src/domain/dates.js`: `todayInTz`, `periodOf`, `periodRange`, `clampDay`, `salaryDateForPeriod`, `nextSalaryDate`, `addDays`, `previousPeriod`, `nextPeriod`.
- [x] `src/domain/categories.js`: lista válida, etiquetas en español, `sin_categoria`.
- [x] Tests de tablas de casos del §8.1: `"900.000"`, `"900000"`, `"$ 1.250.500"`, `"900.000,50"`, `"900000.50"`, ceros, negativos, exceso.
- [x] Tests de fechas: 31 en febrero, 29 en bisiesto, 31 en abril, cambio de año, 23:59 en Bogotá.

**Criterio de aceptación:** funciones puras sin I/O, cobertura de los casos límite y ningún `Float` en el manejo de dinero.

---

### Fase 4 — Salario e ingresos extras ✅ (2026-11-24)

- [x] Repositorios: `salary.repository.js`, `incomes.repository.js`.
- [x] Servicio de salario: historial con `effective_from`, vigente, próxima fecha de pago.
- [x] Servicio de ingresos: crear, listar por periodo, editar, eliminar, fecha por defecto hoy, guard de periodo cerrado.
- [x] Rutas `GET/PUT /api/salary`, `GET /api/salary/history`, `GET/POST /api/incomes`, `PATCH/DELETE /api/incomes/{id}`.
- [x] Validación zod y errores en español con códigos de `AGENTS.md` §9.
- [x] Tests de integración de cada endpoint y del historial.

**Criterio de aceptación:** se puede configurar el salario, cambiarlo sin alterar cierres previos y gestionar ingresos del periodo activo; los cerrados responden 409.

---

### Fase 5 — Gastos fijos e instancias mensuales ✅ (2026-11-24)

- [x] `ensurePeriod(period)`: crea `periods` (snapshot del límite) y las instancias pendientes de plantillas activas.
- [x] CRUD de plantillas: crear (con instancia del periodo activo), editar (propagación solo a pendientes), eliminar (borra pendientes, conserva pagadas con `fixed_expense_id = NULL`).
- [x] Listado de instancias con filtro `status` y campo calculado `overdue`.
- [x] `POST /api/fixed-expenses/instances/{id}/pay`: transaccional, `ALREADY_PAID` si ya estaba pagada.
- [x] Tests: generación por periodo, clamp del día 31, propagación de edición, borrado, pago y doble pago.

**Criterio de aceptación:** las facturas aparecen pendientes cada mes, el pago descuenta del saldo y el estado no se filtra entre meses.

---

### Fase 6 — Gastos extras y límite mensual ✅ (2026-11-24)

- [x] CRUD de gastos extras: categoría opcional, fecha por defecto hoy, rechazo de fechas futuras, guard de periodo cerrado.
- [x] Límite: `settings.monthly_limit_cents`, snapshot en `periods.limit_cents`, actualización del periodo activo.
- [x] Cálculo de umbrales con `Math.ceil` (80 % y 100 %) y evaluación tras crear/editar/eliminar.
- [x] Outbox `notifications` + marcas `alert_80_at` / `alert_100_at`; un aviso por umbral y periodo.
- [x] Recalculo al cambiar el límite (limpiar marcas si el acumulado baja; encolar si sube).
- [x] Rutas `GET /api/limits/current`, `PUT /api/limits/monthly`, `GET /api/notifications/pending`, `POST /api/notifications/{id}/ack`.
- [x] Tests: 79,9 %, 80 %, 100 %, 101 %, un solo aviso, borrado, cambio de límite.

**Criterio de aceptación:** con límite $600.000 se emite un aviso exactamente al llegar a $480.000 y otro al llegar a $600.000, sin repetirlos.

---

### Fase 7 — Saldo y consultas ✅ (2026-11-24)

- [x] `GET /api/balance` con desglose, saldo y valores formateados (§9.7).
- [x] `GET /api/expenses/recent`, `/by-day?days=3`, `/by-category`, y listado con `sort`/`order`/filtros/paginación.
- [x] Totales por día y por categoría calculados en SQL, porcentajes en el servicio.
- [x] Tests de cada consulta, incluidos periodos vacíos y lectura de periodos cerrados.

**Criterio de aceptación:** las seis consultas del requisito devuelven datos correctos y formato COP; el saldo coincide con la fórmula RN-10.

---

### Fase 8 — Cierre mensual, ahorro y facturas del nuevo mes ✅ (2026-11-24)

- [x] `src/domain/closure.js`: cálculo puro (totales, ranking de categorías, ahorro, déficit) con tests.
- [x] Servicio de cierre transaccional según §8.6; `UNIQUE (user_id, period)` como idempotencia.
- [x] `ensureClosures()` al inicio de cada request y job diario a las 00:05 America/Bogota.
- [x] Ahorro general: fila inicial, abono y movimiento por cierre.
- [x] Creación del periodo `M+1` y de sus facturas pendientes.
- [x] Notificación `cierre_mensual` con texto redactado por el backend.
- [x] Rutas `GET /api/closures`, `/latest`, `/{period}`, `POST /api/closures/run` con `dry_run`.
- [x] Tests: cierre normal, doble ejecución, concurrencia, diciembre→enero, febrero con día 31, saldo negativo, sin gastos, una sola categoría.

**Criterio de aceptación:** cerrar un mes guarda un único resumen, suma el sobrante una sola vez, deja las facturas nuevas pendientes y no altera meses anteriores.

---

### Fase 9 — Contrato de herramientas para la IA ✅ (2026-11-24)

- [x] `src/ai/tools.js`: nombre, descripción, esquema zod y ejecutor de cada herramienta de §10.3.
- [x] Traducción de argumentos en español al contrato de la API; cliente HTTP con `X-Api-Key`, timeout de 10 s y recorte de listas.
- [x] Errores de validación devueltos como resultado de herramienta, sin ejecutar la escritura.
- [x] Tests: matriz herramienta → endpoint (fetch simulado), argumentos inválidos, error del backend.

**Criterio de aceptación:** todas las herramientas del catálogo funcionan contra la API real y ninguna toca SQLite directamente.

---

### Fase 10 — Bot de Telegram y orquestador de IA ✅ (2026-11-24; falta la prueba manual con token real)

- [x] grammY con long polling; lista blanca `ALLOWED_TELEGRAM_USER_IDS`; rate limit y longitud máxima.
- [x] Buffer de 20 mensajes por chat (en memoria) y prompt de sistema de §10.4 con fecha/hora de Bogotá.
- [x] Bucle de `tool_calls` (máx. 6 rondas, timeout 30 s) y respuesta final en español.
- [x] Entrega de notificaciones pendientes al terminar cada turno y al arrancar.
- [x] Comandos mínimos: `/start`, `/ayuda`.
- [x] Tests con servidor de IA falso que emite `tool_calls`.
- [ ] Prueba manual con token real de Telegram y el modelo definitivo (requiere `TELEGRAM_BOT_TOKEN`, `ALLOWED_TELEGRAM_USER_IDS` y `AI_MODEL`).
- [x] `README.md` de uso para el usuario final.

**Criterio de aceptación:** desde Telegram se registra un gasto, se paga una factura y se consulta el saldo; los avisos de límite llegan sin que el modelo los redacte.

---

### Fase 11 — Endurecimiento y operación ✅ (2026-11-24)

- [x] Idempotencia de escrituras con header `Idempotency-Key` (tabla `idempotency_keys`, ventana de 24 h).
- [x] `scripts/backup.js` con `VACUUM INTO` y retención de 30 días; prueba de restauración documentada.
- [x] Unidad systemd de ejemplo y variables de entorno.
- [x] Logs estructurados con `request_id`, sin datos sensibles; alerta al dueño ante errores 500.
- [x] Límites de tasa y validación de tamaños en la API.
- [x] Revisión de seguridad: permisos del archivo DB, `.env`, superficie expuesta.

**Criterio de aceptación:** backup y restauración verificados; un reinicio no pierde cierres ni duplica avisos; la API no es accesible desde fuera de la máquina.

---

### Fase 12 — Opcional: correcciones después del cierre

- [ ] Reabrir un periodo cerrado con auditoría y recálculo del cierre y del ahorro (movimiento de ajuste).
- [ ] Anular el pago de una factura (`unpay`).
- [ ] Exportar movimientos y cierres a CSV.
- [ ] Tests de recálculo y de integridad del ahorro.

**Criterio de aceptación:** corregir un mes cerrado deja rastro, mantiene la suma del ahorro coherente y no duplica resúmenes.

---

## Bitácora de sesiones

| # | Fecha | Sesión | Cambios | Siguiente |
|---|---|---|---|---|
| 001 | 2026-11-24 | Inicial | `AGENTS.md` con arquitectura, modelo de datos, reglas y API; `docs/PROGRESO.md` con fases; repositorio git inicializado. | Fase 1 — esqueleto del backend |
| 002 | 2026-11-24 | Fase 1 | `.env` y `.env.example`; config validada con zod; Express con `/health`, request id, logs pino sin credenciales; auth `X-Api-Key`; manejo de errores; 13 tests; README. | Fase 2 — base de datos y migraciones |

| 003 | 2026-11-24 | Fases 2–11 | A pedido del usuario se completaron todas las fases en una sesión. Base SQLite (WAL, migraciones, transacciones anidadas con savepoints); dominio puro (dinero, fechas, cierre); API completa; avisos de límite por outbox; cierres idempotentes con `ensureClosures` por request y job 00:05; herramientas de IA (19) con cliente HTTP; orquestador con máx. 6 rondas; bot grammY con lista blanca, rate limit, historial y entrega de notificaciones; `Idempotency-Key`; rate limit de API; aviso de 500 al dueño; backup `VACUUM INTO` con retención; systemd de ejemplo. Decisiones tomadas sin cambiar reglas: usuario único "dueño"; `pay_day` omitido conserva el vigente; `sin_categoria` participa en mayor/menor; meses viejos sin fila cuentan como cerrados; herramienta `consultar_gastos` admite `categoria`. 82 tests. | Prueba manual con Telegram y modelo real; confirmar §17; Fase 12 opcional |

| 004 | 2026-11-24 | Proveedor de IA | El usuario decide usar DeepSeek (`https://api.deepseek.com/v1`, `deepseek-chat`) por el momento; “GPT Luna 6” queda registrado como modelo previsto. `.env` configurado (la clave la pone el usuario); `.env.example`, `AGENTS.md` §10.1/§17 actualizados. | Poner `AI_API_KEY`, `TELEGRAM_BOT_TOKEN` y `ALLOWED_TELEGRAM_USER_IDS` y hacer la prueba manual |

> Al cerrar una sesión, agregar una fila con lo hecho, lo que quedó a medias y el siguiente paso exacto.

---

## Decisiones pendientes de confirmar

Están detalladas en `AGENTS.md` §17. Resumen:

1. Modelo: previsto “GPT Luna 6” (ID de API pendiente); por ahora DeepSeek `deepseek-chat`.
2. Corrección de periodos cerrados (hoy bloqueada).
3. Saldo devengado vs. saldo disponible antes del día de pago.
4. Si el déficit debe descontarse del ahorro.
5. Confirmación adicional para gastos grandes.
6. Día de pago 29–31 ajustado al último día del mes.

---

## Comandos

```bash
npm install
npm run migrate
npm run seed
npm run dev
npm start
npm test
npm run test:watch
npm run closure:run   # -- --dry-run para simular
npm run backup        # -- <directorio> para otro destino
```

---

## Riesgos y notas técnicas

- **Token de Telegram y clave de IA:** sin ellos el proceso corre solo la API (lo avisa en el log). Los tests usan dobles: servidor de IA falso y bot falso.
- **`node:sqlite`:** API síncrona (`DatabaseSync`). Mantener las consultas cortas y dentro de servicios; no usarla desde las rutas.
- **Zona horaria:** Bogotá no tiene horario de verano, lo que simplifica los cálculos; aun así, todas las fechas pasan por `domain/dates.js`.
- **Centavos:** es fácil equivocarse por factor 100; los tests usan valores explícitos y los fixtures documentan el monto en pesos al lado.
- **Cierres:** dependen del reloj; probar con reloj inyectado y no con `new Date()` disperso.
- **Crecimiento:** el volumen esperado es mínimo (una persona); SQLite sobra. Si se separa el bot, la API ya está aislada por HTTP.
- **Datos reales:** antes de usar la app con dinero real, completar Fase 11 (backup y restauración).
