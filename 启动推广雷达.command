#!/bin/zsh
set -eu
task_repo="${0:A:h}"
task_node="/Users/macmini/.local/bin/node"
if [[ ! -x "$task_node" ]]; then
  task_node="$(command -v node || true)"
fi
if [[ -z "$task_node" ]]; then
  print "需要 Node.js 22.13 或以上。当前没有找到 Node.js。"
  exit 1
fi
cd "$task_repo"
if "$task_node" --input-type=module -e 'try { const r=await fetch("http://127.0.0.1:8876/api/health",{signal:AbortSignal.timeout(1200)});const d=await r.json();process.exit(d.app_id==="lydia-affiliate-radar"?0:1); } catch { process.exit(1); }'; then
  open "http://127.0.0.1:8876"
  exit 0
fi
"$task_node" "$task_repo/ops/open.mjs" &
exec "$task_node" --no-warnings "$task_repo/server.mjs"
