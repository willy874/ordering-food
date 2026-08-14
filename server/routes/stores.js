import { Router } from 'express';
import * as menuController from '../controllers/menuController.js';
import * as storeController from '../controllers/storeController.js';

/** 路徑 → controller。這裡只做對照，不放任何邏輯。 */
const router = Router();

router.get('/stores', storeController.list);
router.post('/stores', storeController.create);
router.patch('/stores/:id', storeController.update);
router.delete('/stores/:id', storeController.remove);

router.get('/stores/:id/menu', menuController.list);
router.post('/stores/:id/menu', menuController.create);
router.post('/stores/:id/menu/bulk', menuController.bulkCreate);

router.patch('/menu-items/:id', menuController.update);
router.delete('/menu-items/:id', menuController.remove);

export default router;
