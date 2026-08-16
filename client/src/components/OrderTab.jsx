import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Card,
  Checkbox,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
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
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import EditIcon from '@mui/icons-material/Edit';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { api } from '../lib/api.js';
import { keys, useAppMutation } from '../lib/queries.js';
import { storage } from '../lib/storage.js';
import { NameInput, ItemTags, priceText, shareLabelOf, MAX_PRICE } from './ui.jsx';
import ItemEditDialog from './ItemEditDialog.jsx';
import ShareSelect from './ShareSelect.jsx';

/**
 * 加點清單每一列的本機識別碼。
 * 不能用品名或價格當 key——改名、改價後就會跟別列撞在一起。
 */
let uidSeq = 0;
const nextUid = () => `row${++uidSeq}`;

/** 送出時只保留伺服器需要的欄位；菜單品項不送名稱與價格，一律以菜單為準 */
const toPayload = (items) =>
  items.map((item) => ({
    ...(item.menuItemId == null
      ? {
          name: item.name,
          unitPrice: item.unitPrice,
          priceUncertain: item.priceUncertain === true,
        }
      : { menuItemId: item.menuItemId }),
    qty: item.qty,
    note: item.note || null,
    shareScope: item.shareScope ?? 'owner',
    sharedWith: item.sharedWith ?? [],
  }));

export default function OrderTab({ joinCode, group, menu, orders = [], myOrder }) {
  const existing = myOrder?.order ?? null;

  const accepting =
    group.status === 'open' && !(group.deadlineAt && new Date(group.deadlineAt) < new Date());

  // 還沒登記暱稱：先給身分再點餐。有了身分別人才選得到你分單，
  // 你之後加點也不必再打一次名字。
  if (!existing) {
    if (!accepting) {
      return (
        <Box sx={{ px: 2, py: 3 }}>
          <Alert severity="warning">這一攤已經結束點餐了。</Alert>
        </Box>
      );
    }
    return <RegisterCard joinCode={joinCode} orders={orders} />;
  }

  return (
    <OrderEditor
      joinCode={joinCode}
      menu={menu}
      orders={orders}
      existing={existing}
      editToken={myOrder.editToken}
      accepting={accepting}
    />
  );
}

/**
 * 第一次進團要先登記暱稱。
 *
 * 這一步刻意擋在點餐之前，而不是跟著送單一起填：先前每次送單都重打名字，
 * 打成「小明」「小明 」「明」的時候，結帳就多出三個人。名字是這一團裡的身分，
 * 登記一次就固定下來。
 */
