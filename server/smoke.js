/**
 * 端對端煙霧測試。
 *
 * 需要伺服器已啟動（npm run dev:server）且 DATABASE_URL 指向可寫入的資料庫。
 *   npm run smoke
 *
 * 測試資料一律以 [smoke] 開頭，結束後自動清除。
 */
import { count, eq, like } from 'drizzle-orm';
import { closeDb, db } from './db.js';
import { groupOrders, orders, stores } from './schema.js';

const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:3000';

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function cleanup() {
  await db.delete(groupOrders).where(like(groupOrders.title, '[smoke]%'));
  await db.delete(stores).where(like(stores.name, '[smoke]%'));
}

console.log(`\n對 ${BASE} 執行煙霧測試\n`);
await cleanup();

// ── 店家與菜單 ────────────────────────────────────────────────
console.log('店家與菜單');
const store = await call('/stores', { method: 'POST', body: { name: '[smoke] 測試便當店' } });
check('建立店家', store.status === 201 && store.data.id, `status=${store.status}`);

const patchedStore = await call(`/stores/${store.data.id}`, {
  method: 'PATCH',
  body: { phone: '07-1234567', note: '午餐限定' },
});
check(
  '修改店家資訊',
  patchedStore.status === 200 && patchedStore.data.phone === '07-1234567' && patchedStore.data.note === '午餐限定',
  `status=${patchedStore.status}`,
);

const clearedNote = await call(`/stores/${store.data.id}`, { method: 'PATCH', body: { note: null } });
check('店家備註可清空', clearedNote.status === 200 && clearedNote.data.note === null);

const emptyPatch = await call(`/stores/${store.data.id}`, { method: 'PATCH', body: {} });
check('空的店家修改回 400', emptyPatch.status === 400, `status=${emptyPatch.status}`);

const patchMissingStore = await call('/stores/999999999', { method: 'PATCH', body: { name: '不存在' } });
check('修改不存在的店家回 404', patchMissingStore.status === 404, `status=${patchMissingStore.status}`);

const bento = await call(`/stores/${store.data.id}/menu`, {
  method: 'POST',
  body: { name: '排骨便當', price: 90, category: '便當' },
});
check('新增菜單品項', bento.status === 201 && bento.data.price === 90);

const offItem = await call(`/stores/${store.data.id}/menu`, {
  method: 'POST',
  body: { name: '已下架便當', price: 70 },
});
await call(`/menu-items/${offItem.data.id}`, { method: 'PATCH', body: { available: false } });

const badPrice = await call(`/stores/${store.data.id}/menu`, {
  method: 'POST',
  body: { name: '天價便當', price: 999999 },
});
check('拒絕超出範圍的價格', badPrice.status === 400, `status=${badPrice.status}`);

// ── 開團 ──────────────────────────────────────────────────────
console.log('\n開團');
const group = await call('/groups', {
  method: 'POST',
  body: { storeId: store.data.id, title: '[smoke] 測試團', hostName: '小明' },
});
check('建立團', group.status === 201 && /^[A-Z2-9]{6}$/.test(group.data.joinCode), group.data?.joinCode);
check('回傳 adminToken', Boolean(group.data.adminToken));
const code = group.data.joinCode;

// ── 價格信任模型 ──────────────────────────────────────────────
console.log('\n價格信任模型');
const tampered = await call(`/groups/${code}/orders`, {
  method: 'POST',
  body: {
    personName: '小華',
    items: [{ menuItemId: bento.data.id, qty: 2, unitPrice: 1, name: '一元便當' }],
  },
});
check('接受菜單品項訂單', tampered.status === 201, `status=${tampered.status}`);
check(
  '忽略前端竄改的價格（90×2=180，而非 1×2）',
  tampered.data?.total === 180,
  `total=${tampered.data?.total}`,
);

const custom = await call(`/groups/${code}/orders`, {
  method: 'POST',
  body: {
    personName: '小美',
    note: '不要香菜',
    items: [
      { menuItemId: bento.data.id, qty: 1 },
      { name: '自己加的珍奶', unitPrice: 60, qty: 2 },
    ],
  },
});
check('自填品項價格被採用（90 + 60×2 = 210）', custom.data?.total === 210, `total=${custom.data?.total}`);

const offOrder = await call(`/groups/${code}/orders`, {
  method: 'POST',
  body: { personName: '小李', items: [{ menuItemId: offItem.data.id, qty: 1 }] },
});
check('拒絕已下架的品項', offOrder.status === 400, `status=${offOrder.status}`);

const negative = await call(`/groups/${code}/orders`, {
  method: 'POST',
  body: { personName: '小李', items: [{ name: '負數', unitPrice: -50, qty: 1 }] },
});
check('拒絕負數自填價格', negative.status === 400, `status=${negative.status}`);

const noName = await call(`/groups/${code}/orders`, {
  method: 'POST',
  body: { personName: '  ', items: [{ menuItemId: bento.data.id, qty: 1 }] },
});
check('拒絕空白名字', noName.status === 400, `status=${noName.status}`);

// ── 彙總 ──────────────────────────────────────────────────────
console.log('\n彙總');
const detail = await call(`/groups/${code}`);
check('讀取團資訊', detail.status === 200);
check('訂單數正確', detail.data.orders.length === 2, `count=${detail.data.orders.length}`);
check('總金額 180 + 210 = 390', detail.data.summary.grandTotal === 390, `total=${detail.data.summary.grandTotal}`);
check(
  '相同品項被合併（排骨便當 ×3）',
  detail.data.summary.byItem.find((i) => i.name === '排骨便當')?.qty === 3,
);
check('自填品項被標記', detail.data.summary.byItem.some((i) => i.isCustom));
check(
  'edit_token 不外流',
  !JSON.stringify(detail.data).includes(tampered.data.editToken),
);
check(
  'admin_token 不外流',
  !JSON.stringify(detail.data).includes(group.data.adminToken),
);

// ── 權限 ──────────────────────────────────────────────────────
console.log('\n權限');
const noToken = await call(`/orders/${tampered.data.orderId}/items`, {
  method: 'POST',
  body: { items: [{ menuItemId: bento.data.id, qty: 1 }] },
});
check('沒有 token 不能加點', noToken.status === 403, `status=${noToken.status}`);

