import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
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
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import { api } from '../lib/api.js';
import { parseMenuCsv } from '../lib/menuCsv.js';
import { Layout, Header, Empty, ItemTags, money, MAX_PRICE } from '../components/ui.jsx';
import MenuCsvImport from '../components/MenuCsvImport.jsx';

export default function Stores() {
  const [stores, setStores] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  async function loadStores() {
    try {
      setStores(await api.listStores());
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadStores();
  }, []);

  if (selected) {
    return <MenuEditor store={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <Layout header={<Header title="店家與菜單" back="/" />}>
      <Stack spacing={2.5} sx={{ px: 2, py: 2.5 }}>
        {error && <Alert severity="error">{error}</Alert>}

        {stores === null ? (
          <Empty>載入中…</Empty>
        ) : stores.length === 0 ? (
          <Empty>還沒有店家，先新增一家吧</Empty>
        ) : (
          <Stack spacing={1}>
            {stores.map((store) => (
              <Card key={store.id}>
                <CardActionArea onClick={() => setSelected(store)} sx={{ px: 2, py: 1.5 }}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" fontWeight={500} noWrap>
                        {store.name}
                      </Typography>
                      {store.phone && (
                        <Typography variant="caption" color="text.secondary" noWrap component="p">
                          {store.phone}
                        </Typography>
                      )}
                    </Box>
                    <ChevronRightIcon sx={{ color: 'text.disabled' }} />
                  </Stack>
                </CardActionArea>
              </Card>
            ))}
          </Stack>
        )}

        <NewStoreForm onCreated={loadStores} onToast={setToast} />
      </Stack>

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={4000}
        onClose={() => setToast('')}
        message={toast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Layout>
  );
}

/**
 * 新增店家，順便把整份菜單一起帶進來。
 *
 * 新開一家店最花時間的從來不是填店名，是後面那幾十樣品項。所以 CSV 就放在
 * 這一步：建店與匯入是同一個動作，不必建完再翻進去一樣一樣按。
 *
 * 匯入失敗不會把店一起收回——店已經建好了是事實，讓使用者進菜單頁重試比
 * 「什麼都沒發生」好，至少他知道自己走到哪一步。
 */
function NewStoreForm({ onCreated, onToast }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [csv, setCsv] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const store = await api.createStore({ name: name.trim(), phone: phone.trim() || null });

      const { items } = parseMenuCsv(csv);
      if (items.length > 0) {
        try {
          const result = await api.bulkAddMenuItems(store.id, items);
          onToast?.(`已建立「${store.name}」並匯入 ${result.created} 樣`);
        } catch (err) {
          setError(`店家已建立，但菜單匯入失敗：${err.message}。可以進去菜單頁再試一次。`);
        }
      }

      setName('');
      setPhone('');
      setCsv('');
      await onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const pendingCount = parseMenuCsv(csv).items.length;

  return (
    <Card component="form" onSubmit={submit} sx={{ p: 2, borderStyle: 'dashed' }}>
      <Stack spacing={2}>
        <Typography variant="overline" color="text.secondary">
          新增店家
        </Typography>
        <TextField label="店名" value={name} onChange={(e) => setName(e.target.value)} slotProps={{ htmlInput: { maxLength: 50 } }} />
        <TextField label="電話（選填）" value={phone} onChange={(e) => setPhone(e.target.value)} slotProps={{ htmlInput: { maxLength: 30 } }} />

        <MenuCsvImport value={csv} onChange={setCsv} onToast={onToast} />

        {error && <Alert severity="error">{error}</Alert>}
        <Button type="submit" variant="contained" disabled={saving || !name.trim()}>
          {saving ? '新增中…' : pendingCount > 0 ? `新增店家並匯入 ${pendingCount} 樣` : '新增店家'}
        </Button>
      </Stack>
    </Card>
  );
}

function MenuEditor({ store, onBack }) {
  const [menu, setMenu] = useState(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  async function load() {
    try {
      setMenu(await api.getMenu(store.id));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);

  async function addItem(event) {
    event.preventDefault();
    setError('');
    const value = Number(price);
    if (!Number.isInteger(value) || value < 0 || value > MAX_PRICE) {
      setError(`價格需為 0 ~ ${MAX_PRICE} 的整數`);
      return;
    }
    setSaving(true);
    try {
      await api.addMenuItem(store.id, {
        name: name.trim(),
        price: value,
        category: category.trim() || '主餐',
        sortOrder: (menu?.length ?? 0) * 10,
        priceUncertain: uncertain,
      });
      setName('');
      setPrice('');
      setUncertain(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function patch(item, body) {
    try {
      await api.patchMenuItem(item.id, body);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(item) {
    try {
      await api.deleteMenuItem(item.id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Layout
      header={
        <Header
          title={store.name}
          subtitle="管理菜單"
          right={
            <Button variant="outlined" onClick={onBack} sx={{ flexShrink: 0 }}>
              返回
            </Button>
          }
        />
      }
    >
      <Stack spacing={2.5} sx={{ px: 2, py: 2.5 }}>
        {error && <Alert severity="error">{error}</Alert>}

        {menu === null ? (
          <Empty>載入中…</Empty>
        ) : menu.length === 0 ? (
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
                  <Button size="small" onClick={() => patch(item, { available: !item.available })} sx={{ minHeight: 36 }}>
                    {item.available ? '下架' : '上架'}
                  </Button>
                  <IconButton size="small" color="error" onClick={() => remove(item)} aria-label="刪除">
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </ListItem>
              ))}
            </List>
          </Card>
        )}

        <Card component="form" onSubmit={addItem} sx={{ p: 2, borderStyle: 'dashed' }}>
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
            <Button type="submit" variant="contained" disabled={saving || !name.trim() || price === ''}>
              {saving ? '新增中…' : '新增品項'}
            </Button>
          </Stack>
        </Card>

        {/* 同一個匯入器：換季改整份菜單時，這裡比一樣一樣按快得多 */}
        <MenuCsvImport
          title="一次貼上多個品項"
          busy={saving}
          onToast={setToast}
          onImport={async (items) => {
            setError('');
            setSaving(true);
            try {
              const result = await api.bulkAddMenuItems(store.id, items);
              setToast(`已匯入 ${result.created} 樣`);
              await load();
            } catch (err) {
              setError(err.message);
            } finally {
              setSaving(false);
            }
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
        onSave={async (body) => {
          setEditing(null);
          await patch(editing, body);
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
