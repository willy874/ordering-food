import { QueryClient } from '@tanstack/react-query';

/**
 * 4xx 是「這一筆確定有問題」——代碼打錯、團被刪掉、憑證不夠——再試幾次
 * 也是同一個答案，只會讓錯誤訊息晚幾秒才出現。5xx 與斷線才值得重試。
 */
function retryUnlessClientError(failureCount, error) {
  if (error?.status >= 400 && error?.status < 500) return false;
  return failureCount < 2;
}

/**
 * 純 CSR，一個瀏覽器分頁就是一個 client，模組層級建立即可
 * （沒有 SSR，不需要每個請求各自一份）。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 大家坐在同一桌，資料變動快；但連按兩下 tab 或返回上一頁時
      // 不該每次都重打一輪，10 秒是「剛剛才讀過」的合理範圍
      staleTime: 10_000,
      retry: retryUnlessClientError,
      // 切回這個分頁時自動重讀：手機上點完餐切去聊天室再切回來是常態
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: false,
    },
  },
});
