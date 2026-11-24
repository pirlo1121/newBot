import { z } from 'zod';

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('127.0.0.1'),
  DB_PATH: z.string().min(1).default('./data/finanzas.db'),
  TZ: z.string().min(1).default('America/Bogota'),
  INTERNAL_API_KEY: z.string().min(16, 'debe tener al menos 16 caracteres'),
  TELEGRAM_BOT_TOKEN: z.string().optional().transform((value) => value?.trim() || undefined),
  ALLOWED_TELEGRAM_USER_IDS: z.string().optional(),
  AI_BASE_URL: z.url().default('https://api.openai.com/v1'),
  AI_API_KEY: z.string().optional().transform((value) => value?.trim() || undefined),
  AI_MODEL: z.string().optional().transform((value) => value?.trim() || undefined),
  LOG_LEVEL: z.enum(logLevels).default('info')
});

function parseAllowedTelegramIds(rawValue) {
  if (!rawValue) return [];

  const ids = rawValue
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (!/^\d+$/.test(part)) {
        throw new Error(
          `Configuración inválida: ALLOWED_TELEGRAM_USER_IDS contiene un valor no numérico ("${part}").`
        );
      }

      const id = Number(part);
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error(
          `Configuración inválida: ALLOWED_TELEGRAM_USER_IDS contiene un ID inválido ("${part}").`
        );
      }

      return id;
    });

  return [...new Set(ids)];
}

/**
 * Valida las variables de entorno y devuelve una configuración inmutable.
 * No lee process.env directamente para que las pruebas puedan inyectar valores.
 */
export function loadConfig(env = {}) {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuración inválida:\n${issues}`);
  }

  const data = parsed.data;

  return Object.freeze({
    nodeEnv: data.NODE_ENV,
    port: data.PORT,
    host: data.HOST,
    dbPath: data.DB_PATH,
    timezone: data.TZ,
    internalApiKey: data.INTERNAL_API_KEY,
    telegramBotToken: data.TELEGRAM_BOT_TOKEN,
    allowedTelegramUserIds: parseAllowedTelegramIds(data.ALLOWED_TELEGRAM_USER_IDS),
    aiBaseUrl: data.AI_BASE_URL,
    aiApiKey: data.AI_API_KEY,
    aiModel: data.AI_MODEL,
    logLevel: data.LOG_LEVEL
  });
}