const wrongToken = await call(`/orders/${tampered.data.orderId}/items`, {
  method: 'POST',
  headers: { 'X-Edit-Token': '00000000-0000-0000-0000-000000000000' },
  body: { items: [{ menuItemId: bento.data.id, qty: 1 }] },
});
check('錯誤的 token 不能加點', wrongToken.status === 403, `status=${wrongToken.status}`);

const detailBefore = await call(`/groups/${code}`);
const myItem = detailBefore.data.orders.find((o) => o.personName === '小華').items[0];

const noTokenPatch = await call(`/order-items/${myItem.id}`, {
  method: 'PATCH',
  body: { qty: 9 },
});
check('沒有 token 不能改品項內容', noTokenPatch.status === 403, `status=${noTokenPatch.status}`);

const ownEdit = await call(`/orders/${tampered.data.orderId}/items`, {
  method: 'POST',
  headers: { 'X-Edit-Token': tampered.data.editToken },
  body: { items: [{ name: '本人加點的啤酒', unitPrice: 120, qty: 1 }] },
});
check('本人可以加點（180 + 120 = 300）', ownEdit.data?.total === 300, `total=${ownEdit.data?.total}`);

const qtyPatch = await call(`/order-items/${myItem.id}`, {
  method: 'PATCH',
  headers: { 'X-Edit-Token': tampered.data.editToken },
  body: { qty: 1 },
});
check('本人可以改數量（90 + 120 = 210）', qtyPatch.data?.total === 210, `total=${qtyPatch.data?.total}`);
check('只改數量不會脫離菜單', qtyPatch.data?.item?.menuItemId === bento.data.id);

const renamePatch = await call(`/order-items/${myItem.id}`, {
  method: 'PATCH',
  headers: { 'X-Edit-Token': tampered.data.editToken },
  body: { name: '排骨便當（大）', unitPrice: 110 },
});
check('可以改品名與價格', renamePatch.data?.item?.name === '排骨便當（大）');
check(
  '改過內容就轉成自填品項（否則會被菜單蓋回去）',
  renamePatch.data?.item?.menuItemId === null && renamePatch.data?.item?.isCustom === true,
);
check('改價後金額重算（110 + 120 = 230）', renamePatch.data?.total === 230, `total=${renamePatch.data?.total}`);

const hostEdit = await call(`/orders/${custom.data.orderId}`, {
  method: 'DELETE',
  headers: { 'X-Admin-Token': group.data.adminToken },
});
check('開團者可以代刪訂單', hostEdit.status === 204, `status=${hostEdit.status}`);

const notAdmin = await call(`/groups/${code}`, {
  method: 'PATCH',
  headers: { 'X-Admin-Token': '00000000-0000-0000-0000-000000000000' },
  body: { status: 'closed' },
});
check('非開團者不能關團', notAdmin.status === 403, `status=${notAdmin.status}`);

// ── 關團 ──────────────────────────────────────────────────────
console.log('\n關團');
const closed = await call(`/groups/${code}`, {
  method: 'PATCH',
  headers: { 'X-Admin-Token': group.data.adminToken },
  body: { status: 'closed' },
});
check('開團者可以關團', closed.status === 200 && closed.data.status === 'closed');

const afterClose = await call(`/groups/${code}/orders`, {
  method: 'POST',
  body: { personName: '遲到的人', items: [{ menuItemId: bento.data.id, qty: 1 }] },
});
check('關團後不能再下單', afterClose.status === 400, `status=${afterClose.status}`);

const editAfterClose = await call(`/orders/${tampered.data.orderId}/items`, {
  method: 'POST',
  headers: { 'X-Edit-Token': tampered.data.editToken },
  body: { items: [{ menuItemId: bento.data.id, qty: 5 }] },
});
check('關團後本人不能加點', editAfterClose.status === 400, `status=${editAfterClose.status}`);

// ── 價格未確認 ────────────────────────────────────────────────
console.log('\n價格未確認');
const store2 = await call('/stores', { method: 'POST', body: { name: '[smoke] 估價店' } });
const fuzzyItem = await call(`/stores/${store2.data.id}/menu`, {
  method: 'POST',
  body: { name: '大概兩百的菜', price: 200, priceUncertain: true },
});
check('可建立價格未確認的品項', fuzzyItem.data?.priceUncertain === true);

const group2 = await call('/groups', {
  method: 'POST',
  body: { storeId: store2.data.id, title: '[smoke] 估價團', hostName: '小明' },
});
const fuzzyOrder = await call(`/groups/${group2.data.joinCode}/orders`, {
  method: 'POST',
  body: {
    personName: '小華',
    items: [
      { menuItemId: fuzzyItem.data.id, qty: 1 },
      { name: '不知道多少的飲料', unitPrice: 50, qty: 1, priceUncertain: true },
      { name: '確定 30 元的湯', unitPrice: 30, qty: 1 },
    ],
  },
});
check('估價品項可正常下單（200+50+30=280）', fuzzyOrder.data?.total === 280, `total=${fuzzyOrder.data?.total}`);

const fuzzyDetail = await call(`/groups/${group2.data.joinCode}`);
check('彙總標示含估價', fuzzyDetail.data.summary.hasUncertainPrice === true);
check(
  '估價部分金額正確（200+50=250）',
  fuzzyDetail.data.summary.uncertainSubtotal === 250,
  `uncertain=${fuzzyDetail.data.summary.uncertainSubtotal}`,
);
check(
  '確定價格的品項未被誤標',
  fuzzyDetail.data.summary.byItem.find((i) => i.name === '確定 30 元的湯')?.priceUncertain === false,
);

// 前端謊報菜單品項的不確定性應無效——以資料庫為準
const liedItem = await call(`/stores/${store2.data.id}/menu`, {
  method: 'POST',
  body: { name: '確定價格的菜', price: 100 },
});
const group3 = await call('/groups', {
  method: 'POST',
  body: { storeId: store2.data.id, title: '[smoke] 謊報團', hostName: '小明' },
});
await call(`/groups/${group3.data.joinCode}/orders`, {
  method: 'POST',
  body: { personName: '小華', items: [{ menuItemId: liedItem.data.id, qty: 1, priceUncertain: true }] },
});
const liedDetail = await call(`/groups/${group3.data.joinCode}`);
check(
  '菜單品項的不確定性由資料庫決定，前端無法偽造',
  liedDetail.data.summary.hasUncertainPrice === false,
);

