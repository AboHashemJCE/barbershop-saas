import express from 'express';

import {
  setBarberSchedule,
  getBarberSchedule,
  setScheduleException,
  getBarberExceptions,
  deleteScheduleException
} from '../controllers/schedules.js';

const router = express.Router();

router.post('/barber/:barberId', setBarberSchedule);           // POST   /api/schedules/barber/1
router.get('/barber/:barberId', getBarberSchedule);            // GET    /api/schedules/barber/1
router.post('/exceptions', setScheduleException);              // POST   /api/schedules/exceptions
router.get('/exceptions/barber/:barberId', getBarberExceptions); // GET  /api/schedules/exceptions/barber/1
router.delete('/exceptions/:id', deleteScheduleException);     // DELETE /api/schedules/exceptions/1

export default router;