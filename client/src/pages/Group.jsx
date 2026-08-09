import { useEffect, useState } from 'react';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import IosShareIcon from '@mui/icons-material/IosShare';
import RefreshIcon from '@mui/icons-material/Refresh';
import { api } from '../lib/api.js';
import { groupQuery, keys, useAppMutation } from '../lib/queries.js';
import { storage } from '../lib/storage.js';
import { roleAtLeast } from '../lib/roles.js';
import { Layout, Header, Empty, money } from '../components/ui.jsx';
import OrderTab from '../components/OrderTab.jsx';
import PeopleList from '../components/PeopleList.jsx';
import GroupManage from '../components/GroupManage.jsx';
import ManageCodeCard from '../components/ManageCodeCard.jsx';
import Summary from '../components/Summary.jsx';

const route = getRouteApi('/g/$joinCode');

const TABS = [
  ['order', '點餐'],
  ['people', '清單'],
  ['summary', '結帳'],
];

function deadlineLabel(deadlineAt) {
  if (!deadlineAt) return null;
  const target = new Date(deadlineAt);
  const diffMinutes = Math.round((target - Date.now()) / 60000);
  if (diffMinutes < 0) return '已截止';
  if (diffMinutes < 60) return `還有 ${diffMinutes} 分鐘截止`;
  const time = target.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  const sameDay = target.toDateString() === new Date().toDateString();
  return `${sameDay ? '今天' : target.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })} ${time} 截止`;
}

