/** Envelope de éxito de AGENTS.md §9. */
export function send(res, data, status = 200) {
  res.status(status).json({ ok: true, data, meta: res.locals.meta ?? {} });
}