// ── 重複與同名 ────────────────────────────────────────────────
console.log('\n重複與同名');
const dupe1 = await call('/groups', {
  method: 'POST',
  body: { storeId: store.data.id, title: '[smoke] 連點團', hostName: '手殘' },
});
const dupe2 = await call('/groups', {
  method: 'POST',
  body: { storeId: store.data.id, title: '[smoke] 連點團', hostName: '手殘' },
});
check('短時間內重複建立同一個團會回傳既有的團', dupe1.data.joinCode === dupe2.data.joinCode);
check('並標示為 reused', dupe2.data.reused === true);

const similar = await call(
  `/groups?storeId=${store.data.id}&title=${encodeURIComponent('[smoke] 連點團')}`,
);
check('可查詢同名且收單中的團', similar.data.length >= 1 && similar.data[0].joinCode === dupe1.data.joinCode);
check('同名團查詢不外流 adminToken', !JSON.stringify(similar.data).includes(dupe1.data.adminToken));

// ── 進行中的清單 ──────────────────────────────────────────────
console.log('\n進行中的清單');
const activeList = await call('/groups/active');
const activeDupe = activeList.data.find((g) => g.joinCode === dupe1.data.joinCode);
check('剛開的團會出現在進行中清單', Boolean(activeDupe), `status=${activeList.status}`);
check('清單帶得出店名與有效期限', activeDupe?.storeName === store.data.name && Boolean(activeDupe?.expiresAt));
check('已關閉的團不在清單裡', !activeList.data.some((g) => g.joinCode === code));

// 逾期的團仍是 open，但已經收不了單，不該再出現在首頁
const expired = await call('/groups', {
  method: 'POST',
  body: {
    storeId: store.data.id,
    title: '[smoke] 逾期團',
    hostName: '遲到王',
    deadlineAt: new Date(Date.now() - 60_000).toISOString(),
  },
});
const afterExpired = await call('/groups/active');
check(
  '超過截止時間的團不在清單裡',
  !afterExpired.data.some((g) => g.joinCode === expired.data.joinCode),
);
check(
  '進行中清單不外流 adminToken 與 manageCode',
  !JSON.stringify(activeList.data).includes(dupe1.data.adminToken) &&
    !JSON.stringify(activeList.data).includes(dupe1.data.manageCode),
);

const sameName1 = await call(`/groups/${dupe1.data.joinCode}/orders`, {
  method: 'POST',
  body: { personName: '小明', items: [{ menuItemId: bento.data.id, qty: 1 }] },
});
check('第一個小明可以下單', sameName1.status === 201);

const sameName2 = await call(`/groups/${dupe1.data.joinCode}/orders`, {
  method: 'POST',
  body: { personName: '小明', items: [{ menuItemId: bento.data.id, qty: 1 }] },
});
check('同團第二個同名者被擋下', sameName2.status === 409, `status=${sameName2.status}`);
check('錯誤訊息提示如何區隔', /小明2/.test(sameName2.data?.error || ''));

const renamed = await call(`/groups/${dupe1.data.joinCode}/orders`, {
  method: 'POST',
  body: { personName: '小明2', items: [{ menuItemId: bento.data.id, qty: 1 }] },
});
check('換個名字就能下單', renamed.status === 201, `status=${renamed.status}`);

// ── 刪除團 ────────────────────────────────────────────────────
console.log('\n刪除團');
const delNoToken = await call(`/groups/${dupe1.data.joinCode}`, { method: 'DELETE' });
check('沒有 adminToken 不能刪團', delNoToken.status === 403, `status=${delNoToken.status}`);

const delWrongToken = await call(`/groups/${dupe1.data.joinCode}`, {
  method: 'DELETE',
  headers: { 'X-Admin-Token': '00000000-0000-0000-0000-000000000000' },
});
check('錯誤的 adminToken 不能刪團', delWrongToken.status === 403, `status=${delWrongToken.status}`);

const delOk = await call(`/groups/${dupe1.data.joinCode}`, {
  method: 'DELETE',
  headers: { 'X-Admin-Token': dupe1.data.adminToken },
});
check('開團者可以刪團', delOk.status === 204, `status=${delOk.status}`);

const gone = await call(`/groups/${dupe1.data.joinCode}`);
check('刪除後查不到', gone.status === 404, `status=${gone.status}`);

const [orphan] = await db
  .select({ n: count() })
  .from(orders)
  .where(eq(orders.id, sameName1.data.orderId));
check('團內訂單一併被刪除（cascade）', orphan.n === 0);

// ── 品項狀態 ──────────────────────────────────────────────────
console.log('\n品項狀態');
const sGroup = await call('/groups', {
  method: 'POST',
  body: { storeId: store.data.id, title: '[smoke] 狀態團', hostName: '小明' },
});
const sCode = sGroup.data.joinCode;

const mkOrder = (name) =>
  call(`/groups/${sCode}/orders`, {
    method: 'POST',
    body: { personName: name, items: [{ menuItemId: bento.data.id, qty: 1 }] },
  });

const oA = await mkOrder('阿一');
const oB = await mkOrder('阿二');
const oC = await mkOrder('阿三');

const itemsOf = (detail, personName) =>
  detail.data.orders.find((o) => o.personName === personName).items;

const initial = await call(`/groups/${sCode}`);
check('新品項預設為未點單', initial.data.orders.every((o) => o.items.every((i) => i.status === 'pending')));
check('整張單的狀態由品項推導', initial.data.orders.every((o) => o.status === 'pending'));
check('狀態統計以品項為單位', initial.data.summary.statusCounts.pending === 3);

const itemA = itemsOf(initial, '阿一')[0];
const itemB = itemsOf(initial, '阿二')[0];
const itemC = itemsOf(initial, '阿三')[0];

const badJump = await call(`/order-items/${itemA.id}/status`, {
  method: 'PATCH',
  body: { status: 'served' },
});
check('未點單不能直接跳到已到餐', badJump.status === 400, `status=${badJump.status}`);

const toOrdered = await call(`/order-items/${itemA.id}/status`, {
  method: 'PATCH',
  body: { status: 'ordered' },
});
check('未點單 → 已點單', toOrdered.data?.status === 'ordered');

