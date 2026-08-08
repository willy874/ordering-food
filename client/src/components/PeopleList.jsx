import { Card, Chip, Divider, List, ListItem, Stack, Typography } from '@mui/material';
import { Empty, ItemTags, money } from './ui.jsx';
import { statusColor, statusLabel } from '../lib/orderStatus.js';

export default function PeopleList({ orders, myOrderId }) {
  if (!orders.length) return <Empty>還沒有人點餐</Empty>;

  return (
    <Stack spacing={1.5} sx={{ px: 2, py: 2.5 }}>
      {orders.map((order) => {
        const uncertain = order.items.some((i) => i.priceUncertain);
        const cancelled = order.status === 'cancelled';
        return (
          <Card key={order.id} sx={{ opacity: cancelled ? 0.55 : 1 }}>
            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ px: 2, py: 1.25 }}>
              <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                {order.personName}
              </Typography>
              {order.id === myOrderId && <Chip label="我" size="small" color="primary" sx={{ height: 20, fontSize: 11 }} />}
              <Chip
                label={statusLabel(order.status)}
                color={statusColor(order.status)}
                size="small"
                sx={{ height: 20, fontSize: 11 }}
              />
              <Typography
                variant="subtitle2"
                className="tnum"
                sx={{ textDecoration: cancelled ? 'line-through' : 'none' }}
              >
                {uncertain ? `≈ ${money(order.total)}` : money(order.total)}
              </Typography>
            </Stack>
            <Divider />
            <List disablePadding>
              {order.items.map((item) => (
                <ListItem key={item.id} divider sx={{ px: 2, py: 0.75 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 0 }} noWrap>
                    {item.name}
                    <ItemTags isCustom={item.isCustom} priceUncertain={item.priceUncertain} />
                  </Typography>
                  <Typography variant="body2" color="text.disabled" className="tnum" sx={{ mx: 1 }}>
                    ×{item.qty}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" className="tnum" sx={{ width: 60, textAlign: 'right' }}>
                    {money(item.subtotal)}
                  </Typography>
                </ListItem>
              ))}
            </List>
            {order.note && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, py: 1 }}>
                備註：{order.note}
              </Typography>
            )}
          </Card>
        );
      })}
    </Stack>
  );
}
