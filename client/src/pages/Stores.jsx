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
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { api } from '../lib/api.js';
import { Layout, Header, Empty, ItemTags, money } from '../components/ui.jsx';

export default function Stores() {
  const [stores, setStores] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');

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

        <NewStoreForm onCreated={loadStores} />
      </Stack>
    </Layout>
  );
}

function NewStoreForm({ onCreated }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.createStore({ name: name.trim(), phone: phone.trim() || null });
      setName('');
      setPhone('');
      await onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card component="form" onSubmit={submit} sx={{ p: 2, borderStyle: 'dashed' }}>
      <Stack spacing={2}>
        <Typography variant="overline" color="text.secondary">
          新增店家
        </Typography>
        <TextField label="店名" value={name} onChange={(e) => setName(e.target.value)} slotProps={{ htmlInput: { maxLength: 50 } }} />
        <TextField label="電話（選填）" value={phone} onChange={(e) => setPhone(e.target.value)} slotProps={{ htmlInput: { maxLength: 30 } }} />
        {error && <Alert severity="error">{error}</Alert>}
        <Button type="submit" variant="contained" disabled={saving || !name.trim()}>
          {saving ? '新增中…' : '新增店家'}
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
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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
    if (!Number.isInteger(value) || value < 0 || value > 9999) {
      setError('價格需為 0 ~ 9999 的整數');
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
      </Stack>
    </Layout>
  );
}
