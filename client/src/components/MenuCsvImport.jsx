import { useMemo, useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  Chip,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import { MENU_CSV_TEMPLATE, downloadMenuCsvTemplate, parseMenuCsv } from '../lib/menuCsv.js';

/**
 * 一次貼上整份菜單。
 *
 * 逐樣新增一家店要按幾十次，而菜單通常已經以某種表格形式存在了。這裡接受
 * 貼上的 CSV／從試算表直接複製的內容，解析後先顯示「會匯入幾樣、哪幾行有問題」，
 * 確認過再送出——匯入是一次寫進去幾十列的動作，看不到結果就按下去太可怕了。
 *
 * 兩種用法：
 *   受控（value/onChange）  新增店家時用，店還不存在，CSV 要等店建好才送
 *   自帶按鈕（onImport）    既有店家的菜單頁用，當場就能匯入
 */
export default function MenuCsvImport({
  value,
  onChange,
  onImport,
  busy = false,
  onToast,
  title = '一次貼上菜單（選填）',
}) {
  const [internal, setInternal] = useState('');
  const text = value ?? internal;
  const setText = onChange ?? setInternal;

  const { items, errors } = useMemo(() => parseMenuCsv(text), [text]);
  const touched = text.trim() !== '';

  async function copyTemplate() {
    try {
      await navigator.clipboard.writeText(MENU_CSV_TEMPLATE);
      onToast?.('已複製範本，貼到試算表或編輯器改');
    } catch {
      // 瀏覽器不給複製時退而求其次：直接填進輸入框，使用者照著改
      setText(MENU_CSV_TEMPLATE);
      onToast?.('瀏覽器不允許複製，已直接填入範本');
    }
  }

  return (
    <Card sx={{ p: 2, borderStyle: 'dashed' }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="overline" color="text.secondary">
            {title}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="p">
            每行一樣：<b>品名,價格,分類,排序,價格待確認</b>。
            價格留空＝待確認，分類留空＝主餐；從試算表直接複製貼上也可以。
          </Typography>
        </Box>

        <Stack direction="row" spacing={1}>
          <Button size="small" startIcon={<ContentCopyIcon />} onClick={copyTemplate} sx={{ minHeight: 36 }}>
            複製範本
          </Button>
          <Button
            size="small"
            startIcon={<DownloadIcon />}
            onClick={() => downloadMenuCsvTemplate()}
            sx={{ minHeight: 36 }}
          >
            下載範本
          </Button>
        </Stack>

        <TextField
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={MENU_CSV_TEMPLATE}
          multiline
          minRows={4}
          maxRows={12}
          slotProps={{ htmlInput: { spellCheck: false, 'aria-label': '菜單 CSV' } }}
        />

        {touched && (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
            <Chip
              label={`可匯入 ${items.length} 樣`}
              size="small"
              color={items.length > 0 ? 'success' : 'default'}
            />
            {errors.length > 0 && <Chip label={`${errors.length} 行有問題`} size="small" color="error" />}
            {items.length > 0 && (
              <Typography variant="caption" color="text.disabled" noWrap sx={{ minWidth: 0 }}>
                {items
                  .slice(0, 3)
                  .map((i) => i.name)
                  .join('、')}
                {items.length > 3 && ` … 等 ${items.length} 樣`}
              </Typography>
            )}
          </Stack>
        )}

        {errors.length > 0 && (
          <Alert severity="warning">
            <AlertTitle sx={{ fontSize: 14 }}>這幾行會被略過</AlertTitle>
            <Stack spacing={0.25}>
              {errors.slice(0, 5).map((err) => (
                <Typography key={err.line} variant="caption" component="p">
                  第 {err.line} 行：{err.message}
                </Typography>
              ))}
              {errors.length > 5 && (
                <Typography variant="caption" component="p">
                  …另外還有 {errors.length - 5} 行
                </Typography>
              )}
            </Stack>
          </Alert>
        )}

        {onImport && (
          <>
            <Divider />
            <Button
              variant="contained"
              disabled={busy || items.length === 0}
              onClick={() => onImport(items).then(() => setText(''))}
            >
              {busy ? '匯入中…' : `匯入 ${items.length} 樣`}
            </Button>
          </>
        )}
      </Stack>
    </Card>
  );
}
