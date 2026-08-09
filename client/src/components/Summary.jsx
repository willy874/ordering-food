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
import { Empty, ItemTags, money, priceText, priceTextPlain } from './ui.jsx';
import { statusColor, statusLabel } from '../lib/orderStatus.js';

/**
 * 還沒有價格的品項（自填時留空）。
 * 這些以 0 元計入，所以不會反映在 uncertainSubtotal 上，
 * 必須另外點出來，否則總額看起來像是已經確定的。
 */
const pendingPriceItems = (summary) =>
  summary.byItem.filter((item) => item.priceUncertain && item.unitPrice === 0);

const pendingPriceLine = (summary) => {
  const pending = pendingPriceItems(summary);
  if (!pending.length) return null;
  return `尚未有價格（未計入總額）：${pending.map((i) => `${i.name} ×${i.qty}`).join('、')}`;
};

/** 給店家的那一行：品名、備註、數量 */
const itemLine = (item) => `${item.name}${item.note ? `（${item.note}）` : ''} ×${item.qty}`;

/**
 * 合併後的品項沒有 id，得用內容當 key。
 * 必須包含備註——後端就是照「品名＋價格＋備註」合併的（見 lib/serialize.js），
 * key 少一個欄位就會出現兩列同 key。
 */
const itemKey = (item) =>
  `${item.name}|${item.unitPrice}|${item.priceUncertain}|${item.isCustom}|${item.note ?? ''}`;

/** 產生可直接貼給店家或群組的純文字 */
function buildText(group, summary) {
  const lines = [
    `【${group.title}】${group.store.name}`,
    '',
    ...summary.byItem.map(
      (item) => `${itemLine(item)}　${priceTextPlain(item.subtotal, item.priceUncertain)}`,
    ),
    '',
    `合計 ${summary.itemCount} 樣，${summary.hasUncertainPrice ? '約 ' : ''}${money(summary.grandTotal)}`,
  ];
  if (summary.hasUncertainPrice) {
    lines.push(`（其中 ${money(summary.uncertainSubtotal)} 為估價，請以店家實際金額為準）`);
  }
  const pending = pendingPriceLine(summary);
  if (pending) lines.push(`（${pending}）`);
  return lines.join('\n');
}

/** 只有這一輪要加點的，唸給店家聽 */
function buildRoundText(group, pendingByItem) {
  return [
    `【${group.title}】${group.store.name} — 加點`,
    '',
    ...pendingByItem.map(itemLine),
  ].join('\n');
}

/**
 * 分單一覽的純文字版。
 * 收錢的人通常是把這段貼進群組，所以先寫每個人付多少（大家只看自己那行），
 * 分單的明細放後面備查——有人覺得金額不對時，答案在那裡。
 */
function buildSplitOverviewText(group, summary) {
  const split = summary.split;
  const lines = [`【${group.title}】分單一覽`, ''];

  for (const person of split.people) {
    if (!person.counted) continue;
    const parts = [];
    if (person.ownPayable > 0) parts.push(`自己 ${money(person.ownPayable)}`);
    if (person.sharedIn > 0) parts.push(`分擔 ${money(person.sharedIn)}`);
    lines.push(
      `${person.personName}　${person.priceUncertain ? '約 ' : ''}${money(person.payable)}${
        parts.length > 1 ? `（${parts.join(' + ')}）` : ''
      }`,
    );
  }

  lines.push('', `總計 ${money(summary.grandTotal)}（${summary.peopleCount} 人）`);

  if (split.items.length) {
    lines.push('', '分單明細');
    for (const item of split.items) {
      lines.push(
        `${item.name} ×${item.qty}　${priceTextPlain(item.subtotal, item.priceUncertain)}${
          item.counted ? '' : '（已撤單）'
        }`,
        `　${item.payers.map((p) => `${p.personName} ${money(p.amount)}`).join('、')}`,
      );
    }
  }

  return lines.join('\n');
}

/**
 * 給 AI 記帳用的完整明細。
 * 用 Tab 分隔的表格，欄位固定，AI 或試算表都好解析；
 * 未確認的價格如實寫「待確認」，不要用 0 假裝已知。
 */