const toServed = await call(`/order-items/${itemA.id}/status`, {
  method: 'PATCH',
  body: { status: 'served' },
});
check('已點單 → 已到餐', toServed.data?.status === 'served');

// 狀態是全系統唯一不需憑證的寫入：現場誰看到餐送來誰就能按
const statusNoToken = await call(`/order-items/${itemB.id}/status`, {
  method: 'PATCH',
  body: { status: 'ordered' },
});
check('任何人都能改品項狀態（不需憑證）', statusNoToken.data?.status === 'ordered', `status=${statusNoToken.status}`);

// ── 已送單之後繼續加點 ────────────────────────────────────────
console.log('\n已送單之後繼續加點');
const secondRound = await call(`/orders/${oA.data.orderId}/items`, {
  method: 'POST',
  headers: { 'X-Edit-Token': oA.data.editToken },
  body: { items: [{ name: '第二輪的酒', unitPrice: 300, qty: 1 }] },
});
check('已到餐的單仍可加點', secondRound.status === 201, `status=${secondRound.status}`);

const roundDetail = await call(`/groups/${sCode}`);
const aItems = itemsOf(roundDetail, '阿一');
check('加點不會動到既有品項的狀態', aItems.find((i) => i.id === itemA.id)?.status === 'served');
check('新加的品項是未點單', aItems.find((i) => i.name === '第二輪的酒')?.status === 'pending');
check('同一張單可以同時有已到餐與未點單', new Set(aItems.map((i) => i.status)).size === 2);
check('整張單的狀態退回最落後的那一項', roundDetail.data.orders.find((o) => o.personName === '阿一')?.status === 'pending');
check('金額累加（90 + 300 = 390）', roundDetail.data.orders.find((o) => o.personName === '阿一')?.total === 390);
check(
  '「還沒跟店家點的」只列出未點單的品項',
  roundDetail.data.summary.pendingByItem.some((i) => i.name === '第二輪的酒') &&
    !roundDetail.data.summary.pendingByItem.some((i) => i.name === '排骨便當' && i.qty > 2),
);

// ── 撤單只影響單一品項 ────────────────────────────────────────
console.log('\n撤單');
await call(`/order-items/${itemC.id}/status`, { method: 'PATCH', body: { status: 'ordered' } });
await call(`/order-items/${itemC.id}/status`, { method: 'PATCH', body: { status: 'cancel_requested' } });
const beforeCancel = await call(`/groups/${sCode}`);
check(
  '待撤單仍計入金額（90×3 + 300 = 570）',
  beforeCancel.data.summary.grandTotal === 570,
  `total=${beforeCancel.data.summary.grandTotal}`,
);

await call(`/order-items/${itemC.id}/status`, { method: 'PATCH', body: { status: 'cancelled' } });
const afterCancel = await call(`/groups/${sCode}`);
check(
  '已撤單不計入金額（570 - 90 = 480）',
  afterCancel.data.summary.grandTotal === 480,
  `total=${afterCancel.data.summary.grandTotal}`,
);
check('整張單都撤掉的人不計入人數', afterCancel.data.summary.peopleCount === 2, `n=${afterCancel.data.summary.peopleCount}`);
check('已撤單不進入叫餐清單（排骨便當 ×2）', afterCancel.data.summary.byItem.find((i) => i.name === '排骨便當')?.qty === 2);
check('撤單金額另計', afterCancel.data.summary.cancelledTotal === 90, `n=${afterCancel.data.summary.cancelledTotal}`);
check('撤單後 orders.total 一併重算', afterCancel.data.orders.find((o) => o.personName === '阿三')?.total === 0);
check(
  'byPerson 仍保留已撤單者但標記 counted=false',
  afterCancel.data.summary.byPerson.find((p) => p.personName === '阿三')?.counted === false,
);

// 只撤掉一張單裡的其中一樣
const partial = await call(`/orders/${oB.data.orderId}/items`, {
  method: 'POST',
  headers: { 'X-Edit-Token': oB.data.editToken },
  body: { items: [{ name: '點錯的東西', unitPrice: 500, qty: 1 }] },
});
check('阿二加點後 90 + 500 = 590', partial.data?.total === 590, `total=${partial.data?.total}`);
const wrongItemId = partial.data.addedItemIds[0];
await call(`/order-items/${wrongItemId}/status`, { method: 'PATCH', body: { status: 'cancelled' } });
const partialDetail = await call(`/groups/${sCode}`);
const bOrder = partialDetail.data.orders.find((o) => o.personName === '阿二');
check('撤掉其中一樣，其餘照算（回到 90）', bOrder?.total === 90, `total=${bOrder?.total}`);
check('這個人仍計入人數', bOrder?.counted === true);
check('被撤掉的品項還留著（看得到自己撤了什麼）', bOrder?.items.length === 2);

// ── 批次 ──────────────────────────────────────────────────────
console.log('\n批次');
const bulkNotAdmin = await call(`/groups/${sCode}/orders/status`, {
  method: 'PATCH',
  headers: { 'X-Admin-Token': '00000000-0000-0000-0000-000000000000' },
  body: { from: 'ordered', to: 'served' },
});
check('非發起人不能批次改狀態', bulkNotAdmin.status === 403, `status=${bulkNotAdmin.status}`);

const bulkOk = await call(`/groups/${sCode}/orders/status`, {
  method: 'PATCH',
  headers: { 'X-Admin-Token': sGroup.data.adminToken },
  body: { from: 'pending', to: 'ordered' },
});
check('批次把這一輪未點單的標為已點單', bulkOk.data?.updated === 1, `updated=${bulkOk.data?.updated}`);

const afterBulk = await call(`/groups/${sCode}`);
check(
  '批次不會動到已經到餐的品項',
  itemsOf(afterBulk, '阿一').find((i) => i.id === itemA.id)?.status === 'served',
);

const bulkAll = await call(`/groups/${sCode}/orders/status`, {
  method: 'PATCH',
  headers: { 'X-Admin-Token': sGroup.data.adminToken },
  body: { to: 'ordered' },
});
check(
  '批次遇到不合法轉移會略過而非整批失敗',
  bulkAll.status === 200 && bulkAll.data.skipped >= 1,
  `updated=${bulkAll.data?.updated} skipped=${bulkAll.data?.skipped}`,
);