function RegisterCard({ joinCode, orders }) {
  const [name, setName] = useState(storage.getName());
  const [error, setError] = useState('');

  const takenNames = useMemo(() => new Set(orders.map((o) => o.personName)), [orders]);
  const knownNames = useMemo(
    () => storage.listNames().filter((n) => !takenNames.has(n)),
    [takenNames],
  );

  const register = useAppMutation({
    // 登記出來的是一張還沒點東西的單。有單才有身分。
    mutationFn: (personName) => api.createOrder(joinCode, { personName, items: [] }),
    invalidates: [keys.group(joinCode)],
    onSuccess: (created, personName) => {
      storage.setMyOrder(joinCode, {
        orderId: created.orderId,
        editToken: created.editToken,
        personName,
      });
      storage.rememberName(personName);
    },
    onError: (err) => setError(err.message),
  });

  function submit() {
    const trimmed = name.trim();
    setError('');
    if (!trimmed) return setError('請填一個暱稱');
    if (takenNames.has(trimmed)) {
      return setError(`這一團已經有「${trimmed}」了，換一個或加上區隔（例如「${trimmed}2」）`);
    }
    return register.mutate(trimmed);
  }

  return (
    <Stack spacing={2.5} sx={{ px: 2, py: 3 }}>
      <Box>
        <Typography variant="h6">先登記一下你是誰</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          這個暱稱在這一攤就固定下來了，結帳按它算錢，別人也用它把你選進分單。
        </Typography>
      </Box>

      <NameInput
        label="你的暱稱"
        value={name}
        onChange={setName}
        names={knownNames}
        helperText="通常填自己的名字就好"
        maxLength={20}
      />

      {orders.length > 0 && (
        <Box>
          <Typography variant="caption" color="text.secondary">
            已經登記的人
          </Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
            {orders.map((order) => (
              <Chip key={order.id} label={order.personName} size="small" variant="outlined" />
            ))}
          </Stack>
        </Box>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      <Button
        variant="contained"
        size="large"
        onClick={submit}
        disabled={register.isPending || !name.trim()}
      >
        {register.isPending ? '登記中…' : '登記，開始點餐'}
      </Button>
    </Stack>
  );
}

/**
 * 點餐頁只做一件事：挑東西。
 *
 * 已經送出的品項不在這裡——那份資料跟別人點的東西是同一份，看與改一律去「清單」。
 * 分兩個 tab 顯示同一張單，只會讓人為了確認自己點了什麼一直切回來。
 *
 * 購物車出現兩次是刻意的：上面那份給「剛挑完、還沒往下滑」的人，
 * 置底那份收合著，給已經滑到菜單深處、想確認一下再送出的人。
 */
function OrderEditor({ joinCode, menu, orders, existing, editToken, accepting }) {
  const [cart, setCart] = useState([]);
  const [note, setNote] = useState(existing.note ?? '');
  const [keyword, setKeyword] = useState('');
  const [editing, setEditing] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');

  const tokens = storage.tokensFor(joinCode, editToken);

  // 分單只選得到已經登記的人，自己不列（自己必然要付）
  const otherPeople = useMemo(
    () =>
      orders
        .filter((order) => order.id !== existing.id)
        .map((order) => ({ orderId: order.id, personName: order.personName })),
    [orders, existing.id],
  );

  // 關鍵字同時比對品名與分類，讓「飲料」這種只寫在分類上的字也找得到
  const categories = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    const map = new Map();
    for (const item of menu) {
      if (!item.available) continue;
      if (q && !`${item.name} ${item.category ?? ''}`.toLowerCase().includes(q)) continue;
      if (!map.has(item.category)) map.set(item.category, []);
      map.get(item.category).push(item);
    }
    return [...map.entries()];
  }, [menu, keyword]);

  const availableCount = useMemo(() => menu.filter((item) => item.available).length, [menu]);
  const matchCount = categories.reduce((sum, [, items]) => sum + items.length, 0);
  const searching = keyword.trim().length > 0;

  const cartCount = cart.reduce((sum, i) => sum + i.qty, 0);
  const cartTotal = cart.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
  // 留空價格的品項以 0 元計入，不該讓這次加點裡其他已確定的金額被標成約略值
  const cartUncertain = cart.some((i) => i.priceUncertain && i.unitPrice !== 0);
  const noteChanged = (note.trim() || null) !== (existing.note ?? null);

  function addMenuItem(menuItem) {
    setCart((prev) => {
      // 已經改過內容或設過分單的列不會被合併，使用者的設定因此不會被
      // 「再點一次」的動作蓋掉
      const found = prev.find(
        (i) => i.menuItemId === menuItem.id && i.shareScope === 'owner' && !i.note,
      );
      if (found) {
        return prev.map((i) => (i.uid === found.uid ? { ...i, qty: Math.min(i.qty + 1, 99) } : i));
      }
      return [
        ...prev,
        {
          uid: nextUid(),
          menuItemId: menuItem.id,
          name: menuItem.name,
          unitPrice: menuItem.price,
          qty: 1,
          priceUncertain: menuItem.priceUncertain,
          note: '',
          shareScope: 'owner',
          sharedWith: [],
        },
      ];
    });
  }

  function changeCartQty(uid, delta) {
    setCart((prev) =>
      prev
        .map((item) => (item.uid === uid ? { ...item, qty: item.qty + delta } : item))
        .filter((item) => item.qty > 0),
    );
  }

  /**
   * 改加點清單裡某一列。菜單品項的名稱與價格在後端一律以菜單為準
   * （前端送什麼都會被丟棄），所以一旦改動就把 menuItemId 拿掉轉成自填品項。
   * 只改數量、備註或分單則保留連結。
   */
  function editCartItem(uid, patch) {
    setCart((prev) =>
      prev.map((item) => {
        if (item.uid !== uid) return item;
        const contentChanged =
          patch.name !== item.name ||
          patch.unitPrice !== item.unitPrice ||
          patch.priceUncertain !== item.priceUncertain;
        return { ...item, ...patch, menuItemId: contentChanged ? null : item.menuItemId };
      }),
    );
  }

  const save = useAppMutation({
    mutationFn: async () => {
      // 備註與品項是兩個 API，但對使用者是同一個「加點」動作，
      // 所以綁在同一個 mutation 裡，兩邊都成功才算送出去了
      if (noteChanged) {
        await api.patchOrder(existing.id, { note: note.trim() || null }, tokens);
      }
      if (cart.length > 0) {
        await api.addOrderItems(existing.id, toPayload(cart), tokens);
      }
    },
    invalidates: [keys.group(joinCode)],
    onSuccess: () => {
      setCart([]);
      setExpanded(false);
    },
    onError: (err) => setError(err.message),
  });

  const rename = useAppMutation({
    mutationFn: (personName) => api.patchOrder(existing.id, { personName }, tokens),
    invalidates: [keys.group(joinCode)],
    onSuccess: (_result, personName) => {
      storage.renameMe(joinCode, personName);
      storage.rememberName(personName);
    },
    onError: (err) => setError(err.message),
  });

  const saving = save.isPending || rename.isPending;

  function submit() {
    setError('');
    if (cart.length === 0 && !noteChanged) return setError('沒有要加點的東西');
    return save.mutate();
  }

  const cartList = (
    <CartList
      cart={cart}
      onEdit={(item) => setEditing(item)}
      onChangeQty={changeCartQty}
      disabled={saving}
    />
  );

  return (
    <Box>
      <Stack spacing={3} sx={{ px: 2, py: 2.5 }}>
        {/* 身分固定顯示，不再是每次要重填的欄位 */}
        <Card sx={{ px: 2, py: 1.25 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary">
                你在這一攤是
              </Typography>
              <Typography variant="subtitle1" noWrap>
                {existing.personName}
              </Typography>
            </Box>
            <Typography variant="subtitle2" className="tnum">
              {priceText(existing.payable, existing.payablePriceUncertain)}
            </Typography>
            <Button size="small" onClick={() => setRenaming(true)} disabled={saving || !accepting}>
              改暱稱
            </Button>
          </Stack>
          {existing.payable !== existing.total && (
            <Typography variant="caption" color="text.secondary">
              自己點了 {priceText(existing.total, existing.priceUncertain)}，分單後應付{' '}
              {priceText(existing.payable, existing.payablePriceUncertain)}
            </Typography>
          )}
          <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }}>
            已經送出的品項在「清單」那一頁看與修改。
          </Typography>
        </Card>

        {/* 還沒送出的東西。空的時候整塊不出現——沒挑東西時它只是一個空殼 */}
        {cart.length > 0 && (
          <Box>
            <Typography variant="overline" color="text.secondary">
              這次要加點的
            </Typography>
            <Card sx={{ mt: 0.5 }}>{cartList}</Card>
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.75 }}>
              價格、品名、備註或要分給誰，都點鉛筆改；改完記得按下面的加點。
            </Typography>
          </Box>
        )}

        {!accepting && (
          <Alert severity="info">已結束點餐，不能再加點。餐點狀態還是可以繼續更新。</Alert>
        )}

        {accepting && (
          <>
            <Stack spacing={1.5}>
              <TextField
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder={`搜尋品名或分類（共 ${availableCount} 樣）`}
                size="small"
                helperText={searching ? `找到 ${matchCount} 樣` : undefined}
                slotProps={{
                  htmlInput: { maxLength: 30, 'aria-label': '搜尋菜單' },
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" color="disabled" />
                      </InputAdornment>
                    ),
                    endAdornment: keyword ? (
                      <InputAdornment position="end">
                        <IconButton size="small" onClick={() => setKeyword('')} aria-label="清除搜尋">
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ) : null,
                  },
                }}
              />

              <CustomItemForm
                keyword={keyword}
                people={otherPeople}
                onAdd={(item) => setCart((prev) => [...prev, { uid: nextUid(), ...item }])}
              />
            </Stack>

            {categories.map(([category, items]) => (
              <Box key={category}>
                <Typography variant="overline" color="text.secondary">
                  {category}
                </Typography>
                <Stack spacing={0.75} sx={{ mt: 0.5 }}>
                  {items.map((item) => {
                    const inCart = cart.filter((i) => i.menuItemId === item.id);
                    const qty = inCart.reduce((sum, i) => sum + i.qty, 0);
                    return (
                      <Card key={item.id}>
                        <ListItemButton
                          onClick={() => addMenuItem(item)}
                          sx={{ px: 1.5, py: 1, borderRadius: 2 }}
                        >
                          <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                            {item.name}
                            <ItemTags priceUncertain={item.priceUncertain} />
                          </Typography>
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            className="tnum"
                            sx={{ mx: 1 }}
                          >
                            {priceText(item.price, item.priceUncertain)}
                          </Typography>
                          {qty > 0 && (
                            <Chip label={qty} size="small" color="primary" className="tnum" />
                          )}
                        </ListItemButton>
                      </Card>
                    );
                  })}
                </Stack>
              </Box>
            ))}

            {categories.length === 0 && (
              <Typography variant="body2" color="text.disabled" align="center" sx={{ py: 3 }}>
                {searching
                  ? `菜單上找不到「${keyword.trim()}」，可以用上面的「自己填一個」加進來`
                  : '這家店還沒有菜單，用上面的「自己填一個」把品項加進來'}
              </Typography>
            )}
          </>
        )}

        {error && <Alert severity="error">{error}</Alert>}
      </Stack>

      <ItemEditDialog
        item={editing}
        people={otherPeople}
        onClose={() => setEditing(null)}
        onSave={(patch) => {
          editCartItem(editing.uid, patch);
          setEditing(null);
        }}
      />

      <RenameDialog
        open={renaming}
        current={existing.personName}
        taken={orders.filter((o) => o.id !== existing.id).map((o) => o.personName)}
        onClose={() => setRenaming(false)}
        onSave={(personName) => {
          setRenaming(false);
          setError('');
          rename.mutate(personName);
        }}
      />

      {accepting && (
        <Paper
          elevation={0}
          square
          sx={{
            position: 'sticky',
            bottom: 0,
            borderTop: 1,
            borderColor: 'divider',
            bgcolor: 'rgba(255,255,255,0.95)',
            backdropFilter: 'blur(8px)',
            pb: 'max(12px, env(safe-area-inset-bottom))',
          }}
        >
          {/* 收合起來的快速檢視：滑到菜單深處時不必捲回最上面才確認得了 */}
          <Collapse in={expanded}>
            {/* 不透明底色：置底面板浮在菜單上面，半透明會讓兩層字疊在一起 */}
            <Box
              sx={{
                maxHeight: '45dvh',
                overflowY: 'auto',
                bgcolor: 'background.paper',
                borderBottom: 1,
                borderColor: 'divider',
              }}
            >
              {cart.length > 0 ? (
                cartList
              ) : (
                <Typography variant="body2" color="text.disabled" align="center" sx={{ py: 2 }}>
                  還沒挑任何東西
                </Typography>
              )}
              <Box sx={{ px: 2, py: 1.5 }}>
                <TextField
                  label="整張單的備註"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="例如 我晚點到，餐先冰著"
                  size="small"
                  helperText="整張單的通則；單樣的要求請用該列的鉛筆填"
                  slotProps={{ htmlInput: { maxLength: 200 } }}
                />
              </Box>
            </Box>
          </Collapse>

          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 2, pt: 1.5 }}>
            <ButtonBase
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-label={expanded ? '收合這次要加點的' : '展開這次要加點的'}
              sx={{ flex: 1, justifyContent: 'flex-start', borderRadius: 2, px: 0.5, py: 0.5 }}
            >
              <ExpandLessIcon
                fontSize="small"
                sx={{
                  color: 'text.secondary',
                  mr: 0.5,
                  transition: 'transform 0.2s',
                  transform: expanded ? 'rotate(180deg)' : 'none',
                }}
              />
              <Box sx={{ textAlign: 'left', minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary" component="p">
                  這次加點 {cartCount} 樣
                  {cartUncertain && '・含估價'}
                  {noteChanged && '・備註已改'}
                </Typography>
                <Typography variant="h6" className="tnum">
                  {priceText(cartTotal, cartUncertain)}
                </Typography>
              </Box>
            </ButtonBase>
            <Button
              variant="contained"
              onClick={submit}
              disabled={saving || (cart.length === 0 && !noteChanged)}
              sx={{ px: 3 }}
            >
              {saving ? '送出中…' : '加點'}
            </Button>
          </Stack>
        </Paper>
      )}
    </Box>
  );
}

