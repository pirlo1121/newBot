# AGENTS.md — Finanzas Bot (Telegram + IA + Express/SQLite)

Documento maestro de la aplicación. Es la fuente de verdad para cualquier persona o agente que trabaje en el repositorio. El plan de implementación y la bitácora de sesiones están en [`docs/PROGRESO.md`](docs/PROGRESO.md).

- **Última actualización:** 2026-11-24
- **Estado:** Fase 1 completada (esqueleto del backend). Siguiente: Fase 2 (base de datos y migraciones).
- **Idioma del producto:** español (Colombia), moneda COP.

---

## 1. Resumen

Aplicación personal para gestionar dinero. El usuario conversa por Telegram con un bot; el bot delega la interpretación en un modelo de IA con *function calling*; el modelo invoca funciones del backend; el backend es el único componente que lee y escribe en SQLite. El modelo nunca ve la base de datos ni calcula cifras: recibe resultados ya calculados y redacta la respuesta.

El objetivo de diseño es que registrar un gasto o consultar el saldo tome un mensaje, sin formularios ni pantallas.

### Principios no negociables

1. **La IA no toca la base de datos.** Solo llama endpoints HTTP del backend con una API key interna.
2. **El backend calcula todo.** Totales, saldos, porcentajes de límite, ahorro y cierres salen del backend ya formateados. El modelo no suma ni resta.
3. **El dinero se guarda en enteros.** Nunca `REAL`/`FLOAT`. Se almacena en centavos de COP (`amount_cents`) y se formatea al mostrar.
4. **Los cierres son idempotentes y transaccionales.** Ejecutar el cierre dos veces no duplica ahorro ni resúmenes.
5. **Toda escritura valida el periodo.** No se crean ni modifican movimientos en periodos cerrados.
6. **Los secretos viven en `.env`.** Nunca en el repositorio ni en la base de datos.

---

## 2. Alcance

### 2.1 Incluido en la v1

- **Salario mensual** configurable (monto y día de pago; por defecto día 1) con historial de cambios.
- **Ingresos extras** (ventas, negocios, otros) con descripción, monto y fecha.
- **Gastos fijos** recurrentes (nombre, monto, día de pago mensual) con estado pagado/pendiente **por mes**.
- **Gastos extras** (nombre, monto, categoría opcional, fecha) con categorías `salidas`, `comida`, `transporte`, `emergencias`, `lujo`; sin categoría cuando se omite.
- **Límite mensual de gastos extras** con avisos al 80 % y al 100 % (una sola vez por umbral y por mes).
- **Saldo del periodo:** `(salario + ingresos extras) − gastos fijos pagados − gastos extras`.
- **Consultas:** saldo, últimos gastos, gastos de hoy y de los últimos tres días, gastos por categoría, facturas pendientes y pagadas, gastos extras ordenados de mayor a menor.
- **Cierre mensual automático** al llegar la fecha de pago del siguiente salario: resumen guardado, desglose por categoría, categoría mayor y menor, monto ahorrado.
- **Ahorro general único** (sin metas individuales): el sobrante del cierre se suma automáticamente.
- **Facturas del nuevo mes** generadas como pendientes.
- **Edición y eliminación** de gastos fijos, gastos extras e ingresos extras.
- **Bot de Telegram** con lista blanca de usuarios y notificaciones salientes (límite y cierre).

### 2.2 Fuera de alcance en la v1

- Metas de ahorro individuales o múltiples cuentas de ahorro.
- Multiusuario real (la base soporta varias filas en `users`, pero el producto es de un solo usuario).
- Multimoneda, inversiones, deudas con intereses, presupuestos por categoría.
- Interfaz web o app móvil. La única interfaz es Telegram.
- Sincronización con bancos.
- Corrección o reapertura de periodos ya cerrados (ver decisión D-05; queda como fase opcional).

---

## 3. Arquitectura

```text
Usuario
  │  mensaje en lenguaje natural
  ▼
Bot de Telegram (grammY, long polling)
  │  historial corto + contexto (fecha/hora Bogotá)
  ▼
Orquestador de IA (API compatible con OpenAI, modelo configurable)
  │  tool_calls
  ▼
Cliente HTTP interno  ──►  API Express (127.0.0.1:3000, X-Api-Key)
                               │
                               ├── Rutas + validación (zod)
                               ├── Servicios de dominio
                               ├── Repositorios (SQL parametrizado)
                               └── node:sqlite  ──►  data/finanzas.db
                                         ▲
Scheduler diario 00:05 (America/Bogota) ─┘  cierres y generación de facturas
Outbox de notificaciones  ──►  el bot las envía a Telegram
```

### Componentes

| Componente | Responsabilidad |
|---|---|
| `src/telegram/` | Recibir updates, validar usuario permitido, mantener historial corto, enviar respuestas y notificaciones. |
| `src/ai/` | Prompt de sistema, definición de herramientas, bucle de *function calling*, límite de iteraciones y timeouts. |
| `src/routes/` | Contrato HTTP: validación de entrada, códigos de estado, envelope de respuesta. |
| `src/services/` | Reglas de negocio y transacciones (salario, gastos, límite, saldo, cierre, ahorro). |
| `src/domain/` | Funciones puras: dinero, fechas/periodos, categorías, cálculo de cierre. Sin I/O. |
| `src/repositories/` | SQL y mapeo fila → objeto. Único lugar con `SELECT`/`INSERT`/`UPDATE`. |
| `src/db/` | Conexión, PRAGMAs, runner de migraciones, helper de transacción. |
| `scripts/` | `seed`, ejecución manual de cierres, backups. |

### Por qué HTTP interno y no llamadas directas

El requisito es que la IA ejecute “funciones del backend” sin tocar la base de datos. Usar HTTP sobre loopback hace explícita esa frontera, permite probar cada función con `curl`, y deja la puerta abierta a separar el bot del backend sin reescribir nada. El costo es ~1 ms por llamada en local, irrelevante para un bot conversacional.

