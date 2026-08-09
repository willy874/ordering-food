import { useState } from 'react';
import { Link as RouterLink } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { api } from '../lib/api.js';
import { keys, storesQuery, useAppMutation } from '../lib/queries.js';
import { parseMenuCsv } from '../lib/menuCsv.js';
import { Layout, Header, Empty } from '../components/ui.jsx';
import MenuCsvImport from '../components/MenuCsvImport.jsx';

export default function Stores() {
  const { data: stores = [], error } = useQuery(storesQuery());
  const [toast, setToast] = useState('');

  return (
    <Layout header={<Header title="店家與菜單" back="/" />}>
      <Stack spacing={2.5} sx={{ px: 2, py: 2.5 }}>
        {error && <Alert severity="error">{error.message}</Alert>}

        {stores.length === 0 ? (
          <Empty>還沒有店家，先新增一家吧</Empty>
        ) : (
          <Stack spacing={1}>
            {stores.map((store) => (
              <Card key={store.id}>
                <CardActionArea
                  component={RouterLink}
                  to="/stores/$storeId"
                  params={{ storeId: String(store.id) }}
                  sx={{ px: 2, py: 1.5 }}
                >
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

        <NewStoreForm onToast={setToast} />
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
function NewStoreForm({ onToast }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [csv, setCsv] = useState('');
  const [error, setError] = useState('');

  const create = useAppMutation({
    mutationFn: async () => {
      const store = await api.createStore({ name: name.trim(), phone: phone.trim() || null });

      const { items } = parseMenuCsv(csv);
      if (items.length === 0) return { store, imported: 0 };

      try {
        const result = await api.bulkAddMenuItems(store.id, items);
        return { store, imported: result.created };
      } catch (err) {
        return { store, imported: 0, importError: err.message };
      }
    },
    invalidates: [keys.stores()],
    onSuccess: ({ store, imported, importError }) => {
      if (importError) {
        setError(`店家已建立，但菜單匯入失敗：${importError}。可以進去菜單頁再試一次。`);
      } else if (imported > 0) {
        onToast?.(`已建立「${store.name}」並匯入 ${imported} 樣`);
      }
      setName('');
      setPhone('');
      setCsv('');
    },
    onError: (err) => setError(err.message),
  });

  function submit(event) {
    event.preventDefault();
    setError('');
    create.mutate();
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
        <Button type="submit" variant="contained" disabled={create.isPending || !name.trim()}>
          {create.isPending ? '新增中…' : pendingCount > 0 ? `新增店家並匯入 ${pendingCount} 樣` : '新增店家'}
        </Button>
      </Stack>
    </Card>
  );
}
