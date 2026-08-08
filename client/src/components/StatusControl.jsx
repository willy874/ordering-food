import { useState } from 'react';
import { Alert, Button, Card, Chip, Stack, Typography } from '@mui/material';
import { api } from '../lib/api.js';
import { storage } from '../lib/storage.js';
import { ORDER_STATUS, nextStatuses, statusColor, statusLabel } from '../lib/orderStatus.js';

/**
 * 單筆訂單的狀態切換。
 * 只顯示合法的下一步，避免使用者按到會被後端擋掉的按鈕。
 */
export default function StatusControl({ joinCode, order, editToken, onChanged }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const options = nextStatuses(order.status);

  async function change(status) {
    setSaving(true);
    setError('');
    try {
      await api.setOrderStatus(order.id, status, {
        editToken,
        adminToken: storage.getAdminToken(joinCode),
      });
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            目前狀態
          </Typography>
          <Chip label={statusLabel(order.status)} color={statusColor(order.status)} size="small" />
        </Stack>

        <Typography variant="caption" color="text.secondary">
          {ORDER_STATUS[order.status]?.hint}
        </Typography>

        {options.length > 0 && (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {options.map((status) => (
              <Button
                key={status}
                size="small"
                variant={status === 'cancelled' || status === 'cancel_requested' ? 'outlined' : 'contained'}
                color={statusColor(status) === 'default' ? 'inherit' : statusColor(status)}
                onClick={() => change(status)}
                disabled={saving}
              >
                {ORDER_STATUS[status]?.action ?? statusLabel(status)}
              </Button>
            ))}
          </Stack>
        )}

        {error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </Card>
  );
}
