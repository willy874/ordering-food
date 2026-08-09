#!/usr/bin/env bash
#
# 部署到 Vercel，然後打幾支線上端點確認這一版真的活著。
#
#   npm run deploy           正式環境（ordering-food-mu.vercel.app）
#   npm run deploy:preview   預覽環境
#
# 兩件每次都會踩到、所以寫進腳本裡的事：
#
#   1. 專案在 take-6570 這個團隊底下，不在個人帳號。不帶 --scope 的話 Vercel
#      會回 "Not authorized"，看起來像沒登入，其實是找錯地方。
#   2. 這個 repo 沒有連 GitHub 自動部署，push 不會觸發任何東西——要部署就是
#      跑這支腳本。
#
# 可用環境變數覆寫：VERCEL_SCOPE、DEPLOY_VERIFY_URL
set -euo pipefail

TARGET="${1:-production}"
SCOPE="${VERCEL_SCOPE:-take-6570}"
PROD_URL="${DEPLOY_VERIFY_URL:-https://ordering-food-mu.vercel.app}"

cd "$(dirname "$0")/.."

# ── 部署的是本機這份檔案，不是 GitHub 上那份 ──────────────────
# Vercel CLI 上傳的是工作區的內容，所以「忘了 commit」不會讓部署失敗，
# 只會讓線上跑著一份沒人留下紀錄的程式。擋不是這裡的事，講出來就好。
if [ -n "$(git status --porcelain)" ]; then
  echo "⚠ 工作區有未提交的變更，這些變更會一起部署上去"
fi
if [ -n "$(git log --branches --not --remotes --oneline 2>/dev/null)" ]; then
  echo "⚠ 有已提交但還沒 push 的 commit"
fi

if [ "$TARGET" = "production" ]; then
  echo "▸ 部署到正式環境（scope: ${SCOPE}）"
  PROD_FLAG="--prod"
else
  echo "▸ 部署到預覽環境（scope: ${SCOPE}）"
  PROD_FLAG=""
fi

set +e
# shellcheck disable=SC2086
OUTPUT="$(npx --yes vercel deploy $PROD_FLAG --yes --scope "$SCOPE" 2>&1)"
STATUS=$?
set -e

echo "$OUTPUT"

if [ $STATUS -ne 0 ]; then
  echo
  echo "✗ 部署失敗"
  case "$OUTPUT" in
    *"Not authorized"*|*"not authenticated"*|*"credentials"*)
      echo "  憑證過期或不對，先跑：npx vercel login"
      echo "  若專案換了團隊，改 VERCEL_SCOPE 或這支腳本裡的 SCOPE"
      ;;
  esac
  exit $STATUS
fi

# 正式環境固定驗證那個對外的網址（別名一部署就切過去了）；
# 預覽環境則從 CLI 的輸出裡撿出這一次的網址。
if [ "$TARGET" = "production" ]; then
  BASE="$PROD_URL"
else
  HOST="$(printf '%s' "$OUTPUT" | grep -Eo '[a-z0-9-]+\.vercel\.app' | tail -1 || true)"
  BASE="${HOST:+https://$HOST}"
fi

if [ -z "$BASE" ]; then
  echo
  echo "⚠ 找不到這次部署的網址，跳過驗證"
  exit 0
fi

# 預覽部署開著 Deployment Protection 時，未帶憑證的請求會被導去 SSO，
# 每一項都會「失敗」但其實什麼問題都沒有。與其每次都紅一片，不如直說驗不了。
if [ "$TARGET" != "production" ]; then
  GUARD="$(curl -s --max-time 20 -o /dev/null -w '%{http_code}' "$BASE/api/health" || true)"
  case "$GUARD" in
    30*|401)
      echo
      echo "▸ $BASE"
      echo "  這個預覽部署有 Deployment Protection（HTTP ${GUARD}），未帶憑證驗證不了，請直接開瀏覽器看"
      exit 0
      ;;
  esac
fi

echo
echo "驗證 $BASE"
FAILED=0

check() { # check <說明> <條件結果 0/1> <實際值>
  if [ "$2" = "0" ]; then
    echo "  ✓ $1"
  else
    echo "  ✗ $1 — ${3:-無回應}"
    FAILED=1
  fi
}

HEALTH="$(curl -fsS --max-time 20 "$BASE/api/health" || true)"
[ "$HEALTH" = '{"ok":true}' ] && check "健康檢查" 0 || check "健康檢查" 1 "$HEALTH"

# 首頁那份清單。回的必須是 JSON 陣列——回 HTML 就代表 API 落到了 SPA fallback
ACTIVE="$(curl -fsS --max-time 20 "$BASE/api/groups/active" || true)"
case "$ACTIVE" in
  \[*) check "進行中的聚餐清單（$(printf '%s' "$ACTIVE" | grep -o '"joinCode"' | wc -l | tr -d ' ') 攤）" 0 ;;
  *) check "進行中的聚餐清單" 1 "$(printf '%s' "$ACTIVE" | head -c 80)" ;;
esac

# 沒對到的 API 要回 404 JSON 而不是 index.html
NOPE="$(curl -s --max-time 20 -o /dev/null -w '%{http_code}' "$BASE/api/nope" || true)"
[ "$NOPE" = "404" ] && check "未知的 API 回 404" 0 || check "未知的 API 回 404" 1 "得到 $NOPE"

# 深層路由重新整理要落回 index.html 交給前端路由，不是 404
DEEP="$(curl -s --max-time 20 -o /dev/null -w '%{http_code}' "$BASE/g/ABC234" || true)"
[ "$DEEP" = "200" ] && check "深層路由回 200" 0 || check "深層路由回 200" 1 "得到 $DEEP"

echo
if [ $FAILED -ne 0 ]; then
  if [ "$TARGET" != "production" ]; then
    echo "⚠ 預覽環境若開了 Deployment Protection，未帶憑證的請求本來就會被擋，上面的失敗可能是這個原因"
  fi
  echo "✗ 部署上去了，但驗證沒過：$BASE"
  exit 1
fi

echo "✓ 完成：$BASE"
echo "  要跑完整的端對端測試（會在資料庫建立並刪除 [smoke] 資料）："
echo "    SMOKE_BASE_URL=$BASE npm run smoke"