// 結束點餐後仍可推進狀態（餐點是結束點餐後才陸續送達的）
await call(`/groups/${sCode}`, {
  method: 'PATCH',
  headers: { 'X-Admin-Token': sGroup.data.adminToken },
  body: { status: 'closed' },
});
const afterClosed = await call(`/order-items/${itemB.id}/status`, {
  method: 'PATCH',
  body: { status: 'served' },
});
check('結束點餐後仍可標記已到餐', afterClosed.data?.status === 'served', `status=${afterClosed.status}`);

const addAfterClosed = await call(`/orders/${oB.data.orderId}/items`, {
  method: 'POST',
  headers: { 'X-Edit-Token': oB.data.editToken },
  body: { items: [{ name: '關團後想加的', unitPrice: 50, qty: 1 }] },
});
check('但結束點餐後不能再加點', addAfterClosed.status === 400, `status=${addAfterClosed.status}`);

// ── 刪除單一品項 ──────────────────────────────────────────────
console.log('\n刪除單一品項');
const dGroup = await call('/groups', {
  method: 'POST',
  body: { storeId: store.data.id, title: '[smoke] 刪品項團', hostName: '小明' },
});
const dOrder = await call(`/groups/${dGroup.data.joinCode}/orders`, {
  method: 'POST',
  body: {
    personName: '阿四',
    items: [
      { menuItemId: bento.data.id, qty: 1 },
      { name: '要被刪掉的', unitPrice: 40, qty: 1 },
    ],
  },
});
const dDetail = await call(`/groups/${dGroup.data.joinCode}`);
const doomed = itemsOf(dDetail, '阿四').find((i) => i.name === '要被刪掉的');

const delItemNoToken = await call(`/order-items/${doomed.id}`, { method: 'DELETE' });
check('沒有 token 不能刪品項', delItemNoToken.status === 403, `status=${delItemNoToken.status}`);

const delItemOk = await call(`/order-items/${doomed.id}`, {
  method: 'DELETE',
  headers: { 'X-Edit-Token': dOrder.data.editToken },
});
check('本人可以刪單一品項', delItemOk.status === 204, `status=${delItemOk.status}`);

const afterDelItem = await call(`/groups/${dGroup.data.joinCode}`);
check('刪品項後金額重算（130 - 40 = 90）', afterDelItem.data.orders[0].total === 90, `total=${afterDelItem.data.orders[0].total}`);
check('其餘品項不受影響', afterDelItem.data.orders[0].items.length === 1);

// ── 截止時間 ──────────────────────────────────────────────────
console.log('\n截止時間');
const expired = await call('/groups', {
  method: 'POST',
  body: {
    storeId: store.data.id,
    title: '[smoke] 過期團',
    hostName: '小明',
    deadlineAt: new Date(Date.now() - 60_000).toISOString(),
  },
});
const afterDeadline = await call(`/groups/${expired.data.joinCode}/orders`, {
  method: 'POST',
  body: { personName: '遲到的人', items: [{ menuItemId: bento.data.id, qty: 1 }] },
});
check('超過截止時間不能下單', afterDeadline.status === 400, `status=${afterDeadline.status}`);

// ── 登記暱稱與分單 ────────────────────────────────────────────
//
// 分單的金額除不盡時，多出來的一元會依品項 id 輪到某個人身上（見 lib/split.js），
// 所以下面一律驗證「合計」與「該分到幾份」，不對個別的人寫死絕對值。
console.log('\n登記暱稱與分單');
const spStore = await call('/stores', { method: 'POST', body: { name: '[smoke] 分單酒吧' } });
const spWine = await call(`/stores/${spStore.data.id}/menu`, {
  method: 'POST',
  body: { name: '一瓶紅酒', price: 100, category: '酒' },
});
const spFood = await call(`/stores/${spStore.data.id}/menu`, {
  method: 'POST',
  body: { name: '拼盤', price: 90, category: '下酒菜' },
});
const spGroup = await call('/groups', {
  method: 'POST',
  body: { storeId: spStore.data.id, title: '[smoke] 分單團', hostName: '甲' },
});
const spCode = spGroup.data.joinCode;
const spAdmin = { 'X-Admin-Token': spGroup.data.adminToken };

const reg甲 = await call(`/groups/${spCode}/orders`, { method: 'POST', body: { personName: '甲' } });
check('可以只登記暱稱、不點東西', reg甲.status === 201 && reg甲.data.orderId, `status=${reg甲.status}`);
const reg乙 = await call(`/groups/${spCode}/orders`, {
  method: 'POST',
  body: { personName: '乙', items: [] },
});
const reg丙 = await call(`/groups/${spCode}/orders`, {
  method: 'POST',
  body: { personName: '丙', items: [] },
});
check(
  '同一團不能重複登記同一個暱稱',
  (await call(`/groups/${spCode}/orders`, { method: 'POST', body: { personName: '甲' } })).status === 409,
);

let spSnap = await call(`/groups/${spCode}`);
check('只登記還沒點的人不算人頭', spSnap.data.summary.peopleCount === 0);
check('但算在參與者裡', spSnap.data.summary.participantCount === 3);

// 全部平分
await call(`/orders/${reg甲.data.orderId}/items`, {
  method: 'POST',
  headers: { 'X-Edit-Token': reg甲.data.editToken },
  body: { items: [{ menuItemId: spWine.data.id, qty: 1, shareScope: 'all', note: '常溫' }] },
});
spSnap = await call(`/groups/${spCode}`);
const payerOf = (name) => spSnap.data.summary.byPerson.find((p) => p.personName === name);
check(
  '全部平分：100 拆成 34/33/33',
  [payerOf('甲').payable, payerOf('乙').payable, payerOf('丙').payable].sort().join(',') === '33,33,34',
  JSON.stringify(spSnap.data.summary.byPerson.map((p) => [p.personName, p.payable])),
);
check('分擔總和等於總額（零頭不會漏掉）', spSnap.data.summary.split.total === spSnap.data.summary.grandTotal);
check('點的人自己的單仍是 100', payerOf('甲').ownTotal === 100);
check('分擔到的人現在算人頭了', spSnap.data.summary.peopleCount === 3);
check('品項備註存得下來', spSnap.data.orders[0].items[0].note === '常溫');
check('分單品項進入一覽表', spSnap.data.summary.split.items[0]?.payers.length === 3);

