import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import { api } from '../lib/api.js';
import { storage } from '../lib/storage.js';
import { NameInput, ItemTags, money } from './ui.jsx';
import StatusControl from './StatusControl.jsx';
import { statusColor, statusLabel } from '../lib/orderStatus.js';

const cartKey = (item) =>
  item.menuItemId == null
    ? `c:${item.name}:${item.unitPrice}:${item.priceUncertain ? 'u' : ''}`
    : `m:${item.menuItemId}`;

/** 把既有訂單的品項還原成購物車格式，供編輯使用 */
function itemsToCart(items) {
  return items.map((item) => ({
    menuItemId: item.menuItemId,
    name: item.name,
    unitPrice: item.unitPrice,
    qty: item.qty,
    priceUncertain: item.priceUncertain,
  }));
}

export default function OrderTab({ joinCode, group, menu, orders = [], myOrder, onSaved }) {
  const existing = myOrder?.order ?? null;
  const [editing, setEditing] = useState(!existing);
  const [cart, setCart] = useState(() => (existing ? itemsToCart(existing.items) : []));
  const [personName, setPersonName] = useState(existing?.personName ?? storage.getName());
  const [note, setNote] = useState(existing?.note ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // 本機記過的名字。同一攤已被用掉的要排除，因為同攤不允許同名。
  const takenNames = useMemo(
    () => new Set(orders.filter((o) => o.id !== existing?.id).map((o) => o.personName)),
    [orders, existing?.id],
  );
  const knownNames = useMemo(
    () => storage.listNames().filter((n) => !takenNames.has(n)),
    [takenNames],
  );

  const accepting =
    group.status === 'open' && !(group.deadlineAt && new Date(group.deadlineAt) < new Date());

  const categories = useMemo(() => {
    const map = new Map();
    for (const item of menu) {
      if (!item.available) continue;
      if (!map.has(item.category)) map.set(item.category, []);
      map.get(item.category).push(item);
    }
    return [...map.entries()];
  }, [menu]);

  const total = cart.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
  const hasUncertain = cart.some((i) => i.priceUncertain);

  function addMenuItem(menuItem) {
    setCart((prev) => {
      const key = `m:${menuItem.id}`;
      const found = prev.find((i) => cartKey(i) === key);
      if (found) {
        return prev.map((i) => (cartKey(i) === key ? { ...i, qty: Math.min(i.qty + 1, 99) } : i));
      }
      return [
        ...prev,
        {
          menuItemId: menuItem.id,
          name: menuItem.name,
          unitPrice: menuItem.price,
          qty: 1,
          priceUncertain: menuItem.priceUncertain,
        },
      ];
    });
  }

  function changeQty(key, delta) {
    setCart((prev) =>
      prev
        .map((item) => (cartKey(item) === key ? { ...item, qty: item.qty + delta } : item))
        .filter((item) => item.qty > 0),
    );
  }

  async function save() {
    setError('');
    if (!personName.trim()) return setError('請填寫名字');
    if (cart.length === 0) return setError('至少要點一樣');

    setSaving(true);
    try {
      const payload = {
        personName: personName.trim(),
        note: note.trim() || null,
        items: cart.map((item) =>
          item.menuItemId == null
            ? {
                name: item.name,
                unitPrice: item.unitPrice,
                qty: item.qty,
                priceUncertain: item.priceUncertain === true,
              }
            : { menuItemId: item.menuItemId, qty: item.qty },
        ),
      };

      if (existing) {
        await api.updateOrder(existing.id, payload, {
          editToken: myOrder.editToken,
          adminToken: storage.getAdminToken(joinCode),
        });
      } else {
        const created = await api.createOrder(joinCode, payload);
        storage.setMyOrder(joinCode, { orderId: created.orderId, editToken: created.editToken });
      }
      storage.rememberName(personName.trim());
      setEditing(false);
      await onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    try {
      await api.deleteOrder(existing.id, {
        editToken: myOrder.editToken,
        adminToken: storage.getAdminToken(joinCode),
      });
      storage.clearMyOrder(joinCode);
      setCart([]);
      setEditing(true);
      await onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!accepting && !existing) {
    return (
      <Box sx={{ px: 2, py: 3 }}>
        <Alert severity="warning">這一攤已經結束點餐了。</Alert>
      </Box>
    );
  }

  // 已點餐且未進入編輯模式 → 顯示我的訂單
  if (existing && !editing) {
    const mineUncertain = existing.items.some((i) => i.priceUncertain);
    return (
      <Stack spacing={2} sx={{ px: 2, py: 2.5 }}>
        <StatusControl
          joinCode={joinCode}
          order={existing}
          editToken={myOrder.editToken}
          onChanged={onSaved}
        />

        <Card sx={{ opacity: existing.status === 'cancelled' ? 0.55 : 1 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1.5 }}>
            <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 0 }} noWrap>
              {existing.personName} 點的
            </Typography>
            <Chip
              label={statusLabel(existing.status)}
              color={statusColor(existing.status)}
              size="small"
              sx={{ height: 20, fontSize: 11 }}
            />
            <Typography
              variant="subtitle2"
              className="tnum"
              sx={{ textDecoration: existing.status === 'cancelled' ? 'line-through' : 'none' }}
            >
              {mineUncertain ? `≈ ${money(existing.total)}` : money(existing.total)}
            </Typography>
          </Stack>
          <Divider />
          <List disablePadding>
            {existing.items.map((item) => (
              <ListItem key={item.id} divider sx={{ px: 2, py: 1 }}>
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                  {item.name}
                  <ItemTags isCustom={item.isCustom} priceUncertain={item.priceUncertain} />
                </Typography>
                <Typography variant="body2" color="text.secondary" className="tnum" sx={{ mx: 1 }}>
                  ×{item.qty}
                </Typography>
                <Typography variant="body2" className="tnum" sx={{ width: 60, textAlign: 'right' }}>
                  {money(item.subtotal)}
                </Typography>
              </ListItem>
            ))}
          </List>
          {existing.note && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, py: 1.25 }}>
              備註：{existing.note}
            </Typography>
          )}
        </Card>

        {accepting ? (
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" fullWidth onClick={() => setEditing(true)}>
              修改
            </Button>
            <Button color="error" onClick={remove} disabled={saving}>
              刪除
            </Button>
          </Stack>
        ) : (
          <Alert severity="info">已結束點餐，不能再修改。</Alert>
        )}
        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
    );
  }

  return (
    <Box>
      <Stack spacing={3} sx={{ px: 2, py: 2.5 }}>
        {categories.map(([category, items]) => (
          <Box key={category}>
            <Typography variant="overline" color="text.secondary">
              {category}
            </Typography>
            <Stack spacing={0.75} sx={{ mt: 0.5 }}>
              {items.map((item) => {
                const inCart = cart.find((i) => cartKey(i) === `m:${item.id}`);
                return (
                  <Card key={item.id}>
                    <ListItemButton onClick={() => addMenuItem(item)} sx={{ px: 1.5, py: 1, borderRadius: 2 }}>
                      <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                        {item.name}
                        <ItemTags priceUncertain={item.priceUncertain} />
                      </Typography>
                      <Typography variant="body2" color="text.secondary" className="tnum" sx={{ mx: 1 }}>
                        {item.priceUncertain ? `≈${money(item.price)}` : money(item.price)}
                      </Typography>
                      {inCart && <Chip label={inCart.qty} size="small" color="primary" className="tnum" />}
                    </ListItemButton>
                  </Card>
                );
              })}
            </Stack>
          </Box>
        ))}

        <CustomItemForm onAdd={(item) => setCart((prev) => [...prev, item])} />

        {cart.length > 0 && (
          <Box>
            <Typography variant="overline" color="text.secondary">
              我點的
            </Typography>
            <Card sx={{ mt: 0.5 }}>
              <List disablePadding>
                {cart.map((item, index) => {
                  const key = cartKey(item);
                  return (
                    <ListItem key={key} divider={index < cart.length - 1} sx={{ px: 1.5, py: 0.75 }}>
                      <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                        {item.name}
                        <ItemTags
                          isCustom={item.menuItemId == null}
                          priceUncertain={item.priceUncertain}
                        />
                      </Typography>
                      <Typography variant="caption" color="text.secondary" className="tnum" sx={{ mx: 1 }}>
                        {item.priceUncertain ? `≈${money(item.unitPrice)}` : money(item.unitPrice)}
                      </Typography>
                      <IconButton size="small" onClick={() => changeQty(key, -1)} aria-label="減少">
                        <RemoveIcon fontSize="small" />
                      </IconButton>
                      <Typography variant="body2" className="tnum" sx={{ width: 24, textAlign: 'center' }}>
                        {item.qty}
                      </Typography>
                      <IconButton size="small" onClick={() => changeQty(key, 1)} aria-label="增加">
                        <AddIcon fontSize="small" />
                      </IconButton>
                    </ListItem>
                  );
                })}
              </List>
            </Card>
          </Box>
        )}

        <NameInput
          label="誰點的"
          value={personName}
          onChange={setPersonName}
          names={knownNames}
          helperText="結帳時用來算每個人要付多少"
          maxLength={20}
        />

        <TextField
          label="備註"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="例如 不要香菜、加辣"
          slotProps={{ htmlInput: { maxLength: 200 } }}
        />

        {error && <Alert severity="error">{error}</Alert>}
      </Stack>

      <Paper
        elevation={0}
        square
        sx={{
          position: 'sticky',
          bottom: 0,
          borderTop: 1,
          borderColor: 'divider',
          px: 2,
          pt: 1.5,
          pb: 'max(12px, env(safe-area-inset-bottom))',
          bgcolor: 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(8px)',
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {cart.reduce((sum, i) => sum + i.qty, 0)} 樣{hasUncertain && '・含估價'}
            </Typography>
            <Typography variant="h6" className="tnum">
              {hasUncertain ? `≈ ${money(total)}` : money(total)}
            </Typography>
          </Box>
          {existing && (
            <Button variant="outlined" onClick={() => setEditing(false)} disabled={saving}>
              取消
            </Button>
          )}
          <Button variant="contained" onClick={save} disabled={saving || cart.length === 0} sx={{ px: 3 }}>
            {saving ? '送出中…' : existing ? '更新' : '送出'}
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}

function CustomItemForm({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');

  function add() {
    const trimmed = name.trim();
    const value = Number(price);
    if (!trimmed) return setError('請填寫品名');
    if (!Number.isInteger(value) || value < 0 || value > 9999) {
      return setError('價格需為 0 ~ 9999 的整數');
    }

    onAdd({ menuItemId: null, name: trimmed, unitPrice: value, qty: 1, priceUncertain: uncertain });
    setName('');
    setPrice('');
    setUncertain(false);
    setError('');
    setOpen(false);
  }

  if (!open) {
    return (
      <Button variant="outlined" fullWidth onClick={() => setOpen(true)} sx={{ borderStyle: 'dashed' }}>
        菜單上沒有？自己填一個
      </Button>
    );
  }

  return (
    <Card sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Typography variant="overline" color="text.secondary">
          自填品項
        </Typography>
        <TextField
          label="品名"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          slotProps={{ htmlInput: { maxLength: 50 } }}
        />
        <TextField
          label={uncertain ? '大概多少錢' : '價格'}
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))}
          slotProps={{ htmlInput: { inputMode: 'numeric', className: 'tnum' } }}
        />
        <FormControlLabel
          control={<Checkbox checked={uncertain} onChange={(e) => setUncertain(e.target.checked)} />}
          label={<Typography variant="body2">我不確定價格，這只是估的</Typography>}
        />
        {error && <Alert severity="error">{error}</Alert>}
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" fullWidth onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button variant="contained" fullWidth onClick={add}>
            加入
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
}
