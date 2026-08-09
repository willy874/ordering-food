import { useState } from 'react';
import { Chip, ListItemText, Menu, MenuItem, Typography } from '@mui/material';
import { api } from '../lib/api.js';
import { ORDER_STATUS, nextStatuses, statusColor, statusLabel } from '../lib/orderStatus.js';

/**
 * 單一品項的狀態。點一下展開可以改成哪些狀態。
 *
 * 不需要任何憑證——現場誰看到餐送來誰就能按，點的人可能正在廁所。
 * 只顯示合法的下一步，避免按到會被後端擋掉的選項。
 */
export default function ItemStatusChip({ item, onChanged, onError }) {
  const [anchor, setAnchor] = useState(null);
  const [saving, setSaving] = useState(false);

  const options = nextStatuses(item.status);

  async function change(status) {
    setAnchor(null);
    setSaving(true);
    try {
      await api.setItemStatus(item.id, status);
      await onChanged();
    } catch (err) {
      onError?.(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Chip
        label={statusLabel(item.status)}
        color={statusColor(item.status)}
        size="small"
        variant={item.status === 'cancelled' ? 'outlined' : 'filled'}
        onClick={options.length > 0 ? (e) => setAnchor(e.currentTarget) : undefined}
        disabled={saving}
        aria-label={`${item.name} 目前${statusLabel(item.status)}，點擊修改`}
        sx={{ height: 22, fontSize: 11 }}
      />
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {options.map((status) => (
          <MenuItem key={status} onClick={() => change(status)}>
            <ListItemText
              primary={ORDER_STATUS[status]?.action ?? statusLabel(status)}
              secondary={ORDER_STATUS[status]?.hint}
              slotProps={{ primary: { variant: 'body2' }, secondary: { variant: 'caption' } }}
            />
          </MenuItem>
        ))}
      </Menu>
      {saving && (
        <Typography variant="caption" color="text.disabled" sx={{ ml: 0.5 }}>
          …
        </Typography>
      )}
    </>
  );
}
