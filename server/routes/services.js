import express from 'express';
import { createService, getShopServices, updateService, deleteService } from '../controllers/services.js';

const router = express.Router();

router.post('/', createService);                  // POST   /api/services
router.get('/shop/:shopId', getShopServices);     // GET    /api/services/shop/1
router.put('/:id', updateService);                // PUT    /api/services/1
router.delete('/:id', deleteService);             // DELETE /api/services/1

export default router;