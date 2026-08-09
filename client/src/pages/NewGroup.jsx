import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
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
import { similarGroupsQuery, storesQuery } from '../lib/queries.js';
import { storage } from '../lib/storage.js';
import { Layout, Header, BottomBar, NameInput } from '../components/ui.jsx';

/** 預設截止時間：今天 11:30，若已過則設為明天 */
function defaultDeadline() {
  const d = new Date();
  d.setSeconds(0, 0);
  if (d.getHours() >= 11 && d.getMinutes() >= 30) d.setDate(d.getDate() + 1);
  d.setHours(11, 30);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 邊打字邊查同名的攤太吵，等手停下來再問 */
function useDebounced(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export default function NewGroup() {
  const navigate = useNavigate();
  const { data: stores = [] } = useQuery(storesQuery());

  const [storeId, setStoreId] = useState('');
  const [title, setTitle] = useState('');
  const [hostName, setHostName] = useState(storage.getName());
  const [useDeadline, setUseDeadline] = useState(false);
  const [deadline, setDeadline] = useState(defaultDeadline());
  const [error, setError] = useState('');

  useEffect(() => {
    if (!storeId && stores.length > 0) setStoreId(String(stores[0].id));
  }, [stores, storeId]);

  // 同店家、同名且仍在收單中的攤，事先提醒，避免大家分散在兩攤
  const debouncedTitle = useDebounced(title.trim(), 400);
  const { data: similar = [] } = useQuery(similarGroupsQuery(storeId, debouncedTitle));

  const create = useMutation({
    mutationFn: (body) => api.createGroup(body),
    onError: (err) => setError(err.message),
  });

  function submit(event) {
    event.preventDefault();
    setError('');

    const store = stores.find((s) => String(s.id) === String(storeId));
    if (!store) return setError('請先選一家店');
    const finalTitle = title.trim() || store.name;

    return create.mutate(
      {
        storeId: Number(storeId),
        title: finalTitle,
        hostName: hostName.trim(),
        deadlineAt: useDeadline && deadline ? new Date(deadline).toISOString() : null,
      },
      {
        onSuccess: (created) => {
          storage.setAdminToken(created.joinCode, created.adminToken);
          storage.rememberName(hostName.trim());
          storage.rememberGroup({
            joinCode: created.joinCode,
            title: finalTitle,
            storeName: store.name,
          });
          navigate({ to: '/g/$joinCode', params: { joinCode: created.joinCode }, replace: true });
        },
      },
    );
  }

  if (stores.length === 0) {
    return (
      <Layout header={<Header title="開始一攤" back="/" />}>
        <Stack spacing={2} sx={{ px: 2, py: 3 }}>
          <Alert severity="warning">還沒有任何店家，請先建立店家與菜單。</Alert>
          <Button variant="contained" onClick={() => navigate({ to: '/stores' })}>
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
            <Button
              type="submit"
              variant="contained"
              fullWidth
              disabled={create.isPending || !hostName.trim()}
            >
              {create.isPending ? '建立中…' : '建立並取得代碼'}
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
                    <CardActionArea
                      onClick={() =>
                        navigate({ to: '/g/$joinCode', params: { joinCode: group.joinCode } })
                      }
                      sx={{ px: 1.5, py: 1 }}
                    >
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
