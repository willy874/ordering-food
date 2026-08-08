/**
 * 訂單狀態的顯示設定。
 * 轉移規則必須與 server/lib/orderStatus.js 保持一致——
 * 這裡只影響按鈕顯示，真正的把關在後端。
 */

export const ORDER_STATUS = {
  pending: {
    label: '未點單',
    color: 'default',
    hint: '已經加進來，還沒跟店家開口',
    action: null,
  },
  ordered: {
    label: '已點單',
    color: 'primary',
    hint: '已經跟店家點了，等出餐',
    action: '跟店家點了',
  },
  served: {
    label: '已到餐',
    color: 'success',
    hint: '餐點送到了',
    action: '餐到了',
  },
  cancel_requested: {
    label: '待撤單',
    color: 'warning',
    hint: '想取消，還沒跟店家講定',
    action: '要撤單',
  },
  cancelled: {
    label: '已撤單',
    color: 'error',
    hint: '已取消，不列入結帳',
    action: '確定撤掉',
  },
};

export const TRANSITIONS = {
  pending: ['ordered', 'cancelled'],
  ordered: ['served', 'cancel_requested', 'pending'],
  served: ['ordered'],
  cancel_requested: ['cancelled', 'ordered'],
  cancelled: ['pending'],
};

/** 依序排列，供狀態總覽顯示 */
export const STATUS_ORDER = ['pending', 'ordered', 'served', 'cancel_requested', 'cancelled'];

export const statusLabel = (status) => ORDER_STATUS[status]?.label ?? status;
export const statusColor = (status) => ORDER_STATUS[status]?.color ?? 'default';
export const nextStatuses = (status) => TRANSITIONS[status] ?? [];
