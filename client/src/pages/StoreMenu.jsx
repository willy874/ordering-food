import { useState } from 'react';
import { getRouteApi } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import { api } from '../lib/api.js';
import { keys, menuQuery, storesQuery, useAppMutation } from '../lib/queries.js';
import { Layout, Header, Empty, ItemTags, money, MAX_PRICE } from '../components/ui.jsx';
import MenuCsvImport from '../components/MenuCsvImport.jsx';

const route = getRouteApi('/stores/$storeId');

export default function StoreMenu() {
  const { storeId: param } = route.useParams();
  const storeId = Number(param);

  const { data: stores = [] } = useQuery(storesQuery());
  const { data: menu = [] } = useQuery(menuQuery(storeId));
  const store = stores.find((s) => s.id === storeId);

  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const invalidates = [keys.menu(storeId)];
  const fail = (err) => setError(err.message);

  const addItem = useAppMutation({
    mutationFn: (body) => api.addMenuItem(storeId, body),
    invalidates,
    onSuccess: () => {
      setName('');
      setPrice('');
      setUncertain(false);
    },
    onError: fail,
  });

  const patchItem = useAppMutation({
    mutationFn: ({ id, body }) => api.patchMenuItem(id, body),
    invalidates,
    onError: fail,
  });

  const removeItem = useAppMutation({
    mutationFn: (id) => api.deleteMenuItem(id),
    invalidates,
    onError: fail,
  });

  const bulkImport = useAppMutation({
    mutationFn: (items) => api.bulkAddMenuItems(storeId, items),
    invalidates,
    onSuccess: (result) => setToast(`已匯入 ${result.created} 樣`),
    onError: fail,
  });

  const busy =
    addItem.isPending || patchItem.isPending || removeItem.isPending || bulkImport.isPending;

  function submitNewItem(event) {
    event.preventDefault();
    setError('');
    const value = Number(price);
    if (!Number.isInteger(value) || value < 0 || value > MAX_PRICE) {
      setError(`價格需為 0 ~ ${MAX_PRICE} 的整數`);
      return;
    }
    addItem.mutate({
      name: name.trim(),
      price: value,
      category: category.trim() || '主餐',
      sortOrder: menu.length * 10,
      priceUncertain: uncertain,
    });
  }

  return (
    <Layout header={<Header title={store?.name ?? '菜單'} subtitle="管理菜單" back="/stores" />}>
      <Stack spacing={2.5} sx={{ px: 2, py: 2.5 }}>
        {error && <Alert severity="error">{error}</Alert>}

        {menu.length === 0 ? (
          <Empty>還沒有品項</Empty>
        ) : (
          <Card>
            <List disablePadding>
              {menu.map((item, index) => (
                <ListItem key={item.id} divider={index < menu.length - 1} sx={{ px: 1.5, py: 1 }}>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography
                      variant="body2"
                      noWrap
                      sx={{
                        color: item.available ? 'text.primary' : 'text.disabled',
                        textDecoration: item.available ? 'none' : 'line-through',
                      }}
                    >
                      {item.name}
                      <ItemTags priceUncertain={item.priceUncertain} />
                    </Typography>
                    <Typography variant="caption" color="text.disabled">
                      {item.category}
                    </Typography>
                  </Box>
                  <Typography variant="body2" color="text.secondary" className="tnum" sx={{ mx: 1 }}>
                    {money(item.price)}
                  </Typography>
                  <IconButton size="small" onClick={() => setEditing(item)} aria-label={`修改 ${item.name}`}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <Button
                    size="small"
                    onClick={() => {
                      setError('');
                      patchItem.mutate({ id: item.id, body: { available: !item.available } });
                    }}
                    disabled={busy}
                    sx={{ minHeight: 36 }}
                  >
                    {item.available ? '下架' : '上架'}
                  </Button>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => {
                      setError('');
                      removeItem.mutate(item.id);
                    }}
                    disabled={busy}
                    aria-label="刪除"
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </ListItem>
              ))}
            </List>
          </Card>
        )}

        <Card component="form" onSubmit={submitNewItem} sx={{ p: 2, borderStyle: 'dashed' }}>
          <Stack spacing={2}>
            <Typography variant="overline" color="text.secondary">
              新增品項
            </Typography>
            <TextField label="品名" value={name} onChange={(e) => setName(e.target.value)} slotProps={{ htmlInput: { maxLength: 50 } }} />
            <TextField
              label="價格"
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))}
              slotProps={{ htmlInput: { inputMode: 'numeric', className: 'tnum' } }}
            />
            <TextField
              label="分類"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              helperText="留空預設為「主餐」"
              slotProps={{ htmlInput: { maxLength: 20 } }}
            />
            <FormControlLabel
              control={<Checkbox checked={uncertain} onChange={(e) => setUncertain(e.target.checked)} />}
              label={<Typography variant="body2">價格待確認（只記得大概）</Typography>}
            />
            <Divider />
            <Button type="submit" variant="contained" disabled={busy || !name.trim() || price === ''}>
              {addItem.isPending ? '新增中…' : '新增品項'}
            </Button>
          </Stack>
        </Card>

        {/* 同一個匯入器：換季改整份菜單時，這裡比一樣一樣按快得多 */}
        <MenuCsvImport
          title="一次貼上多個品項"
          busy={busy}
          onToast={setToast}
          onImport={(items) => {
            setError('');
            return bulkImport.mutateAsync(items);
          }}
        />
      </Stack>

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={4000}
        onClose={() => setToast('')}
        message={toast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />

      <MenuItemEditDialog
        item={editing}
        onClose={() => setEditing(null)}
        onSave={(body) => {
          const item = editing;
          setEditing(null);
          setError('');
          patchItem.mutate({ id: item.id, body });
        }}
      />
    </Layout>
  );
}

