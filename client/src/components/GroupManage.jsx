import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Divider,
  List,
  ListItem,
  MenuItem,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { api } from '../lib/api.js';
import { keys, useAppMutation } from '../lib/queries.js';
import { ItemTags, priceText } from './ui.jsx';
import ItemStatusChip from './ItemStatusChip.jsx';
import { STATUS_ORDER, statusColor, statusLabel } from '../lib/orderStatus.js';
import { ROLES, ROLE_INFO, roleLabel } from '../lib/roles.js';

/**
 * 清單頁的管理區，只有管理者看得到。
 *
 * 進度原本在結帳頁，但看進度的時機就是在看誰點了什麼的當下——
 * 「這一輪還有誰沒點到」跟下面那份名單是同一件事，隔一個 tab 只是讓人來回切。
 * 結帳頁留給金額。
 *
 * 一般參與者不需要這一區：他只想知道自己點了什麼、多少錢，
 * 全攤的統計對他是雜訊，批次按鈕更不該出現在他面前。
 */
export default function GroupManage({
  joinCode,
  orders,
  summary,
  tokens,
  isHost,
  canManage,
  canGrant,
  myOrderId,
}) {
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  const bulk = useAppMutation({
    mutationFn: ({ from, to }) => api.bulkSetStatus(joinCode, { from, to }, tokens),
    invalidates: [keys.group(joinCode)],
    onSuccess: (result) => setToast(result.message),
    onError: (err) => setError(err.message),
  });

  const changeRole = useAppMutation({
    mutationFn: ({ order, role }) => api.setOrderRole(order.id, role, tokens),
    invalidates: [keys.group(joinCode)],
    onSuccess: (_result, { order, role }) => setToast(`${order.personName} 現在是${roleLabel(role)}`),
    onError: (err) => setError(err.message),
  });

  const busy = bulk.isPending || changeRole.isPending;

  const counts = summary.statusCounts ?? {};
  const pendingCount = counts.pending ?? 0;
  const orderedCount = counts.ordered ?? 0;
  const cancelRequestedCount = counts.cancel_requested ?? 0;

  /**
   * 進度明細：把全攤的品項依狀態分組。
   * 只給數字（「未點單 3 樣」）在現場沒有用——要跟店家開口的人得知道
   * 那三樣到底是什麼、誰點的。
   */
  const byStatus = useMemo(() => {
    const groups = new Map(STATUS_ORDER.map((status) => [status, []]));
    for (const order of orders) {
      for (const item of order.items) {
        groups.get(item.status)?.push({ ...item, personName: order.personName });
      }
    }
    return [...groups].filter(([, items]) => items.length > 0);
  }, [orders]);

  if (!canManage && !canGrant) return null;

  const runBulk = (from, to) => {
    setError('');
    bulk.mutate({ from, to });
  };

  return (
    <Stack spacing={2} sx={{ px: 2, pt: 2.5 }}>
      {error && <Alert severity="error">{error}</Alert>}

      {canManage && (
        <Card>
          <Box sx={{ px: 2, py: 1.25 }}>
            <Typography variant="subtitle2">進度</Typography>
            <Typography variant="caption" color="text.secondary">
              {summary.allServed ? '全部都到餐了' : '還沒全部到餐'}・以品項計
            </Typography>
          </Box>
          <Divider />

          {byStatus.length === 0 ? (
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', px: 2, py: 1.5 }}>
              還沒有人點東西
            </Typography>
          ) : (
            byStatus.map(([status, items]) => (
              <Box key={status}>
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  sx={{ px: 2, py: 0.75, bgcolor: 'background.default' }}
                >
                  <Chip
                    label={statusLabel(status)}
                    color={statusColor(status)}
                    size="small"
                    variant={status === 'cancelled' ? 'outlined' : 'filled'}
                    sx={{ height: 22, fontSize: 11 }}
                  />
                  <Typography variant="caption" color="text.secondary" className="tnum">
                    {items.length} 樣・共 {items.reduce((sum, i) => sum + i.qty, 0)} 份
                  </Typography>
                </Stack>
                <List disablePadding>
                  {items.map((item) => (
                    <ListItem key={item.id} divider sx={{ px: 2, py: 0.5 }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" noWrap>
                          {item.name}
                          <ItemTags isCustom={item.isCustom} priceUncertain={item.priceUncertain} />
                        </Typography>
                        <Typography variant="caption" color="text.disabled" noWrap component="p">
                          {item.personName}
                          {item.note ? `・${item.note}` : ''}
                        </Typography>
                        {/* 批次不是萬用的：只有這一份還沒到、或這一樣客人反悔了，
                            要動的就是單獨這一列 */}
                        <Box sx={{ mt: 0.25 }}>
                          <ItemStatusChip joinCode={joinCode} item={item} onError={setError} />
                        </Box>
                      </Box>
                      <Typography variant="body2" className="tnum" sx={{ mx: 1 }}>
                        ×{item.qty}
                      </Typography>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        className="tnum"
                        sx={{ width: 64, textAlign: 'right' }}
                      >
                        {priceText(item.subtotal, item.priceUncertain)}
                      </Typography>
                    </ListItem>
                  ))}
                </List>
              </Box>
            ))
          )}

          <Divider />
          <Stack spacing={1} sx={{ px: 2, py: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              跟店家點完這一輪後按第一顆，只會動到還沒點的品項，已經到餐的不受影響。
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button
                size="small"
                variant="contained"
                disabled={busy || pendingCount === 0}
                onClick={() => runBulk('pending', 'ordered')}
              >
                全部標為已點單{pendingCount > 0 && `（${pendingCount}）`}
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="success"
                disabled={busy || orderedCount === 0}
                onClick={() => runBulk('ordered', 'served')}
              >
                全部標為已到餐{orderedCount > 0 && `（${orderedCount}）`}
              </Button>
              {cancelRequestedCount > 0 && (
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  disabled={busy}
                  onClick={() => runBulk('cancel_requested', 'cancelled')}
                >
                  確認撤單（{cancelRequestedCount}）
                </Button>
              )}
            </Stack>
          </Stack>
        </Card>
      )}

      {canGrant && (
        <Card>
          <Box sx={{ px: 2, py: 1.25 }}>
            <Typography variant="subtitle2">參與者與權限</Typography>
            <Typography variant="caption" color="text.secondary">
              已登記 {orders.length} 人
            </Typography>
          </Box>
          <Divider />
          {orders.length === 0 ? (
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', px: 2, py: 1.5 }}>
              還沒有人登記
            </Typography>
          ) : (
            <List disablePadding>
              {orders.map((order) => {
                const isMe = order.id === myOrderId;
                return (
                  <ListItem key={order.id} divider sx={{ px: 2, py: 1, gap: 1 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" alignItems="center" spacing={0.75}>
                        <Typography variant="body2" noWrap>
                          {order.personName}
                        </Typography>
                        {isMe && (
                          <Chip
                            label={isHost ? '你（發起人）' : '你'}
                            size="small"
                            color="primary"
                            sx={{ height: 20, fontSize: 11 }}
                          />
                        )}
                      </Stack>
                      <Typography variant="caption" color="text.disabled">
                        {order.itemCount > 0 ? `${order.itemCount} 樣` : '還沒點東西'}
                      </Typography>
                    </Box>
                    <TextField
                      select
                      size="small"
                      value={isMe && isHost ? 'admin' : (order.role ?? 'participant')}
                      // 發起人的權限來自 admin_token 而不是這張單，改它沒有意義
                      disabled={busy || (isMe && isHost)}
                      onChange={(e) => {
                        setError('');
                        changeRole.mutate({ order, role: e.target.value });
                      }}
                      sx={{ width: 150, flexShrink: 0 }}
                      slotProps={{ htmlInput: { 'aria-label': `${order.personName} 的權限` } }}
                    >
                      {ROLES.map((role) => (
                        <MenuItem key={role} value={role}>
                          {ROLE_INFO[role].label}
                        </MenuItem>
                      ))}
                    </TextField>
                  </ListItem>
                );
              })}
            </List>
          )}
          <Stack spacing={0.25} sx={{ px: 2, py: 1.25 }}>
            {ROLES.map((role) => (
              <Typography key={role} variant="caption" color="text.disabled">
                <b>{ROLE_INFO[role].label}</b>：{ROLE_INFO[role].hint}
              </Typography>
            ))}
            <Typography variant="caption" color="text.disabled" sx={{ pt: 0.5 }}>
              指派出去的最高管理者跟你同級，包含刪掉整攤——給之前想一下。
            </Typography>
          </Stack>
        </Card>
      )}

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={3000}
        onClose={() => setToast('')}
        message={toast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Stack>
  );
}
