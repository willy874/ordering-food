import { useState } from 'react';
import { Alert, Box, Button, Card, Divider, Stack, TextField, Typography } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { api } from '../lib/api.js';
import { storage } from '../lib/storage.js';
import { roleLabel } from '../lib/roles.js';

/**
 * 管理代碼，放在清單頁最底下。
 *
 * 三種樣子，各自對應一種人：
 *   發起人      代碼本身，念給誰誰就能幫忙改單
 *   已有權限    一行確認就好，不再顯示代碼——他手上本來就有，
 *               重複顯示只是讓旁邊經過的人瞄到
 *   其他人      一個輸入框
 *
 * 擺在最底下是因為它是「還沒有權限的人」才需要的入口：
 * 一攤十個人裡通常只有一個會用到它，擺上面等於九個人每次都要滑過去。
 */
export default function ManageCodeCard({
  joinCode,
  group,
  isHost,
  canManage,
  myRole,
  onToast,
  onChanged,
}) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      onToast?.('已複製管理代碼');
    } catch {
      onToast?.(text);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const trimmed = input.trim().toUpperCase();
    if (!trimmed) return setError('請輸入管理代碼');

    setSaving(true);
    setError('');
    try {
      const result = await api.verifyManageCode(joinCode, trimmed);
      storage.setManageCode(joinCode, result.manageCode);
      setInput('');
      onToast?.('你現在是這一攤的協助管理者');
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (isHost) {
    return (
      <Box sx={{ px: 2, pt: 1, pb: 4 }}>
        <Card>
          <Box sx={{ px: 2, py: 1.25 }}>
            <Typography variant="subtitle2">管理代碼</Typography>
            <Typography variant="caption" color="text.secondary">
              念給誰，誰就能幫忙改全攤的單——適合沒登記、但幫忙結帳的人
            </Typography>
          </Box>
          <Divider />
          <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1.5 }}>
            <Typography variant="h6" className="tnum" sx={{ letterSpacing: '0.18em', flex: 1 }}>
              {group.manageCode ?? '—'}
            </Typography>
            {group.manageCode && (
              <Button size="small" startIcon={<ContentCopyIcon />} onClick={() => copy(group.manageCode)}>
                複製
              </Button>
            )}
          </Stack>
          <Typography variant="caption" color="text.disabled" sx={{ display: 'block', px: 2, pb: 1.5 }}>
            跟代碼 {joinCode} 不一樣，別貼錯。拿到的人是<b>協助管理者</b>，
            改得動所有人的單但指派不了別人；這一組給出去就收不回來，
            要能收回請改用上面的權限下拉選單。
          </Typography>
        </Card>
      </Box>
    );
  }

  if (canManage) {
    return (
      <Box sx={{ px: 2, pt: 1, pb: 4 }}>
        <Alert severity="success">
          你是這一攤的{roleLabel(myRole)}，可以改任何人的品項、批次推進度。
          {myRole === 'admin'
            ? '也可以指派別人的權限、結束點餐、刪掉整攤。'
            : '結束點餐與刪除整攤要最高管理者才行。'}
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ px: 2, pt: 1, pb: 4 }}>
      <Card component="form" onSubmit={submit} sx={{ px: 2, py: 1.5 }}>
        <Stack spacing={1.5}>
          <Box>
            <Typography variant="subtitle2">有管理代碼？</Typography>
            <Typography variant="caption" color="text.secondary">
              發起人給你的那一組，輸入後就能幫忙改單
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <TextField
              value={input}
              onChange={(e) => {
                setInput(e.target.value.toUpperCase());
                setError('');
              }}
              placeholder="例如 K7M2QXVN"
              size="small"
              sx={{ flex: 1 }}
              slotProps={{
                htmlInput: {
                  autoCapitalize: 'characters',
                  autoComplete: 'off',
                  maxLength: 16,
                  className: 'tnum',
                  'aria-label': '管理代碼',
                  style: { letterSpacing: '0.15em' },
                },
              }}
            />
            <Button
              type="submit"
              variant="outlined"
              disabled={saving || !input.trim()}
              sx={{ flexShrink: 0 }}
            >
              {saving ? '確認中…' : '確認'}
            </Button>
          </Stack>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </Card>
    </Box>
  );
}