/**
 * 修改已經在菜單上的品項。
 *
 * 改價不會動到已經送出的訂單——order_items 存的是下單當下的名稱與價格快照
 * （見 docs/ARCHITECTURE.md §6），所以這裡調整的是「之後點的人看到什麼」。
 * 已經點過的人不會莫名其妙被追加金額，這是刻意的。
 */
function MenuItemEditDialog({ item, onClose, onSave }) {
  return (
    <Dialog open={Boolean(item)} onClose={onClose} fullWidth maxWidth="xs">
      {item && <MenuItemEditForm key={item.id} item={item} onClose={onClose} onSave={onSave} />}
    </Dialog>
  );
}

function MenuItemEditForm({ item, onClose, onSave }) {
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState(String(item.price));
  const [category, setCategory] = useState(item.category ?? '');
  const [uncertain, setUncertain] = useState(item.priceUncertain === true);
  const [error, setError] = useState('');

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return setError('請填寫品名');

    const value = Number(price);
    if (price.trim() === '' || !Number.isInteger(value) || value < 0 || value > MAX_PRICE) {
      return setError(`價格需為 0 ~ ${MAX_PRICE} 的整數`);
    }

    onSave({
      name: trimmed,
      price: value,
      category: category.trim() || '主餐',
      priceUncertain: uncertain,
    });
  }

  return (
    <>
      <DialogTitle sx={{ pb: 1 }}>修改品項</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="品名"
            value={name}
            onChange={(e) => setName(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 50 } }}
          />
          <TextField
            label="價格"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))}
            slotProps={{ htmlInput: { inputMode: 'numeric', className: 'tnum' } }}
          />
          <TextField
            label="分類"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            helperText="留空預設為「主餐」"
            slotProps={{ htmlInput: { maxLength: 20 } }}
          />
          <FormControlLabel
            control={
              <Checkbox checked={uncertain} onChange={(e) => setUncertain(e.target.checked)} />
            }
            label={<Typography variant="body2">價格待確認（只記得大概）</Typography>}
          />
          <Alert severity="info" sx={{ py: 0.25 }}>
            已經送出的訂單不受影響，改的是之後點的人看到的價格。
          </Alert>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={submit}>
          確定
        </Button>
      </DialogActions>
    </>
  );
}
