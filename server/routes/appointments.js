import express from 'express';
import {
  getAvailability,
  createAppointment,
  getAppointmentByToken,
  cancelByCustomer,
  getShopAppointments,
  getBarberAppointments,
  updateAppointmentStatus,
  cancelByBarber
} from '../controllers/appointments.js';

const router = express.Router();

router.get('/availability', getAvailability);                  // GET  /api/appointments/availability
router.post('/', createAppointment);                           // POST /api/appointments
router.get('/token/:token', getAppointmentByToken);            // GET  /api/appointments/token/:token
router.put('/token/:token/cancel', cancelByCustomer);          // PUT  /api/appointments/token/:token/cancel
router.get('/shop/:shopId', getShopAppointments);              // GET  /api/appointments/shop/:shopId
router.get('/barber/:barberId', getBarberAppointments);        // GET  /api/appointments/barber/:barberId
router.put('/:id/status', updateAppointmentStatus);            // PUT  /api/appointments/:id/status
router.put('/:id/cancel', cancelByBarber);                     // PUT  /api/appointments/:id/cancel

export default router;
