import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Divider,
  List,
  ListItem,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { api } from '../lib/api.js';
import { storage } from '../lib/storage.js';
import { STATUS_ORDER, statusColor, statusLabel } from '../lib/orderStatus.js';

/**
 * 清單頁最上面的管理區。
 *
 * 進度原本在結帳頁，但看進度的時機就是在看誰點了什麼的時候——
 * 「這一輪還有誰沒點到」跟下面那份名單是同一件事，隔一個 tab 只是讓人來回切。
 * 結帳頁留給金額。
 *
 * 三塊，各自只在有對象時出現：
 *   進度       誰都看得到；批次操作限發起人與管理者
 *   參與者權限 只有發起人看得到，用來指派管理者
 *   管理代碼   發起人看得到代碼本身；其他人看到的是輸入框
 */
export default function GroupManage({
  joinCode,
  group,
  orders,
  summary,
  tokens,
  isHost,
  canManage,
  myOrderId,
  onChanged,
}) {
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const counts = summary.statusCounts ?? {};
  const pendingCount = counts.pending ?? 0;
  const orderedCount = counts.ordered ?? 0;
  const cancelRequestedCount = counts.cancel_requested ?? 0;
  const hasAnyItem = STATUS_ORDER.some((s) => counts[s] > 0);

  async function bulk(from, to) {
    setBusy(true);
    setError('');
    try {
      const result = await api.bulkSetStatus(joinCode, { from, to }, tokens);
      setToast(result.message);
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleManager(order, isManager) {
    setBusy(true);
    setError('');
    try {
      await api.setOrderManager(order.id, isManager, tokens.adminToken);
      setToast(isManager ? `${order.personName} 現在可以幫忙改單了` : `已收回 ${order.personName} 的管理權`);
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      setToast(`已複製${label}`);
    } catch {
      setToast(text);
    }
  }

  return (
    <Stack spacing={2} sx={{ px: 2, pt: 2.5 }}>
      {error && <Alert severity="error">{error}</Alert>}

      <Card>
        <Box sx={{ px: 2, py: 1.25 }}>
          <Typography variant="subtitle2">進度</Typography>
          <Typography variant="caption" color="text.secondary">
            {summary.allServed ? '全部都到餐了' : '還沒全部到餐'}・以品項計
          </Typography>
        </Box>
        <Divider />
        {hasAnyItem ? (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ px: 2, py: 1.5 }}>
            {STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => (
              <Chip
                key={s}
                label={`${statusLabel(s)} ${counts[s]} 樣`}
                color={statusColor(s)}
                size="small"
                variant={s === 'cancelled' ? 'outlined' : 'filled'}
              />
            ))}
          </Stack>
        ) : (
          <Typography variant="caption" color="text.disabled" sx={{ display: 'block', px: 2, py: 1.5 }}>
            還沒有人點東西
          </Typography>
        )}

        {canManage && (
          <>
            <Divider />
            <Stack spacing={1} sx={{ px: 2, py: 1.5 }}>
              <Typography variant="caption" color="text.secondary">
                批次操作（發起人與管理者看得到）。跟店家點完這一輪後按第一顆，
                只會動到還沒點的品項，已經到餐的不受影響。
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Button
                  size="small"
                  variant="contained"
                  disabled={busy || pendingCount === 0}
                  onClick={() => bulk('pending', 'ordered')}
                >
                  全部標為已點單{pendingCount > 0 && `（${pendingCount}）`}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="success"
                  disabled={busy || orderedCount === 0}
                  onClick={() => bulk('ordered', 'served')}
                >
                  全部標為已到餐{orderedCount > 0 && `（${orderedCount}）`}
                </Button>
                {cancelRequestedCount > 0 && (
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    disabled={busy}
                    onClick={() => bulk('cancel_requested', 'cancelled')}
                  >
                    確認撤單（{cancelRequestedCount}）
                  </Button>
                )}
              </Stack>
            </Stack>
          </>
        )}
      </Card>

      {isHost && (
        <Card>
          <Box sx={{ px: 2, py: 1.25 }}>
            <Typography variant="subtitle2">參與者與權限</Typography>
            <Typography variant="caption" color="text.secondary">
              已登記 {orders.length} 人・打開開關就能幫忙改所有人的單
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
                  <ListItem key={order.id} divider sx={{ px: 2, py: 0.5 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" alignItems="center" spacing={0.75}>
                        <Typography variant="body2" noWrap>
                          {order.personName}
                        </Typography>
                        {isMe && (
                          <Chip label="你（發起人）" size="small" color="primary" sx={{ height: 20, fontSize: 11 }} />
                        )}
                        {order.isManager && !isMe && (
                          <Chip label="管理者" size="small" color="secondary" sx={{ height: 20, fontSize: 11 }} />
                        )}
                      </Stack>
                      <Typography variant="caption" color="text.disabled">
                        {order.itemCount > 0 ? `${order.itemCount} 樣` : '還沒點東西'}
                      </Typography>
                    </Box>
                    <Switch
                      checked={isMe || order.isManager === true}
                      // 發起人本來就有全部權限，開關對自己沒有意義，關掉只會讓人以為自己被降權
                      disabled={busy || isMe}
                      onChange={(e) => toggleManager(order, e.target.checked)}
                      inputProps={{ 'aria-label': `讓 ${order.personName} 當管理者` }}
                    />
                  </ListItem>
                );
              })}
            </List>
          )}
          <Typography variant="caption" color="text.disabled" sx={{ display: 'block', px: 2, py: 1.25 }}>
            管理者可以改任何人的品項、批次推進度，但不能結束點餐或刪掉這一攤。
          </Typography>
        </Card>
      )}

      <ManageCodeCard
        joinCode={joinCode}
        group={group}
        isHost={isHost}
        canManage={canManage}
        onCopy={copy}
        onToast={setToast}
        onChanged={onChanged}
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

