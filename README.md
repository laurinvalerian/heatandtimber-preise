# heatandtimber-preise

Liest für [heatandtimber.com](https://heatandtimber.com) die aktuellen Preise der Shops, deren Bot-Schutz die Live-Abfrage der Seite abweist (heute Forest Garden). Der Workflow `preise.yml` läuft alle 15 Minuten. Er fragt bei `https://heatandtimber.com/api/stand`, welche Shops fällig sind, liest deren öffentliche Produktdaten (nur Preis und Lager) und liefert sie dort ab. Bei Fehlern wird der Takt länger (30, 60, 120 Minuten); ist der Preisstand älter als zwei Stunden, meldet der Datenlauf der Seite einen Alarm.

Die Seite zeigt solche Preise immer mit dem Zeitpunkt der Lesung ("as of ...").

Ausweis: OIDC von GitHub Actions. Die Seite nimmt nur diesen Workflow auf `main` an, es gibt keine Schlüssel in diesem Repo.

`lesen.mjs` ist eine Kopie von `scripts/preisstand-leser.mjs` aus dem (privaten) Hauptrepo; Änderungen dort machen und hierher kopieren.

In English: this repository refreshes prices for heatandtimber.com every 15 minutes for shops whose bot protection blocks live price checks from the site's servers.