/**
 * 還沒送出的加點清單。
 * 上方那份與置底收合的那份是同一個元件——兩邊要做的事完全一樣，
 * 分成兩份實作只會讓其中一份先長歪。
 */
function CartList({ cart, onEdit, onChangeQty, disabled }) {
  return (
    <List disablePadding>
      {cart.map((item, index) => (
        <ListItem key={item.uid} divider={index < cart.length - 1} sx={{ px: 1.5, py: 0.75 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" noWrap>
              {item.name}
              <ItemTags
                isCustom={item.menuItemId == null}
                priceUncertain={item.priceUncertain}
                shareLabel={shareLabelOf(item)}
              />
            </Typography>
            {item.note && (
              <Typography variant="caption" color="text.secondary" display="block" noWrap>
                {item.note}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary" className="tnum">
              {priceText(item.unitPrice, item.priceUncertain)}
            </Typography>
          </Box>
          <IconButton
            size="small"
            onClick={() => onEdit(item)}
            disabled={disabled}
            aria-label={`修改 ${item.name}`}
            sx={{ color: 'text.disabled' }}
          >
            <EditIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => onChangeQty(item.uid, -1)}
            disabled={disabled}
            aria-label="減少"
          >
            <RemoveIcon fontSize="small" />
          </IconButton>
          <Typography variant="body2" className="tnum" sx={{ width: 24, textAlign: 'center' }}>
            {item.qty}
          </Typography>
          <IconButton
            size="small"
            onClick={() => onChangeQty(item.uid, 1)}
            disabled={disabled}
            aria-label="增加"
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </ListItem>
      ))}
    </List>
  );
}

/** 改暱稱。名字是這一團的身分，改了之後彙總與分單都跟著改。 */
function RenameDialog({ open, current, taken, onClose, onSave }) {
  const [name, setName] = useState(current);
  const [error, setError] = useState('');

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return setError('請填一個暱稱');
    if (taken.includes(trimmed)) return setError(`這一團已經有「${trimmed}」了`);
    onSave(trimmed);
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ pb: 1 }}>改暱稱</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="暱稱"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            slotProps={{ htmlInput: { maxLength: 20 } }}
          />
          <Typography variant="caption" color="text.secondary">
            結帳與別人的分單都會跟著改成新的名字。
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={submit}>
          確定
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * 自填品項。
 * 價格可以留空 —— 常見情況是先點了東西，結帳才知道多少錢；
 * 留空時以 0 元計入，並標為價格待確認，結帳時再補。
 */
function CustomItemForm({ onAdd, keyword = '', people = [] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [share, setShare] = useState({ shareScope: 'owner', sharedWith: [] });
  const [error, setError] = useState('');

  const noPrice = price.trim() === '';

  function reset() {
    setName('');
    setPrice('');
    setNote('');
    setUncertain(false);
    setShare({ shareScope: 'owner', sharedWith: [] });
    setError('');
    setOpen(false);
  }

  function add() {
    const trimmed = name.trim();
    if (!trimmed) return setError('請填寫品名');

    const value = noPrice ? 0 : Number(price);
    if (!noPrice && (!Number.isInteger(value) || value < 0 || value > MAX_PRICE)) {
      return setError(`價格需為 0 ~ ${MAX_PRICE} 的整數`);
    }

    onAdd({
      menuItemId: null,
      name: trimmed,
      unitPrice: value,
      qty: 1,
      // 沒填價格本身就是一種不確定
      priceUncertain: noPrice || uncertain,
      note: note.trim(),
      ...share,
    });
    reset();
  }

  if (!open) {
    return (
      <Button
        variant="outlined"
        fullWidth
        onClick={() => {
          // 搜尋沒找到就直接把關鍵字當品名，少打一次字
          setName(keyword.trim().slice(0, 50));
          setOpen(true);
        }}
        sx={{ borderStyle: 'dashed' }}
      >
        {keyword.trim() ? `菜單沒有「${keyword.trim()}」？自己填一個` : '菜單上沒有？自己填一個'}
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
          label={noPrice ? '價格（可以留空）' : uncertain ? '大概多少錢' : '價格'}
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))}
          helperText={noPrice ? '還不知道多少錢就留空，結帳時再補' : undefined}
          slotProps={{ htmlInput: { inputMode: 'numeric', className: 'tnum' } }}
        />
        <TextField
          label="備註（選填）"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="例如 不要香菜、去冰"
          slotProps={{ htmlInput: { maxLength: 100 } }}
        />
        {noPrice ? (
          <Alert severity="info" sx={{ py: 0.25 }}>
            沒填價格：先以 $0 計入，並標成「價格待確認」。
          </Alert>
        ) : (
          <FormControlLabel
            control={<Checkbox checked={uncertain} onChange={(e) => setUncertain(e.target.checked)} />}
            label={<Typography variant="body2">我不確定價格，這只是估的</Typography>}
          />
        )}
        <Divider />
        <ShareSelect value={share} onChange={setShare} people={people} dense />
        {error && <Alert severity="error">{error}</Alert>}
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" fullWidth onClick={reset}>
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
