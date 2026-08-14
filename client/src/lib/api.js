async function request(path, { method = 'GET', body, editToken, adminToken, manageCode } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (editToken) headers['X-Edit-Token'] = editToken;
  if (adminToken) headers['X-Admin-Token'] = adminToken;
  // 管理代碼本身就是憑證，跟另外兩個一樣一律由後端驗
  if (manageCode) headers['X-Manage-Code'] = manageCode;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('伺服器回應格式錯誤');
    }
  }

  if (!res.ok) {
    // 帶上狀態碼，呼叫端才分得出「這筆確定不存在」與「這次連不上」——
    // 兩者的處置完全不同
    const error = new Error(data?.error || `請求失敗（${res.status}）`);
    error.status = res.status;
    throw error;
  }
  return data;
}

export const api = {
  listStores: () => request('/stores'),
  createStore: (body) => request('/stores', { method: 'POST', body }),
  /** 改店名／電話／備註，不動菜單 */
  patchStore: (id, body) => request(`/stores/${id}`, { method: 'PATCH', body }),
  /** 軟刪除：下架而非真的刪，歷史訂單還連著這家店 */
  deleteStore: (id) => request(`/stores/${id}`, { method: 'DELETE' }),

  getMenu: (storeId) => request(`/stores/${storeId}/menu`),
  addMenuItem: (storeId, body) => request(`/stores/${storeId}/menu`, { method: 'POST', body }),
  /** 一次匯入整份菜單，整批成立或整批退回 */
  bulkAddMenuItems: (storeId, items) =>
    request(`/stores/${storeId}/menu/bulk`, { method: 'POST', body: { items } }),
  patchMenuItem: (id, body) => request(`/menu-items/${id}`, { method: 'PATCH', body }),
  deleteMenuItem: (id) => request(`/menu-items/${id}`, { method: 'DELETE' }),

  createGroup: (body) => request('/groups', { method: 'POST', body }),
  /** 帶憑證讀團才拿得到 group.manageCode，其餘欄位跟誰讀都一樣 */
  getGroup: (joinCode, tokens = {}) =>
    request(`/groups/${encodeURIComponent(joinCode)}`, { ...tokens }),
  /** 驗管理代碼。成功才存進 localStorage，免得存了一組打錯的 */
  verifyManageCode: (joinCode, manageCode) =>
    request(`/groups/${encodeURIComponent(joinCode)}/manage-code`, {
      method: 'POST',
      body: { manageCode },
    }),
  /** 關攤／改截止：最高管理者以上，所以要帶齊憑證而不只是 adminToken */
  patchGroup: (joinCode, body, tokens) =>
    request(`/groups/${encodeURIComponent(joinCode)}`, { method: 'PATCH', body, ...tokens }),
  /** 刪攤：最高管理者以上 */
  deleteGroup: (joinCode, tokens) =>
    request(`/groups/${encodeURIComponent(joinCode)}`, { method: 'DELETE', ...tokens }),
  /** 現在還收得了單的團，首頁用；不含任何憑證 */
  listActiveGroups: () => request('/groups/active'),
  findSimilarGroups: (storeId, title) =>
    request(`/groups?storeId=${storeId}&title=${encodeURIComponent(title)}`),

  createOrder: (joinCode, body) =>
    request(`/groups/${encodeURIComponent(joinCode)}/orders`, { method: 'POST', body }),
  /** 改名字或備註，不動品項 */
  patchOrder: (orderId, body, tokens) =>
    request(`/orders/${orderId}`, { method: 'PATCH', body, ...tokens }),
  /** 加點：追加品項，已經在單上的東西原封不動 */
  addOrderItems: (orderId, items, tokens) =>
    request(`/orders/${orderId}/items`, { method: 'POST', body: { items }, ...tokens }),
  patchOrderItem: (itemId, body, tokens) =>
    request(`/order-items/${itemId}`, { method: 'PATCH', body, ...tokens }),
  deleteOrderItem: (itemId, tokens) =>
    request(`/order-items/${itemId}`, { method: 'DELETE', ...tokens }),
  deleteOrder: (orderId, tokens) => request(`/orders/${orderId}`, { method: 'DELETE', ...tokens }),
  /** 指派角色，只有最高管理者做得到 */
  setOrderRole: (orderId, role, tokens) =>
    request(`/orders/${orderId}/role`, { method: 'PATCH', body: { role }, ...tokens }),

  // 狀態不需要憑證：現場誰看到餐送來誰就能按
  setItemStatus: (itemId, status) =>
    request(`/order-items/${itemId}/status`, { method: 'PATCH', body: { status } }),
  setOrderStatus: (orderId, status) =>
    request(`/orders/${orderId}/status`, { method: 'PATCH', body: { status } }),
  bulkSetStatus: (joinCode, body, tokens) =>
    request(`/groups/${encodeURIComponent(joinCode)}/orders/status`, {
      method: 'PATCH',
      body,
      ...tokens,
    }),
};
