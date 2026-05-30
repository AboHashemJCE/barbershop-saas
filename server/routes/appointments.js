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
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

router.get('/availability', getAvailability);
router.post('/', authenticate, requireRole('customer'), createAppointment);
router.get('/token/:token', authenticate, requireRole('customer'), getAppointmentByToken);
router.put('/token/:token/cancel', authenticate, requireRole('customer'), cancelByCustomer);
router.get('/shop/:shopId', authenticate, requireRole('shop_admin'), getShopAppointments);
router.get('/barber/:barberId', authenticate, requireRole('barber'), getBarberAppointments);
router.put('/:id/status', authenticate, requireRole('barber'), updateAppointmentStatus);
router.put('/:id/cancel', authenticate, requireRole('shop_admin', 'barber'), cancelByBarber);

export default router;
