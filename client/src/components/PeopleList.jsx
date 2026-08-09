import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  Stack,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { api } from '../lib/api.js';
import { Empty, ItemTags, priceText, shareLabelOf } from './ui.jsx';
import ItemStatusChip from './ItemStatusChip.jsx';
import ItemEditDialog from './ItemEditDialog.jsx';
import { canEditItemBasics, statusColor, statusLabel } from '../lib/orderStatus.js';
import { roleLabel } from '../lib/roles.js';

/**
 * 清單：大家點了什麼，自己的單置頂。
 *
 * 「我的單」原本在點餐頁，但那一頁真正的工作是「挑東西」——挑完的結果跟
 * 別人挑的結果是同一份資料，分在兩個 tab 只會讓人為了確認自己點了什麼
 * 一直切回去。點餐頁因此只留下購物車，已經送出的東西一律在這裡看與改。
 *
 * 每一樣的狀態誰都可以改——服務生把餐端上桌時，點的人不一定在座位上，
 * 看到的人順手按掉就好。內容則需要憑證：自己的單一律可改（受品項狀態限制），
 * 管理者可以改任何人的。
 */
export default function PeopleList({
  orders,
  myOrderId,
  tokens,
  canManage,
  accepting,
  onChanged,
  onOrderDeleted,
}) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const participants = useMemo(
    () => orders.map((order) => ({ orderId: order.id, personName: order.personName })),
    [orders],
  );

  // 自己的單置頂：進這一頁最常做的事就是看自己點了什麼
  const sorted = useMemo(() => {
    const mine = orders.filter((order) => order.id === myOrderId);
    return [...mine, ...orders.filter((order) => order.id !== myOrderId)];
  }, [orders, myOrderId]);

  if (!orders.length) return <Empty>還沒有人登記</Empty>;

  const myOrder = orders.find((order) => order.id === myOrderId) ?? null;

  const tokensFor = (order) => ({
    ...tokens,
    editToken: order.id === myOrderId ? tokens.editToken : undefined,
  });

  /** 改得動這張單的內容嗎。管理者不受截止時間限制，本人受。 */
  const canEdit = (order) =>
    canManage || (order.id === myOrderId && Boolean(tokens.editToken) && accepting);

  /** 這一樣的品名與數量還動得了嗎（已跟店家點過的，本人就不能再動） */
  const basicsEditable = (item) => canEditItemBasics(item, canManage);

  async function withSaving(fn) {
    setError('');
    setSaving(true);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function changeQty(order, item, delta) {
    const qty = item.qty + delta;
    if (qty < 1) return withSaving(() => api.deleteOrderItem(item.id, tokensFor(order)));
    if (qty > 99) return undefined;
    return withSaving(() => api.patchOrderItem(item.id, { qty }, tokensFor(order)));
  }

  async function removeMyOrder() {
    setConfirmDelete(false);
    await withSaving(async () => {
      await api.deleteOrder(myOrder.id, tokensFor(myOrder));
      onOrderDeleted?.();
    });
  }

  // 整張單刪掉會連同已經點過的品項一起消失，所以跟單一品項同樣的規則：
  // 只要還有一樣離開「未點單」，本人就得改走撤單
  const canDeleteMyOrder =
    myOrder && canEdit(myOrder) && (canManage || myOrder.items.every(basicsEditable));

  return (
    <Stack spacing={1.5} sx={{ px: 2, py: 2.5 }}>
      {error && <Alert severity="error">{error}</Alert>}

      {sorted.map((order) => {
        const isMe = order.id === myOrderId;
        const editable = canEdit(order);

        return (
          <Card
            key={order.id}
            sx={{
              opacity: order.counted || order.payable > 0 ? 1 : 0.55,
              ...(isMe ? { borderColor: 'primary.main' } : {}),
            }}
          >
            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ px: 2, py: 1.25 }}>
              <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                {order.personName}
              </Typography>
              {isMe && <Chip label="我" size="small" color="primary" sx={{ height: 20, fontSize: 11 }} />}
              {order.role && order.role !== 'participant' && (
                <Chip
                  label={roleLabel(order.role)}
                  size="small"
                  color="secondary"
                  variant="outlined"
                  sx={{ height: 20, fontSize: 11 }}
                />
              )}
              <Chip
                label={statusLabel(order.status)}
                color={statusColor(order.status)}
                size="small"
                variant="outlined"
                sx={{ height: 20, fontSize: 11 }}
              />
              <Typography
                variant="subtitle2"
                className="tnum"
                sx={{ textDecoration: order.counted || order.payable > 0 ? 'none' : 'line-through' }}
              >
                {priceText(order.payable, order.payablePriceUncertain)}
              </Typography>
            </Stack>

            {/* 應付與自己點的不一樣時要交代清楚，否則看起來就是算錯了 */}
            {order.payable !== order.total && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, pb: 0.75 }}>
                自己點 {priceText(order.total, order.priceUncertain)}
                {order.sharedOut > 0 && `，其中 ${priceText(order.sharedOut)} 由別人分擔`}
                {order.sharedIn > 0 && `，另分擔別人 ${priceText(order.sharedIn)}`}
              </Typography>
            )}

            <Divider />
            <List disablePadding>
              {order.items.map((item) => (
                <ListItem key={item.id} divider sx={{ px: 2, py: 0.75 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      noWrap
                      sx={{ textDecoration: item.counted ? 'none' : 'line-through' }}
                    >
                      {item.name}
                      <ItemTags
                        isCustom={item.isCustom}
                        priceUncertain={item.priceUncertain}
                        shareLabel={shareLabelOf(item)}
                      />
                    </Typography>
                    {item.note && (
                      <Typography variant="caption" color="text.secondary" display="block" noWrap>
                        {item.note}
                      </Typography>
                    )}
                    <Box sx={{ mt: 0.25 }}>
                      <ItemStatusChip item={item} onChanged={onChanged} onError={setError} />
                    </Box>
                    {item.shared && (
                      <Typography variant="caption" color="text.disabled" display="block" noWrap>
                        {item.payers.map((p) => `${p.personName} ${p.amount}`).join('、')}
                      </Typography>
                    )}
                  </Box>

                  {editable && (
                    <>
                      <IconButton
                        size="small"
                        onClick={() => setEditing({ order, item })}
                        disabled={saving}
                        aria-label={`修改 ${item.name}`}
                        sx={{ color: 'text.disabled' }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      {/* 已經跟店家點過的，本人只能撤單不能刪——刪掉就沒有紀錄了 */}
                      {basicsEditable(item) &&
                        (isMe ? (
                          <IconButton
                            size="small"
                            onClick={() => changeQty(order, item, -1)}
                            disabled={saving}
                            aria-label="減少"
                          >
                            <RemoveIcon fontSize="small" />
                          </IconButton>
                        ) : (
                          <IconButton
                            size="small"
                            color="error"
                            disabled={saving}
                            onClick={() => withSaving(() => api.deleteOrderItem(item.id, tokensFor(order)))}
                            aria-label={`刪除 ${item.name}`}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        ))}
                    </>
                  )}

                  <Typography variant="body2" color="text.disabled" className="tnum" sx={{ mx: 1 }}>
                    ×{item.qty}
                  </Typography>

                  {editable && isMe && basicsEditable(item) && (
                    <IconButton
                      size="small"
                      onClick={() => changeQty(order, item, 1)}
                      disabled={saving}
                      aria-label="增加"
                    >
                      <AddIcon fontSize="small" />
                    </IconButton>
                  )}

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

            {order.items.length === 0 && (
              <Typography variant="caption" color="text.disabled" sx={{ display: 'block', px: 2, py: 1.5 }}>
                {isMe ? '還沒點東西，去「點餐」挑幾樣' : '已登記，還沒點東西'}
              </Typography>
            )}
            {order.note && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, py: 1 }}>
                備註：{order.note}
              </Typography>
            )}

            {isMe && canDeleteMyOrder && (
              <>
                <Divider />
                <Box sx={{ px: 1, py: 0.5, textAlign: 'right' }}>
                  <Button size="small" color="error" onClick={() => setConfirmDelete(true)} disabled={saving}>
                    刪除整張單
                  </Button>
                </Box>
              </>
            )}
          </Card>
        );
      })}

      <Typography variant="caption" color="text.disabled">
        {canManage
          ? '你可以直接改任何人的品項——數量、品名、價格、備註、分單都能動。狀態則是誰都可以幫忙按。'
          : '狀態每一樣分開算，誰都可以幫忙按。已經跟店家點過的品項，品名與數量就固定了；要多點請去「點餐」另外加一筆，不要了就把狀態改成待撤單。'}
      </Typography>

      <ItemEditDialog
        item={editing?.item ?? null}
        title={editing ? `修改 ${editing.order.personName} 的品項` : '修改品項'}
        lockBasics={Boolean(editing) && !basicsEditable(editing.item)}
        people={participants.filter((p) => p.orderId !== editing?.order.id)}
        // 代改別人的品項時，分單裡的「自己」是點的那個人
        ownerName={editing && editing.order.id !== myOrderId ? editing.order.personName : undefined}
        onClose={() => setEditing(null)}
        onSave={(patch) => {
          const { order, item } = editing;
          setEditing(null);
          withSaving(() => api.patchOrderItem(item.id, patch, tokensFor(order)));
        }}
      />

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>刪除整張單？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            連同已經點過的品項一起消失，也會從別人的分單裡移除，無法復原。
            只想拿掉其中幾樣的話，用每一列的減號。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>取消</Button>
          <Button color="error" variant="contained" onClick={removeMyOrder}>
            確定刪除
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
