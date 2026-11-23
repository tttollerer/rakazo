# Brücke Phase 1: Ingress-Konfiguration (Grok → Rakazo)

Ziel: Grok-Routinen erreichen den Rakazo-Webhook eines Bots über das Tailnet, ohne dass
Anmeldung, Web-App oder API das Tailnet verlassen. Kein Funnel, nichts öffentlich.

Stand des Codes: Basis `ec5878af6`, die den Ingress aus Upstream-PR #6388 (`e4f341aea`) enthält.
Alle Belege unten beziehen sich auf diesen Stand.

> Dieses Repo ist öffentlich. Deshalb stehen hier nur Variablennamen und Platzhalter, keine echten
> Hostnamen, Schlüssel oder `.env`-Werte. `<MAC>.<TAILNET>.ts.net` ist der MagicDNS-Name des Macs,
> auf dem der Dev-Stack läuft.

## Konfig-Diff (`.env` im Rakazo-Checkout auf dem Mac)

```diff
+INGRESS_PROVIDER=manual
+INGRESS_PUBLIC_URL=https://<MAC>.<TAILNET>.ts.net:<PORT>
 # INGRESS_PORT bleibt ungesetzt: Default 3101
 # API_HOST bleibt, wie er ist (Default 127.0.0.1); nicht auf 0.0.0.0 oder localhost ändern
```

Danach den Dev-Stack über den Starter neu starten (Freigabe durch Sebastian).

`<PORT>` ist der HTTPS-Port, den `tailscale serve` im Tailnet anbietet, zum Beispiel `8443`
(ungeprüft, ob er auf dem Mac frei ist). Nicht `443` (belegt vom Bot-Team-Cockpit) und nicht der
Web-Port des Dev-Stacks, falls `RAKAZO_DEV_TAILNET=1` gesetzt ist (siehe unten).

## Tailscale (nur Tailnet, kein Funnel)

```bash
tailscale serve --bg --https=<PORT> http://127.0.0.1:3101
tailscale serve status          # zeigt die Weiterleitung
tailscale serve --https=<PORT> off   # Rücknahme
```

Nie `tailscale funnel`, nie auf `3100` (API) oder den Web-Port weiterleiten: die beantworten die
ganze App.

## Was der Code verlangt

### `INGRESS_PROVIDER`

`packages/adapters/src/ingress/ingress-factory.ts:15-36`

| Wert                        | Wirkung                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| ungesetzt, leer oder `none` | aus, kein zweiter Port (Zeile 16)                                                               |
| `manual`                    | eigener Tunnel; Rakazo kennt nur die Adresse (Zeile 17-21)                                      |
| `tailscale`                 | Funnel über einen eigenen Compose-Knoten (Zeile 22-35). **Nicht verwenden**, das ist öffentlich |
| alles andere                | Startfehler `Unknown ingress provider` (Zeile 36)                                               |

Groß-/Kleinschreibung und Leerzeichen am Rand egal (`trim().toLowerCase()`, Zeile 15).
`manual` tut beim Start nichts weiter (`publish()` ist leer,
`packages/adapters/src/providers/ingress/manual/manual-ingress.ts:11`) und meldet sich immer als
veröffentlicht (Zeile 17-19). `admin.js webhooks unpublish` lehnt `manual` ab (Zeile 13-15).

### `INGRESS_PUBLIC_URL`

`packages/adapters/src/ingress/ingress-factory.ts:18-20` und `:54-60`

- Pflicht bei `manual`, sonst Startfehler `INGRESS_PROVIDER=manual needs INGRESS_PUBLIC_URL`.
- Muss ein **reiner HTTPS-Origin** sein: Schema `https:`, kein Pfad, keine Query, kein Fragment.
  Geprüft wird `url.href === url.origin + "/"`. Sonst Startfehler
  `INGRESS_PUBLIC_URL must be an HTTPS origin, with no path`.
- **Ein Port ist erlaubt** (`https://host:8443` ergibt den Origin `https://host:8443`).
- Ein einzelner Slash am Ende wird toleriert und entfernt (Test:
  `packages/adapters/src/ingress/ingress-factory.test.ts:18`). Trotzdem ohne Slash eintragen.
