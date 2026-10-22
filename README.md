# Fuvar Figyelő

Egyszerű fuvarkövető webapp telematika nélküli, kézi követéshez. A friss Excel-listát az appba töltöd fel,
az app felismeri a formátumát, megmutatja a változásokat, és push értesítést küld arról, mikor nézz rá
újra egy autóra, illetve mely autókat figyeld ma és holnap.

- **App:** <https://gergokun-create.github.io/fuvar-figyelo/> (statikus PWA, telepíthető a kezdőképernyőre)
- **Adat + ütemező:** a `fuvar-figyelo-data` **privát** repó
- Időzóna: Europe/Budapest, a nyári/téli időszámítás váltását is kezeli.

## Hogyan működik

```
 telefon / gép                         GitHub
┌──────────────┐  Contents API    ┌──────────────────────────────┐
│ PWA (Pages)  │ ───────────────▶ │ fuvar-figyelo-data (PRIVÁT)  │
│ fuvar-figyelo│  token (csak     │  data/fuvarok.json   ← app   │
│ (nyilvános,  │  erre a repóra)  │  data/formatumok.json← app   │
│  adat nélkül)│                  │  data/beallitasok.json← app  │
└──────────────┘                  │  state/elkuldve.json ← ütem. │
        ▲                         │  Actions: utemezo.yml (cron) │
        │ push (ntfy / Telegram)  └──────────────┬───────────────┘
        └────────────────────────────────────────┘
```

- A feltöltött Excel-fájlt **nem tároljuk**, csak a feldolgozott adatot.
- Az app sha-val ír; ha közben más is írt (409), újraolvas, a módosítást újra alkalmazza, és újraír.
- Az ütemező minden értesítést küldés előtt lefoglal, így semmi nem megy ki kétszer; a kimaradt futások
  esedékes elemeit a következő futás pótolja. A naplóba nem ír fuvaradatot.

---

## Beállítás lépésről lépésre

> Ha a `gh` CLI-vel be vagy jelentkezve, az 1–2. lépést (repók, Pages, kód feltöltése) a Claude már elvégezte.
> A 3–6. lépést (token, secretek, ntfy) neked kell megcsinálnod.

### 1. A repók létrehozása

1. <https://github.com/new> → név: `fuvar-figyelo`, **Public** (csak az app kódja, adat nincs benne). Töltsd fel ennek a
   mappának a tartalmát.
2. <https://github.com/new> → név: `fuvar-figyelo-data`, **Private**. Töltsd fel a `fuvar-figyelo-data` mappa tartalmát
   (README + `.github/workflows/utemezo.yml`).

> GitHub Pro-val egyetlen privát repó is elég lenne (Pages privát repóból), de ingyenes fiókkal a Pages csak nyilvános
> repóból megy – ezért van két repó.

### 2. A Pages bekapcsolása

`fuvar-figyelo` repó → **Settings → Pages** → *Build and deployment*: Source = **Deploy from a branch**,
Branch = **main**, mappa = **/ (root)** → Save. Pár perc múlva elérhető: `https://<felhasználónév>.github.io/fuvar-figyelo/`.

### 3. A token elkészítése (fine-grained, csak az adat-repóra)

1. GitHub → jobb felső avatar → **Settings → Developer settings → Personal access tokens → Fine-grained tokens →
   Generate new token**.
2. *Token name*: `fuvar-figyelo`, *Expiration*: pl. 1 év (lejárat előtt a GitHub e-mailben szól).
3. *Repository access*: **Only select repositories** → `fuvar-figyelo-data`.
4. *Permissions → Repository permissions*:
   - **Contents: Read and write** (adatok olvasása/írása)
   - **Actions: Read and write** (csak a „Teszt push küldése” gombhoz kell)
   - (a *Metadata: Read-only* automatikusan bekerül)
