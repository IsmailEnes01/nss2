// Spektrum Çarkı's pair pool: 42 opposite-adjective spectrums, both ends
// Turkish. Roughly alphabetical by `low` for easy diffs (not strict Turkish
// collation); rules.ts draws from it deterministically via the room seed.
// Add more pairs freely — nothing else needs to change, the draw just picks
// from however many exist.

export interface SpectrumPair {
  low: string;
  high: string;
}

export const SPECTRUMS: readonly SpectrumPair[] = [
  { low: "Acemi", high: "Uzman" },
  { low: "Ağır", high: "Hafif" },
  { low: "Antik", high: "Modern" },
  { low: "Bağımsız", high: "Bağımlı" },
  { low: "Basit", high: "Karmaşık" },
  { low: "Cesur", high: "Korkak" },
  { low: "Doğal", high: "Yapay" },
  { low: "Eski", high: "Yeni" },
  { low: "Genç", high: "Yaşlı" },
  { low: "Gerçek", high: "Sahte" },
  { low: "Hızlı", high: "Yavaş" },
  { low: "İyimser", high: "Kötümser" },
  { low: "Kalabalık", high: "Tenha" },
  { low: "Kalıcı", high: "Geçici" },
  { low: "Karanlık", high: "Aydınlık" },
  { low: "Kirli", high: "Temiz" },
  { low: "Kısa", high: "Uzun" },
  { low: "Kolay", high: "Zor" },
  { low: "Komik", high: "Ciddi" },
  { low: "Küçük", high: "Büyük" },
  { low: "Lezzetli", high: "Tatsız" },
  { low: "Lüks", high: "Mütevazı" },
  { low: "Nadir", high: "Yaygın" },
  { low: "Nazik", high: "Kaba" },
  { low: "Popüler", high: "Bilinmeyen" },
  { low: "Rahat", high: "Rahatsız" },
  { low: "Sağlam", high: "Kırılgan" },
  { low: "Sağlıklı", high: "Sağlıksız" },
  { low: "Sakin", high: "Heyecanlı" },
  { low: "Sessiz", high: "Gürültülü" },
  { low: "Sıcak", high: "Soğuk" },
  { low: "Sıkıcı", high: "İlginç" },
  { low: "Şanslı", high: "Şanssız" },
  { low: "Şehirli", high: "Köylü" },
  { low: "Tatlı", high: "Ekşi" },
  { low: "Tehlikeli", high: "Güvenli" },
  { low: "Ucuz", high: "Pahalı" },
  { low: "Yakın", high: "Uzak" },
  { low: "Yasal", high: "Yasadışı" },
  { low: "Yerli", high: "Yabancı" },
  { low: "Yumuşak", high: "Sert" },
  { low: "Zayıf", high: "Güçlü" },
];