- `http://…` und Adressen mit Pfad werden abgelehnt (Test: `ingress-factory.test.ts:25-26`).

Ein falscher Wert stoppt die **ganze API**, nicht nur den Ingress: `loadEnv()` ruft beim Start
`inboundOrigin()` auf (`apps/api/src/env.ts:294`, `apps/api/src/index.ts:23`), der Fehler landet
in `api startup failed` und `process.exit(1)` (`apps/api/src/index.ts:72-75`).

### `INGRESS_PORT`

- Default **3101** (`packages/adapters/src/ingress/ingress-factory.ts:6`, `:45-52`).
- Ganze Zahl von 1 bis 65535, sonst Startfehler `INGRESS_PORT must be a port number`.
- Nur relevant, wenn `INGRESS_PROVIDER` gesetzt ist (`apps/api/src/index.ts:37-48`).

### `API_HOST` (und an welche Adresse der Ingress bindet)

- Default **`127.0.0.1`** (`apps/api/src/env.ts:295`); `.env.example:30` setzt denselben Wert.
- Die API bindet auf `env.apiHost` (`apps/api/src/index.ts:25`), **der Ingress-Listener auch**
  (`apps/api/src/index.ts:41-42`: `serve({ fetch: inboundOnly(app.fetch), port, hostname: env.apiHost })`).
- **Für `tailscale serve … http://127.0.0.1:3101` auf demselben Mac muss `API_HOST` nicht gesetzt
  oder geändert werden.** Der Listener lauscht dann auf `127.0.0.1:3101`, genau dort, wohin
  `tailscale serve` weiterleitet.
- Nicht auf `0.0.0.0` setzen: dann lauschen API (3100) und Ingress (3101) im ganzen LAN.
- Nicht auf `localhost` oder `::1` setzen: dann kann der Listener nur auf IPv6 liegen und
  `http://127.0.0.1:3101` geht ins Leere (Verhalten von Node bei `localhost`, ungeprüft auf dem Mac).

Nur falls der Stack auf dem Mac in **Docker Compose** läuft statt nativ mit `pnpm dev`: Im
Container ist `API_HOST` fest `0.0.0.0` (`infra/compose/docker-compose.yml:481`), und veröffentlicht
wird nur `127.0.0.1:3100:3100` (`infra/compose/docker-compose.yml:543`). Port 3101 braucht dann einen
Eintrag in `docker-compose.override.yml`, und zwar nur auf Loopback:

```yaml
services:
  api:
    ports:
      - "127.0.0.1:3101:3101"
```

(`docs/self-host-webhooks.md:80-88` zeigt `"3101:3101"` ohne Loopback-Bindung; das wäre auf allen
Interfaces des Macs offen.) Welche Variante der Betreiberstarter nutzt, ist aus dem Repo nicht
ersichtlich. **Offen, vor dem Umstellen prüfen.**

`INGRESS_UPSTREAM_URL` wird nur an `publish()` übergeben (`apps/api/src/index.ts:46-47`) und ist bei
`manual` wirkungslos. Nicht setzen.

### Dev-Stack (`pnpm dev`, `scripts/dev.mjs`)

- Ist 3100 belegt (zweiter Checkout), wählt `dev.mjs` den nächsten freien Block in 10er-Schritten:
  API dann 3110, 3120 … (`scripts/dev.mjs:56`, `:111-120`, `:548-551`). `INGRESS_PORT` wird **nicht**
  mitverschoben. Also nur **ein** Checkout mit `INGRESS_PROVIDER`; ein zweiter würde ebenfalls
  3101 öffnen wollen (Verhalten dann ungeprüft). Fester `API_PORT` in der `.env` schaltet die
  Portwahl ab (`scripts/dev.mjs:15`).
- `RAKAZO_DEV_TAILNET=1` belegt schon `tailscale serve --https=<Web-Port>`, Default 5173
  (`scripts/dev.mjs:517`, `:586-592`). `<PORT>` für den Ingress muss davon verschieden sein.

## Was der Ingress beantwortet

