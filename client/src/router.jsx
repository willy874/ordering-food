import {
  Link,
  Navigate,
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router';
import { Alert, Button, Stack } from '@mui/material';
import { queryClient } from './queryClient.js';
import { groupQuery, menuQuery, storesQuery } from './lib/queries.js';
import { storage } from './lib/storage.js';
import { Empty, Header, Layout } from './components/ui.jsx';
import Home from './pages/Home.jsx';
import NewGroup from './pages/NewGroup.jsx';
import Group from './pages/Group.jsx';
import Stores from './pages/Stores.jsx';
import StoreMenu from './pages/StoreMenu.jsx';

/** 讀取中的骨架。loader 超過 defaultPendingMs 才會看到，快的時候不閃。 */
function Pending({ title = '載入中' }) {
  return (
    <Layout header={<Header title={title} back="/" />}>
      <Empty>載入中…</Empty>
    </Layout>
  );
}

/**
 * loader 失敗時的畫面。最常見的是團被刪掉（404），
 * 其次是離線——兩者都只能回首頁重來，所以共用同一頁。
 */
function RouteError({ error, title = '出了點問題' }) {
  return (
    <Layout header={<Header title={title} back="/" />}>
      <Stack spacing={2} sx={{ px: 2, py: 3 }}>
        <Alert severity="error">{error?.message || '載入失敗'}</Alert>
        <Button component={Link} to="/" variant="outlined" fullWidth>
          回首頁
        </Button>
      </Stack>
    </Layout>
  );
}

const rootRoute = createRootRouteWithContext()({
  component: Outlet,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Home,
});

const newGroupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/new',
  loader: ({ context }) => context.queryClient.ensureQueryData(storesQuery()),
  pendingComponent: () => <Pending title="開始一攤" />,
  errorComponent: (props) => <RouteError {...props} title="開始一攤" />,
  component: NewGroup,
});

const groupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/g/$joinCode',
  loader: async ({ context, params }) => {
    const code = params.joinCode.toUpperCase();
    try {
      return await context.queryClient.ensureQueryData(groupQuery(code));
    } catch (err) {
      // 團已經被刪掉：順手把本機清單與憑證一起清乾淨，
      // 否則首頁會一直留著一個點進來只會報錯的項目
      if (err.status === 404) storage.forgetGroup(code);
      throw err;
    }
  },
  pendingComponent: () => <Pending title="載入中" />,
  errorComponent: (props) => <RouteError {...props} title="找不到這一攤" />,
  component: Group,
});

const storesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/stores',
  loader: ({ context }) => context.queryClient.ensureQueryData(storesQuery()),
  pendingComponent: () => <Pending title="店家與菜單" />,
  errorComponent: (props) => <RouteError {...props} title="店家與菜單" />,
  component: Stores,
});

/**
 * 菜單編輯是獨立一頁而不是店家列表的內部狀態：
 * 手機上退出一層的動作就是按返回，那顆返回鍵應該回到店家列表，
 * 而不是把整個管理頁一起關掉。
 */
const storeMenuRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/stores/$storeId',
  loader: async ({ context, params }) => {
    const storeId = Number(params.storeId);
    if (!Number.isInteger(storeId)) throw redirect({ to: '/stores' });

    // 沒有單一店家的 API，店名從列表裡取；順便確認這個 id 真的存在
    const stores = await context.queryClient.ensureQueryData(storesQuery());
    if (!stores.some((store) => store.id === storeId)) throw redirect({ to: '/stores' });

    await context.queryClient.ensureQueryData(menuQuery(storeId));
  },
  pendingComponent: () => <Pending title="管理菜單" />,
  errorComponent: (props) => <RouteError {...props} title="管理菜單" />,
  component: StoreMenu,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  newGroupRoute,
  groupRoute,
  storesRoute,
  storeMenuRoute,
]);

export const router = createRouter({
  routeTree,
  context: { queryClient },
  // 滑過連結就先把 loader 跑掉，點下去多半已經有資料了
  defaultPreload: 'intent',
  // 網址打錯就回首頁，跟改版前的 path="*" 一樣，不另外做一頁 404
  defaultNotFoundComponent: () => <Navigate to="/" replace />,
  defaultPendingComponent: Pending,
  defaultErrorComponent: RouteError,
  scrollRestoration: true,
});
