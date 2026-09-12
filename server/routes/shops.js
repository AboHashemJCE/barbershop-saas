import express from 'express';
import { createShop, getShopBySlug, getAllShops, updateShopStatus} from '../controllers/shops.js';
import { authenticate, requireRole } from '../middleware/auth.js'

const router = express.Router();

router.put('/:id/status', authenticate, requireRole('super_admin'), updateShopStatus);
router.post('/', authenticate, requireRole('super_admin'), createShop);   //POST /api/shops
router.get('/', authenticate, requireRole('super_admin'), getAllShops) //GET /api/shops
router.get('/:slug', getShopBySlug) //GET /api/shops/:slug:

export default router;