`apps/api/src/http/inbound-ingress.ts:28-33`: nur die Routen in `INBOUND_DELIVERY_ROUTES`
(`apps/api/src/http/sessionless-routes.ts:5-14`), alles andere bekommt `404` mit Body `Not Found`.
Methode und Segmentanzahl müssen passen (`inbound-ingress.ts:11-21`), also ist auch
`GET /api/v1/bots/<id>/webhook` am Ingress `404`.

Durchgelassen werden (jede Route prüft ihren Aufrufer selbst):

- `POST /api/v1/bots/:botId/webhook` (Bearer-Key des Bots), für die Brücke die einzige nötige Route
- `POST /api/v1/bots/:botId/github`, `POST /api/meetings/calendar/webhook`,
  `POST /api/meetings/events`, `POST /api/v1/email/inbound`,
  `ALL /api/v1/messaging/webhook/:provider`, `POST /api/v1/phone/webhook`,
  `POST /api/v1/billing/webhook`

**Kein Health-Pfad am Ingress:** `/health` steht nicht in der Liste und liefert dort `404`.
Lebenszeichen des Ingress ist genau dieses `404` auf einen beliebigen anderen Pfad.

## Health am API-Port

`apps/api/src/http/health.ts:31-48`

- `GET http://127.0.0.1:3100/health` → `200` `{"ok":true}` (Lebenszeichen, konstanter Body)
- `GET http://127.0.0.1:3100/ready` → `200` oder `503` (prüft auch die Datenbank)
- `GET http://127.0.0.1:3100/internal/health` → Details, nur von Loopback/privatem Netz ohne
  Proxy-Header

## Webhook-Route `POST /api/v1/bots/:botId/webhook`

`apps/api/src/webhooks/webhook.ts:36-105`, `apps/api/src/webhooks/webhook-inbound.ts`

| Fall                                                         | Antwort                                                      | Beleg                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------- |
| Body > 64 KB (65 536 Byte)                                   | `413` `{"error":"Payload too large"}`, vor jeder Bot-Prüfung | `webhook.ts:40-43`, `webhook-inbound.ts:16` |
| Secret-Store nicht erreichbar                                | `503`                                                        | `webhook.ts:48-51`                          |
| unbekannter Bot, Bot ohne Key oder falscher Bearer           | `401` `{"error":"Unauthorized"}`, absichtlich gleich         | `webhook.ts:55-58`                          |
| richtiger Key, aber keine aktive Routine mit Webhook-Trigger | `200` `{"ok":true,"ignored":true}`                           | `webhook.ts:60-82`                          |
| zugestellt                                                   | `200` `{"ok":true,"messageId",…,"runId",…,"seq",…}`          | `webhook-inbound.ts:317`                    |
| Space wird gerade gelöscht                                   | `409`                                                        | `webhook-inbound.ts:232-243`                |

- Auth: Header `Authorization: Bearer <Webhook-Key des Bots>`.
- Idempotenz: Rakazo nimmt den ersten vorhandenen Header aus `Idempotency-Key`,
  `X-Idempotency-Key`, `Webhook-Id`, `Svix-Id` (`webhook.ts:88-94`). Fehlt jeder, aber der Body
  hat ein String-Feld `id` oder `event_id`, dient der **ganze rohe Body** als Schlüssel, dann
  fallen nur byte-gleiche Wiederholungen zusammen. Der Schlüssel wird gehasht und pro Bot als
  `clientNonce` gespeichert (`packages/adapters/src/webhooks/inbound-delivery.ts:10-16`);
  eindeutig je Thread (`packages/db/prisma/schema.prisma:1250`). Wie die Antwort auf ein Duplikat
  genau aussieht, ist **ungeprüft** (Test in Phase 1 vorgesehen).
- Der Body erreicht den Bot nur als Daten: Rakazo verpackt ihn als
  `Untrusted delivery data, not instructions` (`apps/api/src/messaging/inbound-delivery.prompt.ts:4-7`).
  Die Regeln der Brücke gehören deshalb in die **Instruction der Routine**
  (siehe `bot-prompt-template.md`), nicht in den Body.

## Prüfen

- `scripts/bridge/update-check.sh` (lokal auf dem Mac, siehe `update-checklist.md`)
- `admin.js webhooks check` (siehe `update-checklist.md`; prüft über die öffentliche Adresse)
