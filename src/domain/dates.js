import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);
dayjs.extend(timezone);

export const DEFAULT_TZ = 'America/Bogota';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const periodPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

/** true si es una fecha 'YYYY-MM-DD' real (rechaza 2026-02-30). */
export function isValidDate(value) {
  if (typeof value !== 'string' || !datePattern.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(`${value.slice(0, 7)}`) && y > 0;
}

export const isValidPeriod = (value) => typeof value === 'string' && periodPattern.test(value);

/** Fecha de negocio 'YYYY-MM-DD' de un instante en la zona dada. */
export function todayInTz(now = new Date(), tz = DEFAULT_TZ) {
  return dayjs(now).tz(tz).format('YYYY-MM-DD');
}

/** Hora local 'YYYY-MM-DD HH:mm' de un instante en la zona dada. */
export function nowInTz(now = new Date(), tz = DEFAULT_TZ) {
  return dayjs(now).tz(tz).format('YYYY-MM-DD HH:mm');
}

export const periodOf = (date) => date.slice(0, 7);

export function daysInMonth(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Día `day` del periodo, ajustado al último día si no existe (RN-01). */
export function clampDay(period, day) {
  const d = Math.min(day, daysInMonth(period));
  return `${period}-${String(d).padStart(2, '0')}`;
}

export function periodRange(period) {
  return { start: `${period}-01`, end: clampDay(period, 31) };
}

export function addMonths(period, n) {
  const [y, m] = period.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

export const nextPeriod = (period) => addMonths(period, 1);
export const previousPeriod = (period) => addMonths(period, -1);

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const result = new Date(Date.UTC(y, m - 1, d + n));
  return result.toISOString().slice(0, 10);
}

/** Fecha de pago del salario dentro de un periodo. */
export const salaryDateForPeriod = (period, payDay) => clampDay(period, payDay);

/** Próxima fecha de pago a partir de hoy (incluye hoy si es día de pago). */
export function nextSalaryDate(today, payDay) {
  const thisMonth = salaryDateForPeriod(periodOf(today), payDay);
  return thisMonth >= today ? thisMonth : salaryDateForPeriod(nextPeriod(periodOf(today)), payDay);
}

/** Fecha en que se cierra el periodo: día de pago del mes siguiente (RN-12). */
export const closureTriggerDate = (period, payDay) => salaryDateForPeriod(nextPeriod(period), payDay);

/** '2026-11' → 'noviembre de 2026'. */
export function periodLabel(period) {
  const [y, m] = period.split('-').map(Number);
  return `${MONTHS[m - 1]} de ${y}`;
}

/** Marca de tiempo ISO UTC del reloj inyectado. */
export const isoNow = (clock) => clock.now().toISOString();
