import express from 'express';
import {
  requestOtp,
  verifyOtp,
  barberLogin,
  shopLogin,
  superAdminLogin,
  changeBarberPassword,
  changeShopPassword,
  updateCustomerProfile,
  updateBarberProfile,
  updateShopProfile
} from '../controllers/auth.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

router.put('/customer/profile', authenticate, requireRole('customer'), updateCustomerProfile);
router.put('/barber/profile', authenticate, requireRole('barber'), updateBarberProfile);
router.put('/shop/profile', authenticate, requireRole('shop_admin'), updateShopProfile);
router.put('/barber/change-password', authenticate, requireRole('barber'), changeBarberPassword);
router.put('/shop/change-password', authenticate, requireRole('shop_admin'), changeShopPassword);
router.post('/customer/request-otp', requestOtp);
router.post('/customer/verify-otp', verifyOtp);
router.post('/barber/login', barberLogin);
router.post('/shop/login', shopLogin);
router.post('/super-admin/login', superAdminLogin);

export default router;
