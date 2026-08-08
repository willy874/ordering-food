/**
 * 端對端煙霧測試。
 *
 * 需要伺服器已啟動（npm run dev:server）且 DATABASE_URL 指向可寫入的資料庫。
 *   npm run smoke
 *
 * 測試資料一律以 [smoke] 開頭，結束後自動清除。
 */
import { pool } from './db.js';

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
  await pool.query(`delete from group_orders where title like '[smoke]%'`);
  await pool.query(`delete from stores where name like '[smoke]%'`);
}

console.log(`\n對 ${BASE} 執行煙霧測試\n`);
await cleanup();

// ── 店家與菜單 ────────────────────────────────────────────────
console.log('店家與菜單');
const store = await call('/stores', { method: 'POST', body: { name: '[smoke] 測試便當店' } });
check('建立店家', store.status === 201 && store.data.id, `status=${store.status}`);

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
  body: { name: '天價便當', price: 99999 },
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
const noToken = await call(`/orders/${tampered.data.orderId}`, {
  method: 'PUT',
  body: { personName: '駭客', items: [{ menuItemId: bento.data.id, qty: 1 }] },
});
check('沒有 token 不能改單', noToken.status === 403, `status=${noToken.status}`);

const wrongToken = await call(`/orders/${tampered.data.orderId}`, {
  method: 'PUT',
  headers: { 'X-Edit-Token': '00000000-0000-0000-0000-000000000000' },
  body: { personName: '駭客', items: [{ menuItemId: bento.data.id, qty: 1 }] },
});
check('錯誤的 token 不能改單', wrongToken.status === 403, `status=${wrongToken.status}`);

const ownEdit = await call(`/orders/${tampered.data.orderId}`, {
  method: 'PUT',
  headers: { 'X-Edit-Token': tampered.data.editToken },
  body: { personName: '小華', items: [{ menuItemId: bento.data.id, qty: 1 }] },
});
check('本人可以改單（改成 90）', ownEdit.data?.total === 90, `total=${ownEdit.data?.total}`);

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

const editAfterClose = await call(`/orders/${tampered.data.orderId}`, {
  method: 'PUT',
  headers: { 'X-Edit-Token': tampered.data.editToken },
  body: { personName: '小華', items: [{ menuItemId: bento.data.id, qty: 5 }] },
});
check('關團後本人不能改單', editAfterClose.status === 400, `status=${editAfterClose.status}`);

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

const orphan = await pool.query('select count(*)::int n from orders where id = $1', [
  sameName1.data.orderId,
]);
check('團內訂單一併被刪除（cascade）', orphan.rows[0].n === 0);

// ── 訂單狀態 ──────────────────────────────────────────────────
console.log('\n訂單狀態');
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

const initial = await call(`/groups/${sCode}`);
check('新訂單預設為未點單', initial.data.orders.every((o) => o.status === 'pending'));
check('狀態統計正確', initial.data.summary.statusCounts.pending === 3);

const badJump = await call(`/orders/${oA.data.orderId}/status`, {
  method: 'PATCH',
  headers: { 'X-Edit-Token': oA.data.editToken },
  body: { status: 'served' },
});
check('未點單不能直接跳到已到餐', badJump.status === 400, `status=${badJump.status}`);

const toOrdered = await call(`/orders/${oA.data.orderId}/status`, {
  method: 'PATCH',
  headers: { 'X-Edit-Token': oA.data.editToken },
  body: { status: 'ordered' },
});
check('未點單 → 已點單', toOrdered.data?.status === 'ordered');

const toServed = await call(`/orders/${oA.data.orderId}/status`, {
  method: 'PATCH',
  headers: { 'X-Edit-Token': oA.data.editToken },
  body: { status: 'served' },
});
check('已點單 → 已到餐', toServed.data?.status === 'served');

const statusNoToken = await call(`/orders/${oB.data.orderId}/status`, {
  method: 'PATCH',
  body: { status: 'ordered' },
});
check('沒有 token 不能改狀態', statusNoToken.status === 403, `status=${statusNoToken.status}`);

