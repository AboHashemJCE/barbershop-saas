import express from 'express';
import { createShop, getShopBySlug, getAllShops} from '../controllers/shops.js';

const router = express.Router();

router.post('/', createShop);   //POST /api/shops
router.get('/', getAllShops) //GET /api/shops
router.get('/:slug', getShopBySlug) //GET /api/shops/:slug:

export default router;

