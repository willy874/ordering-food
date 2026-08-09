import { useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate } from '@tanstack/react-router';
import { useQueries, useQuery } from '@tanstack/react-query';
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
import { activeGroupsQuery, groupQuery } from '../lib/queries.js';
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

const timeOf = (d) => d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * 這一攤還收得了單多久。清單是照這個排序的，所以每一列都要看得見。
 *
 * 沒設截止時間的團，伺服器是用「建立後三天」當有效範圍的，
 * 但那是內部界線，寫成「23:10 截止」會騙人——那個時間點沒有人約好，
 * 所以改成顯示什麼時候開的。
 */
function activeLabel(group) {
  if (!group.deadlineAt) return `${dateLabel(group.createdAt)} 開的`;

  const deadline = new Date(group.deadlineAt);
  const minutes = Math.round((deadline - new Date()) / 60000);
  if (minutes <= 1) return '即將截止';
  if (minutes < 60) return `剩 ${minutes} 分鐘`;

  const sameDay = deadline.toDateString() === new Date().toDateString();
  if (sameDay) return `${timeOf(deadline)} 截止`;
  return `${deadline.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })} ${timeOf(deadline)} 截止`;
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
   * 用的是跟團頁同一個 query key，所以這一輪讀到的東西不會白費——
   * 點進去的那一團已經在快取裡，直接就有畫面。
   */
  /** 現在還收得了單的攤，不必先有連結或團號也看得到 */
  const active = useQuery(activeGroupsQuery());
  const joinedCodes = new Set(groups.map((group) => group.joinCode));

  const [checkedCodes] = useState(() => storage.listGroups().map((group) => group.joinCode));
  const results = useQueries({ queries: checkedCodes.map((joinCode) => groupQuery(joinCode)) });

  const settled = results.every((result) => !result.isPending);
  const reconciled = useRef(false);

  useEffect(() => {
    if (reconciled.current || checkedCodes.length === 0 || !settled) return;
    reconciled.current = true;

    /**
     * 只有伺服器明確回 404 才移除。離線或伺服器出錯時一律保留——
     * 沒出現在 updates 裡的原樣不動，否則一次斷網就會把整份參與紀錄
     * 連同憑證清掉，救不回來。
     */
    const updates = {};
    let goneCount = 0;

    results.forEach((result, index) => {
      const joinCode = checkedCodes[index];
      if (result.data) {
        const { group } = result.data;
        updates[joinCode] = {
          title: group.title,
          storeName: group.store.name,
          createdAt: group.createdAt,
          status: group.status,
        };
      } else if (result.error?.status === 404) {
        updates[joinCode] = null;
        goneCount += 1;
      }
    });

    setGroups(storage.reconcileGroups(updates));
    if (goneCount > 0) setToast(`已移除 ${goneCount} 個不存在的攤`);
    // results 每次 render 都是新陣列，靠 settled 當開關就夠了
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);

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
    navigate({ to: '/g/$joinCode', params: { joinCode: trimmed } });
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

        {/*
          進行中的攤。讀失敗時整塊不顯示——首頁的主要功能是開攤與輸入團號，
          不該因為這份清單連不上就擋在那裡。
        */}
        {active.isSuccess && (
          <Stack spacing={1}>
            <Typography variant="subtitle2">進行中的聚餐</Typography>
            {active.data.length === 0 ? (
              <Typography variant="caption" color="text.secondary">
                目前沒有還在收單的攤
              </Typography>
            ) : (
              active.data.map((group) => (
                <Card key={group.joinCode}>
                  <CardActionArea
                    component={RouterLink}
                    to="/g/$joinCode"
                    params={{ joinCode: group.joinCode }}
                    sx={{ px: 2, py: 1.5 }}
                  >
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Stack direction="row" alignItems="center" spacing={0.75}>
                          <Typography variant="body2" fontWeight={500} noWrap>
                            {group.title}
                          </Typography>
                          {joinedCodes.has(group.joinCode) && (
                            <Chip label="已參與" size="small" color="primary" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                          )}
                        </Stack>
                        <Typography variant="caption" color="text.secondary" noWrap component="p">
                          {group.storeName}・{group.hostName} 發起・{group.orderCount} 人
                        </Typography>
                      </Box>
                      <Stack alignItems="flex-end" spacing={0.5} sx={{ flexShrink: 0 }}>
                        <Chip label={group.joinCode} size="small" className="tnum" sx={{ letterSpacing: '0.1em' }} />
                        <Typography variant="caption" color="text.secondary" className="tnum">
                          {activeLabel(group)}
                        </Typography>
                      </Stack>
                    </Stack>
                  </CardActionArea>
                </Card>
              ))
            )}
          </Stack>
        )}

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
                  <CardActionArea
                    component={RouterLink}
                    to="/g/$joinCode"
                    params={{ joinCode: group.joinCode }}
                    sx={{ px: 2, py: 1.5 }}
                  >
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