5. **Generate token**, másold ki (`github_pat_…`).
6. Nyisd meg az appot → **Beállítások** → tulajdonos: a GitHub-felhasználóneved, repó: `fuvar-figyelo-data`,
   token: a kimásolt érték → **Mentés és kapcsolódás**. Az app ellenőrzi, hogy a repó tényleg privát-e.

A token csak az adott böngésző `localStorage`-ában tárolódik; minden eszközön (telefon, gép) egyszer meg kell adni.
Ha egy eszköz elveszik: a GitHubon töröld a tokent, és csinálj újat.

### 4. ntfy topic és secret

1. Találj ki egy **hosszú, véletlenszerű** topicnevet – aki ismeri, olvashatja az értesítéseidet. Például PowerShellben:
   ```powershell
   "fuvar-" + [guid]::NewGuid().ToString("N")
   ```
2. `fuvar-figyelo-data` → **Settings → Secrets and variables → Actions → New repository secret**:
   név `NTFY_TOPIC`, érték a topicnév.

### 5. Az ntfy app telepítése és feliratkozás

1. Telepítsd az **ntfy** appot: Android – Google Play / F-Droid, iPhone – App Store („ntfy”).
2. Az appban **+ (Subscribe to topic)** → írd be ugyanazt a topicnevet → szerver: `ntfy.sh` (alapértelmezett) → Subscribe.
3. Androidon érdemes az ntfy-nál kikapcsolni az akkumulátor-optimalizálást, hogy késés nélkül jöjjenek az értesítések.
4. A Fuvar Figyelő **Beállítások → 🔔 Teszt push küldése** gombjával próbáld ki (1–2 perc, amíg az Actions elindul).

> Az ntfy.sh nyilvános szolgáltatás: az értesítés szövege (rendszám, megbízó, jegyzet) átmegy rajta. Ha ez nem fér bele,
> használd a Telegramot, vagy saját ntfy-szervert (`NTFY_SERVER` secret).

### 6. (Opcionális) Telegram bot második értesítőként

1. Telegramban írj a **@BotFather**-nek: `/newbot` → kapsz egy tokent → secret: `TELEGRAM_BOT_TOKEN`.
2. Írj egy üzenetet az új botodnak, majd nyisd meg: `https://api.telegram.org/bot<TOKEN>/getUpdates` – a
   `"chat":{"id": …}` szám a chat-azonosító → secret: `TELEGRAM_CHAT_ID`.
3. Ha mindkét értesítő be van állítva, mindkettőre kimegy az üzenet.

### 7. Telepítés a kezdőképernyőre

- Android / Chrome: menü → **Telepítés** / **Hozzáadás a kezdőképernyőhöz**.
- iPhone / Safari: Megosztás → **Főképernyőhöz adás**.

---

## Használat

**Feltöltés:** fájl (.xlsx, .xls, .csv) behúzással vagy kiválasztással, illetve Excelből másolt cellák beillesztése.
Több munkalapnál az app a legvalószínűbbet ajánlja. Új formátumnál megmutatja a felismert oszlopokat (legördülő menüvel
javítható), és elmenti egy „formátum-ujjlenyomathoz” kötve – legközelebb ugyanilyen fejlécű fájlnál kérdés nélkül alkalmazza.

**Előnézet:** új / változott (a változott mezők kiemelve) / újra megjelent / kikerülő / hibás sorok. Két mód:
- **Teljes lista** (alapértelmezés): ami nincs a fájlban, archívumba kerül, a függő emlékeztetői megszűnnek.
- **Csak hozzáadás/frissítés**: semmi nem kerül archívumba.

A fuvar azonosítója a megbízásszám, ha van; ha nincs, akkor a normalizált rendszám (első/vontató rendszám) + megbízó +
felrakás dátuma. A jegyzeteidet, státuszt, ránézéseket és a naplót a feltöltés soha nem írja felül.

**Napok:** Lejárt, de nincs lerakva / Ma / Holnap / későbbi napok, keresés és szűrés fuvarozóra, megbízóra, státuszra.

