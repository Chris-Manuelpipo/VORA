#!/usr/bin/env bash
# VORA — parcours complet en curl, de l'inscription à l'encaissement.
#
# Deux usages, le même script :
#   · VÉRIFIER que l'API répond de bout en bout (chaque ligne affiche son code HTTP) ;
#   · CAPTURER des réponses réelles, qui deviennent les exemples de docs/API_CONTRACT.md.
#     Une documentation dont les exemples sont inventés ment tôt ou tard ; ceux-ci sortent
#     d'une instance qui tournait.
#
# Le parcours suppose DEMO_MODE=true : le code OTP vaut 123456, et c'est un chauffeur
# SIMULÉ qui accepte la course, arrive, démarre et encaisse. Sans lui, le script
# attendrait un chauffeur qui ne viendra pas.
#
#   npm run docs:api          capture puis régénère la documentation
#   bash scripts/capture-api-examples.sh    capture seule
set -uo pipefail

BASE="${BASE:-http://127.0.0.1:3000}"
OUT="${OUT:-$(cd "$(dirname "$0")/.." && pwd)/.api-examples}"
DEMO_TOKEN="${DEMO_TOKEN:-vora-demo}"
rm -rf "$OUT"; mkdir -p "$OUT"

PASS_TOK=""; DRIVER_TOK=""; OPS_TOK=""

# save <nom> <méthode> <chemin> [corps] [jeton] [en-têtes...]
save() {
  local name="$1" method="$2" path="$3" body="${4:-}" token="${5:-}"; shift 5 2>/dev/null || shift $#
  local args=(-s -o "$OUT/$name.json" -w '%{http_code}' -X "$method" "$BASE$path" -H 'Content-Type: application/json')
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  for h in "$@"; do args+=(-H "$h"); done
  [ -n "$body" ] && args+=(-d "$body")
  local code; code=$(curl "${args[@]}")
  echo "$code" > "$OUT/$name.code"
  printf '%-34s %s %-46s → %s\n' "$name" "$method" "$path" "$code"
}

j() { python3 -c "import json,sys;d=json.load(open('$OUT/$1.json'));print(eval(\"d$2\"))" 2>/dev/null; }

echo "════ 1. SANTÉ ET CONTRAT ════"
save health            GET  /health
save openapi           GET  /openapi.json

echo
echo "════ 2. IDENTITÉ ════"
PHONE="+2376900${RANDOM:0:5}"
save auth_otp_request  POST /v1/auth/otp/request "{\"channel\":\"phone\",\"value\":\"$PHONE\"}"
save auth_otp_verify   POST /v1/auth/otp/verify  "{\"value\":\"$PHONE\",\"code\":\"123456\",\"role\":\"passenger\",\"display_name\":\"Aïcha Mballa\"}"
PASS_TOK=$(j auth_otp_verify "['access_token']")
save me                GET  /v1/me "" "$PASS_TOK"
save auth_otp_invalid  POST /v1/auth/otp/verify  "{\"value\":\"$PHONE\",\"code\":\"000000\"}"

echo
echo "════ 3. GÉO ════"
save geo_search        GET  "/v1/geo/search?q=mokolo&lat=3.8480&lng=11.5021"
save geo_zones         GET  "/v1/geo/zones?kind=moto_forbidden"
save geo_route         GET  "/v1/geo/route?from_lat=3.8541&from_lng=11.4872&to_lat=3.8659&to_lng=11.5171"
save geo_moto_check    POST /v1/geo/moto/check '{"pickup":{"lat":3.8541,"lng":11.4872},"dropoff":{"lat":3.8664,"lng":11.5183}}'

echo
echo "════ 4. PRIX ════"
save pricing_tariffs   GET  /v1/pricing/tariffs
save pricing_estimate  POST /v1/pricing/estimate '{"offer":"eco","distance_m":5000,"duration_s":900}'
save quotes            POST /v1/quotes '{"pickup":{"lat":3.8541,"lng":11.4872,"label":"Carrefour Melen"},"dropoff":{"lat":3.8482,"lng":11.4931,"label":"Carrefour Obili"}}' "$PASS_TOK"
QUOTE_ID=$(j quotes "['offers'][0]['quoteId']")
save quotes_moto_ko    POST /v1/quotes '{"pickup":{"lat":3.8541,"lng":11.4872,"label":"Carrefour Melen"},"dropoff":{"lat":3.8664,"lng":11.5183,"label":"Marché Central"}}' "$PASS_TOK"

