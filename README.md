# Lobi 🎮

**Arkadaşlarınla oyna: lobi kur, kodu paylaş, kapış.** Lobi; XOX'tan Spektrum
Çarkı'na 8 klasik oyunu tarayıcıdan tarayıcıya, hesapsız-kayıtsız oynatan bir
oyun sitesi. Bir lobiye 16 kişiye kadar katılabilir — host içeri girenler
arasından kimin oynayıp kimin izleyeceğini ve hangi oyunun oynanacağını
lobinin içinden seçer; oyun bitmeden de değiştirebilir. Takma adını yaz, 4
harflik lobi kodunu arkadaşlarına gönder, oyun başlasın. Lobide, oyun boyunca
açık kalan bir sohbet paneli de var.

| Oyun | Kaç kişi | Kısaca |
| --- | --- | --- |
| XOX | 2 | Üç işareti ilk hizalayan kazanır |
| Dört Taş | 2 | Dört taşı yan yana ilk getiren kazanır |
| Taş-Kağıt-Makas | 2 | Üç el kazanan maçı alır |
| Amiral Battı | 2 | Rakip filoyu bul ve batır, isabet ettiren yeniden atar |
| Noktalar & Kutular | 2 | Çizgiyi çek, kutuyu kap — kapatan bir tur daha oynar |
| Adam Asmaca | 2 | Altı yanlıştan önce kelimeyi bul |
| Sayı Tahmini | 2-16 | 0-100 arası gizli sayıyı ilk bilen kazanır |
| Spektrum Çarkı | 2-16 | Tek kelimelik ipucuyla takımı gizli noktaya yönlendir |

## Nasıl çalışır?

```
 Oyuncu A                    Cloudflare                     Oyuncu B
 tarayıcı                  LobbyRoom (DO)                   tarayıcı
    │                            │                             │
    │── lobi kur ───────────────▶│  kod: "KYTV"                │
    │                            │◀───────────── katıl "KYTV" ─│
    │◀── start {seed, sıra} ────│──── start {seed, sıra} ────▶│
    │                            │                             │
    │── hamle ──────────────────▶│───────────────── hamle ───▶│
    │◀── hamle ─────────────────│◀───────────────── hamle ────│
```

Basitlik için iki kişi çizildi; oda aslında 16 üyeye kadar aynı `LobbyRoom`'a
bağlanır (roster'a katılır), host kimin "oynayan" kimin "izleyen" olduğunu ve
hangi oyunun oynanacağını odanın içinden seçer, sonra maçı başlatır — lobi
kurulurken henüz hiçbir oyun seçilmiş olmaz. Sunucu oyun kurallarını **bilmez**:
`LobbyRoom` (bir Cloudflare Durable Object) sadece roster'ı ve host'un seçimini
eşitler, hamle mesajlarını oynayanlar arasında karşıya aktarır. Oyunun kendisi
her tarayıcıda aynı **saf, deterministik reducer** ile koşar (lockstep): aynı
seed + aynı hamle akışı = her zaman aynı durum. Rastgele olan her şey (gemi
yerleşimi, asmaca kelimesi, ilk sıra) odanın ortak seed'inden türetilir.
Sohbet mesajları da aynı DO üzerinden herkese anlık olarak akar ama oyun
durumunun bir parçası değildir — hiçbir yerde saklanmaz. Veritabanı yok, hesap
yok, kalıcı veri yok.

## Kurulum

```sh
cd apps/web
bun install
bun dev        # http://localhost:3000
```

Bu kadar. Dış hesap, veritabanı, docker — hiçbiri gerekmiyor.

## Komutlar

| Komut | Ne yapar |
| --- | --- |
| `bun dev` | Geliştirme sunucusu (port 3000) |
| `bun t` | Tip kontrolü (`tsc --noEmit`) |
| `bun check` | Biome lint + format |
| `bun test` | Birim testleri (oyun kuralları, protokol) |
| `bun run build` | Production build + tip kontrolü |
| `bun run deploy` | Build + `wrangler deploy` (Cloudflare hesabı ister) |

## Deploy & CI/CD

- **`ci.yml`** — her PR'da tip kontrolü + lint + test; hiçbir secret istemez,
  repo GitHub'a itildiği an çalışır.
- **`preview.yml`** — her PR'a `lobi-pr-N` adında önizleme worker'ı.
- **`deploy-prod.yml`** — main'e merge'de production deploy.

Deploy workflow'larının tek ihtiyacı bir `CLOUDFLARE_API_TOKEN` repo secret'ı;
adım adım bağlama rehberi [ci/README.md](ci/README.md)'de. Elle deploy için
`bun run deploy` yeter.

## Yeni oyun nasıl eklenir?

Mimari oyun sayısından bağımsız — beşinci adımda site oyunu kendiliğinden
tanır:

1. `src/features/play-<oyun>/model/rules.ts` — saf bir `GameDef` yaz:
   `init(seed, playerCount, settings?)`, `applyMove(durum, hamle, oyuncu)`,
   `status(durum)`, `turn(durum)`, `playerLabel(index)`. React yok, soket yok,
   `Math.random()` yok. `meta.minPlayers`/`maxPlayers` iki taraflı sabit
   olabilir (klasik iki kişilik oyun) ya da bir aralık (`2-16` gibi) — lobi
   "oynayan" işaretli herkesi buna göre koltuklara oturtur. Oyunun host'un
   maç öncesi ekranından ayarlayabileceği sayısal bir seçeneği varsa (ör.
   Spektrum Çarkı'nın tahmin süresi), `meta.settings`'e bir
   `GameSettingField` ekle — geri kalan oyunlar bu 3. argümanı hiç görmez.
2. Önce `model/rules.test.ts`: kazanma/beraberlik matrisi, geçersiz hamlelerin
   reddi, seed determinizmi.
3. `ui/board.tsx` — `BoardProps` alan sunumsal tahta: durumu çiz, `onMove`
   çağır, `canMove` kapalıyken kendini kilitle.
4. `index.ts`'ten `GameDef`'i ve tahta bileşenini export et.
5. `src/routes/-catalog.ts`'e kaydet. Ana sayfa vitrini, lobinin içindeki oyun
   seçici ve relay otomatik tanır — başka hiçbir dosyaya dokunulmaz; oyunun
   kendi route'u yok, host'un lobi içinden seçtiği bir seçenek olarak belirir.

## Mimari

Feature-Sliced Design (FSD v2.1): `routes → widgets | features | entities →
shared`, importlar sadece yukarıdan aşağı; her slice `index.ts` public API'si
verir; sunucu tarafı (`LobbyRoom`) Biome kuralıyla makine zoruyla izole.
Dosya-içi bildirim sırası, `// ──` bölüm ayraçları ve adlandırma dahil tüm
mühendislik sözleşmesi: [apps/web/AGENTS.md](apps/web/AGENTS.md). Tasarım
kararlarının kaydı: [docs/superpowers/specs/](docs/superpowers/specs/).