**Fuvar:** státusz (Tervezett / Úton / Lerakva / Probléma), ránézés gyorsgombokkal (+1, +2, +4 óra, holnap 8:00) vagy
egyedi időponttal, jegyzet, időrendi napló. Lerakott vagy archivált fuvarhoz nem megy ki emlékeztető.

**Értesítések:** a ránézések a beállított időben; reggel 7:30-kor összesítő a mai lerakókról; 17:00-kor a holnapiakról
(szombaton vasárnap + hétfő). Az időpontok a Beállításoknál módosíthatók.

## Ütemezés és Actions-percek

A GitHub cron UTC-ben fut, ezért úgy választottam, hogy nyári és téli időben is lefedje a helyi 5–21 órát;
a szkript Budapest helyi ideje szerint dönt.

| Cron (UTC) | Futás/nap | Helyi idő nyáron (UTC+2) | Helyi idő télen (UTC+1) |
|---|---|---|---|
| `0,15,30,45 5-16 * * 1-6` | 48 | 7:00–18:45, 15 percenként | 6:00–17:45, 15 percenként |
| `0 3,4,17,18,19,20 * * 1-6` | 6 | 5, 6, 19, 20, 21, 22 óra | 4, 5, 18, 19, 20, 21 óra |

**Számítás:** minden futás kb. 10–20 másodperc, de a GitHub percre felfelé kerekít → 1 perc/futás.
54 futás × átlag 26 munkanap (hétfő–szombat) ≈ **1404 perc/hó**; a legrosszabb hónapban (27 nap) **1458 perc** –
a 2000 ingyenes percből bő 500 perc tartalék marad (teszt pushokra és egyéb privát workflow-kra). A nyilvános
`fuvar-figyelo` repó tesztjei nem fogyasztanak percet.

Ha végig 15 percenként futna 5–21 óra között (DST miatt 3–20 UTC), az napi 72 futás ≈ 1870 perc/hó lenne – ez már
túl közel a kerethez, ezért a reggeli/esti széleken óránként fut.

**Fontos:** a GitHub ütemezett futásai csúcsidőben **5–15 percet késhetnek**, ritkán egy-egy futás ki is maradhat.
Ezért egy 14:00-ra állított ránézés jellemzően 14:00 és 14:30 között érkezik. Vasárnap nincs futás; a vasárnapra
állított ránézések hétfő reggel mennek ki.

## Fejlesztés

```bash
npm install
```

```bash
npm test
```

```bash
npm run serve
```

- `npm run samples` – a minta-fájlok újragenerálása (`samples/`): eltérő fejlécnevek és oszlopsorrend, címsor a fejléc
  fölött, kétsoros egyesített fejléc, Excel sorszám-dátumok és szöveges dátumok, újrafeltöltés változásokkal és kikerült
  fuvarokkal, Windows-1250 CSV a nyári/téli váltás körüli időpontokkal, beillesztett (tabulátoros) szöveg.
- Az ütemező helyben: `GITHUB_REPOSITORY=tulaj/fuvar-figyelo-data GITHUB_TOKEN=… NTFY_TOPIC=… node scheduler/run.mjs`

| Modul | Feladat |
|---|---|
| `js/core/detect.js` | fejlécsor keresése, oszlopfelismerés (szinonimák + tartalom), ujjlenyomat |
| `js/core/tabular.js` | CSV/TSV, kódolás, Excel munkalapok, egyesített cellák |
| `js/core/dates.js`, `tz.js` | dátum/idő/idősáv értelmezés, Budapest időzóna |
| `js/core/records.js` | sorok → fuvarok, hibás / üres / összesítő sorok |
| `js/core/sync.js` | diff és alkalmazás, archiválás, feléledés |
| `js/core/schedule.js` | esedékes emlékeztetők és összesítők |
| `js/core/github.js` | Contents API, sha, 409-kezelés |
| `scheduler/` | Actions-futtató, ntfy és Telegram értesítő |

Az Excel-olvasás a SheetJS rögzített verziójával történik a hivatalos CDN-ről:
`https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs`.
