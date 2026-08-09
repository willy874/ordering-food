import { Router } from 'express';
import * as orderController from '../controllers/orderController.js';

const router = Router();

router.patch('/orders/:orderId', orderController.update);
router.delete('/orders/:orderId', orderController.remove);
router.patch('/orders/:orderId/status', orderController.updateStatus);
router.patch('/orders/:orderId/role', orderController.assignRole);
router.post('/orders/:orderId/items', orderController.addItems);

router.patch('/order-items/:itemId', orderController.updateItem);
router.delete('/order-items/:itemId', orderController.removeItem);
router.patch('/order-items/:itemId/status', orderController.updateItemStatus);

export default router;
