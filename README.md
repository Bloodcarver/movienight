# 🎬 Filmkväll

Hjälper gänget att komma överens om en film från ert Jellyfin-bibliotek.

1. Någon skapar ett rum och visar QR-koden.
2. Alla går med och väljer 3–5 favoritfilmer (vilka som helst, från TMDB) och genrer.
3. Servern tar fram ~25 filmer **ur ert Jellyfin-bibliotek** som liknar allas favoriter och passar valda genrer.
4. Alla swipar höger (ja) eller vänster (nej).
5. Filmen flest gillat vinner.

En enda container: nginx (webbsida, hemlig sökväg, QR-sida, affischer) + PocketBase med SQLite (rum, swipes, förslag).

## 1. Lägg koden på GitHub

1. Skapa ett nytt repo på github.com, t.ex. `movienight` (kan vara privat).
2. Pusha den här mappen dit.
3. Under **Actions** i repot byggs imagen automatiskt (tar några minuter). Den hamnar på
   `ghcr.io/bloodcarver/movienight:latest`.
4. Gör imagen publik så att Unraid kan hämta den utan inloggning:
   din profil → **Packages** → `movienight` → **Package settings** → *Change visibility* → **Public**.
   (Koden i repot kan fortfarande vara privat.)

## 2. Installera på Unraid

Hämta mallen till Unraid (repot måste vara publikt för den här raden – annars kopiera filen `unraid/movienight.xml` dit manuellt):

```bash
wget -O /boot/config/plugins/dockerMan/templates-user/my-Movienight.xml https://raw.githubusercontent.com/Bloodcarver/movienight/main/unraid/movienight.xml
```

Sedan i Unraid: **Docker → Add Container → Template:** välj **Movienight** under *User templates*. Fyll i:

- **Jellyfin URL** – t.ex. `http://192.168.0.114:8096`
- **Jellyfin API-nyckel** – Jellyfin → Kontrollpanelen → API-nycklar → **+**
- **TMDB API-nyckel** – gratis på themoviedb.org → Inställningar → API
- **Admin e-post / lösenord** – för PocketBase adminpanel

Tryck **Apply**.

Utan mall går det också att fylla i **Add Container** för hand: Repository `ghcr.io/bloodcarver/movienight:latest`, port 8095 → 80, port 8091 → 8090, sökväg `/mnt/user/appdata/movienight` → `/data`, samt variablerna i tabellen längre ner.

## 3. Hitta den hemliga adressen

Docker-fliken → klicka på Movienight-ikonen → **Logs**. Där står:

```
Filmkväll: appen finns på  /AbC123.../
```

Öppna `http://192.168.0.114:8095/` hemifrån – där visas QR-koden direkt (WebUI-knappen i Unraid går också dit).

## 4. Nginx Proxy Manager (för att nå appen utifrån)

Lägg till en **Proxy Host**:

- Domain: `film.dindomän.se`
- Scheme `http`, Forward Hostname/IP `192.168.0.114`, Port `8095`
- SSL: *Request a new SSL Certificate* + *Force SSL*

Öppna **inte** adminporten (8091) i routern.

### Kontrollera att QR-sidan inte syns utifrån

1. Hemma på wifi: `https://film.dindomän.se/` → QR-kod. Längst ner står vilken adress du uppfattas som (ska vara `192.168.0.x`).
2. På mobilen med wifi avstängt (4G): `https://film.dindomän.se/` → **404**.
3. På 4G: `https://film.dindomän.se/<hemlighet>/` → appen.

Om steg 2 visar QR-koden: Betrodda proxyer saknar NPM:s adress. I loggen visar varje rad `klientadress (från avsändare)` – lägg till avsändaren i **Betrodda proxyer** och starta om.

Om steg 1 ger 404 hemma via domänen: routern skickar trafiken via den publika adressen. Använd då `http://192.168.0.14:8095/` hemma för QR-sidan.

## Uppdatera

Pusha ändringar till GitHub → vänta tills Actions är klar → Unraid Docker-fliken → **Check for updates** → **Update**.

## Byta hemlig adress

Ta bort `/mnt/user/appdata/movienight/secret/secret.txt` (eller fyll i *Egen hemlig sökväg*) och starta om containern. Gamla QR-koder slutar då fungera.

## Inställningar

| Variabel | Standard | Betydelse |
|---|---|---|
| `PUBLIC_URL` | tom | Adressen utifrån, t.ex. `https://movienight.omniware.se`. QR-koderna pekar hit |
| `JELLYFIN_URL` / `JELLYFIN_API_KEY` | – | Jellyfin |
| `JELLYFIN_USER_ID` | tom | Behövs bara om filmlistan blir tom/ger fel |
| `TMDB_API_KEY` | tom | Tom = inget favoritsteg, förslag bara utifrån genrer |
| `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD` | tom | Admin till PocketBase (`http://192.168.0.114:8091/_/`) |
| `QR_ALLOWED_NETWORK` | 192.168.0.0/24 | Vilka som ser QR-sidan på `/` |
| `TRUSTED_PROXY` | 172.16.0.0/12 | Vems `X-Forwarded-For` vi litar på (lägg till NPM:s IP) |
| `ROOM_TTL_HOURS` | 24 | Rum raderas efter så här många timmar |
| `CANDIDATE_COUNT` | 25 | Antal filmer att swipa på |
| `GENRE_WEIGHT` | 1 | Hur mycket genrer styr jämfört med favoriter (2 = mer genre, 0.5 = mer favoriter) |
| `TMDB_SYNC_BATCH` | 40 | Hur många filmer per minut som får genrer och svensk beskrivning från TMDB i bakgrunden |
| `APP_SECRET` | tom | Egen hemlig sökväg (annars slumpad) |

## Felsökning

- **"Kunde inte hämta filmer från Jellyfin"** – kolla Jellyfin URL (ska nås från containern, inte `localhost`) och API-nyckeln. Prova att fylla i Jellyfin användar-id. Se loggen.
- **Inga affischer** – samma sak, nginx hämtar dem från Jellyfin URL.
- **Säkerhetskopia** – kopiera `/mnt/user/appdata/movienight`. Allt finns där.

## Köra med docker compose i stället

```bash
cp .env.example .env && nano .env
docker compose up -d --build
```
