import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  IconButton,
  Link,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import { api } from '../lib/api.js';
import { storage } from '../lib/storage.js';
import { Layout, Header } from '../components/ui.jsx';

/** 同名的攤很常見，用日期與代碼區隔 */
function dateLabel(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  if (sameDay) {
    return `今天 ${d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  }
  return d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', weekday: 'short' });
}

export default function Home() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [groups, setGroups] = useState(() => storage.listGroups());
  const [toast, setToast] = useState('');

  /**
   * 本機清單只是快取：團可能已經被發起人刪掉，標題或狀態也可能變了。
   * 進首頁時逐團問一次伺服器，刪掉的移除、還在的順便更新。
   *
   * 只有伺服器明確回 404 才移除。離線或伺服器出錯時一律保留，
   * 否則一次斷網就會把整份參與紀錄連同憑證清掉，救不回來。
   */
  useEffect(() => {
    const codes = storage.listGroups().map((group) => group.joinCode);
    if (codes.length === 0) return undefined;

    let cancelled = false;

    (async () => {
      const entries = await Promise.all(
        codes.map(async (code) => {
          try {
            const { group } = await api.getGroup(code);
            return [
              code,
              {
                title: group.title,
                storeName: group.store.name,
                createdAt: group.createdAt,
                status: group.status,
              },
            ];
          } catch (err) {
            return [code, err.status === 404 ? null : undefined];
          }
        }),
      );
      if (cancelled) return;

      const updates = Object.fromEntries(entries.filter(([, value]) => value !== undefined));
      const goneCount = Object.values(updates).filter((value) => value === null).length;

      setGroups(storage.reconcileGroups(updates));
      if (goneCount > 0) setToast(`已移除 ${goneCount} 個不存在的攤`);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function forget(event, joinCode) {
    event.preventDefault();
    event.stopPropagation();
    storage.forgetGroup(joinCode);
    setGroups(storage.listGroups());
  }

  function join(event) {
    event.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 4) {
      setError('請輸入完整的代碼');
      return;
    }
    navigate(`/g/${trimmed}`);
  }

  return (
    <Layout header={<Header title="聚會點餐機" subtitle="開一攤，大家各自點餐" />}>
      <Stack spacing={3} sx={{ px: 2, py: 2.5 }}>
        <Button
          component={RouterLink}
          to="/new"
          variant="contained"
          fullWidth
          sx={{ px: 2, py: 1.75, gap: 1.5, justifyContent: 'flex-start', textAlign: 'left' }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 40,
              height: 40,
              flexShrink: 0,
              borderRadius: '50%',
              bgcolor: 'rgba(255,255,255,0.16)',
            }}
          >
            <AddIcon />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" fontWeight={600} lineHeight={1.4}>
              開始一攤
            </Typography>
            <Typography variant="caption" lineHeight={1.4} sx={{ display: 'block', opacity: 0.7 }}>
              選一家店，把連結傳給大家
            </Typography>
          </Box>
        </Button>

        <Box component="form" onSubmit={join}>
          <Stack spacing={1}>
            <Typography variant="subtitle2">用代碼加入</Typography>
            <Stack direction="row" spacing={1}>
              <TextField
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setError('');
                }}
                placeholder="例如 K7M2QX"
                slotProps={{
                  htmlInput: {
                    autoCapitalize: 'characters',
                    autoComplete: 'off',
                    maxLength: 8,
                    className: 'tnum',
                    style: { letterSpacing: '0.15em' },
                  },
                }}
              />
              <Button type="submit" variant="outlined" sx={{ flexShrink: 0, px: 3 }}>
                加入
              </Button>
            </Stack>
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </Box>

        {groups.length > 0 && (
          <Stack spacing={1}>
            <Typography variant="subtitle2">最近參與的</Typography>
            {groups.map((group) => (
              <Card key={group.joinCode}>
                <Stack direction="row" alignItems="center">
                  <CardActionArea component={RouterLink} to={`/g/${group.joinCode}`} sx={{ px: 2, py: 1.5 }}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Stack direction="row" alignItems="center" spacing={0.75}>
                          <Typography variant="body2" fontWeight={500} noWrap>
                            {group.title}
                          </Typography>
                          {group.status === 'closed' && <Chip label="已結束" size="small" sx={{ height: 20, fontSize: 11 }} />}
                        </Stack>
                        <Typography variant="caption" color="text.secondary" noWrap component="p">
                          {group.storeName}
                          {dateLabel(group.createdAt) && `・${dateLabel(group.createdAt)}`}
                        </Typography>
                      </Box>
                      <Chip label={group.joinCode} size="small" className="tnum" sx={{ letterSpacing: '0.1em' }} />
                    </Stack>
                  </CardActionArea>
                  <IconButton
                    onClick={(e) => forget(e, group.joinCode)}
                    aria-label="從清單移除"
                    sx={{ color: 'text.disabled', mr: 0.5 }}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </Card>
            ))}
          </Stack>
        )}

        <Link component={RouterLink} to="/stores" variant="body2" color="text.secondary" sx={{ pt: 1 }}>
          管理店家與菜單
        </Link>
      </Stack>

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={3000}
        onClose={() => setToast('')}
        message={toast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Layout>
  );
}
