import express from 'express';
import {
  requestOtp,
  verifyOtp,
  barberLogin,
  shopLogin,
  superAdminLogin
} from '../controllers/auth.js';

const router = express.Router();

router.post('/customer/request-otp', requestOtp);
router.post('/customer/verify-otp', verifyOtp);
router.post('/barber/login', barberLogin);
router.post('/shop/login', shopLogin);
router.post('/super-admin/login', superAdminLogin);

export default router;
