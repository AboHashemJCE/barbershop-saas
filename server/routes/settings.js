import express from 'express';
import { getShopSettings, updateShopSettings } from '../controllers/settings.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

router.get('/:shopId', authenticate, requireRole('shop_admin'), getShopSettings);
router.put('/:shopId', authenticate, requireRole('shop_admin'), updateShopSettings);

export default router;
