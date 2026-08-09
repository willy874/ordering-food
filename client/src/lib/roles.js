/**
 * 角色的顯示設定。定義必須與 server/lib/roles.js 一致——
 * 這裡只影響按鈕與標籤，真正的把關在後端。
 */

export const ROLES = ['participant', 'manager', 'admin'];

export const ROLE_INFO = {
  participant: {
    label: '參與者',
    color: 'default',
    hint: '只能改自己的單，已跟店家點過的品項改不了品名與數量',
  },
  manager: {
    label: '協助管理者',
    color: 'secondary',
    hint: '可以改所有人的品項、批次推進度',
  },
  admin: {
    label: '最高管理者',
    color: 'primary',
    hint: '再加上指派別人的權限、結束點餐、刪除整攤',
  },
};

const RANK = { participant: 0, manager: 1, admin: 2 };

export const roleLabel = (role) => ROLE_INFO[role]?.label ?? role;
export const roleAtLeast = (role, min) => (RANK[role] ?? 0) >= RANK[min];
