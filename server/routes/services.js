import express from 'express';
import { createService, getShopServices, updateService, deleteService } from '../controllers/services.js';
import { authenticate, requireRole } from '../middleware/auth.js'

const router = express.Router();

router.post('/', authenticate, requireRole('shop_admin'), createService);                  // POST   /api/services
router.get('/shop/:shopId', getShopServices);     // GET    /api/services/shop/1
router.put('/:id', authenticate, requireRole('shop_admin'), updateService);                // PUT    /api/services/1
router.delete('/:id', authenticate, requireRole('shop_admin'), deleteService);             // DELETE /api/services/1

export default router;
