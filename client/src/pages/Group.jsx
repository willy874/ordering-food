import { useCallback, useEffect, useState } from 'react';
import { useParams, Link as RouterLink, useNavigate } from 'react-router-dom';
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
  Snackbar,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { api } from '../lib/api.js';
import { storage } from '../lib/storage.js';
import { Layout, Header, Empty, money } from '../components/ui.jsx';
import OrderTab from '../components/OrderTab.jsx';
import PeopleList from '../components/PeopleList.jsx';
import Summary from '../components/Summary.jsx';

const TABS = [
  ['order', '點餐'],
  ['people', '大家點了什麼'],
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
  const { joinCode } = useParams();
  const code = (joinCode || '').toUpperCase();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('order');
  const [closing, setClosing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState('');

  const adminToken = storage.getAdminToken(code);
  const stored = storage.getMyOrder(code);

  const load = useCallback(async () => {
    try {
      const result = await api.getGroup(code);
      setData(result);
      setError('');
      storage.rememberGroup({
        joinCode: result.group.joinCode,
        title: result.group.title,
        storeName: result.group.store.name,
        createdAt: result.group.createdAt,
        status: result.group.status,
      });
    } catch (err) {
      setError(err.message);
      setData(null);
    }
  }, [code]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleStatus() {
    if (!adminToken) return;
    setClosing(true);
    try {
      await api.patchGroup(code, { status: data.group.status === 'open' ? 'closed' : 'open' }, adminToken);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setClosing(false);
    }
  }

  async function removeGroup() {
    setDeleting(true);
    try {
      await api.deleteGroup(code, adminToken);
      storage.forgetGroup(code);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
      setDeleting(false);
      setConfirmDelete(false);
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

  if (error && !data) {
    return (
      <Layout header={<Header title="找不到這一攤" back="/" />}>
        <Stack spacing={2} sx={{ px: 2, py: 3 }}>
          <Alert severity="error">{error}</Alert>
          <Button component={RouterLink} to="/" variant="outlined" fullWidth>
            回首頁
          </Button>
        </Stack>
      </Layout>
    );
  }

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

  return (
    <Layout
      header={
        <Header
          title={group.title}
          subtitle={`${group.store.name}・${group.hostName} 發起`}
          back="/"
          right={
            <Chip label={code} onClick={share} className="tnum" sx={{ letterSpacing: '0.1em', fontWeight: 600 }} />
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
          onSaved={load}
        />
      )}

      {tab === 'people' && <PeopleList orders={orders} myOrderId={stored?.orderId} />}

      {tab === 'summary' && (
        <>
          <Summary
            group={group}
            summary={summary}
            joinCode={code}
            adminToken={adminToken}
            onChanged={load}
          />
          {adminToken && (
            <Stack spacing={1.5} sx={{ px: 2, pb: 4 }}>
              <Button
                variant={isClosed ? 'outlined' : 'contained'}
                color={isClosed ? 'primary' : 'error'}
                fullWidth
                onClick={toggleStatus}
                disabled={closing || deleting}
              >
                {closing ? '處理中…' : isClosed ? '重新開放點餐' : '結束點餐'}
              </Button>
              <Button color="error" onClick={() => setConfirmDelete(true)} disabled={deleting}>
                刪除這一攤
              </Button>
              <Typography variant="caption" color="text.disabled" align="center">
                這區塊只有發起的人看得到
              </Typography>
            </Stack>
          )}
        </>
      )}

      {error && (
        <Box sx={{ px: 2, pb: 2 }}>
          <Alert severity="error">{error}</Alert>
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
          <Button onClick={() => setConfirmDelete(false)} disabled={deleting}>
            取消
          </Button>
          <Button color="error" variant="contained" onClick={removeGroup} disabled={deleting}>
            {deleting ? '刪除中…' : '確定刪除'}
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
