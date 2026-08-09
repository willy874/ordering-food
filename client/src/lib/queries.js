import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api.js';
import { storage } from './storage.js';

/**
 * 所有 query key 集中在這裡。
 * 散在各元件裡打字串遲早會拼錯一個字，然後你會看到一個怎麼樣都不重新整理的畫面。
 */
export const keys = {
  stores: () => ['stores'],
  menu: (storeId) => ['menu', Number(storeId)],
  group: (joinCode) => ['group', joinCode],
  activeGroups: () => ['groups', 'active'],
  similarGroups: (storeId, title) => ['groups', 'similar', Number(storeId), title],
};

export const storesQuery = () =>
  queryOptions({
    queryKey: keys.stores(),
    queryFn: () => api.listStores(),
  });

export const menuQuery = (storeId) =>
  queryOptions({
    queryKey: keys.menu(storeId),
    queryFn: () => api.getMenu(storeId),
  });

/**
 * 一攤的完整實況。
 *
 * 憑證不進 key：它們存在 localStorage，由本機的動作（輸入管理代碼、登記暱稱）
 * 改動，而那些動作結束後一律 invalidate 這個 key。把憑證塞進 key 只會讓
 * 同一攤在快取裡分裂成好幾份，然後你分不清畫面上顯示的是哪一份。
 */
export const groupQuery = (joinCode) =>
  queryOptions({
    queryKey: keys.group(joinCode),
    queryFn: () => api.getGroup(joinCode, storage.tokensFor(joinCode)),
  });

/**
 * 現在還收得了單的團。
 *
 * 「還有效」是伺服器算的（截止時間、或沒設截止時間時的建立後三天），
 * 所以這份清單會過期——staleTime 短一點，回到首頁時重讀一輪。
 */
export const activeGroupsQuery = () =>
  queryOptions({
    queryKey: keys.activeGroups(),
    queryFn: () => api.listActiveGroups(),
    staleTime: 30_000,
  });

export const similarGroupsQuery = (storeId, title) =>
  queryOptions({
    queryKey: keys.similarGroups(storeId, title),
    queryFn: () => api.findSimilarGroups(storeId, title),
    enabled: Boolean(storeId) && Boolean(title),
    // 這只是「要不要提醒你有同名的攤」，慢一點無所謂，別一直重打
    staleTime: 60_000,
  });

/**
 * 送出一個會改到伺服器的動作，成功後把受影響的 query 重讀一輪
 * ——改版前散在各處的 `await load()` 就是這件事。
 *
 * `invalidates` 帶的是 query key 陣列。呼叫端的 onSuccess 先跑、重讀後跑：
 * 它要改的通常是本機狀態或 localStorage 憑證，而接下來那一次重讀會用到
 * 那些東西（最明顯的是剛存好的管理代碼——晚一步存，重讀就帶不上）。
 */
export function useAppMutation({ invalidates = [], onSuccess, ...options }) {
  const queryClient = useQueryClient();

  return useMutation({
    ...options,
    onSuccess: async (data, variables, context) => {
      await onSuccess?.(data, variables, context);
      await Promise.all(invalidates.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
  });
}
