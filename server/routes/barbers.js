import express from 'express';
import { createBarber, getShopBarbers, updateBarber, deleteBarber } from '../controllers/barbers.js';

const router = express.Router();

router.post('/', createBarber);   //POST /api/barbers
router.get('/shop/:shopId', getShopBarbers) //GET /api/barbers/shop/:shopId
router.put('/:id', updateBarber) //PUT /api/barbers/:id
router.delete('/:id', deleteBarber) //DELETE /api/barbers/:id

export default router;