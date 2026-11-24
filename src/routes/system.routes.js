import { Router } from 'express';

import { getContext } from '../services/context.service.js';
import * as notifications from '../services/notifications.service.js';
import { send } from './respond.js';
import { idParam, parse } from './validation.js';

export function systemRoutes(ctx) {
  const router = Router();

  // GET http://127.0.0.1:3000/api/context
  router.get('/context', (req, res) => send(res, getContext(ctx, req.userId)));

  // GET http://127.0.0.1:3000/api/notifications/pending
  router.get('/notifications/pending', (req, res) =>
    send(res, { items: notifications.listPending(ctx, req.userId) })
  );

  // POST http://127.0.0.1:3000/api/notifications/{id}/ack
  router.post('/notifications/:id/ack', (req, res) => {
    const { id } = parse(idParam, req.params);
    send(res, notifications.ack(ctx, req.userId, id));
  });

  return router;
}
