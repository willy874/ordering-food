import { createTheme } from '@mui/material/styles';

/** 版面最大寬度。手機優先，桌機上就是畫面中間一條。 */
export const MAX_WIDTH = 500;

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1e293b', light: '#334155', dark: '#0f172a' },
    secondary: { main: '#ea580c' },
    background: { default: '#f1f5f9', paper: '#ffffff' },
    text: { primary: '#0f172a', secondary: '#64748b' },
  },

  shape: { borderRadius: 12 },

  typography: {
    fontFamily:
      'system-ui, -apple-system, "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif',
    h6: { fontSize: '1rem', fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },

  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: {
          // 手機上避免點擊灰底閃爍與雙擊縮放
          WebkitTapHighlightColor: 'transparent',
          touchAction: 'manipulation',
        },
        // 金額欄位對齊用
        '.tnum': { fontVariantNumeric: 'tabular-nums' },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      // 44px 是拇指可靠點擊的下限
      styleOverrides: { root: { minHeight: 44 } },
    },
    MuiTextField: { defaultProps: { fullWidth: true, size: 'medium' } },
    MuiCard: { defaultProps: { variant: 'outlined' }, styleOverrides: { root: { borderRadius: 16 } } },
    MuiChip: { styleOverrides: { root: { fontWeight: 500 } } },
    MuiIconButton: { styleOverrides: { root: { minWidth: 44, minHeight: 44 } } },
    MuiListItemButton: { styleOverrides: { root: { minHeight: 44 } } },
    MuiAlert: { styleOverrides: { root: { borderRadius: 12 } } },
  },
});

export default theme;
