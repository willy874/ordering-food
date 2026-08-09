import {
  Alert,
  Checkbox,
  Chip,
  FormControlLabel,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';

/**
 * 這一樣要分給誰。
 *
 *   我自己    只有點的人付（預設）
 *   全部平分  全團平分，人數在結帳當下才算——後面才登記的人也會被算進去
 *   指定的人  點的人 ＋ 勾選的人
 *
 * 只列得出已經登記暱稱的人：沒有登記就沒有身分，也就沒有地方掛他那份錢。
 * 「全部平分」刻意不展開成一串勾選，因為它的意思是「不管最後有誰」，
 * 展開成當下的名單反而會在有人晚到時算錯。
 */
export default function ShareSelect({ value, onChange, people, ownerName, dense = false }) {
  const scope = value?.shareScope ?? 'owner';
  const sharedWith = value?.sharedWith ?? [];

  // 發起人在改別人的品項時，「自己」指的是點的那個人，不是操作的人。
  // 這裡不寫清楚，代改的時候會以為勾選名單裡少了一個人。
  const owner = ownerName ?? '你自己';

  function setScope(next) {
    if (!next) return;
    onChange({
      shareScope: next,
      // 切走再切回來時保留先前勾的人，少一次重勾
      sharedWith: next === 'custom' ? sharedWith : [],
    });
  }

  function togglePerson(orderId) {
    const next = sharedWith.includes(orderId)
      ? sharedWith.filter((id) => id !== orderId)
      : [...sharedWith, orderId];
    onChange({ shareScope: 'custom', sharedWith: next });
  }

  return (
    <Stack spacing={1}>
      <Typography variant="caption" color="text.secondary">
        這一樣誰要付？
      </Typography>

      <ToggleButtonGroup
        exclusive
        fullWidth
        size="small"
        value={scope}
        onChange={(_, next) => setScope(next)}
      >
        <ToggleButton value="owner" sx={{ py: dense ? 0.5 : 0.75, fontSize: 13 }}>
          {ownerName ? `只有 ${ownerName}` : '我自己'}
        </ToggleButton>
        <ToggleButton value="all" sx={{ py: dense ? 0.5 : 0.75, fontSize: 13 }}>
          全部平分
        </ToggleButton>
        <ToggleButton value="custom" sx={{ py: dense ? 0.5 : 0.75, fontSize: 13 }}>
          指定的人
        </ToggleButton>
      </ToggleButtonGroup>

      {scope === 'all' && (
        <Typography variant="caption" color="text.secondary">
          全團平分，包含之後才登記進來的人。
        </Typography>
      )}

      {scope === 'custom' &&
        (people.length === 0 ? (
          <Alert severity="info" sx={{ py: 0.25 }}>
            這一團目前只有 {owner} 登記過。其他人登記暱稱之後就能選了。
          </Alert>
        ) : (
          <Stack>
            <Typography variant="caption" color="text.secondary">
              除了 {owner}，還有誰一起分：
            </Typography>
            <Stack direction="row" flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
              {people.map((person) => (
                <FormControlLabel
                  key={person.orderId}
                  sx={{ mr: 1.5 }}
                  control={
                    <Checkbox
                      size="small"
                      checked={sharedWith.includes(person.orderId)}
                      onChange={() => togglePerson(person.orderId)}
                    />
                  }
                  label={<Typography variant="body2">{person.personName}</Typography>}
                />
              ))}
            </Stack>
            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: 0.5 }}>
              <Chip
                label={`共 ${sharedWith.length + 1} 人分`}
                size="small"
                color={sharedWith.length > 0 ? 'secondary' : 'default'}
                sx={{ height: 20, fontSize: 11 }}
              />
              <Typography variant="caption" color="text.disabled">
                除不盡的零頭會自動分配，總額不會跑掉
              </Typography>
            </Stack>
          </Stack>
        ))}
    </Stack>
  );
}
