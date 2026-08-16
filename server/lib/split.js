/**
 * 分單
 *
 * 一瓶酒、一份大拼盤本來就不是一個人吃的。品項自己說明「這筆該分給誰」，
 * 金額則一律在讀取時重算，不落地成欄位——有人中途加入或退出時，
 * 「全部平分」的結果會自己跟著變，不需要回頭改任何一列。
 *
 *   owner   只有點的人付（預設）
 *   all     全團平分，參與者於計算當下解析
 *   custom  點的人 ＋ order_item_shares 列出的人
 *
 * custom 只存「其他人」，不存擁有者自己：擁有者必然要付，而且下單當下
 * 那張單的 id 還不存在，寫不進去。
 */

/**
 * 這個品項實際由誰買單，回傳 orderId 陣列。
 *
 * 一律照 participantIds 的順序輸出（擁有者永遠排第一），
 * 因為餘數要分給誰取決於順序，順序不穩定會讓同一份資料算出不同的帳。
 */
export function resolvePayers(item, ownerOrderId, participantIds) {
  if (item.shareScope === 'all' && participantIds.length > 0) {
    return [...participantIds];
  }

  if (item.shareScope === 'custom') {
    const valid = new Set(participantIds);
    // 已離開的人（單被刪掉）不該再分到錢。cascade 通常已經清乾淨，這裡是保險。
    const others = (item.sharedWith ?? []).filter(
      (id) => id !== ownerOrderId && valid.has(id),
    );
    if (others.length > 0) {
      const rank = new Map(participantIds.map((id, index) => [id, index]));
      const sorted = [...new Set(others)].sort((a, b) => rank.get(a) - rank.get(b));
      return [ownerOrderId, ...sorted];
    }
  }

  return [ownerOrderId];
}

/**
 * 把整數金額拆成 count 份，總和必等於原金額。
 *
 * 金額是整數台幣元，100 元分三個人一定除不盡。餘數以一元為單位逐一分配，
 * 起點由 seed 決定（實際傳入品項 id），讓不同品項的餘數落在不同人身上——
 * 固定從第一個人開始的話，排最前面的人會被每一筆除不盡的品項各多收一元。
 */
export function splitAmount(amount, count, seed = 0) {
  if (count <= 0) return [];

  const base = Math.floor(amount / count);
  const remainder = amount - base * count;
  const amounts = new Array(count).fill(base);

  const start = ((seed % count) + count) % count;
  for (let i = 0; i < remainder; i += 1) {
    amounts[(start + i) % count] += 1;
  }
  return amounts;
}

/**
 * 為全團的品項補上付款人與金額，並在每張單上累計應付。
 *
 * 就地改寫傳入的 orders（已經過 decorateOrder），因為呼叫端接著要用同一組物件
 * 產生彙總。回傳同一個陣列方便串接。
 *
 * 已撤單的品項仍會列出付款人，但金額為 0：清單上要看得到「這樣撤掉了」，
 * 又不能跟任何人收錢。
 */
export function applySplits(orders) {
  const participantIds = orders.map((order) => order.id);
  const nameOf = new Map(orders.map((order) => [order.id, order.personName]));

  const payable = new Map(participantIds.map((id) => [id, 0]));
  // 別人點的東西分到我頭上的金額，一覽表要單獨顯示這一欄
  const sharedIn = new Map(participantIds.map((id) => [id, 0]));
  const uncertain = new Set();

  for (const order of orders) {
    for (const item of order.items) {
      const payers = resolvePayers(item, order.id, participantIds);
      const amounts = splitAmount(item.counted ? item.subtotal : 0, payers.length, item.id);

      item.payers = payers.map((orderId, index) => ({
        orderId,
        personName: nameOf.get(orderId),
        amount: amounts[index],
      }));
      item.shared = payers.length > 1;

      for (const payer of item.payers) {
        payable.set(payer.orderId, payable.get(payer.orderId) + payer.amount);
        if (payer.orderId !== order.id) {
          sharedIn.set(payer.orderId, sharedIn.get(payer.orderId) + payer.amount);
        }
        // 同樣只在留空價格的品項「有金額」時才算估價，見 lib/serialize.js 的 decorateOrder
        if (item.counted && item.priceUncertain && item.subtotal !== 0) uncertain.add(payer.orderId);
      }
    }
  }

  for (const order of orders) {
    order.payable = payable.get(order.id);
    order.sharedIn = sharedIn.get(order.id);
    // 自己點的東西裡真正由自己負擔的部分
    order.ownPayable = order.payable - order.sharedIn;
    // 自己點的東西裡由別人分走的部分
    order.sharedOut = order.total - order.ownPayable;
    // 應付金額是否含估價：可能來自別人點的分擔品項，所以不能沿用 order.priceUncertain
    order.payablePriceUncertain = uncertain.has(order.id);
  }

  return orders;
}

/**
 * 結帳用的分單一覽。
 *
 *   people 每個人的應付金額，拆成「自己的」與「分攤別人的」兩塊
 *   items  所有被分擔的品項，含每個人各分到多少
 *
 * 沒有任何品項被分擔時 hasShared 為 false，介面可以整塊不顯示——
 * 大部分的團就是各點各的，多一張全是 0 的表只是雜訊。
 */
export function buildSplitOverview(orders) {
  const items = [];

  for (const order of orders) {
    for (const item of order.items) {
      if (!item.shared) continue;
      items.push({
        itemId: item.id,
        name: item.name,
        qty: item.qty,
        subtotal: item.subtotal,
        counted: item.counted,
        priceUncertain: item.priceUncertain,
        shareScope: item.shareScope,
        ownerOrderId: order.id,
        ownerName: order.personName,
        payers: item.payers,
      });
    }
  }

  const people = orders.map((order) => ({
    orderId: order.id,
    personName: order.personName,
    // 自己點的總額（含被別人分走的部分）
    ownTotal: order.total,
    // 拆解應付的兩塊，兩者相加等於 payable
    ownPayable: order.ownPayable,
    sharedIn: order.sharedIn,
    sharedOut: order.sharedOut,
    payable: order.payable,
    priceUncertain: order.payablePriceUncertain,
    // 只點了東西卻完全不用付（整份被別人分走）的人仍要列出來，因此不看金額
    counted: order.payable > 0 || order.counted,
  }));

  return {
    people,
    items,
    hasShared: items.length > 0,
    total: people.reduce((sum, person) => sum + person.payable, 0),
  };
}
