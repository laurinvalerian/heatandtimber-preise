// Leser des Preisstands: läuft im öffentlichen Repo laurinvalerian/heatandtimber-preise (Workflow preise.yml, alle 15
// Minuten, dort als lesen.mjs; öffentliche Repos haben unbegrenzte Actions-Minuten). Quelle ist diese Datei im
// Hauptrepo (Test daneben); nach einer Änderung die Kopie im öffentlichen Repo von Hand nachführen.
// Ablauf: OIDC-Ausweis von GitHub holen, bei https://heatandtimber.com/api/stand fragen, welche Shops im Stand-Modus
// fällig sind (functions/api/stand.js, scripts/stand-modus.mjs), diese Shops lesen und das Ergebnis abliefern.
// Gelesen wird genau wie im Datenlauf (scripts/sammler-woo.mjs, scripts/sammler-shopify.mjs: gleiche Adressen, gleiche
// Kennung, keine weiteren Köpfe): WooCommerce über die Store API, Shopify über /products.json; abgeliefert werden nur
// die Felder für Preis und Lager. Bis 06.10.2026 fragte der Leser mit _fields, eigener Kennung und Accept-Kopf; Forest
// Garden wies davon 5 von 7 Läufen ab, den Datenlauf in derselben Zeit 1 von 4. Seite für Seite mit Pause, Ende bei
// einer nicht vollen Seite (Shops schonend fragen). Scheitert ein Shop, geht das mit dem
// Grund an die Function (sie verlängert dann das Intervall); der Lauf endet nur rot, wenn die Function selbst nicht
// erreichbar ist oder den Ausweis ablehnt.
// Lauf: node lesen.mjs (in GitHub Actions mit permissions id-token: write)

export const ZIEL = 'https://heatandtimber.com/api/stand';
// Dieselbe Kennung wie die Sammler des Datenlaufs
const KENNUNG = 'Mozilla/5.0 (heatandtimber-daten)';
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

export const ARTEN = {
  woo: {
    groesse: 100,
    url: (base, seite) => `${base}/wp-json/wc/store/v1/products?per_page=100&page=${seite}`,
    liste: (j) => j,
    kuerzen: (d) => ({ id: d.id, prices: { price: d.prices?.price, currency_minor_unit: d.prices?.currency_minor_unit, price_range: d.prices?.price_range ?? null }, is_in_stock: d.is_in_stock }),
  },
  shopify: {
    groesse: 250,
    url: (base, seite) => `${base}/products.json?limit=250&page=${seite}`,
    liste: (j) => j?.products,
    kuerzen: (d) => ({ handle: d.handle, variants: (d.variants ?? []).map((v) => ({ id: v.id, price: v.price, available: v.available })) }),
  },
};

const typVon = (r) => (r.headers.get('content-type') ?? '').split(/[;,]/)[0].trim().toLowerCase();

/** Alle Produkte eines Shops ({ shop, art, base } aus der Antwort von /api/stand), gekürzt; wirft mit dem Grund */
export async function shopLesen(s, { abruf = fetch, pause = warte } = {}) {
  const a = ARTEN[s.art];
  if (!a) throw new Error(`unbekannte Art ${s.art}`);
  const alle = [];
  for (let seite = 1; seite <= 40; seite++) {
    let r;
    try {
      r = await abruf(a.url(s.base, seite), { headers: { 'User-Agent': KENNUNG }, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      throw new Error(e?.name === 'TimeoutError' ? 'Zeitlimit' : 'Abruf gescheitert');
    }
    // Hinter einer genau vollen letzten Seite antwortet die Store API mit 400
    if (r.status === 400 && seite > 1 && s.art === 'woo') break;
    // Gleicher Wortlaut wie in functions/api/preise.js ("HTTP 202 text/html" ist die Captcha-Seite eines Bot-Schutzes)
    if (!r.ok || !/json/.test(typVon(r))) throw new Error(`HTTP ${r.status} ${typVon(r) || 'ohne Typ'}`);
    const liste = a.liste(await r.json());
    if (!Array.isArray(liste)) throw new Error('Antwort ohne Produktliste');
    if (seite === 1 && !liste.length) throw new Error('leere Produktliste');
    alle.push(...liste.map(a.kuerzen));
    if (liste.length < a.groesse) break;
    // Pausen wie im Datenlauf (WooCommerce 800 ms, Shopify 700 ms)
    await pause(s.art === 'woo' ? 800 : 700);
  }
  return alle;
}

/** OIDC-Ausweis von GitHub Actions für die Function (Empfänger ist ihre Adresse) */
export async function ausweis(env = process.env, abruf = fetch) {
  if (!env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) throw new Error('kein OIDC (permissions: id-token: write fehlt)');
  const r = await abruf(`${env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${encodeURIComponent(ZIEL)}`, { headers: { Authorization: `bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } });
  if (!r.ok) throw new Error(`OIDC HTTP ${r.status}`);
  const { value } = await r.json();
  if (!value) throw new Error('OIDC ohne Ausweis');
  return value;
}

/** Ein Lauf: fällige Shops holen, lesen, abliefern. Ergebnis: Zeilen für das Protokoll */
export async function laufen({ abruf = fetch, env = process.env, pause = warte } = {}) {
  const protokoll = [];
  const plan = await abruf(ZIEL, { headers: { Authorization: `Bearer ${await ausweis(env, abruf)}`, Accept: 'application/json' } });
  if (!plan.ok) throw new Error(`${ZIEL}: HTTP ${plan.status} ${await plan.text().catch(() => '')}`.trim());
  const { shops = [] } = await plan.json();
  const faellig = shops.filter((s) => s.faellig);
  for (const s of shops) protokoll.push(`${s.shop}: ${s.faellig ? 'fällig' : 'nicht fällig'}, Intervall ${s.intervall ?? 15} min, letzter Erfolg ${s.letzter_erfolg ?? 'noch keiner'}${s.fehler ? `, ${s.fehler} Fehler in Folge (${s.grund})` : ''}`);
  if (!faellig.length) return [...protokoll, shops.length ? 'nichts fällig' : 'kein Shop im Stand-Modus'];
  const ergebnisse = [];
  for (const s of faellig) {
    try {
      const liste = await shopLesen(s, { abruf, pause });
      ergebnisse.push({ shop: s.shop, ok: true, liste });
    } catch (e) {
      ergebnisse.push({ shop: s.shop, ok: false, grund: e.message });
    }
  }
  // Frischer Ausweis: der erste kann nach langen Abrufen abgelaufen sein
  const r = await abruf(ZIEL, { method: 'POST', headers: { Authorization: `Bearer ${await ausweis(env, abruf)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ergebnisse }) });
  if (!r.ok) throw new Error(`${ZIEL} POST: HTTP ${r.status} ${await r.text().catch(() => '')}`.trim());
  const { gespeichert = [], ignoriert = [] } = await r.json();
  for (const g of gespeichert) protokoll.push(g.ok ? `${g.shop}: ${g.anzahl} Produkte gespeichert, nächstes Intervall ${g.intervall} min` : `${g.shop}: gescheitert (${g.grund}), nächstes Intervall ${g.intervall} min`);
  for (const i of ignoriert) protokoll.push(`${i}: nicht mehr im Stand-Modus, ignoriert`);
  return protokoll;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  try {
    console.log((await laufen()).join('\n'));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
