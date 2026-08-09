/**
 * 本系統沒有帳號，身分完全靠 localStorage 保存的憑證：
 *   admin:<code>  開團者憑證，可關團與代刪訂單
 *   manage:<code> 管理代碼，可代改全團訂單但不能關團／刪團
 *   order:<code>  本人的訂單 id 與編輯憑證
 *   groups        參與過的團，只用於首頁列表
 *
 * 換裝置或清除瀏覽器資料後會遺失，此時需由開團者代為處理。
 */
const PREFIX = 'og:';

function read(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* 隱私模式或空間不足時忽略 */
  }
}

function remove(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* 同上 */
  }
}

export const storage = {
  getAdminToken: (code) => read(`admin:${code}`),
  setAdminToken: (code, token) => write(`admin:${code}`, token),

  /**
   * 管理代碼。跟 adminToken 不同的是它是人念得出來的，發起人可以直接把它
   * 給旁邊幫忙的人；持有者是協助管理者，能代改全攤訂單，
   * 但關攤、刪攤與指派權限要最高管理者才行。
   */
  getManageCode: (code) => read(`manage:${code}`),
  setManageCode: (code, value) => write(`manage:${code}`, value),
  clearManageCode: (code) => remove(`manage:${code}`),

  /** 這一團手上有的所有憑證，送給 api 當 headers 用 */
  tokensFor: (code, editToken) => ({
    editToken,
    adminToken: read(`admin:${code}`) ?? undefined,
    manageCode: read(`manage:${code}`) ?? undefined,
  }),

  /**
   * 本人在某一團的身分：{ orderId, editToken, personName }。
   * personName 是第一次登記時填的暱稱，之後這一團就一直用它，
   * 不再每次點餐重打——重打會打錯，而收錢是按名字算的。
   */
  getMyOrder: (code) => read(`order:${code}`),
  setMyOrder: (code, value) => write(`order:${code}`, value),
  clearMyOrder: (code) => remove(`order:${code}`),
  /** 改暱稱：只動名字，憑證原封不動 */
  renameMe: (code, personName) => {
    const current = read(`order:${code}`);
    if (current) write(`order:${code}`, { ...current, personName });
  },

  /**
   * 點過餐的名字。同一支手機常常會被傳給好幾個人用，
   * 記下來做 autocomplete，省去每次重打。只存本機，不上傳。
   */
  listNames: () => read('names', []),
  rememberName: (name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    const names = read('names', []).filter((n) => n !== trimmed);
    names.unshift(trimmed);
    write('names', names.slice(0, 20));
  },
  forgetName: (name) => {
    write(
      'names',
      read('names', []).filter((n) => n !== name),
    );
  },
  /** 最近用過的名字，作為輸入框預設值 */
  getName: () => read('names', [])[0] || '',
  setName: (name) => storage.rememberName(name),

  listGroups: () => read('groups', []),
  rememberGroup: (group) => {
    const existing = read('groups', []).find((g) => g.joinCode === group.joinCode);
    const groups = read('groups', []).filter((g) => g.joinCode !== group.joinCode);
    groups.unshift({
      ...existing,
      ...group,
      seenAt: new Date().toISOString(),
    });
    write('groups', groups.slice(0, 10));
  },
  /**
   * 用伺服器的實況校正本機清單。
   * updates 以團號為 key：物件＝這團還在，順便更新標題等資訊；null＝這團已經不存在。
   * 沒出現在 updates 裡的（例如那筆這次查不到答案）原樣保留，寧可留著也不要誤刪。
   *
   * 刻意不動排序與 seenAt——這是校正，不是「又參與了一次」。
   */
  reconcileGroups: (updates) => {
    const kept = read('groups', []).filter((group) => {
      if (updates[group.joinCode] !== null) return true;
      remove(`admin:${group.joinCode}`);
      remove(`manage:${group.joinCode}`);
      remove(`order:${group.joinCode}`);
      return false;
    });

    const groups = kept.map((group) => ({ ...group, ...(updates[group.joinCode] ?? {}) }));
    write('groups', groups);
    return groups;
  },

  /** 從本機清單移除，並清掉該團的所有憑證 */
  forgetGroup: (code) => {
    write(
      'groups',
      read('groups', []).filter((g) => g.joinCode !== code),
    );
    remove(`admin:${code}`);
    remove(`manage:${code}`);
    remove(`order:${code}`);
  },
};
