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
