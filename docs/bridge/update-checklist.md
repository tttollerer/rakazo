# Brücke Phase 1: Checkliste vor und nach jedem Update

Der Webhook-Ingress kam mit Upstream-PR #6388 (`e4f341aea`). Die Desktop-App 0.14.0 hat ihn nicht
(der Tag `v0.14.0` enthält `apps/api/src/http/inbound-ingress.ts` nicht). Die Brücke läuft deshalb
nur über den Dev-Stack. Jedes Update und jeder Branch-Wechsel kann sie still abschalten.

Freigaben (`.env`, Neustart, `tailscale serve`) gibt nur Sebastian selbst.

## Vor dem Update oder Branch-Wechsel

1. Zielstand prüfen, ohne zu wechseln:

   ```bash
   git fetch upstream
   scripts/bridge/update-check.sh --files-only --ref upstream/main .
   ```

   `FEHLER … enthält … nicht`: **Update abbrechen.**
2. Laufenden Stand als Vergleich festhalten (Stack läuft):

   ```bash
   scripts/bridge/update-check.sh .
   ```

## Nach dem Update (Stack über den Starter neu gestartet)

1. Lokaler Check auf dem Mac:

   ```bash
   scripts/bridge/update-check.sh .
   ```

   Prüft:
   - `apps/api/src/http/inbound-ingress.ts` und `admin.js webhooks check` sind im Code
   - `GET http://127.0.0.1:3100/health` ergibt `200`
   - Ingress `127.0.0.1:3101`: unbekannter Pfad `404`, App-Route `/api/auth/capabilities` `404`
     (die API selbst gäbe hier `200`), `POST /api/v1/bots/bridge-update-check/webhook` mit
     falschem Key `401`

   Läuft die API wegen der Portwahl von `pnpm dev` auf einem anderen Port (3110 …), `API_PORT=…`
   davorsetzen. Abweichender Ingress-Port: `INGRESS_PORT=…`.
2. Über das Tailnet (gleiche Proben über `tailscale serve`, von einem anderen Gerät im Tailnet):

   ```bash
   BRIDGE_PUBLIC_URL=https://<MAC>.<TAILNET>.ts.net:<PORT> scripts/bridge/update-check.sh --files-only .   # Code
   BRIDGE_PUBLIC_URL=https://<MAC>.<TAILNET>.ts.net:<PORT> scripts/bridge/update-check.sh .                 # alles
   ```

   Von einem anderen Rechner aus schlagen die lokalen Proben (127.0.0.1) fehl. Dort zählen nur
   die Zeilen `Ingress über Tailnet`.
3. Optional `admin.js webhooks check`:

   ```bash
   RAKAZO_ADMIN_CMD='<Befehl bis vor "webhooks check">' scripts/bridge/update-check.sh .
   ```

   Der dokumentierte Aufruf läuft im API-Container (`docs/self-host-webhooks.md:58-63`):

   ```bash
   docker compose --env-file .env -f docker-compose.images.yml exec api \
     node dist/cli/admin.js webhooks check
   ```

   Er prüft über `INGRESS_PUBLIC_URL`: Provider meldet veröffentlicht, Webhook eines unbekannten
   Bots ergibt `401`, `GET /api/auth/capabilities` ergibt `404`; Exit-Code 1, wenn etwas fehlt
   (`apps/api/src/cli/admin/webhooks-commands.ts:49-91`). Das Skript zeigt davon nur OK/FEHLER.

   Einschränkungen (ungeprüft auf dem Mac):
   - Für den nativen Dev-Stack gibt es keinen dokumentierten Aufruf: `admin.ts` lädt die `.env`
     nicht selbst (anders als `apps/api/src/index.ts:7`) und braucht `DATABASE_URL` und den
     Schlüssel für den Secret-Store (`apps/api/src/cli/admin.ts:25-32`), die `pnpm dev` zur
     Laufzeit setzt. Ein `dist/cli/admin.js` entsteht erst mit `pnpm --filter @rakazo/api build`.
   - Mit `manual` meldet der Provider immer „published“ (`manual-ingress.ts:17-19`). Die
     Aussagekraft liegt in den zwei HTTP-Proben, und die macht `update-check.sh` ohnehin.
   - Aus einem Container ist die Tailnet-Adresse eventuell nicht erreichbar.
4. Smoke-Test aus dem Plan: Ping in beide Richtungen (`bot-prompt-template.md`, Abschnitt Ping-Test).

Schlägt eine Prüfung fehl: **Update abbrechen**, auf den letzten guten Stand zurück, Brücke so lange
über das Postfach (`rakazo-grok-mailbox`) laufen lassen.

## Ausgabe und Exit-Code

- `OK` / `FEHLER` / `SKIP` je Prüfung, am Ende `Ergebnis: …`
- Exit `0`: alles in Ordnung. Exit `1`: mindestens ein Fehler, „Update abbrechen“. Exit `2`:
  falscher Aufruf.
- Das Skript liest keine `.env`, gibt keine Schlüssel aus und schickt nur einen erfundenen, falschen
  Key (`bridge-update-check-wrong-key`) an einen erfundenen Bot.
