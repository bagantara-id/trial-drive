// ==========================================================================
// FILE: chat/radar-tiket.js
// FUNGSI: Mesin Radar Anti-Spam & Negosiasi Tiket Klien
// ==========================================================================

import { dbChat } from './config-chat.js';
import { ref, onChildAdded, onChildRemoved, remove, update } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

let antrianTiket = [];
let referensiRadar = null;
let uidDriverAktif = null;

// =======================================================================
// ⚙️ KONFIGURASI NADA DERING (SILAKAN ISI LINK CLOUDINARY ANDA)
// =======================================================================
const RINGTONE_RADAR = "MASUKKAN_LINK_AUDIO_CLOUDINARY_ANDA_DISINI.mp3"; 

// Engine Audio Sonar (Alarm Order)
function bunyikanSonarTiket() {
    try {
        if(RINGTONE_RADAR && RINGTONE_RADAR.startsWith("http")) {
            const audio = new Audio(RINGTONE_RADAR);
            audio.play().catch(e => console.warn("Auto-play audio diblokir peramban"));
        }
    } catch (e) {}
}

export function hidupkanRadar(uid) {
    if (!uid) return;
    uidDriverAktif = uid;
    antrianTiket = [];
    
    referensiRadar = ref(dbChat, `radar_tiket/${uid}`);
    
    onChildAdded(referensiRadar, (snapshot) => {
        const tiket = snapshot.val();
        tiket.id = snapshot.key; 
        
        // Anti-Spam (Diperlonggar): Buang otomatis jika > 5 menit (Mencegah kegagalan akibat jam HP tidak sinkron)
        if (Date.now() - tiket.waktu_dibuat > 300000) {
            buangTiketDariDatabase(tiket.id);
            return;
        }

        antrianTiket.push(tiket);
        bunyikanSonarTiket();
        
        const indikatorKedip = document.getElementById('chat-notif-dot');
        if (indikatorKedip) indikatorKedip.classList.remove('hidden-state');

        // 🔥 PERBAIKAN MUTLAK: Tampilkan pop-up Tawaran Masuk secara OTOMATIS saat tiket mendarat
        if (antrianTiket.length === 1) {
            periksaPintuMasuk();
        }
    });

    onChildRemoved(referensiRadar, (snapshot) => {
        antrianTiket = antrianTiket.filter(t => t.id !== snapshot.key);
        if (antrianTiket.length === 0) {
            const indikatorKedip = document.getElementById('chat-notif-dot');
            if (indikatorKedip) indikatorKedip.classList.add('hidden-state');
            tutupKartuJabatTangan(); 
        } else {
            // 🔥 PERBAIKAN MUTLAK: Tampilkan tiket berikutnya jika tiket sebelumnya ditolak/diterima
            periksaPintuMasuk();
        }
    });
}

export function matikanRadar() {
    uidDriverAktif = null;
    antrianTiket = [];
}

export function periksaPintuMasuk() {
    if (antrianTiket.length === 0) {
        if (window.showToast) window.showToast("Belum ada tawaran masuk dari Klien.", "info");
        return false; 
    }
    tampilkanKartuJabatTangan(antrianTiket[0]);
    return true;
}

function tampilkanKartuJabatTangan(tiket) {
    const panel = document.getElementById('panel-handshake');
    if (!panel) return;

    // Pasok Data ke DOM
    const hargaFormat = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(tiket.harga_tawaran);
    document.getElementById('handshake-info').innerText = `Jarak: ${tiket.jarak_km} KM | Layanan: ${tiket.layanan}`;
    document.getElementById('handshake-price').innerText = hargaFormat;
    
    // Tampilkan Panel
    panel.classList.remove('hidden-state');

    const btnTolak = document.getElementById('btn-tolak-tiket');
    const btnTerima = document.getElementById('btn-terima-tiket');

    // Reset tombol (Mencegah event listener bertumpuk dari tiket sebelumnya)
    btnTerima.innerHTML = 'TERIMA';
    btnTerima.disabled = false;
    btnTolak.disabled = false;

    // Fungsi Handler (Ditugaskan via property onclick untuk pembersihan absolut)
    btnTolak.onclick = () => {
        buangTiketDariDatabase(tiket.id);
        tutupKartuJabatTangan();
    };

    btnTerima.onclick = async () => {
        btnTerima.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        btnTerima.disabled = true;
        btnTolak.disabled = true;
        
        try {
            // 1. Update status agar Klien tahu tawaran diterima
            await update(ref(dbChat, `radar_tiket/${uidDriverAktif}/${tiket.id}`), { status: 'ACCEPTED' });
            
            // 2. PROTOKOL INJEKSI INBOX (Mendaftarkan Klien ke Beranda Chat Anda)
            await update(ref(dbChat, `inbox_mitra/${uidDriverAktif}/${tiket.id}`), {
                nama_klien: tiket.nama_klien || "Klien VIP",
                layanan: tiket.layanan || "ORDER",
                pesan_terakhir: "Tawaran diterima. Menunggu pesan...",
                waktu_dibuat: tiket.waktu_dibuat || Date.now(),
                waktu_update: Date.now()
            });
            
            // 3. PROTOKOL CONSUME & DESTROY (Jeda 1,5s agar status ACCEPTED terbaca Klien, lalu musnahkan Zombie Popup)
            setTimeout(() => { buangTiketDariDatabase(tiket.id); }, 1500);
            
            tutupKartuJabatTangan();
            
            // 4. Beralih ke Beranda Inbox (Bukan memaksa masuk ke ruang Walkie-Talkie)
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.replace('text-theme-gold', 'text-gray-500'));
            const btnPesan = document.querySelector('[data-target="panel-inbox"]');
            if (btnPesan) btnPesan.classList.replace('text-gray-500', 'text-theme-gold');
            
            document.querySelectorAll('.panel-overlay').forEach(p => p.classList.add('hidden-state'));
            const panelInbox = document.getElementById('panel-inbox');
            if (panelInbox) panelInbox.classList.remove('hidden-state');

            if(window.showToast) window.showToast("Klien ditambahkan ke Kotak Masuk", "success");
            
        } catch (err) {
            console.error("Gagal menerima tiket:", err);
            if(window.showToast) window.showToast("Gagal memproses pesanan.", "error");
            btnTerima.innerHTML = 'TERIMA';
            btnTerima.disabled = false;
            btnTolak.disabled = false;
        }
    };
}

function tutupKartuJabatTangan() {
    const panel = document.getElementById('panel-handshake');
    if (panel) panel.classList.add('hidden-state');
}

function buangTiketDariDatabase(idTiket) {
    if (uidDriverAktif && idTiket) {
        remove(ref(dbChat, `radar_tiket/${uidDriverAktif}/${idTiket}`));
    }
}
