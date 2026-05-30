import express from 'express';

import {
  setBarberSchedule,
  getBarberSchedule,
  setScheduleException,
  getBarberExceptions,
  deleteScheduleException
} from '../controllers/schedules.js';
import { authenticate, requireRole } from '../middleware/auth.js'

const router = express.Router();

router.post('/barber/:barberId', authenticate, requireRole('shop_admin', 'barber'), setBarberSchedule);           // POST   /api/schedules/barber/1
router.get('/barber/:barberId', authenticate, requireRole('shop_admin', 'barber'), getBarberSchedule);            // GET    /api/schedules/barber/1
router.post('/exceptions', authenticate, requireRole('shop_admin', 'barber'), setScheduleException);              // POST   /api/schedules/exceptions
router.get('/exceptions/barber/:barberId', authenticate, requireRole('shop_admin', 'barber'), getBarberExceptions); // GET  /api/schedules/exceptions/barber/1
router.delete('/exceptions/:id', authenticate, requireRole('shop_admin', 'barber'), deleteScheduleException);     // DELETE /api/schedules/exceptions/1

export default router;