// 指定的人
await call(`/orders/${reg乙.data.orderId}/items`, {
  method: 'POST',
  headers: { 'X-Edit-Token': reg乙.data.editToken },
  body: {
    items: [
      { menuItemId: spFood.data.id, qty: 1, shareScope: 'custom', sharedWith: [reg丙.data.orderId] },
    ],
  },
});
spSnap = await call(`/groups/${spCode}`);
check('指定分單：90 由乙丙對半，乙自己那份是 45', payerOf('乙').ownPayable === 45, `${payerOf('乙').ownPayable}`);
check(
  '三人合計等於總額 190',
  payerOf('甲').payable + payerOf('乙').payable + payerOf('丙').payable === 190,
);

check(
  '不能把品項分給不在這一團的人',
  (
    await call(`/orders/${reg乙.data.orderId}/items`, {
      method: 'POST',
      headers: { 'X-Edit-Token': reg乙.data.editToken },
      body: {
        items: [
          {
            menuItemId: spFood.data.id,
            qty: 1,
            shareScope: 'custom',
            sharedWith: ['00000000-0000-0000-0000-000000000000'],
          },
        ],
      },
    })
  ).status === 400,
);

// 發起人代改別人的單一品項
const foodItem = spSnap.data.orders
  .find((o) => o.personName === '乙')
  .items.find((i) => i.name === '拼盤');
const hostPatch = await call(`/order-items/${foodItem.id}`, {
  method: 'PATCH',
  headers: spAdmin,
  body: { qty: 2, note: '不要辣', name: '拼盤', unitPrice: 90 },
});
check('發起人可以改別人的品項', hostPatch.status === 200, JSON.stringify(hostPatch.data));
check('品項備註寫得進去', hostPatch.data.item.note === '不要辣');
check('值沒變就不會被踢出菜單', hostPatch.data.item.isCustom === false);
check('分單設定不受影響', hostPatch.data.item.shareScope === 'custom');
check(
  '真的改了價格才脫離菜單',
  (
    await call(`/order-items/${foodItem.id}`, {
      method: 'PATCH',
      headers: spAdmin,
      body: { unitPrice: 110 },
    })
  ).data.item.isCustom === true,
);

// 撤單與刪人
const wineItem = spSnap.data.orders.find((o) => o.personName === '甲').items[0];
await call(`/order-items/${wineItem.id}/status`, { method: 'PATCH', body: { status: 'cancelled' } });
spSnap = await call(`/groups/${spCode}`);
check('撤掉的分單品項不跟任何人收錢', payerOf('甲').payable === 0);
check('撤單後總和仍守恆', spSnap.data.summary.split.total === spSnap.data.summary.grandTotal);

await call(`/orders/${reg丙.data.orderId}`, { method: 'DELETE', headers: spAdmin });
spSnap = await call(`/groups/${spCode}`);
check('被分擔的人整張單被刪掉後，金額仍守恆', spSnap.data.summary.split.total === spSnap.data.summary.grandTotal);

check(
  '關團後發起人仍可修改品項（收拾殘局）',
  (await call(`/groups/${spCode}`, { method: 'PATCH', headers: spAdmin, body: { status: 'closed' } }))
    .status === 200 &&
    (
      await call(`/order-items/${foodItem.id}`, {
        method: 'PATCH',
        headers: spAdmin,
        body: { note: '結帳時補的備註' },
      })
    ).status === 200,
);

// ── 點單後就不能再改品名與數量 ────────────────────────────────
//
// 跟店家點過之後，店家手上那張單就定了，本人再改只會讓兩邊對不起來。
// 只鎖品名與數量：價格常常是點完才知道的，備註與分單也多半在結帳當下才喬。
console.log('\n點單後就不能再改品名與數量');
const lkGroup = await call('/groups', {
  method: 'POST',
  body: { storeId: store.data.id, title: '[smoke] 鎖定團', hostName: '小明' },
});
const lkCode = lkGroup.data.joinCode;
const lkAdmin = { 'X-Admin-Token': lkGroup.data.adminToken };
const lkOrder = await call(`/groups/${lkCode}/orders`, {
  method: 'POST',
  body: { personName: '阿鎖', items: [{ menuItemId: bento.data.id, qty: 1 }] },
});
const lkEdit = { 'X-Edit-Token': lkOrder.data.editToken };
const lkItem = (await call(`/groups/${lkCode}`)).data.orders[0].items[0];

check(
  '未點單時本人可以改數量',
  (await call(`/order-items/${lkItem.id}`, { method: 'PATCH', headers: lkEdit, body: { qty: 2 } }))
    .status === 200,
);

await call(`/order-items/${lkItem.id}/status`, { method: 'PATCH', body: { status: 'ordered' } });

const lkQty = await call(`/order-items/${lkItem.id}`, {
  method: 'PATCH',
  headers: lkEdit,
  body: { qty: 5 },
});
check('已點單後本人不能改數量', lkQty.status === 400, `status=${lkQty.status}`);

const lkName = await call(`/order-items/${lkItem.id}`, {
  method: 'PATCH',
  headers: lkEdit,
  body: { name: '偷改的品名' },
});
check('已點單後本人不能改品名', lkName.status === 400, `status=${lkName.status}`);

const lkResend = await call(`/order-items/${lkItem.id}`, {
  method: 'PATCH',
  headers: lkEdit,
  body: { name: lkItem.name, qty: 2, note: '少辣' },
});
check(
  '原樣送回品名數量不算修改（編輯表單會整份送出）',
  lkResend.status === 200 && lkResend.data.item.note === '少辣',
  `status=${lkResend.status}`,
);

check(
  '已點單後本人仍可補價格（自填品項常常是後來才知道多少錢）',
  (
    await call(`/order-items/${lkItem.id}`, {
      method: 'PATCH',
      headers: lkEdit,
      body: { unitPrice: 95 },
    })
  ).status === 200,
);

const lkDel = await call(`/order-items/${lkItem.id}`, { method: 'DELETE', headers: lkEdit });
check('已點單後本人不能直接刪品項（要走撤單）', lkDel.status === 400, `status=${lkDel.status}`);

const lkDelOrder = await call(`/orders/${lkOrder.data.orderId}`, { method: 'DELETE', headers: lkEdit });
check(
  '單裡有已點單的品項時本人不能整張刪掉',
  lkDelOrder.status === 400,
  `status=${lkDelOrder.status}`,
);

