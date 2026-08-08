/**
 * 訂單狀態機
 *
 * 對應「App 內先湊單 → 跟店家點 → 出餐」的實際流程：
 *
 *   pending          未點單   在 App 裡加好了，還沒跟店家開口
 *   ordered          已點單   已經跟店家點了
 *   served           已到餐   餐點送到了
 *   cancel_requested 待撤單   想取消，還沒跟店家講定
 *   cancelled        已撤單   確定取消，不列入結帳
 */

export const ORDER_STATUSES = ['pending', 'ordered', 'served', 'cancel_requested', 'cancelled'];

export const DEFAULT_STATUS = 'pending';

/**
 * 允許的轉移。刻意保留回退路徑——現場點餐一定會有按錯的時候，
 * 嚴格到不能改回去，使用者只能刪單重建，反而更糟。
 */
export const TRANSITIONS = {
  pending: ['ordered', 'cancelled'],
  ordered: ['served', 'cancel_requested', 'pending'],
  served: ['ordered'],
  cancel_requested: ['cancelled', 'ordered'],
  cancelled: ['pending'], // 誤撤的還原路徑
};

/** 列入結帳金額的狀態。已撤單不算錢。 */
export const COUNTED_STATUSES = new Set(['pending', 'ordered', 'served', 'cancel_requested']);

export const isCounted = (status) => COUNTED_STATUSES.has(status);

export const canTransition = (from, to) => TRANSITIONS[from]?.includes(to) === true;

export const STATUS_LABELS = {
  pending: '未點單',
  ordered: '已點單',
  served: '已到餐',
  cancel_requested: '待撤單',
  cancelled: '已撤單',
};
