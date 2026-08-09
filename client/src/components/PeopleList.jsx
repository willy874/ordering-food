import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  Chip,
  Divider,
  IconButton,
  List,
  ListItem,
  Stack,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { api } from '../lib/api.js';
import { Empty, ItemTags, priceText, shareLabelOf } from './ui.jsx';
import ItemStatusChip from './ItemStatusChip.jsx';
import ItemEditDialog from './ItemEditDialog.jsx';
import { canEditItemBasics, statusColor, statusLabel } from '../lib/orderStatus.js';

/**
 * 清單：大家點了什麼。
 *
 * 每一樣的狀態都可以在這裡直接改——服務生把餐端上桌時，
 * 點的人不一定在座位上，看到的人順手按掉就好。
 *
 * 內容（數量、品名、價格、備註、分單）則需要憑證：自己的單一律可改，
 * 發起人與管理者可以改任何人的。收拾殘局的多半是他們——誰漏了備註、
 * 誰的價格記錯了、這瓶酒該算大家的，都是結帳時才發現。
 *
 * 但本人只能動「未點單」的品名與數量：跟店家點過之後兩邊就對不起來了。
 */
export default function PeopleList({ orders, myOrderId, tokens, canManage, onChanged }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);

  const participants = useMemo(
    () => orders.map((order) => ({ orderId: order.id, personName: order.personName })),
    [orders],
  );

  if (!orders.length) return <Empty>還沒有人登記</Empty>;

  const tokensFor = (order) => ({
    ...tokens,
    editToken: order.id === myOrderId ? tokens.editToken : undefined,
  });

  const canEdit = (order) => Boolean(canManage || (order.id === myOrderId && tokens.editToken));

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

  return (
    <Stack spacing={1.5} sx={{ px: 2, py: 2.5 }}>
      {error && <Alert severity="error">{error}</Alert>}

      {orders.map((order) => (
        <Card key={order.id} sx={{ opacity: order.counted || order.payable > 0 ? 1 : 0.55 }}>
          <Stack direction="row" alignItems="center" spacing={0.75} sx={{ px: 2, py: 1.25 }}>
            <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 0 }} noWrap>
              {order.personName}
            </Typography>
            {order.id === myOrderId && (
              <Chip label="我" size="small" color="primary" sx={{ height: 20, fontSize: 11 }} />
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

                {canEdit(order) && (
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
                    {canEditItemBasics(item, canManage) && (
                      <IconButton
                        size="small"
                        color="error"
                        disabled={saving}
                        onClick={() =>
                          withSaving(() => api.deleteOrderItem(item.id, tokensFor(order)))
                        }
                        aria-label={`刪除 ${item.name}`}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    )}
                  </>
                )}

                <Typography variant="body2" color="text.disabled" className="tnum" sx={{ mx: 1 }}>
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
          {order.items.length === 0 && (
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', px: 2, py: 1.5 }}>
              已登記，還沒點東西
            </Typography>
          )}
          {order.note && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, py: 1 }}>
              備註：{order.note}
            </Typography>
          )}
        </Card>
      ))}

      <Typography variant="caption" color="text.disabled">
        {canManage
          ? '你可以直接改任何人的品項——數量、品名、價格、備註、分單都能動。'
          : '已經跟店家點過的品項，品名與數量就固定了；要多點請另外加一筆，不要了就撤單。'}
      </Typography>

      <ItemEditDialog
        item={editing?.item ?? null}
        title={editing ? `修改 ${editing.order.personName} 的品項` : '修改品項'}
        lockBasics={Boolean(editing) && !canEditItemBasics(editing.item, canManage)}
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
    </Stack>
  );
}