function buildLedgerText(group, summary, orders) {
  const lines = [
    `【${group.title}】${group.store.name}`,
    `日期：${new Date(group.createdAt).toLocaleDateString('zh-TW')}`,
    `人數：${summary.peopleCount}　總計：${money(summary.grandTotal)}${
      summary.hasUncertainPrice ? `（其中 ${money(summary.uncertainSubtotal)} 為估價）` : ''
    }`,
  ];

  const pending = pendingPriceLine(summary);
  if (pending) lines.push(pending);

  lines.push('', ['姓名', '品項', '備註', '數量', '單價', '小計', '狀態', '分給誰'].join('\t'));

  for (const order of orders) {
    for (const item of order.items) {
      lines.push(
        [
          order.personName,
          item.name,
          item.note ?? '',
          item.qty,
          priceTextPlain(item.unitPrice, item.priceUncertain),
          priceTextPlain(item.subtotal, item.priceUncertain),
          // 狀態屬於品項：同一個人的東西可能一樣到餐、一樣還沒點
          statusLabel(item.status),
          // 分單的品項小計不等於點的人要付的錢，這一欄是唯一的線索
          item.shared ? item.payers.map((p) => `${p.personName} ${p.amount}`).join('、') : '',
        ].join('\t'),
      );
    }
  }

  lines.push('', '每人應付（已含分單）');
  for (const person of summary.byPerson) {
    lines.push(
      `${person.personName}\t${
        person.counted ? priceTextPlain(person.payable, person.priceUncertain) : '不計'
      }`,
    );
  }

  const notes = orders.filter((order) => order.note);
  if (notes.length) {
    lines.push('', '備註', ...notes.map((order) => `${order.personName}：${order.note}`));
  }

  return lines.join('\n');
}

function buildSplitText(group, summary) {
  return [
    `【${group.title}】分帳`,
    '',
    ...summary.byPerson
      .filter((p) => p.counted)
      .map((p) => `${p.personName}　${p.priceUncertain ? '約 ' : ''}${money(p.payable)}`),
    '',
    `總計 ${money(summary.grandTotal)}（${summary.peopleCount} 人）`,
  ].join('\n');
}

/**
 * 結帳。
 *
 * 只管金額——進度與批次操作搬到「清單」了：要看還有誰沒點到，
 * 看的當下就是在看那份名單，隔一個 tab 只是讓人來回切。
 */