### Proceso único

En v1, backend, bot y scheduler corren en el mismo proceso de Node (`src/server.js` arranca Express, el bot y el job diario). La API escucha solo en `127.0.0.1`. Si más adelante se separan, no cambia el contrato.

---

## 4. Flujo de una conversación

1. Llega un update de Telegram. Si el `telegram_user_id` no está en `ALLOWED_TELEGRAM_USER_IDS`, se ignora y se registra el intento.
2. El bot arma el contexto: fecha/hora actual en `America/Bogota`, últimos turnos del chat (buffer en memoria, 20 mensajes) y pregunta del usuario.
3. El orquestador llama al modelo con el prompt de sistema y el catálogo de herramientas.
4. El modelo responde con uno o varios `tool_calls`. El orquestador valida argumentos con zod y ejecuta el endpoint correspondiente con `X-Api-Key`.
5. El backend valida, aplica reglas de negocio, escribe en SQLite en una transacción y devuelve JSON con totales ya formateados.
6. El resultado vuelve al modelo, que puede pedir más herramientas (máximo 6 rondas). Al terminar, redacta la respuesta final en español.
7. El bot envía la respuesta y, después, las notificaciones pendientes de la outbox (límite alcanzado, cierre mensual). Esas notificaciones las redacta el backend, no el modelo, para garantizar su entrega.

Ejemplo:

```text
Usuario: pagué el arriendo
IA → consultar_facturas({ estado: "pendientes" })
     ← [{ id: 12, nombre: "Arriendo", monto: "$900.000", vence: "2026-11-01" }]
IA → pagar_factura({ factura_id: 12 })
     ← { pagado: true, saldo: "$2.450.000", ... }
IA: Listo, registré el pago del arriendo por $900.000. Tu saldo del mes quedó en $2.450.000.
```

---

## 5. Stack

| Pieza | Elección | Notas |
|---|---|---|
| Runtime | Node.js ≥ 24 | El entorno actual tiene Node 26. ESM (`"type": "module"`). |
| HTTP | Express 5 | Manejo nativo de promesas rechazadas. |
| Base de datos | SQLite vía `node:sqlite` (`DatabaseSync`) | Incluido en Node, sin compilación nativa ni dependencias frágiles. WAL activado. |
| Validación | zod | Esquemas de entrada y de argumentos de herramientas. |
| Fechas | dayjs + `utc` + `timezone` | Zona `America/Bogota`; fechas de negocio como `YYYY-MM-DD`. |
| Bot | grammY | Long polling, sin necesidad de URL pública. |
| IA | Cliente HTTP propio a API compatible con OpenAI | `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`. Sin SDK para mantener dependencias mínimas. |
| Logs | pino | JSON, con `request_id`. |
| Tests | `node:test` + `supertest` | Reloj inyectable; base temporal por test. |

---

## 6. Estructura del proyecto

```text
prueba1Finanzas/
├── AGENTS.md
├── README.md                     # uso para el usuario final (Fase 10)
├── docs/
│   └── PROGRESO.md               # plan por fases + bitácora
├── scripts/
│   ├── seed.js
│   ├── run-closure.js
│   └── backup.js
├── src/
│   ├── server.js                 # arranque: API + bot + scheduler
│   ├── app.js                    # app Express (sin listen, testeable)
│   ├── config.js                 # env validado con zod
│   ├── db/
│   │   ├── connection.js
│   │   ├── migrate.js
│   │   ├── transaction.js
│   │   └── migrations/
│   │       └── 001_init.sql
│   ├── domain/
│   │   ├── money.js              # parse/format/validación COP
│   │   ├── dates.js              # hoy, periodos, día de pago, clamp
│   │   ├── categories.js
│   │   └── closure.js            # cálculo puro del cierre
│   ├── repositories/
│   ├── services/
│   ├── routes/
│   ├── middleware/               # auth, requestId, errores
│   ├── telegram/
│   │   ├── bot.js
│   │   └── notifications.js
│   └── ai/
│       ├── orchestrator.js
│       ├── tools.js
│       └── prompt.js
└── tests/
    ├── unit/
    ├── integration/
    └── e2e/
```

---

## 7. Modelo de datos

Convenciones:

- Claves primarias enteras (`INTEGER PRIMARY KEY`), `user_id` en toda tabla de negocio.
- Fechas de negocio: `TEXT 'YYYY-MM-DD'` (hora local de Bogotá). Marcas de tiempo: `TEXT` ISO 8601 UTC (`2026-11-24T14:03:00.000Z`).
- Periodo: `TEXT 'YYYY-MM'` (mes calendario). Se guarda denormalizado en cada movimiento para consultas rápidas.
- Nombres de tablas y columnas en inglés; textos de cara al usuario en español.
- Bajas: plantillas y movimientos se eliminan físicamente, salvo las instancias de gastos fijos ya pagadas (ver RN-05).
- No se usan `ON DELETE CASCADE` desde `users` en producción real, pero se declaran para mantener consistencia en pruebas y borrados de desarrollo.

### Esquema (migración `001_init.sql`)

