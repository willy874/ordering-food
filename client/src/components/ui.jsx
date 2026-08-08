import { Link as RouterLink } from 'react-router-dom';
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

/** 品項標記：自填 / 價格待確認 */
export function ItemTags({ isCustom, priceUncertain }) {
  if (!isCustom && !priceUncertain) return null;
  return (
    <Stack direction="row" spacing={0.5} component="span" sx={{ ml: 0.75, display: 'inline-flex' }}>
      {isCustom && <Chip label="自填" size="small" color="warning" variant="outlined" sx={{ height: 20, fontSize: 11 }} />}
      {priceUncertain && (
        <Chip label="價格待確認" size="small" color="info" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
      )}
    </Stack>
  );
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
