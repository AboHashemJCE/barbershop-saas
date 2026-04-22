import express from 'express';
import {
  getAvailableSlots,
  createAppointment,
  getAppointmentByToken,
  cancelAppointmentByCustomer,
  getShopAppointments,
  getBarberAppointments,
  updateAppointmentStatus,
  cancelAppointmentByBarber
} from '../controllers/appointments.js';

const router = express.Router();

router.get('/slots', getAvailableSlots);                           // GET    /api/appointments/slots?shop_id=1&barber_id=1&service_id=1&date=2026-05-01
router.post('/', createAppointment);                               // POST   /api/appointments
/*
? What does tokens mean in this context? 
? Is it a unique identifier for the appointment that customers
? can use to view or manage their appointment without needing an account?
*/
router.get('/token/:token', getAppointmentByToken);                // GET    /api/appointments/token/abc123
router.put('/cancel/customer/:token', cancelAppointmentByCustomer); // PUT   /api/appointments/cancel/customer/abc123
router.get('/shop/:shopId', getShopAppointments);                  // GET    /api/appointments/shop/1
router.get('/barber/:barberId', getBarberAppointments);            // GET    /api/appointments/barber/1
router.put('/status/:id', updateAppointmentStatus);                // PUT    /api/appointments/status/1
router.put('/cancel/barber/:id', cancelAppointmentByBarber);       // PUT    /api/appointments/cancel/barber/1

export default router;