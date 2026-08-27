#!/bin/zsh
# 雙擊此檔案即可啟動 VFX Playground 本機伺服器。

cd -- "$(dirname "$0")"
PORT=""

if ! command -v python3 >/dev/null 2>&1; then
  echo "找不到 python3，無法啟動本機伺服器。"
  echo "請安裝 Python 3 後再試一次。"
  read -k 1 "?按任意鍵關閉…"
  exit 1
fi

echo "正在啟動 VFX Playground…"
for candidate in {4173..4183}; do
  if ! nc -z 127.0.0.1 "$candidate" >/dev/null 2>&1; then
    PORT="$candidate"
    break
  fi
done

if [[ -z "$PORT" ]]; then
  echo "4173–4183 都正在使用中，請關閉其他本機伺服器後再試。"
  read -k 1 "?按任意鍵關閉…"
  exit 1
fi

URL="http://127.0.0.1:${PORT}/"
# 用專案自帶的 serve.py，不要用內建的 http.server：後者不會送
# Cache-Control: no-store，Chrome 在一般重新整理（非強制）時可能直接吃自己
# 快取的舊版 .js，改完檔案、甚至重開分頁都還是看到舊畫面——serve.py 的
# FastRequestHandler 就是為了堵住這個問題才寫的（見 serve.py 開頭註解）。
python3 serve.py "$PORT" >/dev/null 2>&1 &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM

sleep 1
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "無法啟動伺服器，請再試一次。"
  read -k 1 "?按任意鍵關閉…"
  exit 1
fi

open "$URL"
echo "VFX Playground 已開啟：${URL}"
echo "保持這個 Terminal 視窗開啟；按 Ctrl+C 可停止伺服器。"
wait "$SERVER_PID"
