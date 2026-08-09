import { Link as RouterLink } from '@tanstack/react-router';
import {
  AppBar,
  Autocomplete,
  Box,
  Chip,
  IconButton,
  Paper,
  Stack,
  TextField,
  Toolbar,
  Typography,
} from '@mui/material';
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew';
import { MAX_WIDTH } from '../theme.js';

export const money = (n) => `$${Number(n).toLocaleString('zh-TW')}`;

/** 單一品項的價格上限，需與 server/lib/validate.js 的 money schema 一致 */
export const MAX_PRICE = 200000;

/**
 * 金額顯示。
 * 自填品項可能只點了東西、還沒有價格（0 元且標為不確定），
 * 這種情況顯示「待確認」比 ≈$0 誠實，結帳時再補。
 */
export const priceText = (n, priceUncertain) => {
  if (priceUncertain && Number(n) === 0) return '待確認';
  return priceUncertain ? `≈${money(n)}` : money(n);
};

/** 純文字版本，給複製出去的清單用 */
export const priceTextPlain = (n, priceUncertain) => {
  if (priceUncertain && Number(n) === 0) return '待確認';
  return priceUncertain ? `約 ${money(n)}` : money(n);
};

/**
 * 版面骨架：最大 500px 置中、單欄、不做響應式斷點。
 * 使用 100dvh 而非 100vh，避免手機瀏覽器網址列造成高度跳動。
 */
export function Layout({ children, header, footer }) {
  return (
    <Box
      sx={{
        maxWidth: MAX_WIDTH,
        mx: 'auto',
        minHeight: '100dvh',
        bgcolor: 'background.paper',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {header}
      <Box component="main" sx={{ flex: 1 }}>
        {children}
      </Box>
      {footer}
    </Box>
  );
}

export function Header({ title, subtitle, back, right, children }) {
  return (
    <AppBar
      position="sticky"
      color="inherit"
      elevation={0}
      sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)' }}
    >
      <Toolbar sx={{ gap: 1, px: 2 }}>
        {back && (
          <IconButton component={RouterLink} to={back} edge="start" aria-label="返回" sx={{ color: 'text.secondary' }}>
            <ArrowBackIosNewIcon fontSize="small" />
          </IconButton>
        )}
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="h6" noWrap>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="caption" color="text.secondary" noWrap component="p">
              {subtitle}
            </Typography>
          )}
        </Box>
        {right}
      </Toolbar>
      {children}
    </AppBar>
  );
}

/** 固定於底部的主要操作區，拇指可及 */
export function BottomBar({ children }) {
  return (
    <Paper
      elevation={0}
      square
      sx={{
        position: 'sticky',
        bottom: 0,
        zIndex: 10,
        borderTop: 1,
        borderColor: 'divider',
        px: 2,
        pt: 1.5,
        pb: 'max(12px, env(safe-area-inset-bottom))',
        bgcolor: 'rgba(255,255,255,0.95)',
        backdropFilter: 'blur(8px)',
      }}
    >
      {children}
    </Paper>
  );
}

/** 品項標記：自填 / 價格待確認 / 分單 */
export function ItemTags({ isCustom, priceUncertain, shareLabel }) {
  if (!isCustom && !priceUncertain && !shareLabel) return null;
  return (
    <Stack direction="row" spacing={0.5} component="span" sx={{ ml: 0.75, display: 'inline-flex' }}>
      {isCustom && <Chip label="自填" size="small" color="warning" variant="outlined" sx={{ height: 20, fontSize: 11 }} />}
      {priceUncertain && (
        <Chip label="價格待確認" size="small" color="info" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
      )}
      {shareLabel && (
        <Chip label={shareLabel} size="small" color="secondary" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
      )}
    </Stack>
  );
}

/**
 * 這一樣分給誰的簡短說明，給清單上的標籤用。
 * 沒有分單（只有自己付）時回傳 null，讓標籤整個不出現——
 * 大部分的品項都是各點各的，每一列都掛一個「我自己」只是雜訊。
 */
export function shareLabelOf(item) {
  if (item.shareScope === 'all') return '全部平分';
  const count = item.shareScope === 'custom' ? (item.sharedWith?.length ?? 0) : 0;
  return count > 0 ? `分 ${count + 1} 人` : null;
}

/**
 * 名字輸入框，帶本機記過的名字做建議。
 * freeSolo 讓使用者仍可自由輸入沒出現過的名字。
 */
export function NameInput({ value, onChange, names = [], label, helperText, ...props }) {
  return (
    <Autocomplete
      freeSolo
      options={names}
      value={value}
      onChange={(_, next) => onChange(next ?? '')}
      onInputChange={(_, next) => onChange(next ?? '')}
      renderInput={(params) => (
        <TextField {...params} label={label} helperText={helperText} slotProps={{ htmlInput: { ...params.inputProps, ...props } }} />
      )}
    />
  );
}

export function Empty({ children }) {
  return (
    <Typography color="text.disabled" variant="body2" align="center" sx={{ px: 2, py: 6 }}>
      {children}
    </Typography>
  );
}