check(
  '發起人不受此限（收拾殘局是他的事）',
  (await call(`/order-items/${lkItem.id}`, { method: 'PATCH', headers: lkAdmin, body: { qty: 7 } }))
    .status === 200,
);

check(
  '本人仍可繼續加點（要多點就另外加一筆）',
  (
    await call(`/orders/${lkOrder.data.orderId}/items`, {
      method: 'POST',
      headers: lkEdit,
      body: { items: [{ menuItemId: bento.data.id, qty: 1 }] },
    })
  ).status === 201,
);

// ── 管理代碼與管理者 ──────────────────────────────────────────
//
// 協助管理者能改任何人的單、批次推進度，但關攤、刪攤與指派角色要最高管理者才行。
console.log('\n管理代碼與管理者');
const mgGroup = await call('/groups', {
  method: 'POST',
  body: { storeId: store.data.id, title: '[smoke] 管理團', hostName: '小明' },
});
const mgCode = mgGroup.data.joinCode;
const mgAdmin = { 'X-Admin-Token': mgGroup.data.adminToken };
const mgManage = { 'X-Manage-Code': mgGroup.data.manageCode };

check(
  '開團回傳 8 碼管理代碼',
  /^[A-Z2-9]{8}$/.test(mgGroup.data.manageCode || ''),
  mgGroup.data.manageCode,
);
check('管理代碼與團號不同', mgGroup.data.manageCode !== mgCode);

check(
  '沒帶憑證讀團看不到管理代碼',
  (await call(`/groups/${mgCode}`)).data.group.manageCode === undefined,
);
check(
  '發起人讀團才拿得回管理代碼',
  (await call(`/groups/${mgCode}`, { headers: mgAdmin })).data.group.manageCode ===
    mgGroup.data.manageCode,
);

check(
  '打錯管理代碼會被擋下',
  (await call(`/groups/${mgCode}/manage-code`, { method: 'POST', body: { manageCode: 'WRONGONE' } }))
    .status === 403,
);
check(
  '管理代碼不分大小寫',
  (
    await call(`/groups/${mgCode}/manage-code`, {
      method: 'POST',
      body: { manageCode: mgGroup.data.manageCode.toLowerCase() },
    })
  ).status === 200,
);

const mgVictim = await call(`/groups/${mgCode}/orders`, {
  method: 'POST',
  body: { personName: '被改的人', items: [{ menuItemId: bento.data.id, qty: 1 }] },
});
const mgHelper = await call(`/groups/${mgCode}/orders`, {
  method: 'POST',
  body: { personName: '幫忙的人', items: [{ menuItemId: bento.data.id, qty: 1 }] },
});
const mgVictimItem = (await call(`/groups/${mgCode}`)).data.orders.find(
  (o) => o.personName === '被改的人',
).items[0];

check(
  '持有管理代碼就能改別人的品項',
  (await call(`/order-items/${mgVictimItem.id}`, { method: 'PATCH', headers: mgManage, body: { qty: 3 } }))
    .status === 200,
);
check(
  '持有管理代碼可以批次改狀態',
  (
    await call(`/groups/${mgCode}/orders/status`, {
      method: 'PATCH',
      headers: mgManage,
      body: { from: 'pending', to: 'ordered' },
    })
  ).data?.updated === 2,
);
check(
  '管理代碼改得動已點單的品名數量（他就是來收拾殘局的）',
  (await call(`/order-items/${mgVictimItem.id}`, { method: 'PATCH', headers: mgManage, body: { qty: 1 } }))
    .status === 200,
);
check(
  '協助管理者不能關攤',
  (await call(`/groups/${mgCode}`, { method: 'PATCH', headers: mgManage, body: { status: 'closed' } }))
    .status === 403,
);
check(
  '協助管理者也不能刪攤',
  (await call(`/groups/${mgCode}`, { method: 'DELETE', headers: mgManage })).status === 403,
);
check(
  '持管理代碼的人指派不了任何人（代碼收不回來，不能再生管理者）',
  (
    await call(`/orders/${mgHelper.data.orderId}/role`, {
      method: 'PATCH',
      headers: mgManage,
      body: { role: 'manager' },
    })
  ).status === 403,
);

// ── 指派角色 ──────────────────────────────────────────────────
console.log('\n指派角色');
const mgHelperEdit = { 'X-Edit-Token': mgHelper.data.editToken };
const mgVictimEdit = { 'X-Edit-Token': mgVictim.data.editToken };

check('新登記的人預設是參與者', (await call(`/groups/${mgCode}`)).data.orders.every((o) => o.role === 'participant'));
check(
  '參與者改不動別人的單',
  (await call(`/order-items/${mgVictimItem.id}`, { method: 'PATCH', headers: mgHelperEdit, body: { qty: 4 } }))
    .status === 403,
);

const mgGrant = await call(`/orders/${mgHelper.data.orderId}/role`, {
  method: 'PATCH',
  headers: mgAdmin,
  body: { role: 'manager' },
});
check('發起人可以指派協助管理者', mgGrant.status === 200 && mgGrant.data.role === 'manager');
check(
  '清單看得出誰是什麼角色',
  (await call(`/groups/${mgCode}`)).data.orders.find((o) => o.personName === '幫忙的人')?.role ===
    'manager',
);
check(
  '協助管理者用自己的 editToken 就能改別人的單',
  (await call(`/order-items/${mgVictimItem.id}`, { method: 'PATCH', headers: mgHelperEdit, body: { qty: 4 } }))
    .status === 200,
);
check(
  '但協助管理者指派不了別人',
  (
    await call(`/orders/${mgVictim.data.orderId}/role`, {
      method: 'PATCH',
      headers: mgHelperEdit,
      body: { role: 'manager' },
    })
  ).status === 403,
);
check(
  '協助管理者也關不了攤',
  (await call(`/groups/${mgCode}`, { method: 'PATCH', headers: mgHelperEdit, body: { status: 'closed' } }))
    .status === 403,
);

