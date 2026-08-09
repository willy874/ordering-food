import { Router } from 'express';
import * as groupController from '../controllers/groupController.js';
import * as orderController from '../controllers/orderController.js';

const router = Router();

router.post('/groups', groupController.create);
router.get('/groups', groupController.listDuplicates);
// 要排在 /groups/:joinCode 前面才不會被當成團號；團號的字母表沒有 I，
// 所以 ACTIVE 本身也不可能是一個真的團號
router.get('/groups/active', groupController.listActive);
router.get('/groups/:joinCode', groupController.get);
router.post('/groups/:joinCode/manage-code', groupController.verifyManageCode);
router.patch('/groups/:joinCode', groupController.update);
router.patch('/groups/:joinCode/orders/status', groupController.bulkUpdateItemStatus);
router.delete('/groups/:joinCode', groupController.remove);

// 下單掛在團底下，但做的是訂單的事，因此交給 orderController
router.post('/groups/:joinCode/orders', orderController.create);

export default router;
