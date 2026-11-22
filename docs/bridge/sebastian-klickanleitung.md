# Klickanleitung für Sebastian: Rakazo-Seite der Brücke

Für die Rakazo-Weboberfläche (oder die Desktop-App, gleiche Oberfläche), angemeldet als du selbst.
Drei Teile: Webhook-Routine anlegen, Grok-Adresse und -Schlüssel hinterlegen, `secret_request`
freigeben. Die Grok-Routine legt Jane GOTT selbst an.

**Schlüssel nie in einen Chat, ein Issue oder eine Notiz kopieren.** Nur in die geschützte Karte
bzw. das Formular der Gegenseite.

Die Bezeichnungen stammen aus dem Code (`apps/web`) und der Doku (`docs/`). Die Oberfläche ist
englisch; was nicht sicher belegt ist, ist mit **(unsicher)** markiert.

## Vorher

Der Ingress muss laufen (`phase1-config.md`, Neustart des Dev-Stacks). Erst dann zeigt die
Routine die Tailnet-Adresse statt der lokalen Adresse an (`docs/self-host-webhooks.md:24-26`).

## 1. Routine mit Webhook-Trigger anlegen

Belege: `docs/routines.md` (Abschnitte „Create or edit one yourself“ und „Webhook“),
`apps/web/src/pages/routines/routine-editor/add-trigger-menu.tsx`,
`apps/web/src/pages/routines/routine-editor/trigger-cards.tsx`.

1. Den Chat mit dem Rakazo-Bot öffnen, der mit Grok sprechen soll.
2. Oben auf den **Namen des Bots** klicken. Das Bot-Panel öffnet sich.
3. Im Bereich **Routines**: **New routine** (wenn die Liste leer ist) oder **+**
   („Create routine“).
4. **Name**: z. B. `Brücke Grok`.
5. **Instruction**: die Vorlage aus `bot-prompt-template.md` (Rakazo-Routine) einfügen,
   Platzhalter ersetzen.
6. Unter **When to run**: **Add trigger** → **Webhook**.
7. **Save**.
8. Die Karte **When a webhook fires** zeigt zwei Zeilen:
   - **URL**: `https://<MAC>.<TAILNET>.ts.net:<PORT>/api/v1/bots/<Bot-ID>/webhook`
   - **Header**: `Authorization: Bearer ••••••••`. Das Auge (**Show key**) zeigt den Schlüssel, das
     Kopiersymbol kopiert die ganze Header-Zeile.
9. URL und Schlüssel **nur** in die geschützte Karte bzw. das Secret-Formular der Grok-Routine
   übertragen. Erwartet Grok nur den Schlüssel ohne `Authorization: Bearer `, den Vorsatz dort
   weglassen **(unsicher, wie Grok das Feld erwartet)**.
10. Prüfen, dass **Active** eingeschaltet ist. **Test run** startet die Routine einmal von Hand.

Schlüssel neu erzeugen: im Menü **Key options** der Karte → **Rotate key**. Der alte Schlüssel
gilt danach nicht mehr; die Grok-Seite muss den neuen bekommen.

## 2. Grok-Adresse und -Schlüssel als Bot-Secret hinterlegen

Belege: `docs/bot-secrets.md` (Abschnitte „Reusable credentials“ und „Managing the vault“).

Zwei Wege, beide speichern verschlüsselt im Vault. Das Modell sieht den Wert nie
(`docs/bot-secrets.md:3`, `:37`).

**Weg A (empfohlen), über den Bot im Chat:**

1. Im Chat mit dem Bot schreiben (ohne Schlüssel!):
   „Lege mit request_secret ein Credential `grok_bridge` an, Origin
   `https://<GROK-ROUTINEN-HOST>`, Auth Bearer.“
2. Der Bot zeigt eine **geschützte Karte** mit dem Origin. Origin prüfen, dann den Grok-Schlüssel
   **nur dort** eintragen und speichern.

**Weg B, von Hand:** **Settings → Vault** → **New** → API key **(unsicher: genaue Felder des
Formulars nicht geprüft)**. Name `grok_bridge`, Origin wie oben.

Wichtig:

- Gebunden wird an den **Origin** (Schema, Host, Port), nicht an die volle URL. Er muss **exakt**
  passen, auch der Port (`docs/bot-secrets.md:31`). Der Pfad der Grok-Routine steht später nur im
  `secret_request`-Aufruf.
- Nur HTTPS (`docs/bot-secrets.md:31-33`).
- Möglich sind Bearer, ein benannter Header (`{"type":"header","name":"X-…"}`) oder Basic
  (`docs/bot-secrets.md:31`). Welche Variante Grok braucht, ist **unsicher**. Steckt der
  Grok-Schlüssel in der URL selbst, geht dieser Weg nicht geschützt; dann zuerst klären.
- Hat der Space einen eigenen Vault, dort speichern (Space-Einstellungen → **Vault**,
  `docs/bot-secrets.md:161-162`).
- Optional unter **Bots** des Eintrags nur den Brücken-Bot zulassen (`docs/bot-secrets.md:164-166`).

## 3. `secret_request` auf „Always allow“

Belege: `docs/approvals.md`,
`apps/web/src/components/settings/ApprovalRulesSettings.tsx:170-177`, `:259`.

Ohne diese Freigabe wartet ein Webhook-Lauf auf eine Karte, die niemand sieht, und sie verfällt
nach 30 Minuten (`docs/approvals.md`, Abschnitt „Approval cards“; `docs/routines.md`, Hinweis
unter „Triggers“). `secret_request` ist standardmäßig freigabepflichtig
(`packages/core/src/runs/action-approval.ts:80`).

**Weg A, über die Einstellungen:**

1. **Settings → Approvals**.
2. **Add rule** → im Suchfeld `secret` eingeben → **Secret request** wählen.
3. Die neue Regel erscheint zunächst als **Always ask** (so legt „Add rule“ sie an). Rechts den
   Schalter auf **Allow** stellen. Sie steht dann unter **Always allow**.

**Weg B, über eine Karte:** Beim ersten `secret_request` im Chat (z. B. beim Test) auf der Karte
**Always allow this tool** wählen.

Hinweise:

- Bei Modus **Never ask** ist keine Regel nötig, alles läuft ohne Karte.
- Gilt für das ganze Konto. Hat ein Space eigene Regeln (**Customize** neben **Approvals** in den
  Space-Einstellungen), die Regel **dort** anlegen.
- „Always allow“ für `secret_request` erlaubt nur Anfragen mit gespeicherten Credentials an deren
  Origin. Andere Werkzeuge wie Shell oder Browser nicht freigeben (Warnung in `docs/routines.md`).

## 4. Testen

1. Jane GOTT / Grok schickt `ping` (siehe `bot-prompt-template.md`, Ping-Test).
2. Im Chat des Bots erscheint ein Lauf der Routine, danach geht `pong` an Grok.
3. Bleibt die Antwort aus: in **Run history** der Routine nachsehen. Steht dort eine wartende
   oder verfallene Freigabe, fehlt Teil 3.