Los `PRAGMA` se aplican en `src/db/connection.js`, no dentro de la migración: `journal_mode = WAL` no puede ejecutarse dentro de una transacción. El SQL de abajo es el contenido de `001_init.sql`; las dos primeras líneas quedan documentadas como parte de la configuración de la conexión.

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id               INTEGER PRIMARY KEY,
  telegram_user_id INTEGER NOT NULL UNIQUE,
  name             TEXT,
  timezone         TEXT NOT NULL DEFAULT 'America/Bogota',
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE settings (
  user_id             INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  monthly_limit_cents INTEGER CHECK (monthly_limit_cents IS NULL OR monthly_limit_cents > 0),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE salary_history (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents   INTEGER NOT NULL CHECK (amount_cents > 0),
  pay_day        INTEGER NOT NULL CHECK (pay_day BETWEEN 1 AND 31),
  effective_from TEXT NOT NULL,           -- 'YYYY-MM-DD'
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_salary_user_date ON salary_history (user_id, effective_from DESC);

CREATE TABLE periods (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period      TEXT NOT NULL,              -- 'YYYY-MM'
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  limit_cents INTEGER CHECK (limit_cents IS NULL OR limit_cents > 0),  -- snapshot del límite
  alert_80_at  TEXT,
  alert_100_at TEXT,
  closed_at    TEXT,
  UNIQUE (user_id, period)
);

CREATE TABLE fixed_expenses (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  due_day      INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Una fila por factura de un gasto fijo en un mes concreto.
CREATE TABLE fixed_expense_instances (
  id               INTEGER PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fixed_expense_id INTEGER REFERENCES fixed_expenses(id) ON DELETE SET NULL,
  period           TEXT NOT NULL,         -- 'YYYY-MM'
  name             TEXT NOT NULL,         -- snapshot del nombre
  amount_cents     INTEGER NOT NULL CHECK (amount_cents > 0),
  due_date         TEXT NOT NULL,         -- 'YYYY-MM-DD' con clamp de fin de mes
  paid             INTEGER NOT NULL DEFAULT 0 CHECK (paid IN (0, 1)),
  paid_at          TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, fixed_expense_id, period)
);
CREATE INDEX idx_instances_user_period ON fixed_expense_instances (user_id, period, paid);

CREATE TABLE extra_incomes (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description  TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  date         TEXT NOT NULL,             -- 'YYYY-MM-DD'
  period       TEXT NOT NULL,             -- 'YYYY-MM'
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_incomes_user_period ON extra_incomes (user_id, period, date);

CREATE TABLE extra_expenses (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  category     TEXT CHECK (category IS NULL OR category IN
                 ('salidas', 'comida', 'transporte', 'emergencias', 'lujo')),
  date         TEXT NOT NULL,
  period       TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_expenses_user_period_date ON extra_expenses (user_id, period, date DESC);
CREATE INDEX idx_expenses_user_period_category ON extra_expenses (user_id, period, category);

CREATE TABLE period_closures (
  id                 INTEGER PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period             TEXT NOT NULL,
  salary_cents       INTEGER NOT NULL,
  extra_income_cents INTEGER NOT NULL,
  fixed_paid_cents   INTEGER NOT NULL,
  extra_expense_cents INTEGER NOT NULL,
  balance_cents      INTEGER NOT NULL,
  saved_cents        INTEGER NOT NULL CHECK (saved_cents >= 0),
  deficit_cents      INTEGER NOT NULL CHECK (deficit_cents >= 0),
  top_category       TEXT,
  bottom_category    TEXT,
  closed_at          TEXT NOT NULL,
  UNIQUE (user_id, period)
);

CREATE TABLE closure_category_totals (
  closure_id  INTEGER NOT NULL REFERENCES period_closures(id) ON DELETE CASCADE,
  category    TEXT NOT NULL,              -- incluye 'sin_categoria'
  total_cents INTEGER NOT NULL,
  PRIMARY KEY (closure_id, category)
);

CREATE TABLE savings (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  updated_at    TEXT NOT NULL
);

CREATE TABLE savings_movements (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('cierre', 'ajuste')),
  period       TEXT,
  closure_id   INTEGER REFERENCES period_closures(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL
);

-- Outbox: el backend redacta el texto, el bot lo entrega.
CREATE TABLE notifications (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('limite_80', 'limite_100', 'cierre_mensual')),
  period       TEXT,
  payload_json TEXT NOT NULL,
  text         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  delivered_at TEXT
);
CREATE INDEX idx_notifications_pending ON notifications (delivered_at, id);
```

### Notas por tabla

- `salary_history`: no se sobrescribe el salario. Cada cambio inserta una fila con `effective_from`; el salario vigente es la fila más reciente con `effective_from <= hoy`. Los cierres pasados quedan intactos.
- `periods`: existe una fila por mes tocado. El **periodo activo** es siempre el mes calendario de hoy (`YYYY-MM`), exista o no cierre pendiente del mes anterior. `limit_cents` congela el límite con el que se evalúan los avisos de ese mes.
- `fixed_expense_instances`: snapshot de nombre, monto y fecha. Editar la plantilla no altera instancias pagadas. Borrar la plantilla deja las pagadas con `fixed_expense_id = NULL` y elimina las pendientes del periodo abierto. SQLite considera distintos los `NULL`, así que el `UNIQUE` no bloquea las filas históricas desvinculadas.
- `period_closures`: resumen inmutable. `UNIQUE (user_id, period)` es la garantía de idempotencia del cierre.
- `savings` + `savings_movements`: una sola cuenta de ahorro por usuario; el historial explica cada abono.
- `notifications`: outbox confiable. `text` ya viene redactado en español.

---

## 8. Reglas de negocio

| ID | Regla |
|---|---|
| RN-01 | Salario: monto > 0 y día de pago 1–31 (por defecto 1). Si el día no existe en el mes, se usa el último día (31 → 30/28/29). |
| RN-02 | Cambiar el salario inserta historial con `effective_from` (hoy por defecto). No reescribe cierres anteriores. |
| RN-03 | Ingresos extras: descripción, monto > 0 y fecha. Fecha por defecto: hoy. |
| RN-04 | Gastos fijos: plantilla (nombre, monto, día de pago) + una instancia por mes. La instancia nace pendiente. |
| RN-05 | Editar una plantilla actualiza la instancia del periodo activo solo si está pendiente; las pagadas conservan su snapshot. Borrar una plantilla elimina sus instancias pendientes y conserva las pagadas con el nombre/monto históricos. |
| RN-06 | Pagar una factura marca la instancia (`paid = 1`, `paid_at`) y descuenta del saldo del periodo. El mismo mes no se puede pagar dos veces (409 `ALREADY_PAID`). |
| RN-07 | Gastos extras: nombre, monto > 0, categoría opcional (NULL = sin categoría) y fecha (por defecto hoy; no se permiten fechas futuras). |
| RN-08 | Límite mensual: se guarda en `settings` y se copia al periodo al abrirlo. Cambiarlo afecta al periodo activo de inmediato y recalcula los avisos. |
| RN-09 | Avisos de límite: al alcanzar o superar el 80 % y el 100 % del límite se encola **un** aviso por umbral y por periodo. Si en una sola operación se cruzan ambos, solo se envía el del 100 % (el del 80 % queda marcado como enviado). |
| RN-10 | Saldo del periodo = `salario + ingresos extras − gastos fijos pagados − gastos extras`. Los gastos fijos pendientes no descuentan. Puede ser negativo. |
| RN-11 | Periodo = mes calendario. El periodo activo es el mes de hoy. Los periodos anteriores siguen abiertos hasta que llega el disparador del cierre. |
| RN-12 | Cierre del periodo `M`: se ejecuta cuando llega la fecha de pago del salario de `M+1` (calculada con el salario vigente). Es idempotente y se ejecuta en una sola transacción. |
| RN-13 | El cierre guarda: salario, ingresos extras, gastos fijos pagados, gastos extras, desglose por categoría (incluye `sin_categoria`), categoría mayor y menor, saldo y ahorro. |
| RN-14 | Ahorro: `saved_cents = max(saldo, 0)` y se suma al ahorro general. Si el saldo es negativo, `deficit_cents = −saldo` y el ahorro no se toca. |
| RN-15 | Categoría mayor/menor: orden por total descendente y nombre ascendente como desempate. Con una sola categoría, `bottom_category = NULL`. Sin gastos, ambas `NULL`. |
| RN-16 | Tras cerrar `M` se crea el periodo `M+1` (si no existe), se generan sus facturas pendientes y se toma el límite vigente. |
| RN-17 | Los periodos cerrados son de solo lectura: no se crean, editan ni eliminan movimientos con fecha en ellos (409 `PERIOD_CLOSED`). |
| RN-18 | Fechas y horas de negocio en `America/Bogota`. Un gasto de las 23:30 del 30 de noviembre pertenece a noviembre. |
| RN-19 | Dinero: enteros en centavos, máximo `1_000_000_000_000` centavos ($10.000 millones). Formato de presentación `es-CO`, sin decimales. |
| RN-20 | Toda escritura monetaria es transaccional y valida el periodo antes de insertar. |

### 8.1 Dinero

Se almacena en centavos para evitar errores de coma flotante y permitir futuros decimales. La API acepta `amount_cents` (entero, uso interno y tests) o `amount` (texto/número en pesos, uso humano); si vienen ambos, gana `amount_cents`.

`parseCop('900.000')` → `90000000` centavos. Reglas de parseo:

| Entrada | Interpretación | Centavos |
|---|---|---|
| `"900.000"` | 900 000 pesos (punto de miles) | 90 000 000 |
| `"900000"` | 900 000 pesos | 90 000 000 |
| `"$ 1.250.500"` | 1 250 500 pesos | 125 050 000 |
| `"900.000,50"` | 900 000,50 pesos | 90 000 050 |
| `"900000.50"` | 900 000,50 pesos (punto decimal, no grupo de 3) | 90 000 050 |

Se rechazan negativos, cero, más de dos decimales y valores por encima del máximo. La presentación usa `Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })`; los centavos distintos de cero se muestran solo si existen.

### 8.2 Periodos y cierres

Con día de pago 1 (por defecto):

| Momento | Efecto |
|---|---|
| 2026-11-01 00:05 | Cierra 2026-10, abona el sobrante al ahorro y crea las facturas de noviembre. |
| Durante noviembre | Periodo activo 2026-11. |
| 2026-12-01 00:05 | Cierra 2026-11 y crea las facturas de diciembre. |

Con día de pago 10:

| Momento | Efecto |
|---|---|
| 2026-12-01 | El periodo activo pasa a 2026-12 (mes calendario), pero noviembre sigue abierto y admite correcciones. |
| 2026-12-10 00:05 | Cierra 2026-11, abona ahorro y crea/actualiza las facturas de diciembre. |
| 2027-01-10 | Cierra 2026-12. |

El cierre se dispara con un job diario a las 00:05 de Bogotá **y** con una verificación `ensureClosures()` al inicio de cada request. Así no se pierde un cierre si el proceso estuvo apagado; la verificación procesa todos los periodos vencidos en orden.

### 8.3 Límite y avisos

- El acumulado es la suma de gastos extras del periodo activo (crear, editar y eliminar lo recalculan).
- Umbrales: 80 % y 100 % del `limit_cents` del periodo, redondeados hacia arriba al centavo (`Math.ceil`).
  Ejemplo con límite $600.000: 80 % = $480.000; 100 % = $600.000.
- Solo se avisa una vez por umbral. Bajar el acumulado (edición/borrado) no rearma el aviso.
- Cambiar el límite recalcula: si el nuevo límite deja el acumulado por debajo de un umbral ya avisado, se limpia la marca para permitir un aviso futuro; si lo deja por encima de un umbral no avisado, se encola.
- El aviso se entrega por la outbox, no depende de que el modelo lo mencione.

### 8.4 Saldo

`GET /api/balance` devuelve el desglose completo y los valores formateados. El saldo es **devengado del periodo**: incluye el salario del mes aunque el día de pago aún no haya llegado, porque el periodo ya está abierto (ver D-06). No se descuentan facturas pendientes.

### 8.5 Edición y eliminación

| Recurso | Editar | Eliminar |
|---|---|---|
| Salario | Inserta nueva fila de historial. | No se elimina; se reemplaza con un monto nuevo. |
| Ingreso extra | Mientras su periodo esté abierto. | Mientras su periodo esté abierto. |
| Gasto fijo (plantilla) | Nombre, monto, día. Propaga al periodo activo si la instancia está pendiente. | Borra pendientes; conserva pagadas. |
| Gasto extra | Mientras su periodo esté abierto. | Mientras su periodo esté abierto. |

Toda operación sobre un periodo cerrado responde 409 `PERIOD_CLOSED`.

### 8.6 Cierre: pasos transaccionales

1. Verificar que `M` existe, está abierto y que se cumplió el disparador.
2. Salario vigente para `M` (última fila con `effective_from <= último día de M`); si no hay, `0` y advertencia en el resumen.
3. Sumar ingresos extras de `M`.
4. Sumar instancias pagadas de `M`.
5. Sumar gastos extras de `M` y agrupar por `COALESCE(category, 'sin_categoria')`.
6. Calcular saldo, ahorro y déficit.
7. Insertar `period_closures` + `closure_category_totals`.
8. Sumar a `savings` e insertar `savings_movements` (solo si `saved_cents > 0`).
9. Marcar `periods.status = 'closed'` y `closed_at`.
10. Crear/asegurar `M+1` y sus instancias pendientes.
11. Encolar notificación `cierre_mensual` con el texto del resumen.

Todo dentro de `BEGIN IMMEDIATE … COMMIT`; si algo falla, rollback completo. El `UNIQUE` del cierre evita duplicados ante ejecuciones concurrentes.

### 8.7 Reporte de cierre

El reporte incluye: mes (`noviembre de 2026`), ingresos totales (salario + extras), total de gastos extras, gastos fijos pagados, desglose por categoría con montos y porcentajes, categoría con mayor gasto, categoría con menor gasto, ahorro del mes y saldo acumulado del ahorro general.

---

## 9. API interna

- **Base:** `http://127.0.0.1:3000`
- **Auth:** header `X-Api-Key: <INTERNAL_API_KEY>` en todo `/api/*`. `/health` es público.
- **Formato:** JSON UTF-8. Fechas de negocio `YYYY-MM-DD`; periodos `YYYY-MM`.
- **Paginación:** `limit` (máx. 100, por defecto 20) y `offset`.
- **Periodo por defecto:** el activo (mes calendario de hoy) en todos los listados.
- **Errores:** HTTP 4xx/5xx con código estable.

Envelope:

```json
{ "ok": true, "data": { }, "meta": { "today": "2026-11-24", "period": "2026-11" } }
```

```json
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "El monto debe ser mayor que cero.", "details": [] } }
```

Códigos: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `NOT_FOUND` (404), `PERIOD_CLOSED` (409), `ALREADY_PAID` (409), `CONFLICT` (409), `INTERNAL_ERROR` (500).

### 9.1 Sistema

| Método y URL completa | Descripción |
|---|---|
| `GET http://127.0.0.1:3000/health` | Estado del proceso. Sin auth. La comprobación de la base se agrega en la Fase 2; hoy responde `database: "not_configured"`. |
| `GET http://127.0.0.1:3000/api/context` | Contexto para la IA: hoy, periodo activo, salario vigente y próxima fecha de pago, límite y acumulado, saldo, ahorro, facturas pendientes/vencidas y último cierre. |
| `GET http://127.0.0.1:3000/api/notifications/pending` | Notificaciones sin entregar (máx. 50). |
| `POST http://127.0.0.1:3000/api/notifications/{id}/ack` | Marca una notificación como entregada. |

### 9.2 Salario

| Método y URL completa | Descripción |
|---|---|
| `GET http://127.0.0.1:3000/api/salary` | Salario vigente: monto, día de pago y próxima fecha. |
| `PUT http://127.0.0.1:3000/api/salary` | Crea o actualiza el salario. Body: `{ "amount_cents": 350000000 }` o `{ "amount": "3.500.000", "pay_day": 10 }`; `pay_day` por defecto 1. Inserta historial. |
| `GET http://127.0.0.1:3000/api/salary/history` | Historial de cambios. |

### 9.3 Ingresos extras

| Método y URL completa | Descripción |
|---|---|
| `GET http://127.0.0.1:3000/api/incomes?period=YYYY-MM&limit=20&offset=0` | Lista ingresos; por defecto, periodo activo. |
| `POST http://127.0.0.1:3000/api/incomes` | Body: `{ "description": "Venta de bici", "amount_cents": 50000000, "date": "2026-11-20" }`. `date` por defecto hoy. |
| `PATCH http://127.0.0.1:3000/api/incomes/{id}` | Edita campos enviados. |
| `DELETE http://127.0.0.1:3000/api/incomes/{id}` | Elimina. |

### 9.4 Gastos fijos y facturas

| Método y URL completa | Descripción |
|---|---|
| `GET http://127.0.0.1:3000/api/fixed-expenses` | Lista plantillas activas. |
| `POST http://127.0.0.1:3000/api/fixed-expenses` | Body: `{ "name": "Arriendo", "amount_cents": 90000000, "due_day": 1 }`. Crea la plantilla y la factura del periodo activo. |
| `PATCH http://127.0.0.1:3000/api/fixed-expenses/{id}` | Edita nombre, monto o día. Propaga al periodo activo si está pendiente. |
| `DELETE http://127.0.0.1:3000/api/fixed-expenses/{id}` | Borra pendientes y conserva pagadas. |
| `GET http://127.0.0.1:3000/api/fixed-expenses/instances?period=YYYY-MM&status=pending\|paid\|all` | Facturas del periodo con `due_date`, `paid`, `paid_at` y `overdue` calculado. `status` por defecto `all`. |
| `POST http://127.0.0.1:3000/api/fixed-expenses/instances/{id}/pay` | Confirma el pago. Body opcional: `{ "paid_at": "2026-11-24" }`. |

### 9.5 Gastos extras

| Método y URL completa | Descripción |
|---|---|
| `GET http://127.0.0.1:3000/api/expenses?period=&category=&from=&to=&sort=date\|amount&order=desc&limit=&offset=` | Listado flexible. `sort=amount&order=desc` cumple “de mayor a menor monto”. |
| `POST http://127.0.0.1:3000/api/expenses` | Body: `{ "name": "Cena", "amount_cents": 4500000, "category": "comida", "date": "2026-11-24" }`. Categoría y fecha opcionales. |
| `PATCH http://127.0.0.1:3000/api/expenses/{id}` | Edita campos enviados; recalcula avisos si cambia el monto. |
| `DELETE http://127.0.0.1:3000/api/expenses/{id}` | Elimina; recalcula avisos. |
| `GET http://127.0.0.1:3000/api/expenses/recent?limit=10` | Últimos gastos registrados (fecha y creación descendente). |
| `GET http://127.0.0.1:3000/api/expenses/by-day?days=3` | Hoy y los últimos 3 días (4 días en total), con subtotal por día y total. |
| `GET http://127.0.0.1:3000/api/expenses/by-category?period=YYYY-MM` | Totales y porcentaje por categoría (`sin_categoria` incluida). |

### 9.6 Límite

| Método y URL completa | Descripción |
|---|---|
| `GET http://127.0.0.1:3000/api/limits/current` | Límite del periodo, acumulado, porcentaje, umbrales y avisos ya enviados. |
| `PUT http://127.0.0.1:3000/api/limits/monthly` | Body: `{ "amount_cents": 60000000 }` o `{ "amount": "600.000" }`. Actualiza el límite por defecto y el del periodo activo; recalcula avisos. |

### 9.7 Saldo

| Método y URL completa | Descripción |
|---|---|
| `GET http://127.0.0.1:3000/api/balance?period=YYYY-MM` | Desglose y saldo del periodo. |

Ejemplo de respuesta (`GET http://127.0.0.1:3000/api/balance`):

```json
{
  "ok": true,
  "data": {
    "period": "2026-11",
    "salary_cents": 350000000,
    "extra_income_cents": 50000000,
    "fixed_paid_cents": 110000000,
    "extra_expense_cents": 45000000,
    "balance_cents": 245000000,
    "currency": "COP",
    "formatted": {
      "salary": "$3.500.000",
      "extra_income": "$500.000",
      "fixed_paid": "$1.100.000",
      "extra_expenses": "$450.000",
      "balance": "$2.450.000"
    }
  },
  "meta": { "today": "2026-11-24", "period": "2026-11" }
}
```

### 9.8 Ahorro

| Método y URL completa | Descripción |
|---|---|
| `GET http://127.0.0.1:3000/api/savings` | Saldo del ahorro general y fecha de actualización. |
| `GET http://127.0.0.1:3000/api/savings/movements?limit=20` | Movimientos del ahorro, con periodo y cierre asociado. |

### 9.9 Cierres

| Método y URL completa | Descripción |
|---|---|
| `GET http://127.0.0.1:3000/api/closures?limit=12` | Lista de cierres, recientes primero. |
| `GET http://127.0.0.1:3000/api/closures/latest` | Último cierre con desglose por categoría. |
| `GET http://127.0.0.1:3000/api/closures/{period}` | Cierre de un periodo (`2026-11`). |
| `POST http://127.0.0.1:3000/api/closures/run` | Fuerza la verificación de cierres vencidos. Body opcional: `{ "dry_run": true }`. Uso administrativo y de pruebas. |

---

## 10. Capa de IA

### 10.1 Configuración del proveedor

El usuario mencionó “ChatGPT Luna 6”, que no es un identificador de API verificable. Por eso el modelo es una variable de entorno (`AI_MODEL`) y el cliente habla el formato de *chat completions* compatible con OpenAI (`AI_BASE_URL`, `AI_API_KEY`). Al desplegar se fija el ID real del proveedor; el código no asume ninguno.

### 10.2 Bucle de herramientas

- Máximo 6 rondas de `tool_calls` por mensaje; luego se responde con un mensaje de disculpa y se registra el caso.
- Cada herramienta tiene esquema zod; si los argumentos no validan, se devuelve al modelo el error de validación como resultado de la herramienta (no se ejecuta nada).
- Timeout por llamada al modelo: 30 s. Timeout por llamada al backend: 10 s.
- Los resultados se recortan a 20 elementos por lista (el modelo no necesita más para redactar).
- Si el backend devuelve error, el modelo lo recibe como `{ ok: false, error: {...} }` y debe explicarlo sin inventar éxito.
- Toda respuesta incluye `meta.today` y `meta.period`; el modelo usa esa fecha para resolver “hoy”, “ayer” y “esta semana”, nunca su reloj interno.

### 10.3 Catálogo de herramientas

Los nombres y argumentos van en español para reducir ambigüedad con el usuario; el orquestador los traduce al contrato en inglés de la API.

| Herramienta | Argumentos | Endpoint |
|---|---|---|
| `consultar_contexto` | — | `GET /api/context` |
| `consultar_saldo` | `periodo?` | `GET /api/balance` |
| `configurar_salario` | `monto`, `dia_pago?` | `PUT /api/salary` |
| `registrar_ingreso_extra` | `descripcion`, `monto`, `fecha?` | `POST /api/incomes` |
| `editar_ingreso_extra` | `id`, `descripcion?`, `monto?`, `fecha?` | `PATCH /api/incomes/{id}` |
| `eliminar_ingreso_extra` | `id` | `DELETE /api/incomes/{id}` |
| `crear_gasto_fijo` | `nombre`, `monto`, `dia_pago` | `POST /api/fixed-expenses` |
| `editar_gasto_fijo` | `id`, `nombre?`, `monto?`, `dia_pago?` | `PATCH /api/fixed-expenses/{id}` |
| `eliminar_gasto_fijo` | `id` | `DELETE /api/fixed-expenses/{id}` |
| `consultar_facturas` | `estado` (`pendientes`\|`pagadas`\|`todas`), `periodo?` | `GET /api/fixed-expenses/instances` |
| `pagar_factura` | `factura_id` | `POST /api/fixed-expenses/instances/{id}/pay` |
| `registrar_gasto_extra` | `nombre`, `monto`, `categoria?`, `fecha?` | `POST /api/expenses` |
| `editar_gasto_extra` | `id`, `nombre?`, `monto?`, `categoria?`, `fecha?` | `PATCH /api/expenses/{id}` |
| `eliminar_gasto_extra` | `id` | `DELETE /api/expenses/{id}` |
| `consultar_gastos` | `vista` (`recientes`\|`por_dias`\|`por_categoria`\|`por_monto`), `dias?`, `periodo?`, `limite?` | `GET /api/expenses`, `/recent`, `/by-day`, `/by-category` |
| `definir_limite_mensual` | `monto` | `PUT /api/limits/monthly` |
| `consultar_limite` | — | `GET /api/limits/current` |
| `consultar_ahorro` | — | `GET /api/savings` |
| `consultar_cierre_mensual` | `periodo?` | `GET /api/closures/latest` o `/api/closures/{periodo}` |

### 10.4 Reglas del prompt de sistema

1. Habla en español claro y breve; tutea al usuario.
2. No inventes cifras, fechas, IDs ni resultados. Si falta un dato, pregunta.
3. Usa siempre las herramientas para leer o escribir; no calcules totales ni saldos por tu cuenta.
4. Confirma explícitamente antes de: pagar una factura, eliminar algo, cambiar el salario o cambiar el límite. Una confirmación previa del usuario en el mismo turno es suficiente; si el mensaje es ambiguo, pregunta.
5. Si el monto viene sin formato (`"900"`, `"900 mil"`), pide confirmación del valor interpretado antes de registrar.
6. Resuelve fechas relativas con `meta.today` del backend. Si el usuario no da fecha, omite el campo para que el backend use hoy.
7. Si una herramienta devuelve `PERIOD_CLOSED` o `ALREADY_PAID`, explica el motivo y ofrece la alternativa válida; no reintentes a ciegas.
8. Menciona los avisos de límite solo si vienen en el resultado de la herramienta o como notificación; no los inventes.
9. No des asesoría financiera, inversiones ni créditos; limítate a registrar y consultar.
10. Cierra con el dato más útil (saldo, total o siguiente paso), sin repetir todo el JSON.

---

## 11. Configuración y ejecución

Variables de entorno (`.env`, ver `.env.example`):

| Variable | Default | Uso |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test` o `production`. |
| `PORT` | `3000` | Puerto de la API. |
| `HOST` | `127.0.0.1` | Interfaz de escucha. No exponer públicamente. |
| `DB_PATH` | `./data/finanzas.db` | Archivo SQLite. |
| `TZ` | `America/Bogota` | Zona de negocio. |
| `INTERNAL_API_KEY` | — (obligatoria) | Secreto del header `X-Api-Key`. |
| `TELEGRAM_BOT_TOKEN` | — | Token de BotFather. |
| `ALLOWED_TELEGRAM_USER_IDS` | — | IDs separados por coma. |
| `AI_BASE_URL` | `https://api.openai.com/v1` | Endpoint compatible. |
| `AI_API_KEY` | — | Clave del proveedor. |
| `AI_MODEL` | — (obligatoria) | ID real del modelo a usar. |
| `LOG_LEVEL` | `info` | Nivel de pino. |

Comandos previstos (los de datos se habilitan en su fase):

```bash
npm install
npm run migrate          # aplica migraciones pendientes (Fase 2)
npm run seed             # datos de ejemplo (Fase 2)
npm run dev              # node --watch, API + bot
npm start                # producción
npm test                 # unit + integration + e2e
npm run closure:run      # cierre manual e idempotente (Fase 8)
npm run backup           # copia consistente de SQLite (Fase 11)
```

---

## 12. Convenciones de código

- ESM, 2 espacios, punto y coma, comillas simples.
- Identificadores, tablas y campos en inglés; textos de usuario, errores y herramientas de IA en español.
- Rutas → servicios → repositorios. Las rutas no escriben SQL; los repositorios no conocen reglas de negocio.
- Dinero siempre `*_cents` entero; nunca operaciones con `Number` decimal para plata.
- Fechas de negocio como string `YYYY-MM-DD`; no usar `Date` para comparar días sin pasar por `domain/dates.js`.
- Transacciones explícitas en toda operación que toque más de una tabla.
- Errores de negocio con clase propia (`AppError` con `code`, `status`, `message` en español).
- Commits convencionales: `feat:`, `fix:`, `docs:`, `test:`, `chore:`.
- Nada de secretos ni `data/*.db` en git.

---

## 13. Estrategia de pruebas

- **Unitarias (dominio puro):** parseo/formato de COP, periodos, día de pago con clamp (31 en febrero, año bisiesto), umbrales 80/100, ranking de categorías, matemática del cierre.
- **Integración (API + SQLite temporal):** CRUD de cada recurso, validaciones, pagos, generación de instancias, avisos únicos, consultas, guards de periodo cerrado.
- **E2E:** flujo completo con reloj inyectado: configurar salario → gastos fijos → pagar → gastos extras hasta 80 % y 100 % → consultas → cierre → ahorro y facturas del mes siguiente.
- **Idempotencia:** ejecutar el cierre dos veces y con requests concurrentes; verificar un solo resumen y un solo abono.
- **Bot/IA:** servidor falso compatible con OpenAI que emite `tool_calls`; se verifica el bucle, la validación de argumentos y el envío de notificaciones.
- Reloj inyectable (`createApp({ clock })` y `createOrchestrator({ clock })`) para no depender de la fecha real.
- Base de datos nueva por test (`DB_PATH=:memory:` o archivo temporal), migraciones aplicadas en `beforeEach`.

---

## 14. Seguridad y privacidad

- Lista blanca de `telegram_user_id`; cualquier otro usuario se rechaza y se registra.
- API interna con `X-Api-Key` y escucha en `127.0.0.1`; no se publica.
- Rate limit por usuario de Telegram (p. ej. 20 mensajes/minuto) y longitud máxima de mensaje.
- SQL siempre parametrizado; sin concatenación de valores.
- Secretos solo en `.env`; `.env` en `.gitignore`.
- Confirmación explícita antes de pagos, borrados y cambios de salario/límite.
- Los logs no incluyen tokens ni el contenido completo de mensajes; sí `request_id`, herramienta y duración.
- La base contiene datos financieros: permisos `600`, backups cifrados o en disco local del usuario.

---

## 15. Operación

- SQLite en modo WAL; `busy_timeout = 5000`; `foreign_keys = ON`.
- Backup diario con `sqlite3 .backup` o `VACUUM INTO`, conservando 30 días.
- Job diario 00:05 America/Bogota; además, verificación de cierres al inicio de cada request.
- Healthcheck `GET /health` con verificación `SELECT 1`.
- Despliegue con systemd (`Restart=always`, `EnvironmentFile=.env`) o contenedor con volumen para `data/`.
- Logs JSON a stdout; rotación por journald.
- Al arrancar: migraciones pendientes + `ensureClosures()` antes de aceptar mensajes.

---

## 16. Decisiones de diseño

| ID | Decisión | Motivo |
|---|---|---|
| D-01 | Backend HTTP sobre loopback en vez de llamadas directas a servicios. | Frontera explícita IA/DB, testeable con `curl`, separable. |
| D-02 | SQLite con `node:sqlite` en vez de `better-sqlite3`. | Cero compilación nativa; Node 26 lo incluye. |
| D-03 | Dinero en centavos enteros. | Evita errores de flotante y unifica parseo/formato. |
| D-04 | Periodo = mes calendario; cierre disparado por el pago del mes siguiente. | Coincide con el requisito y mantiene consultas por mes simples. |
| D-05 | Periodos cerrados inmutables. | Protege la integridad del resumen y del ahorro; corrección queda para fase opcional. |
| D-06 | Saldo devengado (incluye el salario del mes aunque no haya llegado el día de pago). | Es la fórmula pedida; el periodo ya está abierto. |
| D-07 | Saldo negativo no reduce el ahorro; se registra como déficit. | El ahorro solo recibe sobrantes, según el requisito. |
| D-08 | Avisos de límite por outbox, no por el modelo. | Garantiza entrega aunque el modelo olvide mencionarlos. |
| D-09 | Plantillas de gastos fijos + instancias mensuales con snapshot. | Permite editar sin alterar meses pagados y reiniciar el estado cada mes. |
| D-10 | Bot y API en el mismo proceso, API en loopback. | Simplicidad operativa sin perder la separación lógica. |
| D-11 | Sin SDK de IA; `fetch` al endpoint compatible con OpenAI. | Menos dependencias y control del bucle. |
| D-12 | El backend redacta las notificaciones; el modelo redacta la conversación. | Mensajes deterministas para avisos críticos. |

---

## 17. Decisiones abiertas (confirmar con el usuario)

1. **Modelo real:** “ChatGPT Luna 6” no es un ID de API estándar. Falta definir proveedor y `AI_MODEL` al desplegar.
2. **Edición tras el cierre:** se bloquea por defecto (D-05). ¿Se quiere un mecanismo de corrección con recálculo del cierre y del ahorro?
3. **Saldo devengado vs. disponible:** hoy se incluye el salario completo del mes aunque el pago llegue el día 10. ¿Se quiere además un “disponible hasta el próximo pago”?
4. **Déficit:** hoy no se descuenta del ahorro. ¿Debe descontarse?
5. **Confirmaciones:** la IA pedirá confirmación antes de pagar y borrar. ¿Se quiere también confirmación para registrar gastos por encima de un umbral?
6. **Día de pago 29–31:** se usa el último día del mes cuando no existe. ¿Correcto?

---

## 18. Glosario

- **Periodo:** mes calendario (`YYYY-MM`) sobre el que se calculan saldo, límite y cierre.
- **Periodo activo:** mes calendario de la fecha actual en Bogotá.
- **Instancia / factura:** fila mensual de un gasto fijo, con estado pagado/pendiente.
- **Snapshot:** copia de nombre, monto y fecha guardada en la instancia para no depender de la plantilla.
- **Cierre:** resumen inmutable de un periodo, con abono al ahorro.
- **Outbox:** tabla de notificaciones pendientes que el bot entrega a Telegram.
- **Umbral:** 80 % o 100 % del límite mensual de gastos extras.
- **Déficit:** saldo negativo al cerrar; no afecta el ahorro.
- **Devengado:** ingresos y gastos del periodo, aunque el dinero aún no se haya movido.

---

## 19. Referencias

- Plan por fases, estado y bitácora: [`docs/PROGRESO.md`](docs/PROGRESO.md).
- Requisitos originales del usuario: resumidos en la sección 2 y las reglas RN.
- Cualquier cambio de regla de negocio debe actualizar este documento y registrar la decisión en la bitácora.
