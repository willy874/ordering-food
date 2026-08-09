import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { MAX_PRICE } from './ui.jsx';
import ShareSelect from './ShareSelect.jsx';

/**
 * 修改單一品項：品名、價格、數量、備註、分單。
 *
 * 加點清單（還沒送出）與已送出的品項共用這一個對話框——兩邊要改的東西完全一樣，
 * 分成兩份實作只會讓其中一份先長歪。差別只在存檔方式，由呼叫端的 onSave 決定。
 *
 * 最常見的用途是結帳時把「待確認」的價格補成實際金額。
 *
 * lockBasics：已經跟店家點過的品項，本人只鎖品名與數量，價格、備註與分單照舊可改。
 * 整個對話框關掉會讓「價格待確認」再也補不回來，那才是最常見的需求。
 */
export default function ItemEditDialog({
  item,
  people = [],
  ownerName,
  title = '修改品項',
  lockBasics = false,
  onClose,
  onSave,
}) {
  return (
    <Dialog open={Boolean(item)} onClose={onClose} fullWidth maxWidth="xs">
      {/* key 讓每次打開都從該列目前的值重新開始 */}
      {item && (
        <ItemEditForm
          key={item.uid ?? item.id}
          item={item}
          people={people}
          ownerName={ownerName}
          title={title}
          lockBasics={lockBasics}
          onClose={onClose}
          onSave={onSave}
        />
      )}
    </Dialog>
  );
}

function ItemEditForm({ item, people, ownerName, title, lockBasics, onClose, onSave }) {
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState(
    item.priceUncertain && item.unitPrice === 0 ? '' : String(item.unitPrice),
  );
  const [qty, setQty] = useState(String(item.qty));
  const [note, setNote] = useState(item.note ?? '');
  const [uncertain, setUncertain] = useState(item.priceUncertain === true);
  const [share, setShare] = useState({
    shareScope: item.shareScope ?? 'owner',
    sharedWith: item.sharedWith ?? [],
  });
  const [error, setError] = useState('');

  const noPrice = price.trim() === '';
  const fromMenu = item.menuItemId != null;

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return setError('請填寫品名');

    const value = noPrice ? 0 : Number(price);
    if (!noPrice && (!Number.isInteger(value) || value < 0 || value > MAX_PRICE)) {
      return setError(`價格需為 0 ~ ${MAX_PRICE} 的整數`);
    }

    const count = Number(qty);
    if (!Number.isInteger(count) || count < 1 || count > 99) {
      return setError('數量需為 1 ~ 99');
    }

    onSave({
      name: trimmed,
      unitPrice: value,
      priceUncertain: noPrice || uncertain,
      qty: count,
      note: note.trim() || null,
      ...share,
    });
  }

  return (
    <>
      <DialogTitle sx={{ pb: 1 }}>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {lockBasics && (
            <Alert severity="info" sx={{ py: 0.25 }}>
              這一樣已經跟店家點了，品名與數量不能再改。要多點就另外加一筆，不要了就用撤單。
            </Alert>
          )}

          <TextField
            label="品名"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={lockBasics}
            slotProps={{ htmlInput: { maxLength: 50 } }}
          />

          <Stack direction="row" spacing={1.5}>
            <TextField
              label={noPrice ? '價格（可以留空）' : uncertain ? '大概多少錢' : '價格'}
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))}
              helperText={noPrice ? '還不知道就留空，結帳時再補' : undefined}
              sx={{ flex: 2 }}
              slotProps={{ htmlInput: { inputMode: 'numeric', className: 'tnum' } }}
            />
            <TextField
              label="數量"
              value={qty}
              onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))}
              disabled={lockBasics}
              sx={{ flex: 1 }}
              slotProps={{ htmlInput: { inputMode: 'numeric', className: 'tnum', maxLength: 2 } }}
            />
          </Stack>

          {!noPrice && (
            <FormControlLabel
              control={
                <Checkbox checked={uncertain} onChange={(e) => setUncertain(e.target.checked)} />
              }
              label={<Typography variant="body2">我不確定價格，這只是估的</Typography>}
            />
          )}

          <TextField
            label="這一樣的備註"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例如 不要香菜、去冰"
            helperText="只跟著這一樣，會出現在給店家的清單上"
            slotProps={{ htmlInput: { maxLength: 100 } }}
          />

          <Divider />
          <ShareSelect value={share} onChange={setShare} people={people} ownerName={ownerName} />

          {fromMenu && !lockBasics && (
            <Alert severity="info" sx={{ py: 0.25 }}>
              改了品名或價格之後會變成自填品項，店家菜單不受影響；只改數量、備註或分單則不會。
            </Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={submit}>
          確定
        </Button>
      </DialogActions>
    </>
  );
}