export default function Summary({ group, summary, orders = [] }) {
  const [toast, setToast] = useState('');

  if (!summary.peopleCount && !summary.cancelledCount) {
    return <Empty>還沒有人點餐，結帳明細會在這裡出現</Empty>;
  }

  const pending = pendingPriceItems(summary);
  const pendingByItem = summary.pendingByItem ?? [];
  const split = summary.split ?? { people: [], items: [], hasShared: false };

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
      {pendingByItem.length > 0 && (
        <Card sx={{ borderColor: 'primary.main', borderWidth: 1, borderStyle: 'solid' }}>
          <Box sx={{ px: 2, py: 1.25 }}>
            <Typography variant="subtitle2">還沒跟店家點的</Typography>
            <Typography variant="caption" color="text.secondary">
              這一輪要加點的東西，唸這份就好
            </Typography>
          </Box>
          <Divider />
          <List disablePadding>
            {pendingByItem.map((item) => (
              <ListItem key={itemKey(item)} divider sx={{ px: 2, py: 1 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {item.name}
                    <ItemTags isCustom={item.isCustom} priceUncertain={item.priceUncertain} />
                  </Typography>
                  {item.note && (
                    <Typography variant="caption" color="text.secondary" noWrap component="p">
                      {item.note}
                    </Typography>
                  )}
                </Box>
                <Typography variant="body2" fontWeight={600} className="tnum">
                  ×{item.qty}
                </Typography>
              </ListItem>
            ))}
          </List>
          <Box sx={{ px: 2, py: 1.25 }}>
            <Button
              size="small"
              startIcon={<ContentCopyIcon />}
              onClick={() => copy(buildRoundText(group, pendingByItem), '這一輪的清單')}
            >
              複製這一輪
            </Button>
          </Box>
        </Card>
      )}

      <Card>
        <Box sx={{ px: 2, py: 1.25 }}>
          <Typography variant="subtitle2">給店家的訂單</Typography>
          <Typography variant="caption" color="text.secondary">
            合併所有人的相同品項（不分進度）
          </Typography>
        </Box>
        <Divider />
        <List disablePadding>
          {summary.byItem.map((item) => (
            <ListItem key={itemKey(item)} divider sx={{ px: 2, py: 1 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {item.name}
                  <ItemTags isCustom={item.isCustom} priceUncertain={item.priceUncertain} />
                </Typography>
                {item.note && (
                  <Typography variant="caption" color="text.secondary" noWrap component="p">
                    {item.note}
                  </Typography>
                )}
              </Box>
              <Typography variant="body2" color="text.disabled" className="tnum" sx={{ mx: 1 }}>
                {priceText(item.unitPrice, item.priceUncertain)}
              </Typography>
              <Typography variant="body2" fontWeight={600} className="tnum" sx={{ width: 36, textAlign: 'right' }}>
                ×{item.qty}
              </Typography>
              <Typography variant="body2" color="text.secondary" className="tnum" sx={{ width: 64, textAlign: 'right' }}>
                {priceText(item.subtotal, item.priceUncertain)}
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

      {pending.length > 0 && (
        <Alert severity="warning">
          有 {pending.reduce((sum, item) => sum + item.qty, 0)} 樣還沒有價格（
          {pending.map((item) => item.name).join('、')}），沒有計入上方總額，結帳時要補上。
        </Alert>
      )}

      <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={() => copy(buildText(group, summary), '訂單')}>
        複製訂單文字
      </Button>

      <Card>
        <Box sx={{ px: 2, py: 1.25 }}>
          <Typography variant="subtitle2">每個人要付多少</Typography>
          <Typography variant="caption" color="text.secondary">
            共 {summary.peopleCount} 人{split.hasShared && '・已含分單'}
          </Typography>
        </Box>
        <Divider />
        <List disablePadding>
          {summary.byPerson.map((person) => (
            <ListItem key={person.orderId} divider sx={{ px: 2, py: 1, opacity: person.counted ? 1 : 0.5 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {person.personName}
                </Typography>
                {/* 應付跟自己點的不一樣時要交代，否則看起來就是算錯了 */}
                {person.payable !== person.ownTotal && (
                  <Typography variant="caption" color="text.secondary" noWrap component="p">
                    {person.ownPayable > 0 && `自己 ${money(person.ownPayable)}`}
                    {person.ownPayable > 0 && person.sharedIn > 0 && ' ＋ '}
                    {person.sharedIn > 0 && `分擔 ${money(person.sharedIn)}`}
                  </Typography>
                )}
              </Box>
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
                {priceText(person.payable, person.priceUncertain)}
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

      {/* 快速分單一覽：只有真的有東西被分才顯示，
          各點各的那種團多一張全是 0 的表只是雜訊 */}
      {split.hasShared && (
        <Card sx={{ borderColor: 'secondary.main', borderWidth: 1, borderStyle: 'solid' }}>
          <Box sx={{ px: 2, py: 1.25 }}>
            <Typography variant="subtitle2">分單一覽</Typography>
            <Typography variant="caption" color="text.secondary">
              {split.items.length} 樣東西被分著付，這裡是誰分到多少
            </Typography>
          </Box>
          <Divider />
          <List disablePadding>
            {split.items.map((item) => (
              <ListItem key={item.itemId} divider sx={{ px: 2, py: 1, display: 'block' }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography
                    variant="body2"
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      textDecoration: item.counted ? 'none' : 'line-through',
                    }}
                    noWrap
                  >
                    {item.name}
                    <ItemTags priceUncertain={item.priceUncertain} />
                  </Typography>
                  <Typography variant="caption" color="text.disabled" className="tnum">
                    ×{item.qty}
                  </Typography>
                  <Typography variant="body2" className="tnum">
                    {priceText(item.subtotal, item.priceUncertain)}
                  </Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary" component="p">
                  {item.ownerName} 點的
                  {item.shareScope === 'all' ? '・全部平分' : `・分 ${item.payers.length} 人`}
                </Typography>
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                  {item.payers.map((payer) => (
                    <Chip
                      key={payer.orderId}
                      label={`${payer.personName} ${money(payer.amount)}`}
                      size="small"
                      variant="outlined"
                      sx={{ height: 22, fontSize: 11 }}
                    />
                  ))}
                </Stack>
              </ListItem>
            ))}
          </List>

          <Stack spacing={0.75} sx={{ px: 2, py: 1.5, bgcolor: 'background.default' }}>
            {split.people
              .filter((person) => person.counted)
              .map((person) => (
                <Stack key={person.orderId} direction="row" alignItems="center" spacing={1}>
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                    {person.personName}
                  </Typography>
                  <Typography variant="caption" color="text.disabled" className="tnum">
                    自己 {money(person.ownPayable)} ＋ 分擔 {money(person.sharedIn)}
                  </Typography>
                  <Typography
                    variant="body2"
                    fontWeight={600}
                    className="tnum"
                    sx={{ width: 72, textAlign: 'right' }}
                  >
                    {priceText(person.payable, person.priceUncertain)}
                  </Typography>
                </Stack>
              ))}
          </Stack>

          <Divider />
          <Box sx={{ px: 2, py: 1.25 }}>
            <Button
              size="small"
              startIcon={<ContentCopyIcon />}
              onClick={() => copy(buildSplitOverviewText(group, summary), '分單一覽')}
            >
              複製分單一覽
            </Button>
          </Box>
        </Card>
      )}

      <Box>
        <Button
          variant="contained"
          fullWidth
          startIcon={<ContentCopyIcon />}
          disabled={orders.length === 0}
          onClick={() => copy(buildLedgerText(group, summary, orders), '完整清單')}
        >
          複製完整清單
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
          誰點了什麼、單價、小計、狀態、備註都在裡面，用 Tab 分欄，可直接丟給 AI 或試算表記帳。
        </Typography>
      </Box>

      {summary.cancelledCount > 0 && (
        <Alert severity="info">
          有 {summary.cancelledCount} 樣已撤單（{money(summary.cancelledTotal)}），不列入上方金額。
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