/**
 * 管理代碼。
 *
 * 發起人看到的是代碼本身（念給誰，誰就能幫忙改單）；還沒有權限的人看到的是
 * 一個輸入框。已經用代碼取得權限的人只會看到一行確認，不再顯示代碼——
 * 他手上本來就有，重複顯示只是讓別人經過時瞄到。
 */
function ManageCodeCard({ joinCode, group, isHost, canManage, onCopy, onToast, onChanged }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    const trimmed = input.trim().toUpperCase();
    if (!trimmed) return setError('請輸入管理代碼');

    setSaving(true);
    setError('');
    try {
      const result = await api.verifyManageCode(joinCode, trimmed);
      storage.setManageCode(joinCode, result.manageCode);
      setInput('');
      onToast('你現在是這一攤的管理者');
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (isHost) {
    return (
      <Card>
        <Box sx={{ px: 2, py: 1.25 }}>
          <Typography variant="subtitle2">管理代碼</Typography>
          <Typography variant="caption" color="text.secondary">
            念給誰，誰就能幫忙改全團的單——適合沒登記、但幫忙結帳的人
          </Typography>
        </Box>
        <Divider />
        <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1.5 }}>
          <Typography variant="h6" className="tnum" sx={{ letterSpacing: '0.18em', flex: 1 }}>
            {group.manageCode ?? '—'}
          </Typography>
          {group.manageCode && (
            <Button
              size="small"
              startIcon={<ContentCopyIcon />}
              onClick={() => onCopy(group.manageCode, '管理代碼')}
            >
              複製
            </Button>
          )}
        </Stack>
        <Typography variant="caption" color="text.disabled" sx={{ display: 'block', px: 2, pb: 1.5 }}>
          跟代碼 {joinCode} 不一樣，別貼錯：這一組給得出去就收不回來，
          要收回權限請改用上面的開關指派特定的人。
        </Typography>
      </Card>
    );
  }

  if (canManage) {
    return (
      <Alert severity="success">
        你是這一攤的管理者，可以改任何人的品項、批次推進度。結束點餐與刪除這一攤仍然只有發起人做得到。
      </Alert>
    );
  }

  return (
    <Card component="form" onSubmit={submit} sx={{ px: 2, py: 1.5 }}>
      <Stack spacing={1.5}>
        <Box>
          <Typography variant="subtitle2">有管理代碼？</Typography>
          <Typography variant="caption" color="text.secondary">
            發起人給你的那一組，輸入後就能幫忙改單
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <TextField
            value={input}
            onChange={(e) => {
              setInput(e.target.value.toUpperCase());
              setError('');
            }}
            placeholder="例如 K7M2QXVN"
            size="small"
            sx={{ flex: 1 }}
            slotProps={{
              htmlInput: {
                autoCapitalize: 'characters',
                autoComplete: 'off',
                maxLength: 16,
                className: 'tnum',
                'aria-label': '管理代碼',
                style: { letterSpacing: '0.15em' },
              },
            }}
          />
          <Button type="submit" variant="outlined" disabled={saving || !input.trim()} sx={{ flexShrink: 0 }}>
            {saving ? '確認中…' : '確認'}
          </Button>
        </Stack>
        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </Card>
  );
}