const hostSetStatus = await call(`/orders/${oB.data.orderId}/status`, {
  method: 'PATCH',
  headers: { 'X-Admin-Token': sGroup.data.adminToken },
  body: { status: 'ordered' },
});
check('發起人可以改別人的狀態', hostSetStatus.data?.status === 'ordered');

// 撤單流程與金額排除
await call(`/orders/${oC.data.orderId}/status`, {
  method: 'PATCH',
  headers: { 'X-Edit-Token': oC.data.editToken },
  body: { status: 'ordered' },
});
await call(`/orders/${oC.data.orderId}/status`, {
  method: 'PATCH',
  headers: { 'X-Edit-Token': oC.data.editToken },
  body: { status: 'cancel_requested' },
});
const beforeCancel = await call(`/groups/${sCode}`);
check('待撤單仍計入金額（90×3=270）', beforeCancel.data.summary.grandTotal === 270, `total=${beforeCancel.data.summary.grandTotal}`);

await call(`/orders/${oC.data.orderId}/status`, {
  method: 'PATCH',
  headers: { 'X-Edit-Token': oC.data.editToken },
  body: { status: 'cancelled' },
});
const afterCancel = await call(`/groups/${sCode}`);
check('已撤單不計入金額（90×2=180）', afterCancel.data.summary.grandTotal === 180, `total=${afterCancel.data.summary.grandTotal}`);
check('已撤單不計入人數', afterCancel.data.summary.peopleCount === 2, `n=${afterCancel.data.summary.peopleCount}`);
check('已撤單不進入叫餐清單（排骨便當 ×2）', afterCancel.data.summary.byItem.find((i) => i.name === '排骨便當')?.qty === 2);
check('撤單金額另計', afterCancel.data.summary.cancelledTotal === 90, `n=${afterCancel.data.summary.cancelledTotal}`);
check('byPerson 仍保留已撤單者但標記 counted=false',
  afterCancel.data.summary.byPerson.find((p) => p.personName === '阿三')?.counted === false);

// 批次
const bulkNotAdmin = await call(`/groups/${sCode}/orders/status`, {
  method: 'PATCH',
  headers: { 'X-Admin-Token': '00000000-0000-0000-0000-000000000000' },
  body: { from: 'ordered', to: 'served' },
});
check('非發起人不能批次改狀態', bulkNotAdmin.status === 403, `status=${bulkNotAdmin.status}`);

const bulkOk = await call(`/groups/${sCode}/orders/status`, {
  method: 'PATCH',
  headers: { 'X-Admin-Token': sGroup.data.adminToken },
  body: { from: 'ordered', to: 'served' },
});
check('批次把已點單改為已到餐', bulkOk.data?.updated === 1, `updated=${bulkOk.data?.updated}`);

const bulkAll = await call(`/groups/${sCode}/orders/status`, {
  method: 'PATCH',
  headers: { 'X-Admin-Token': sGroup.data.adminToken },
  body: { to: 'ordered' },
});
check('批次遇到不合法轉移會略過而非整批失敗', bulkAll.status === 200 && bulkAll.data.skipped >= 1,
  `updated=${bulkAll.data?.updated} skipped=${bulkAll.data?.skipped}`);

// 結束點餐後仍可推進狀態（餐點是結束點餐後才陸續送達的）
await call(`/groups/${sCode}`, {
  method: 'PATCH',
  headers: { 'X-Admin-Token': sGroup.data.adminToken },
  body: { status: 'closed' },
});
const afterClosed = await call(`/orders/${oB.data.orderId}/status`, {
  method: 'PATCH',
  headers: { 'X-Edit-Token': oB.data.editToken },
  body: { status: 'served' },
});
check('結束點餐後仍可標記已到餐', afterClosed.data?.status === 'served', `status=${afterClosed.status}`);

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

// ── 收尾 ──────────────────────────────────────────────────────
await cleanup();
await pool.end();

console.log(`\n通過 ${passed} 項，失敗 ${failed} 項\n`);
process.exit(failed ? 1 : 0);
