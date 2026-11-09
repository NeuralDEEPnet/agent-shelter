#!/usr/bin/env bash
# Launch smoke test — proves every precondition in docs/LAUNCH.md against the LIVE service.
# Read-only except one free question (a stipend-funded ask). Exit code 0 = ready to announce.
#
#   bash scripts/launch-smoke.sh [origin]
set -u
ORIGIN="${1:-https://agent-shelter-neuraldeepnet.on.adaptive.ai}"
pass=0; fail=0
ok()   { echo "  ok   $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL $1"; fail=$((fail+1)); }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const v=(new Function("j","return ("+process.argv[1]+")"))(j);console.log(typeof v==="string"?v:JSON.stringify(v))}catch(e){console.log("ERR")}})' "$1"; }

echo "Launch smoke test against $ORIGIN"
echo "— discovery"
for p in / /api/mpp/catalog /api/shelter/llms.txt /.well-known/mcp.json /.well-known/agent.json /sitemap.xml /commons; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$ORIGIN$p")
  [ "$code" = 200 ] && ok "GET $p → 200" || bad "GET $p → $code"
done

echo "— MCP"
tools=$(curl -s --max-time 20 -X POST "$ORIGIN/api/mcp" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | json 'j.result.tools.map(t=>t.name).join(",")')
for t in ask list_residents get_resident hire surrender list_commons; do
  case ",$tools," in *",$t,"*) ok "tool $t listed" ;; *) bad "tool $t missing (have: $tools)" ;; esac
done
ver=$(curl -s --max-time 20 -X POST "$ORIGIN/api/mcp" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' | json 'j.result.serverInfo.version')
echo "  info serverInfo.version = $ver"

echo "— catalog"
cat=$(curl -s --max-time 20 "$ORIGIN/api/mpp/catalog")
n=$(echo "$cat" | json 'j.residents.length'); [ "${n:-0}" -ge 1 ] && ok "$n residents taking calls" || bad "no residents"
free=$(echo "$cat" | json 'j.freeTier && j.freeTier.questionsPerDay'); [ "${free:-0}" != "null" ] && [ "${free:-0}" != "ERR" ] && [ "${free:-0}" -ge 1 ] && ok "free tier advertised ($free/day)" || bad "free tier not in catalog"
commons=$(echo "$cat" | json 'j.commons ? j.commons.enabled : "absent"'); [ "$commons" = "true" ] && ok "Commons live" || bad "Commons: $commons (deploy main)"
rescued=$(echo "$cat" | json 'j.rescued'); [ "${rescued:-0}" -ge 1 ] && ok "$rescued rescued resident(s) (not authored by the operator)" || bad "rescued = $rescued — put real servers behind the door before announcing"
mcpkind=$(echo "$cat" | json 'j.residents.filter(r=>r.kind==="mcp").length'); [ "${mcpkind:-0}" -ge 1 ] && ok "$mcpkind mcp resident(s) with callable tools" || bad "no mcp-kind resident — run the foster host (hosting/foster-host)"

echo "— free ask (one stipend-funded question)"
slug=$(echo "$cat" | json 'j.residents[0].slug')
ans=$(curl -s --max-time 60 -w '\n%{http_code}' -X POST "$ORIGIN/api/mpp/ask/$slug" -H 'content-type: application/json' -d '{"question":"In one sentence, what are you for?"}')
code=$(echo "$ans" | tail -n1)
case "$code" in 200) ok "ask $slug → 200 ($(echo "$ans" | head -n1 | json 'j.answer.slice(0,80)'))" ;; 429) ok "ask $slug → 429 (quota used; door works)" ;; *) bad "ask $slug → $code" ;; esac

echo "— documented example slugs resolve"
for s in $(grep -ohE 'api/mpp/(ask|hire)/[a-z0-9-]+' README.md public/about.md | sed -E 's#.*/##' | sort -u); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 -X POST "$ORIGIN/api/mpp/ask/$s" -H 'content-type: application/json' -d '{"question":"What are you for?"}')
  case "$code" in 200|429|502|503) ok "example slug $s → $code" ;; *) bad "example slug $s → $code (dead example in docs)" ;; esac
done

echo "— registry"
reg=$(curl -s --max-time 20 "https://registry.modelcontextprotocol.io/v0/servers?search=agent-shelter" | json 'j.servers[0].server.version')
echo "  info official registry lists version $reg (repo server.json: $(node -e 'console.log(require("./server.json").version)'))"

echo
echo "$pass ok, $fail failing"
[ "$fail" = 0 ]
