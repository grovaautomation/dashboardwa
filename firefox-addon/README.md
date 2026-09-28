# Add-on Firefox

1. Buka `about:debugging#/runtime/this-firefox` di Firefox.
2. Klik **Load Temporary Add-on** dan pilih `manifest.json` dari folder ini.
3. Buka pengaturan add-on, lalu salin token dari menu **Firefox Containers** di aplikasi.

Paket hasil build tersedia sebagai `release/dashboard-draft-wa-firefox.xpi`. Firefox publik mewajibkan add-on ditandatangani Mozilla untuk instalasi permanen; selama pengembangan, muat sementara melalui `about:debugging` seperti langkah di atas.

Add-on menggunakan background persisten Manifest V2 agar koneksi loopback ke aplikasi tetap hidup. Saat Firefox atau aplikasi baru dibuka, add-on mencoba tersambung langsung lalu mengulang dengan jeda 250 ms, 500 ms, 1 detik, dan maksimal 2 detik. Izin dibatasi untuk container, tab, penyimpanan token lokal, dan URL WhatsApp Web. Setiap perintah memakai kembali tab WhatsApp Web yang sudah terbuka pada container tujuan, mencari nomor melalui antarmuka WhatsApp, lalu mengisi template tanpa mengganti URL atau memuat ulang halaman. Add-on tidak membuat tab baru dan tidak menekan tombol Kirim.
