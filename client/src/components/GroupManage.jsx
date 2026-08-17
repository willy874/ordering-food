import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Card,
  Chip,
  Collapse,
  Divider,
  IconButton,
  List,
  ListItem,
  MenuItem,
  Snackbar,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { api } from '../lib/api.js';
import { keys, useAppMutation } from '../lib/queries.js';
import { ItemTags, priceText } from './ui.jsx';
import ItemStatusChip from './ItemStatusChip.jsx';
import ItemEditDialog from './ItemEditDialog.jsx';
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
  // 進度預設展開（看誰點了什麼是進這頁的主要目的），參與者權限預設收合
  const [progressOpen, setProgressOpen] = useState(true);
  const [peopleOpen, setPeopleOpen] = useState(false);
  // 基礎狀態分類之上的第二層排序：預設依名稱，可切成叫單時間
  const [sortBy, setSortBy] = useState('name');
  const [editing, setEditing] = useState(null);

  const bulk = useAppMutation({
    mutationFn: ({ from, to }) => api.bulkSetStatus(joinCode, { from, to }, tokens),
    invalidates: [keys.group(joinCode)],
    onSuccess: (result) => setToast(result.message),
    onError: (err) => setError(err.message),
  });

  // 進度裡直接改品項：管理者不受截止時間與「已點過就鎖定」限制，帶的是管理憑證
  const patchItem = useAppMutation({
    mutationFn: ({ itemId, body }) => api.patchOrderItem(itemId, body, tokens),
    invalidates: [keys.group(joinCode)],
    onError: (err) => setError(err.message),
  });

  const changeRole = useAppMutation({
    mutationFn: ({ order, role }) => api.setOrderRole(order.id, role, tokens),
    invalidates: [keys.group(joinCode)],
    onSuccess: (_result, { order, role }) => setToast(`${order.personName} 現在是${roleLabel(role)}`),
    onError: (err) => setError(err.message),
  });

  const busy = bulk.isPending || changeRole.isPending || patchItem.isPending;

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
        groups.get(item.status)?.push({ ...item, personName: order.personName, orderId: order.id });
      }
    }
    // 叫單時間＝品項最後一次狀態變動的時間，作為「先點的先出現」的近似
    const compare =
      sortBy === 'name'
        ? (a, b) => a.name.localeCompare(b.name, 'zh-TW')
        : (a, b) => new Date(a.statusChangedAt) - new Date(b.statusChangedAt);
    return [...groups]
      .map(([status, items]) => [status, [...items].sort(compare)])
      .filter(([, items]) => items.length > 0);
  }, [orders, sortBy]);

  // 進度數量的分母：全攤所有品項（含已撤單），讓每一類都看得出佔了多少
  const totalItems = byStatus.reduce((sum, [, items]) => sum + items.length, 0);

  // 代改別人的品項時，分單裡的「自己」是點的那個人；名單排除他本人
  const participants = useMemo(
    () => orders.map((order) => ({ orderId: order.id, personName: order.personName })),
    [orders],
  );

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
          <ButtonBase
            onClick={() => setProgressOpen((v) => !v)}
            aria-expanded={progressOpen}
            sx={{ width: '100%', justifyContent: 'flex-start', px: 2, py: 1.25, textAlign: 'left' }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle2">進度</Typography>
              <Typography variant="caption" color="text.secondary">
                {summary.allServed ? '全部都到餐了' : '還沒全部到餐'}・以品項計
              </Typography>
            </Box>
            <ExpandMoreIcon
              fontSize="small"
              sx={{
                color: 'text.secondary',
                transition: 'transform 0.2s',
                transform: progressOpen ? 'rotate(180deg)' : 'none',
              }}
            />
          </ButtonBase>

          <Collapse in={progressOpen}>
            <Divider />

            {byStatus.length === 0 ? (
              <Typography variant="caption" color="text.disabled" sx={{ display: 'block', px: 2, py: 1.5 }}>
                還沒有人點東西
              </Typography>
            ) : (
              <>
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  sx={{ px: 2, py: 1, justifyContent: 'flex-end' }}
                >
                  <Typography variant="caption" color="text.secondary">
                    排序
                  </Typography>
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    value={sortBy}
                    onChange={(_, next) => next && setSortBy(next)}
                  >
                    <ToggleButton value="name" sx={{ py: 0.25, fontSize: 12 }}>
                      名稱
                    </ToggleButton>
                    <ToggleButton value="time" sx={{ py: 0.25, fontSize: 12 }}>
                      叫單時間
                    </ToggleButton>
                  </ToggleButtonGroup>
                </Stack>

                {byStatus.map(([status, items]) => (
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
                        {items.length}
                        <Box component="span" sx={{ color: 'text.disabled' }}>
                          {' / '}
                          {totalItems}
                        </Box>
                        {' 樣・共 '}
                        {items.reduce((sum, i) => sum + i.qty, 0)} 份
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
                          {/* 管理者可以直接改任何人的品項——名稱、價格、數量、備註、分單 */}
                          <IconButton
                            size="small"
                            onClick={() => setEditing(item)}
                            disabled={busy}
                            aria-label={`修改 ${item.personName} 的 ${item.name}`}
                            sx={{ color: 'text.disabled' }}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
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
                ))}
              </>
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
          </Collapse>
        </Card>
      )}

      {canGrant && (
        <Card>
          <ButtonBase
            onClick={() => setPeopleOpen((v) => !v)}
            aria-expanded={peopleOpen}
            sx={{ width: '100%', justifyContent: 'flex-start', px: 2, py: 1.25, textAlign: 'left' }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle2">參與者與權限</Typography>
              <Typography variant="caption" color="text.secondary">
                已登記 {orders.length} 人
              </Typography>
            </Box>
            <ExpandMoreIcon
              fontSize="small"
              sx={{
                color: 'text.secondary',
                transition: 'transform 0.2s',
                transform: peopleOpen ? 'rotate(180deg)' : 'none',
              }}
            />
          </ButtonBase>
          <Collapse in={peopleOpen}>
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
          </Collapse>
        </Card>
      )}

      <ItemEditDialog
        item={editing}
        title={editing ? `修改 ${editing.personName} 的品項` : '修改品項'}
        people={participants.filter((p) => p.orderId !== editing?.orderId)}
        ownerName={editing?.personName}
        onClose={() => setEditing(null)}
        onSave={(patch) => {
          const item = editing;
          setEditing(null);
          setError('');
          patchItem.mutate({ itemId: item.id, body: patch });
        }}
      />

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