echo
echo "════ 5. COMMANDE ════"
save rides_no_idem     POST /v1/rides "{\"quoteId\":\"$QUOTE_ID\",\"offer\":\"eco\",\"paymentMethod\":\"cash\"}" "$PASS_TOK"
IDEM="demo-$(date +%s)-$RANDOM"
save rides_create      POST /v1/rides "{\"quoteId\":\"$QUOTE_ID\",\"offer\":\"eco\",\"paymentMethod\":\"cash\"}" "$PASS_TOK" "Idempotency-Key: $IDEM"
RIDE_ID=$(j rides_create "['id']")
echo "   course = $RIDE_ID"

# On laisse le chauffeur simulé accepter, arriver, démarrer, terminer et encaisser.
echo "   … on attend le chauffeur simulé"
for i in $(seq 1 80); do
  st=$(curl -s "$BASE/v1/rides/$RIDE_ID" -H "Authorization: Bearer $PASS_TOK" | python3 -c "import json,sys;print(json.load(sys.stdin)['status'])" 2>/dev/null)
  case "$st" in
    accepted|approaching) [ ! -f "$OUT/rides_get_accepted.json" ] && save rides_get_accepted GET "/v1/rides/$RIDE_ID" "" "$PASS_TOK" ;;
    paid|rated) break ;;
  esac
  sleep 2
done
save rides_get_paid    GET  "/v1/rides/$RIDE_ID" "" "$PASS_TOK"
save rides_events      GET  "/v1/rides/$RIDE_ID/events" "" "$PASS_TOK"
save rides_list        GET  "/v1/rides?limit=5" "" "$PASS_TOK"
save rides_share       POST "/v1/rides/$RIDE_ID/share" "" "$PASS_TOK"
SHARE_URL=$(j rides_share "['url']")
SHARE_TOKEN="${SHARE_URL##*/}"
save share_public      GET  "/v1/share/$SHARE_TOKEN"
save rides_rating      POST "/v1/rides/$RIDE_ID/rating" '{"stars":5,"tags":["conduite prudente"]}' "$PASS_TOK"
save rides_invalid     POST "/v1/rides/$RIDE_ID/retry" "" "$PASS_TOK"
save rides_forbidden   POST "/v1/rides/$RIDE_ID/complete" '{}' "$PASS_TOK"
save rides_not_found   GET  "/v1/rides/11111111-1111-4111-8111-111111111111" "" "$PASS_TOK"

echo
echo "════ 6. CHAUFFEUR ════"
DPHONE="+2376770011${RANDOM:0:2}"
save driver_otp_req    POST /v1/auth/otp/request "{\"channel\":\"phone\",\"value\":\"$DPHONE\"}"
save driver_otp_verify POST /v1/auth/otp/verify  "{\"value\":\"$DPHONE\",\"code\":\"123456\",\"role\":\"driver\",\"display_name\":\"Boris Nguema\",\"driver_kind\":\"car\"}"
DRIVER_TOK=$(j driver_otp_verify "['access_token']")
save driver_online_ko  POST /v1/driver/online '{"position":{"lat":3.8541,"lng":11.4872}}' "$DRIVER_TOK"
save payments_methods  GET  /v1/payments/methods

echo
echo "════ 7. OPS ════"
save ops_dashboard_ko  GET  /v1/ops/dashboard "" "$PASS_TOK"

echo
echo "════ 8. DÉMO ════"
save demo_status       GET  /v1/demo/status "" "" "X-Demo-Token: $DEMO_TOKEN"
save demo_scenario     POST /v1/demo/scenario '{"name":"moto_zone_interdite"}' "" "X-Demo-Token: $DEMO_TOKEN"
save demo_no_token     GET  /v1/demo/status

echo
echo "Réponses capturées dans $OUT"
