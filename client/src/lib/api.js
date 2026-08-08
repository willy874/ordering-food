async function request(path, { method = 'GET', body, editToken, adminToken } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (editToken) headers['X-Edit-Token'] = editToken;
  if (adminToken) headers['X-Admin-Token'] = adminToken;

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

  if (!res.ok) throw new Error(data?.error || `請求失敗（${res.status}）`);
  return data;
}

export const api = {
  listStores: () => request('/stores'),
  createStore: (body) => request('/stores', { method: 'POST', body }),
  deleteStore: (id) => request(`/stores/${id}`, { method: 'DELETE' }),

  getMenu: (storeId) => request(`/stores/${storeId}/menu`),
  addMenuItem: (storeId, body) => request(`/stores/${storeId}/menu`, { method: 'POST', body }),
  patchMenuItem: (id, body) => request(`/menu-items/${id}`, { method: 'PATCH', body }),
  deleteMenuItem: (id) => request(`/menu-items/${id}`, { method: 'DELETE' }),

  createGroup: (body) => request('/groups', { method: 'POST', body }),
  getGroup: (joinCode) => request(`/groups/${encodeURIComponent(joinCode)}`),
  patchGroup: (joinCode, body, adminToken) =>
    request(`/groups/${encodeURIComponent(joinCode)}`, { method: 'PATCH', body, adminToken }),
  deleteGroup: (joinCode, adminToken) =>
    request(`/groups/${encodeURIComponent(joinCode)}`, { method: 'DELETE', adminToken }),
  findSimilarGroups: (storeId, title) =>
    request(`/groups?storeId=${storeId}&title=${encodeURIComponent(title)}`),

  createOrder: (joinCode, body) =>
    request(`/groups/${encodeURIComponent(joinCode)}/orders`, { method: 'POST', body }),
  updateOrder: (orderId, body, tokens) =>
    request(`/orders/${orderId}`, { method: 'PUT', body, ...tokens }),
  deleteOrder: (orderId, tokens) => request(`/orders/${orderId}`, { method: 'DELETE', ...tokens }),
  setOrderStatus: (orderId, status, tokens) =>
    request(`/orders/${orderId}/status`, { method: 'PATCH', body: { status }, ...tokens }),
  bulkSetStatus: (joinCode, body, adminToken) =>
    request(`/groups/${encodeURIComponent(joinCode)}/orders/status`, {
      method: 'PATCH',
      body,
      adminToken,
    }),
};
