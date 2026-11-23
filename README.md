# Catatan Narik

Catatan pendapatan untuk driver: untung bersih per hari, jam ramai, area jemput terbaik, peta titik jemput (GPS), dan cek rute dengan kemacetan lewat TomTom.

## Cara kerja

- `public/index.html` adalah aplikasinya. Catatan disimpan di browser HP (localStorage). Ada tombol unduh dan pulihkan cadangan.
- `src/worker.js` adalah Cloudflare Worker. Tugasnya menyimpan API key TomTom di server dan meneruskan permintaan rute, cari alamat, dan nama area. Semua `/api/*` dijaga kata sandi (`APP_PIN`).
- Peta memakai OpenStreetMap lewat Leaflet. Cari alamat dan nama area memakai Nominatim (OpenStreetMap). Rute dan kemacetan memakai TomTom Routing API.

## Deploy ke Cloudflare

1. Buat akun gratis di https://developer.tomtom.com dan buat API key (tanpa kartu kredit).
2. Di Cloudflare Dashboard buka Workers & Pages, pilih Create, lalu Import a repository dan pilih repo ini. Biarkan build command kosong dan deploy command `npx wrangler deploy`.
3. Setelah worker terbuat, buka Settings, lalu Variables and Secrets, dan tambahkan dua secret:
   - `TOMTOM_KEY`: API key dari TomTom
   - `APP_PIN`: kata sandi buatanmu sendiri, sebaiknya 12 karakter atau lebih
4. Buka alamat worker di HP, buka bagian Pengaturan di bawah, isi kata sandi yang sama dengan `APP_PIN`, lalu tekan Simpan.

Jangan menaruh API key di kode atau di chat. Simpan hanya sebagai secret di Cloudflare.

## Catatan

- GPS hanya bekerja lewat HTTPS dan saat halaman terbuka. Alamat `*.workers.dev` sudah HTTPS.
- Mode motor TomTom belum dipastikan tersedia untuk Indonesia. Kalau ditolak, Worker otomatis menghitung untuk mobil dan aplikasi memberi tahu.
- Estimasi "per jam" di cek rute hanya menghitung waktu di jalan, bukan waktu menunggu atau menjemput.
- Tile OpenStreetMap dan Nominatim hanya untuk pemakaian ringan. Jangan dipakai untuk banyak pengguna.