export default function Group() {
  const { joinCode } = route.useParams();
  const code = (joinCode || '').toUpperCase();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState('order');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  /**
   * 大家坐在同一桌，別人剛剛加了什麼、餐到了沒有，都要重讀才看得到。
   * 定時輪詢加上切回分頁時自動重讀（見 queryClient.js），
   * 頂上那顆重新整理按鈕留給「我現在就要看到」的時候。
   * 分頁在背景時不會輪詢，省手機的電與流量。
   */
  const { data, error: loadError, isFetching, refetch } = useQuery({
    ...groupQuery(code),
    refetchInterval: 15_000,
  });

  const adminToken = storage.getAdminToken(code);
  const manageCode = storage.getManageCode(code);
  const stored = storage.getMyOrder(code);
  const tokens = { editToken: stored?.editToken, adminToken, manageCode };

  useEffect(() => {
    if (!data) return;

    // 本機記著一張伺服器上已經不存在的單（發起人代刪、或整團重來），
    // 留著只會讓點餐頁一直對著一個空殼。清掉就會回到登記暱稱那一步。
    const mine = storage.getMyOrder(code);
    if (mine && !data.orders.some((order) => order.id === mine.orderId)) {
      storage.clearMyOrder(code);
    }

    storage.rememberGroup({
      joinCode: data.group.joinCode,
      title: data.group.title,
      storeName: data.group.store.name,
      createdAt: data.group.createdAt,
      status: data.group.status,
    });
  }, [data, code]);

  const toggleStatus = useAppMutation({
    mutationFn: (status) => api.patchGroup(code, { status }, tokens),
    invalidates: [keys.group(code)],
    onError: (err) => setError(err.message),
  });

  const removeGroup = useAppMutation({
    mutationFn: () => api.deleteGroup(code, tokens),
    onSuccess: () => {
      storage.forgetGroup(code);
      // 整攤都沒了，快取留著只會讓「返回上一頁」再看到一次它的殘影
      queryClient.removeQueries({ queryKey: keys.group(code) });
      navigate({ to: '/', replace: true });
    },
    onError: (err) => {
      setError(err.message);
      setConfirmDelete(false);
    },
  });

  /** 代碼要用嘴巴唸給旁邊的人、或貼進聊天室，複製代碼本身比複製整段邀請常用 */
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setToast(`已複製代碼 ${code}`);
    } catch {
      setToast(`代碼 ${code}`);
    }
  }

  async function share() {
    const url = `${window.location.origin}/g/${code}`;
    const text = `${data.group.title}（${data.group.store.name}）一起點餐\n代碼 ${code}\n${url}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: data.group.title, text, url });
        return;
      }
      await navigator.clipboard.writeText(text);
      setToast('已複製邀請連結');
    } catch {
      setToast(`連結：${url}`);
    }
  }

  // 進頁面時 loader 已經把資料準備好，這裡只會在快取被清掉時短暫出現
  if (!data) {
    return (
      <Layout header={<Header title="載入中" back="/" />}>
        <Empty>載入中…</Empty>
      </Layout>
    );
  }

  const { group, menu, orders, summary } = data;
  const myOrderRecord = stored ? orders.find((o) => o.id === stored.orderId) : null;
  const isClosed = group.status !== 'open';
  const deadline = deadlineLabel(group.deadlineAt);
  const busy = toggleStatus.isPending || removeGroup.isPending;

  // 角色有三條來源，取最高的那個：發起人（恆為最高管理者）、手上的管理代碼
  // （協助管理者），或被指派到這張單上的角色。
  // 這裡只決定按鈕顯不顯示，真正的把關在後端（server/lib/roles.js 與 services/permissionService.js）。
  const isHost = Boolean(adminToken);
  const grantedRole = myOrderRecord?.role ?? 'participant';
  const myRole = isHost
    ? 'admin'
    : roleAtLeast(grantedRole, 'manager') || !manageCode
      ? grantedRole
      : 'manager';
  const canManage = roleAtLeast(myRole, 'manager');
  const canGrant = roleAtLeast(myRole, 'admin');

  // 背景重讀失敗時舊資料還在畫面上，把錯誤一併說出來就好，不要把整頁換掉
  const banner = error || (loadError && !isFetching ? loadError.message : '');

  return (
    <Layout
      header={
        <Header
          title={group.title}
          subtitle={`${group.store.name}・${group.hostName} 發起`}
          back="/"
          right={
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <Chip
                label={code}
                onClick={copyCode}
                icon={<ContentCopyIcon sx={{ fontSize: 14 }} />}
                className="tnum"
                aria-label={`複製代碼 ${code}`}
                sx={{ letterSpacing: '0.1em', fontWeight: 600 }}
              />
              {/* 轉圈只跟著「使用者自己按的那一次」，
                  背景輪詢不該讓圖示每 15 秒自己動一下 */}
              <IconButton
                onClick={async () => {
                  setRefreshing(true);
                  try {
                    await refetch();
                    setToast('已更新');
                  } finally {
                    setRefreshing(false);
                  }
                }}
                disabled={refreshing}
                aria-label="重新整理"
                sx={{ color: 'text.secondary' }}
              >
                <RefreshIcon
                  fontSize="small"
                  sx={refreshing ? { animation: 'spin 0.8s linear infinite' } : undefined}
                />
              </IconButton>
              <IconButton onClick={share} aria-label="分享邀請連結" sx={{ color: 'text.secondary' }}>
                <IosShareIcon fontSize="small" />
              </IconButton>
            </Stack>
          }
        >
          <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, pb: 1 }}>
            <Chip
              label={isClosed ? '已結束' : '點餐中'}
              size="small"
              color={isClosed ? 'default' : 'success'}
              sx={{ height: 22, fontSize: 11 }}
            />
            {deadline && (
              <Typography variant="caption" color="text.secondary">
                {deadline}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary" className="tnum" sx={{ ml: 'auto' }}>
              {summary.peopleCount} 人・{money(summary.grandTotal)}
            </Typography>
          </Stack>
          <Tabs value={tab} onChange={(_, next) => setTab(next)} variant="fullWidth">
            {TABS.map(([key, label]) => (
              <Tab key={key} value={key} label={label} sx={{ minHeight: 48, fontSize: 14 }} />
            ))}
          </Tabs>
        </Header>
      }
    >
      {tab === 'order' && (
        <OrderTab
          key={myOrderRecord?.id ?? 'new'}
          joinCode={code}
          group={group}
          menu={menu}
          orders={orders}
          myOrder={myOrderRecord ? { order: myOrderRecord, editToken: stored.editToken } : null}
          canManage={canManage}
        />
      )}

      {tab === 'people' && (
        <>
          <GroupManage
            joinCode={code}
            orders={orders}
            summary={summary}
            tokens={tokens}
            isHost={isHost}
            canManage={canManage}
            canGrant={canGrant}
            myOrderId={stored?.orderId}
          />
          <PeopleList
            joinCode={code}
            orders={orders}
            myOrderId={stored?.orderId}
            tokens={tokens}
            canManage={canManage}
            accepting={!isClosed && !(group.deadlineAt && new Date(group.deadlineAt) < new Date())}
            onOrderDeleted={() => {
              storage.clearMyOrder(code);
              setTab('order');
            }}
          />
          {/* 置底：這是「還沒有權限的人」才需要的入口，擺在名單之後才不會擋路 */}
          <ManageCodeCard
            joinCode={code}
            group={group}
            isHost={isHost}
            canManage={canManage}
            myRole={myRole}
            onToast={setToast}
          />
        </>
      )}

      {tab === 'summary' && (
        <>
          <Summary group={group} summary={summary} orders={orders} />
          {canGrant && (
            <Stack spacing={1.5} sx={{ px: 2, pb: 4 }}>
              <Button
                variant={isClosed ? 'outlined' : 'contained'}
                color={isClosed ? 'primary' : 'error'}
                fullWidth
                onClick={() => {
                  setError('');
                  toggleStatus.mutate(isClosed ? 'open' : 'closed');
                }}
                disabled={busy}
              >
                {toggleStatus.isPending ? '處理中…' : isClosed ? '重新開放點餐' : '結束點餐'}
              </Button>
              <Button color="error" onClick={() => setConfirmDelete(true)} disabled={busy}>
                刪除這一攤
              </Button>
              <Typography variant="caption" color="text.disabled" align="center">
                {isHost ? '這區塊只有發起的人看得到' : '這區塊只有最高管理者看得到'}
              </Typography>
            </Stack>
          )}
        </>
      )}

      {banner && (
        <Box sx={{ px: 2, pb: 2 }}>
          <Alert severity="error">{banner}</Alert>
        </Box>
      )}

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>刪除「{group.title}」？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            連同 {summary.peopleCount} 筆訂單一起消失，無法復原。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)} disabled={removeGroup.isPending}>
            取消
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              setError('');
              removeGroup.mutate();
            }}
            disabled={removeGroup.isPending}
          >
            {removeGroup.isPending ? '刪除中…' : '確定刪除'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={3000}
        onClose={() => setToast('')}
        message={toast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Layout>
  );
}
