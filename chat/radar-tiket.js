// ==========================================================================
// FILE: chat/radar-tiket.js
// FUNGSI: Mesin Radar & Auto-Routing ke Inbox (Tanpa Pop-up)
// ARSITEKTUR: Background Microservice & Zero-Latency Routing
// ==========================================================================

import { dbChat } from './config-chat.js';
import { ref, onChildAdded, remove, update } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

let referensiRadar = null;
let uidDriverAktif = null;

// =======================================================================
// ⚙️ KONFIGURASI NADA DERING (SILAKAN ISI LINK CLOUDINARY ANDA)
// =======================================================================
const RINGTONE_RADAR = "MASUKKAN_LINK_AUDIO_CLOUDINARY_ANDA_DISINI.mp3"; 

// Engine Audio Sonar (Alarm Order Masuk)
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
    
    referensiRadar = ref(dbChat, `radar_tiket/${uid}`);
    
    // Memantau secara konstan aliran data tiket masuk dari Klien
    onChildAdded(referensiRadar, async (snapshot) => {
        const tiket = snapshot.val();
        const idTiket = snapshot.key; 
        
        // Pelindung Anti-Spam: Buang tiket secara otomatis jika usianya > 5 menit
        if (Date.now() - tiket.waktu_dibuat > 300000) {
            remove(ref(dbChat, `radar_tiket/${uidDriverAktif}/${idTiket}`));
            return;
        }

        // 1. Peringatan Audio & Visual Halus (Tanpa memblokir layar)
        bunyikanSonarTiket();
        const indikatorKedip = document.getElementById('chat-notif-dot');
        if (indikatorKedip) indikatorKedip.classList.remove('hidden-state');

        // 2. AUTO-ACCEPT & ROUTING MUTLAK KE INBOX
        try {
            // Memberi sinyal ACCEPTED agar Klien diizinkan masuk ke ruang obrolan dan mengirim Katalog
            await update(ref(dbChat, `radar_tiket/${uidDriverAktif}/${idTiket}`), { status: 'ACCEPTED' });
            
            // Protokol Consume & Destroy: Beri waktu Klien membaca status, lalu musnahkan tiket dari radar
            setTimeout(() => { 
                remove(ref(dbChat, `radar_tiket/${uidDriverAktif}/${idTiket}`)); 
            }, 1500);
            
            // Tampilkan informasi singkat di layar bahwa ada data masuk ke Inbox
            if(window.showToast) window.showToast("Pesanan Baru Masuk ke Kotak Pesan!", "success");
            
        } catch (err) {
            console.error("[RADAR ENGINE] Gagal memproses auto-routing tiket:", err);
        }
    });
}

export function matikanRadar() {
    // Memutuskan koneksi radar saat Driver offline/mangkal dihentikan
    uidDriverAktif = null;
}
