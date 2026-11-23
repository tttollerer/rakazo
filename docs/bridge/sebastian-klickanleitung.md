# Klickanleitung für Sebastian: Rakazo-Seite der Brücke

Für die Rakazo-Weboberfläche (oder die Desktop-App, gleiche Oberfläche), angemeldet als du selbst.
Vier Teile, in dieser Reihenfolge:

1. einen eigenen Brücken-Bot `Grok-Brücke` anlegen
2. an diesem Bot eine Webhook-Routine anlegen
3. das Credential `grok_bridge` hinterlegen
4. `secret_request` auf **Always allow** setzen

Warum ein eigener Bot und kein Alltags-Bot (auch nicht Chief): Jeder Webhook landet als Nachricht
im einen, langlebigen Thread genau dieses Bots (`apps/api/src/webhooks/webhook-inbound.ts:287-311`,
`sendUserMessage` mit `threadId: target.threadId`; `target.threadId` ist `bot.thread.id`,
`webhook-inbound.ts:223`). Mit einem eigenen Bot bleibt der Alltagschat frei von Brücken-Nachrichten,
und die Brücke bekommt keinen fremden Verlauf in den Kontext.

Die Grok-Routine legt Jane GOTT selbst an.

**Schlüssel nie in einen Chat, ein Issue oder eine Notiz kopieren.** Nur in die geschützte Karte
bzw. das Formular der Gegenseite.

Die Bezeichnungen stammen aus dem Code (`apps/web`) und der Doku (`docs/`). Die Oberfläche ist
englisch; was nicht sicher belegt ist, ist mit **(unsicher)** markiert.

## Vorher

Der Ingress muss laufen (`phase1-config.md`, Neustart des Dev-Stacks). Erst dann zeigt die
Routine die Tailnet-Adresse statt der lokalen Adresse an (`docs/self-host-webhooks.md:24-26`).

## 1. Eigenen Brücken-Bot anlegen

Belege: `docs/bots-and-chats.md:8-9`, `apps/web/src/pages/shell/sidebar/sidebar-header.tsx`,
`apps/web/src/pages/shell/bots/bot-picker.tsx`, `apps/web/src/pages/shell/bots/create-bot-dialog.tsx`,
`apps/web/src/pages/shell/bots/bot-panel.tsx`, `apps/web/src/pages/shell/bots/instruction-settings.tsx`.

1. `http://127.0.0.1:5173/app` öffnen, angemeldet als du selbst (Web oder Desktop, gleiche
   Oberfläche; Route `/app`: `apps/web/src/App.tsx:333`).
2. Oben in der Seitenleiste das **+** wählen (Tooltip und Bezeichnung **Create**,
   `sidebar-header.tsx:124`, `:133`).
3. Im Menü **New bot** wählen (`bot-picker.tsx:39`). Der Dialog **New bot** öffnet sich
   (`create-bot-dialog.tsx:85`).
4. Ins Feld **Name** (Platzhalter „Name your Bot“, `create-bot-dialog.tsx:93-94`) `Grok-Brücke`
   eintragen, dann **Create** (`create-bot-dialog.tsx:123`). Die App öffnet danach den Chat des
   neuen Bots (`apps/web/src/pages/Shell.tsx:606-610`).
5. Oben im Chat auf den Namen **Grok-Brücke** klicken. Das Bot-Panel öffnet sich
   (`apps/web/src/pages/shell/chat/chat-header.tsx:66-70`).
6. Im Panel den Abschnitt **Settings** aufklappen (`bot-panel.tsx:663`). Darin steht das Feld
   **Instructions** (`instruction-settings.tsx:61`). Hinweis: `docs/bots-and-chats.md:65` nennt
   diesen Bereich „Advanced“; so heißt er nur in der mobilen App, im Web-Code heißt er **Settings**.
7. In **Instructions** die Vorlage aus `bot-prompt-template.md` (Rakazo-Routine) einfügen und
   `<GROK-ROUTINEN-URL>` sowie die erlaubten Aufgaben ersetzen. **Keine Schlüssel.** Es gibt keinen
   Speichern-Button: Gespeichert wird, sobald das Feld den Fokus verliert, also danach einmal
   außerhalb des Feldes klicken (`instruction-settings.tsx:116-118`). Höchstens 20.000 Zeichen
   (`packages/contracts/src/bots/bot.ts:125`).