// 升成最高管理者
await call(`/orders/${mgHelper.data.orderId}/role`, {
  method: 'PATCH',
  headers: mgAdmin,
  body: { role: 'admin' },
});
check(
  '最高管理者可以指派別人',
  (
    await call(`/orders/${mgVictim.data.orderId}/role`, {
      method: 'PATCH',
      headers: mgHelperEdit,
      body: { role: 'manager' },
    })
  ).status === 200,
);
check(
  '最高管理者可以關攤與重新開放',
  (await call(`/groups/${mgCode}`, { method: 'PATCH', headers: mgHelperEdit, body: { status: 'closed' } }))
    .status === 200 &&
    (await call(`/groups/${mgCode}`, { method: 'PATCH', headers: mgHelperEdit, body: { status: 'open' } }))
      .status === 200,
);
check(
  '但最高管理者拿不到管理代碼（角色收得回來，代碼收不回來）',
  (await call(`/groups/${mgCode}`, { headers: mgHelperEdit })).data.group.manageCode === undefined,
);

// 降回參與者
await call(`/orders/${mgHelper.data.orderId}/role`, {
  method: 'PATCH',
  headers: mgAdmin,
  body: { role: 'participant' },
});
check(
  '降回參與者後就改不動別人的單了',
  (await call(`/order-items/${mgVictimItem.id}`, { method: 'PATCH', headers: mgHelperEdit, body: { qty: 2 } }))
    .status === 403,
);
check(
  '也不能再指派任何人',
  (
    await call(`/orders/${mgVictim.data.orderId}/role`, {
      method: 'PATCH',
      headers: mgHelperEdit,
      body: { role: 'admin' },
    })
  ).status === 403,
);
check(
  '亂寫的角色會被擋下',
  (
    await call(`/orders/${mgHelper.data.orderId}/role`, {
      method: 'PATCH',
      headers: mgAdmin,
      body: { role: 'superuser' },
    })
  ).status === 400,
);
check(
  '被指派過的人仍可正常改自己的單',
  (await call(`/orders/${mgHelper.data.orderId}`, { method: 'PATCH', headers: mgHelperEdit, body: { note: '我還在' } }))
    .status === 200,
);
check(
  '管理代碼不會出現在沒帶憑證的完整快照裡',
  !JSON.stringify(await call(`/groups/${mgCode}`)).includes(mgGroup.data.manageCode),
);
// mgVictimEdit 用來確認參與者的界線沒被角色系統放寬
check(
  '參與者仍然改得動自己的單',
  (await call(`/orders/${mgVictim.data.orderId}`, { method: 'PATCH', headers: mgVictimEdit, body: { note: '我的備註' } }))
    .status === 200,
);

// 刪攤：最高管理者做得到，協助管理者不行。另開一攤，免得刪掉上面還在用的那個
const delGroup = await call('/groups', {
  method: 'POST',
  body: { storeId: store.data.id, title: '[smoke] 刪攤權限團', hostName: '小明' },
});
const delCode = delGroup.data.joinCode;
const delAdmin = { 'X-Admin-Token': delGroup.data.adminToken };
const delHelper = await call(`/groups/${delCode}/orders`, {
  method: 'POST',
  body: { personName: '副手', items: [{ menuItemId: bento.data.id, qty: 1 }] },
});
const delHelperEdit = { 'X-Edit-Token': delHelper.data.editToken };

await call(`/orders/${delHelper.data.orderId}/role`, {
  method: 'PATCH',
  headers: delAdmin,
  body: { role: 'manager' },
});
check(
  '協助管理者刪不掉整攤',
  (await call(`/groups/${delCode}`, { method: 'DELETE', headers: delHelperEdit })).status === 403,
);

await call(`/orders/${delHelper.data.orderId}/role`, {
  method: 'PATCH',
  headers: delAdmin,
  body: { role: 'admin' },
});
check(
  '最高管理者可以刪掉整攤',
  (await call(`/groups/${delCode}`, { method: 'DELETE', headers: delHelperEdit })).status === 204,
);
check('刪掉之後就查不到了', (await call(`/groups/${delCode}`)).status === 404);

// ── 菜單批次匯入 ──────────────────────────────────────────────
console.log('\n菜單批次匯入');
const csvStore = await call('/stores', { method: 'POST', body: { name: '[smoke] 匯入店' } });
const bulkOkResult = await call(`/stores/${csvStore.data.id}/menu/bulk`, {
  method: 'POST',
  body: {
    items: [
      { name: '匯入的排骨飯', price: 90, category: '便當' },
      { name: '匯入的雞腿飯', price: 100, category: '便當' },
      { name: '匯入的湯', price: 0, priceUncertain: true },
    ],
  },
});
check('可以一次匯入多個品項', bulkOkResult.status === 201 && bulkOkResult.data.created === 3,
  `status=${bulkOkResult.status}`);

const csvMenu = await call(`/stores/${csvStore.data.id}/menu`);
check('匯入的品項讀得到', csvMenu.data.length === 3, `n=${csvMenu.data.length}`);
check(
  '沒給分類的落到預設值「主餐」',
  csvMenu.data.find((i) => i.name === '匯入的湯')?.category === '主餐',
);
check('價格待確認有帶進去', csvMenu.data.find((i) => i.name === '匯入的湯')?.priceUncertain === true);
check(
  '沒給排序時照送出的順序遞增',
  (() => {
    const a = csvMenu.data.find((i) => i.name === '匯入的排骨飯');
    const b = csvMenu.data.find((i) => i.name === '匯入的雞腿飯');
    return a.sortOrder < b.sortOrder;
  })(),
);

const bulkBad = await call(`/stores/${csvStore.data.id}/menu/bulk`, {
  method: 'POST',
  body: { items: [{ name: '好的', price: 50 }, { name: '壞的', price: -1 }] },
});
check('有一列不合法就整批退回', bulkBad.status === 400, `status=${bulkBad.status}`);
check(
  '退回後真的沒有寫進去（transaction）',
  (await call(`/stores/${csvStore.data.id}/menu`)).data.length === 3,
);

check(
  '空陣列會被擋下',
  (await call(`/stores/${csvStore.data.id}/menu/bulk`, { method: 'POST', body: { items: [] } }))
    .status === 400,
);
check(
  '匯入到不存在的店家回 404',
  (
    await call('/stores/999999999/menu/bulk', {
      method: 'POST',
      body: { items: [{ name: '孤兒品項', price: 10 }] },
    })
  ).status === 404,
);

// ── 收尾 ──────────────────────────────────────────────────────
await cleanup();
await closeDb();

console.log(`\n通過 ${passed} 項，失敗 ${failed} 項\n`);
process.exit(failed ? 1 : 0);
