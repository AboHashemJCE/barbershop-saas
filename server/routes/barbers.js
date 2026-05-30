import express from 'express';
import { createBarber, getShopBarbers, updateBarber, deleteBarber } from '../controllers/barbers.js';
import { authenticate, requireRole } from '../middleware/auth.js'

const router = express.Router();

router.post('/', authenticate, requireRole('shop_admin'), createBarber);   //POST /api/barbers
router.get('/shop/:shopId', authenticate, requireRole('shop_admin'), getShopBarbers) //GET /api/barbers/shop/:shopId
router.put('/:id', authenticate, requireRole('shop_admin'), updateBarber) //PUT /api/barbers/:id
router.delete('/:id', authenticate, requireRole('shop_admin'), deleteBarber) //DELETE /api/barbers/:id

export default router;
