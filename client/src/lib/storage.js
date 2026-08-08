/**
 * 本系統沒有帳號，身分完全靠 localStorage 保存的憑證：
 *   admin:<code>  開團者憑證，可關團與代刪訂單
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

  getMyOrder: (code) => read(`order:${code}`),
  setMyOrder: (code, value) => write(`order:${code}`, value),
  clearMyOrder: (code) => remove(`order:${code}`),

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
  /** 從本機清單移除，並清掉該團的所有憑證 */
  forgetGroup: (code) => {
    write(
      'groups',
      read('groups', []).filter((g) => g.joinCode !== code),
    );
    remove(`admin:${code}`);
    remove(`order:${code}`);
  },
};