8. In diesem Schritt **keine** Routine, **kein** Vault-Eintrag und **kein** Schlüssel. Das folgt in
   den Teilen 2 bis 4.

Den Bot gibt es nur über die Oberfläche: `admin.js` hat kein Kommando zum Anlegen eines Bots
(Liste in `apps/api/src/cli/admin/commands.ts:8-15`: `account delete`, `billing cancel`,
`billing refund`, `bot webhook-key`, `webhooks check`, `webhooks unpublish`).

## 2. Routine mit Webhook-Trigger anlegen

Belege: `docs/routines.md` (Abschnitte „Create or edit one yourself“ und „Webhook“),
`apps/web/src/pages/routines/routine-editor/add-trigger-menu.tsx`,
`apps/web/src/pages/routines/routine-editor/trigger-cards.tsx`.

1. Den Chat mit **Grok-Brücke** öffnen, nicht mit Chief und nicht mit einem Alltags-Bot.
2. Oben auf den **Namen des Bots** klicken. Das Bot-Panel öffnet sich.
3. Im Bereich **Routines**: **New routine** (wenn die Liste leer ist) oder **+**
   („Create routine“).
4. **Name**: z. B. `Brücke Grok`.
5. **Instruction**: dieselbe Vorlage aus `bot-prompt-template.md` (Rakazo-Routine) wie in Teil 1
   einfügen, Platzhalter genauso ersetzen.
6. Unter **When to run**: **Add trigger** → **Webhook**.
7. **Save**.
8. Die Karte **When a webhook fires** zeigt zwei Zeilen:
   - **URL**: `https://<MAC>.<TAILNET>.ts.net:<PORT>/api/v1/bots/<Bot-ID>/webhook`
   - **Header**: `Authorization: Bearer ••••••••`. Das Auge (**Show key**) zeigt den Schlüssel, das
     Kopiersymbol kopiert die ganze Header-Zeile.
9. URL und Schlüssel **nur** in die geschützte Karte bzw. das Secret-Formular der Grok-Routine
   übertragen. Erwartet Grok nur den Schlüssel ohne `Authorization: Bearer `, den Vorsatz dort
   weglassen **(unsicher, wie Grok das Feld erwartet)**.
10. Prüfen, dass **Active** eingeschaltet ist. **Run now** startet die Routine einmal von Hand
    (`apps/web/src/pages/routines/RoutineEditor.tsx:167`; `docs/routines.md` nennt den Button
    „Test run“, im Web-Code heißt er **Run now**).

Schlüssel neu erzeugen: im Menü **Key options** der Karte → **Rotate key**. Der alte Schlüssel
gilt danach nicht mehr; die Grok-Seite muss den neuen bekommen.

## 3. Grok-Adresse und -Schlüssel als Bot-Secret hinterlegen

Belege: `docs/bot-secrets.md` (Abschnitte „Reusable credentials“ und „Managing the vault“).

Zwei Wege, beide speichern verschlüsselt im Vault. Das Modell sieht den Wert nie
(`docs/bot-secrets.md:3`, `:37`).

**Weg A (empfohlen), über den Bot im Chat:**

1. Im Chat mit **Grok-Brücke** schreiben (ohne Schlüssel!):
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
- Optional unter **Bots** des Eintrags nur **Grok-Brücke** zulassen (`docs/bot-secrets.md:164-166`).

## 4. `secret_request` auf „Always allow“

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

## 5. Testen

1. Jane GOTT / Grok schickt `ping` an den Webhook von **Grok-Brücke** (siehe
   `bot-prompt-template.md`, Ping-Test).
2. Im Chat von **Grok-Brücke** erscheint ein Lauf der Routine, danach geht `pong` an Grok.
3. Bleibt die Antwort aus: in **Run history** der Routine nachsehen. Steht dort eine wartende
   oder verfallene Freigabe, fehlt Teil 4.
