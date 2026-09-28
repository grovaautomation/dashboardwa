# Dashboard Draft WA

Aplikasi desktop lokal untuk mengimpor lead Excel, menyiapkan pesan personal, membagi lead ke Firefox Containers, dan membuka satu draft WhatsApp pada satu waktu. Tidak ada pengiriman otomatis dan tidak ada data yang diunggah ke cloud.

## Alur persiapan

Halaman awal menyatukan seluruh konfigurasi sebelum impor: simpan satu template utama, pilih container Firefox yang boleh digunakan, lalu pilih file Excel. Lead valid dapat dibagi merata otomatis atau diberi kuota manual per container. Proyek dan antrean baru dibuat setelah ringkasan pembagian dikonfirmasi.

## Menjalankan untuk pengembangan

```powershell
npm install
npm run dev
```

## Membuat installer Windows

```powershell
npm run dist
```

Installer akan tersedia di folder `release` dan membuat shortcut Desktop serta Start Menu bernama **Dashboard Draft WA**.

## Format Excel

Kolom default yang dikenali: `Business Name`, `Primary WhatsApp`, `WA Exists`, dan `Confidence`. Sheet `Valid Leads` dipilih otomatis bila ada. Nomor lokal Indonesia yang dimulai `0` atau `8` dinormalisasi ke awalan `62`.

## Memasang add-on saat pengembangan

Ikuti petunjuk di [firefox-addon/README.md](firefox-addon/README.md). Add-on memerlukan Firefox Multi-Account Containers atau container identities yang tersedia di Firefox.

## Data lokal

Database dan token koneksi disimpan di direktori data aplikasi Electron milik pengguna. Log tidak mencetak nomor atau isi pesan. Backup proyek dapat diekspor manual sebagai JSON dari aplikasi.
