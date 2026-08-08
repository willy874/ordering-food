import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Divider,
  List,
  ListItem,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { Chip } from '@mui/material';
import { api } from '../lib/api.js';
import { Empty, ItemTags, money } from './ui.jsx';
import { STATUS_ORDER, statusColor, statusLabel } from '../lib/orderStatus.js';

/** 產生可直接貼給店家或群組的純文字 */
function buildText(group, summary) {
  const lines = [
    `【${group.title}】${group.store.name}`,
    '',
    ...summary.byItem.map(
      (item) => `${item.name} ×${item.qty}　${item.priceUncertain ? '約 ' : ''}${money(item.subtotal)}`,
    ),
    '',
    `合計 ${summary.itemCount} 樣，${summary.hasUncertainPrice ? '約 ' : ''}${money(summary.grandTotal)}`,
  ];
  if (summary.hasUncertainPrice) {
    lines.push(`（其中 ${money(summary.uncertainSubtotal)} 為估價，請以店家實際金額為準）`);
  }
  return lines.join('\n');
}

function buildSplitText(group, summary) {
  return [
    `【${group.title}】分帳`,
    '',
    ...summary.byPerson.map(
      (p) => `${p.personName}　${p.priceUncertain ? '約 ' : ''}${money(p.total)}`,
    ),
    '',
    `總計 ${money(summary.grandTotal)}（${summary.peopleCount} 人）`,
  ].join('\n');
}

export default function Summary({ group, summary, joinCode, adminToken, onChanged }) {
  const [toast, setToast] = useState('');
  const [bulking, setBulking] = useState(false);

  if (!summary.peopleCount && !summary.cancelledCount) {
    return <Empty>還沒有人點餐，結帳明細會在這裡出現</Empty>;
  }

  async function bulk(from, to) {
    setBulking(true);
    try {
      const result = await api.bulkSetStatus(joinCode, { from, to }, adminToken);
      setToast(result.message);
      await onChanged();
    } catch (err) {
      setToast(err.message);
    } finally {
      setBulking(false);
    }
  }

  const counts = summary.statusCounts ?? {};
  const pendingCount = counts.pending ?? 0;
  const orderedCount = counts.ordered ?? 0;
  const cancelRequestedCount = counts.cancel_requested ?? 0;

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      setToast(`已複製${label}`);
    } catch {
      setToast('瀏覽器不允許複製，請手動選取');
    }
  }

  return (
    <Stack spacing={3} sx={{ px: 2, py: 2.5 }}>
      <Card>
        <Box sx={{ px: 2, py: 1.25 }}>
          <Typography variant="subtitle2">進度</Typography>
          <Typography variant="caption" color="text.secondary">
            {summary.allServed ? '全部都到餐了' : '還沒全部到餐'}
          </Typography>
        </Box>
        <Divider />
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ px: 2, py: 1.5 }}>
          {STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => (
            <Chip
              key={s}
              label={`${statusLabel(s)} ${counts[s]}`}
              color={statusColor(s)}
              size="small"
              variant={s === 'cancelled' ? 'outlined' : 'filled'}
            />
          ))}
        </Stack>

        {adminToken && (
          <>
            <Divider />
            <Stack spacing={1} sx={{ px: 2, py: 1.5 }}>
              <Typography variant="caption" color="text.secondary">
                批次操作（只有發起的人看得到）
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Button
                  size="small"
                  variant="contained"
                  disabled={bulking || pendingCount === 0}
                  onClick={() => bulk('pending', 'ordered')}
                >
                  全部標為已點單{pendingCount > 0 && `（${pendingCount}）`}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="success"
                  disabled={bulking || orderedCount === 0}
                  onClick={() => bulk('ordered', 'served')}
                >
                  全部標為已到餐{orderedCount > 0 && `（${orderedCount}）`}
                </Button>
                {cancelRequestedCount > 0 && (
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    disabled={bulking}
                    onClick={() => bulk('cancel_requested', 'cancelled')}
                  >
                    確認撤單（{cancelRequestedCount}）
                  </Button>
                )}
              </Stack>
            </Stack>
          </>
        )}
      </Card>

      <Card>
        <Box sx={{ px: 2, py: 1.25 }}>
          <Typography variant="subtitle2">給店家的訂單</Typography>
          <Typography variant="caption" color="text.secondary">
            合併所有人的相同品項
          </Typography>
        </Box>
        <Divider />
        <List disablePadding>
          {summary.byItem.map((item) => (
            <ListItem key={`${item.name}-${item.unitPrice}-${item.priceUncertain}`} divider sx={{ px: 2, py: 1 }}>
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                {item.name}
                <ItemTags isCustom={item.isCustom} priceUncertain={item.priceUncertain} />
              </Typography>
              <Typography variant="body2" color="text.disabled" className="tnum" sx={{ mx: 1 }}>
                {money(item.unitPrice)}
              </Typography>
              <Typography variant="body2" fontWeight={600} className="tnum" sx={{ width: 36, textAlign: 'right' }}>
                ×{item.qty}
              </Typography>
              <Typography variant="body2" color="text.secondary" className="tnum" sx={{ width: 64, textAlign: 'right' }}>
                {money(item.subtotal)}
              </Typography>
            </ListItem>
          ))}
        </List>
        <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1.5, bgcolor: 'background.default' }}>
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            共 {summary.itemCount} 樣
          </Typography>
          <Typography variant="h6" className="tnum">
            {summary.hasUncertainPrice ? `≈ ${money(summary.grandTotal)}` : money(summary.grandTotal)}
          </Typography>
        </Stack>
      </Card>

      {summary.hasUncertainPrice && (
        <Alert severity="warning">
          總額為估算：其中 {money(summary.uncertainSubtotal)} 的品項價格尚未確認，請以店家實際金額為準。
        </Alert>
      )}

      <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={() => copy(buildText(group, summary), '訂單')}>
        複製訂單文字
      </Button>

      <Card>
        <Box sx={{ px: 2, py: 1.25 }}>
          <Typography variant="subtitle2">每個人要付多少</Typography>
          <Typography variant="caption" color="text.secondary">
            共 {summary.peopleCount} 人
          </Typography>
        </Box>
        <Divider />
        <List disablePadding>
          {summary.byPerson.map((person) => (
            <ListItem key={person.orderId} divider sx={{ px: 2, py: 1, opacity: person.counted ? 1 : 0.5 }}>
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                {person.personName}
              </Typography>
              <Chip
                label={statusLabel(person.status)}
                color={statusColor(person.status)}
                size="small"
                sx={{ height: 20, fontSize: 11, mr: 1 }}
              />
              <Typography
                variant="body2"
                fontWeight={600}
                className="tnum"
                sx={{ width: 80, textAlign: 'right', textDecoration: person.counted ? 'none' : 'line-through' }}
              >
                {person.priceUncertain ? `≈ ${money(person.total)}` : money(person.total)}
              </Typography>
            </ListItem>
          ))}
        </List>
      </Card>

      <Button
        variant="outlined"
        startIcon={<ContentCopyIcon />}
        onClick={() => copy(buildSplitText(group, summary), '分帳明細')}
      >
        複製分帳明細
      </Button>

      {summary.cancelledCount > 0 && (
        <Alert severity="info">
          有 {summary.cancelledCount} 筆已撤單（{money(summary.cancelledTotal)}），不列入上方金額。
        </Alert>
      )}

      {summary.byItem.some((item) => item.isCustom) && (
        <Alert severity="info">標示「自填」的品項是點餐的人自己加的，不在店家菜單上。</Alert>
      )}

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={3000}
        onClose={() => setToast('')}
        message={toast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Stack>
  );
}
