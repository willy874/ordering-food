import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { api } from '../lib/api.js';
import { storage } from '../lib/storage.js';
import { Layout, Header, BottomBar, NameInput, Empty } from '../components/ui.jsx';

/** 預設截止時間：今天 11:30，若已過則設為明天 */
function defaultDeadline() {
  const d = new Date();
  d.setSeconds(0, 0);
  if (d.getHours() >= 11 && d.getMinutes() >= 30) d.setDate(d.getDate() + 1);
  d.setHours(11, 30);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function NewGroup() {
  const navigate = useNavigate();
  const [stores, setStores] = useState(null);
  const [storeId, setStoreId] = useState('');
  const [title, setTitle] = useState('');
  const [hostName, setHostName] = useState(storage.getName());
  const [useDeadline, setUseDeadline] = useState(false);
  const [deadline, setDeadline] = useState(defaultDeadline());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [similar, setSimilar] = useState([]);

  useEffect(() => {
    api
      .listStores()
      .then((list) => {
        setStores(list);
        if (list.length) setStoreId(String(list[0].id));
      })
      .catch((err) => setError(err.message));
  }, []);

  // 同店家、同名且仍在收單中的攤，事先提醒，避免大家分散在兩攤
  useEffect(() => {
    const trimmed = title.trim();
    if (!storeId || !trimmed) {
      setSimilar([]);
      return;
    }
    const timer = setTimeout(() => {
      api.findSimilarGroups(storeId, trimmed).then(setSimilar).catch(() => setSimilar([]));
    }, 400);
    return () => clearTimeout(timer);
  }, [storeId, title]);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const store = stores.find((s) => String(s.id) === String(storeId));
      const finalTitle = title.trim() || `${store.name}`;
      const created = await api.createGroup({
        storeId: Number(storeId),
        title: finalTitle,
        hostName: hostName.trim(),
        deadlineAt: useDeadline && deadline ? new Date(deadline).toISOString() : null,
      });

      storage.setAdminToken(created.joinCode, created.adminToken);
      storage.rememberName(hostName.trim());
      storage.rememberGroup({ joinCode: created.joinCode, title: finalTitle, storeName: store.name });
      navigate(`/g/${created.joinCode}`, { replace: true });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  if (stores === null) {
    return (
      <Layout header={<Header title="開始一攤" back="/" />}>
        <Empty>載入中…</Empty>
      </Layout>
    );
  }

  if (stores.length === 0) {
    return (
      <Layout header={<Header title="開始一攤" back="/" />}>
        <Stack spacing={2} sx={{ px: 2, py: 3 }}>
          <Alert severity="warning">還沒有任何店家，請先建立店家與菜單。</Alert>
          <Button variant="contained" onClick={() => navigate('/stores')}>
            去建立店家
          </Button>
        </Stack>
      </Layout>
    );
  }

  return (
    <Box component="form" onSubmit={submit} sx={{ display: 'contents' }}>
      <Layout
        header={<Header title="開始一攤" back="/" />}
        footer={
          <BottomBar>
            <Button type="submit" variant="contained" fullWidth disabled={saving || !hostName.trim()}>
              {saving ? '建立中…' : '建立並取得代碼'}
            </Button>
          </BottomBar>
        }
      >
        <Stack spacing={2.5} sx={{ px: 2, py: 2.5 }}>
          <TextField select label="跟哪家店點" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            {stores.map((store) => (
              <MenuItem key={store.id} value={String(store.id)}>
                {store.name}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="這攤叫什麼"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如 墾丁第二天晚餐"
            helperText="留空的話會用店名"
            slotProps={{ htmlInput: { maxLength: 50 } }}
          />

          {similar.length > 0 && (
            <Alert severity="warning">
              <AlertTitle sx={{ fontSize: 14 }}>已經有同名的一攤還在點餐中</AlertTitle>
              <Stack spacing={1} sx={{ mt: 1 }}>
                {similar.map((group) => (
                  <Card key={group.joinCode}>
                    <CardActionArea onClick={() => navigate(`/g/${group.joinCode}`)} sx={{ px: 1.5, py: 1 }}>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="body2" noWrap>
                            {group.title}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" noWrap component="p">
                            {group.hostName} 開・已有 {group.orderCount} 人點餐
                          </Typography>
                        </Box>
                        <Chip label={group.joinCode} size="small" className="tnum" />
                      </Stack>
                    </CardActionArea>
                  </Card>
                ))}
              </Stack>
              <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>
                或是繼續往下開新的一攤。
              </Typography>
            </Alert>
          )}

          <NameInput
            label="你的名字"
            value={hostName}
            onChange={setHostName}
            names={storage.listNames()}
            helperText="結帳時用來算錢"
            maxLength={20}
          />

          <Box>
            <Button size="small" onClick={() => setUseDeadline((v) => !v)} sx={{ minHeight: 36 }}>
              {useDeadline ? '不需要截止時間' : '＋ 設定截止時間'}
            </Button>
            {useDeadline && (
              <TextField
                type="datetime-local"
                label="截止時間"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                helperText="超過時間後就不能再點"
                sx={{ mt: 1.5 }}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            )}
          </Box>

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </Layout>
    </Box>
  );
}
