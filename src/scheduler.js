import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);
dayjs.extend(timezone);

/** Milisegundos hasta la próxima HH:MM en la zona dada. */
export function msUntilNext({ hour, minute, tz, now = new Date() }) {
  const current = dayjs(now).tz(tz);
  let next = current.hour(hour).minute(minute).second(0).millisecond(0);
  if (!next.isAfter(current)) next = next.add(1, 'day');
  return next.valueOf() - current.valueOf();
}

/** Ejecuta `job` todos los días a la hora indicada (por defecto 00:05). */
export function scheduleDaily({ hour = 0, minute = 5, tz, job, logger }) {
  let timer = null;
  const arm = () => {
    const delay = msUntilNext({ hour, minute, tz });
    timer = setTimeout(async () => {
      try {
        await job();
      } catch (error) {
        logger?.error({ err: error }, 'falló el job diario');
      }
      arm();
    }, delay);
    timer.unref?.();
  };
  arm();
  return { stop: () => clearTimeout(timer) };
}
