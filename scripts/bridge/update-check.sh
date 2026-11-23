#!/usr/bin/env bash
# Brücke Phase 1: Prüft vor und nach einem Update oder Branch-Wechsel, ob der Webhook-Ingress noch da ist
# und antwortet. Liest keine .env-Datei und gibt keine Schlüssel aus. Siehe docs/bridge/update-checklist.md.
#
# Aufruf:
#   scripts/bridge/update-check.sh [--ref <git-ref>] [--files-only] [<checkout>]
#
#   <checkout>     Rakazo-Checkout (Default: aktuelles Verzeichnis)
#   --ref <ref>    zusätzlich prüfen, ob <ref> (z. B. upstream/main) die Ingress-Datei enthält,
#                  bevor man darauf wechselt
#   --files-only   nur Dateiprüfungen, keine HTTP-Proben (z. B. wenn der Stack noch nicht läuft)
#
# Umgebungsvariablen (alle optional, keine Secrets):
#   CHECK_HOST         Adresse der lokalen Listener (Default 127.0.0.1)
#   API_PORT           API-Port (Default 3100)
#   INGRESS_PORT       Ingress-Port (Default 3101)
#   BRIDGE_PUBLIC_URL  Tailnet-Origin des Ingress, z. B. https://<mac>.<tailnet>.ts.net:<port>;
#                      wenn gesetzt, laufen die Ingress-Proben auch über diese Adresse
#   RAKAZO_ADMIN_CMD   Befehl bis vor "webhooks check", z. B.
#                      "docker compose --env-file .env -f docker-compose.images.yml exec -T api node dist/cli/admin.js"
#                      Ohne diese Variable wird die admin.js-Prüfung übersprungen.
#
# Exit-Code: 0 = alles in Ordnung, 1 = mindestens eine Prüfung fehlgeschlagen, 2 = falscher Aufruf.

set -u

INGRESS_FILE="apps/api/src/http/inbound-ingress.ts"
ADMIN_FILE="apps/api/src/cli/admin/webhooks-commands.ts"
PROBE_BOT="bridge-update-check"
PROBE_KEY="bridge-update-check-wrong-key"

ref=""
files_only=0
checkout="."

while [ $# -gt 0 ]; do
  case "$1" in
    --ref)
      [ $# -ge 2 ] || { echo "Fehler: --ref braucht einen Wert" >&2; exit 2; }
      ref="$2"
      shift 2
      ;;
    --files-only)
      files_only=1
      shift
      ;;
    -h | --help)
      sed -n '2,25p' "$0"
      exit 0
      ;;
    -*)
      echo "Fehler: unbekannte Option $1" >&2
      exit 2
      ;;
    *)
      checkout="$1"
      shift
      ;;
  esac
done

host="${CHECK_HOST:-127.0.0.1}"
api_port="${API_PORT:-3100}"
ingress_port="${INGRESS_PORT:-3101}"
public_url="${BRIDGE_PUBLIC_URL:-}"
public_url="${public_url%/}"

failures=0

ok() { printf 'OK    %s\n' "$1"; }
fail() {
  printf 'FEHLER %s\n' "$1"
  failures=$((failures + 1))
}
skip() { printf 'SKIP  %s\n' "$1"; }

# HTTP-Status einer Anfrage, "000" wenn keine Verbindung zustande kam. Der Body wird verworfen.
http_status() {
  local method="$1" url="$2"
  shift 2
  curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -X "$method" "$@" "$url" 2>/dev/null || true
}

expect_status() {
  local label="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    ok "$label ($got)"
  else
    fail "$label: erwartet $want, bekommen ${got:-000}"
  fi
}

ingress_probes() {
  local base="$1" where="$2"
  # Ein Pfad außerhalb der Inbound-Routen: der Ingress antwortet mit 404 (inbound-ingress.ts:28-33).
  expect_status "$where: unbekannter Pfad ergibt 404" 404 \
    "$(http_status GET "$base/bridge-update-check")"
  # /api/auth/capabilities beantwortet die API mit 200, der Ingress muss es mit 404 ablehnen.
  expect_status "$where: App-Route wird abgelehnt (404)" 404 \
    "$(http_status GET "$base/api/auth/capabilities")"
  # Unbekannter Bot mit falschem Key: dieselbe 401 wie ein falscher Key (webhook.ts:55-58).
  expect_status "$where: Webhook mit falschem Key ergibt 401" 401 \
    "$(http_status POST "$base/api/v1/bots/$PROBE_BOT/webhook" \
      -H "Authorization: Bearer $PROBE_KEY" -H 'Content-Type: application/json' --data '{}')"
}

echo "Brücken-Update-Check: $checkout"

# 1. Ingress-Code im Checkout
if [ -f "$checkout/$INGRESS_FILE" ]; then
  ok "$INGRESS_FILE vorhanden"
  if grep -q 'export function inboundOnly' "$checkout/$INGRESS_FILE"; then
    ok "inboundOnly() vorhanden"
  else
    fail "inboundOnly() fehlt in $INGRESS_FILE"
  fi
else
  fail "$INGRESS_FILE fehlt im Checkout"
fi

if [ -f "$checkout/$ADMIN_FILE" ] && grep -q 'path: \["webhooks", "check"\]' "$checkout/$ADMIN_FILE"; then
  ok "admin.js webhooks check im Code vorhanden"
else
  fail "admin.js webhooks check fehlt ($ADMIN_FILE)"
fi

# 1b. Optional: Zielstand vor dem Wechsel
if [ -n "$ref" ]; then
  if git -C "$checkout" cat-file -e "$ref:$INGRESS_FILE" 2>/dev/null; then
    ok "$ref enthält $INGRESS_FILE"
  else
    fail "$ref enthält $INGRESS_FILE nicht (oder $ref ist unbekannt)"
  fi
fi

if [ "$files_only" -eq 0 ]; then
  if ! command -v curl >/dev/null 2>&1; then
    fail "curl nicht gefunden, HTTP-Proben nicht möglich"
  else
    # 2. API-Health
    expect_status "API-Health http://$host:$api_port/health ergibt 200" 200 \
      "$(http_status GET "http://$host:$api_port/health")"

    # 3. Ingress lokal
    ingress_probes "http://$host:$ingress_port" "Ingress $host:$ingress_port"

    # 4. Ingress über das Tailnet
    if [ -n "$public_url" ]; then
      ingress_probes "$public_url" "Ingress über Tailnet"
    else
      skip "Tailnet-Proben (BRIDGE_PUBLIC_URL nicht gesetzt)"
    fi
  fi

  # 5. admin.js webhooks check (nur Status, die Ausgabe wird verworfen)
  if [ -n "${RAKAZO_ADMIN_CMD:-}" ]; then
    if (cd "$checkout" && sh -c "$RAKAZO_ADMIN_CMD webhooks check") >/dev/null 2>&1; then
      ok "admin.js webhooks check"
    else
      fail "admin.js webhooks check (Details: den Befehl von Hand ausführen)"
    fi
  else
    skip "admin.js webhooks check (RAKAZO_ADMIN_CMD nicht gesetzt)"
  fi
else
  skip "HTTP-Proben und admin.js (--files-only)"
fi

if [ "$failures" -gt 0 ]; then
  echo "Ergebnis: $failures Prüfung(en) fehlgeschlagen. Update abbrechen."
  exit 1
fi
echo "Ergebnis: alles in Ordnung."
exit 0
