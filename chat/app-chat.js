// ==========================================================================
// FILE: chat/app-chat.js
// FUNGSI: Mesin Obrolan Real-Time, Modul Cloudinary, & Ekstraktor Forensik
// ==========================================================================

import { dbChat } from './config-chat.js';
import { auth } from '../core/firebase-config.js'; // INJEKSI OTORISASI DRIVER
import { ref, push, onChildAdded, onValue, remove, update, query, limitToLast } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const CLOUDINARY_CLOUD_NAME = "wuw7hvjo"; 
const CLOUDINARY_PRESET = "bagantara-chat"; // Pastikan ini berstatus 'Unsigned' di Cloudinary
const RINGTONE_CHAT = "https://res.cloudinary.com/wuw7hvjo/video/upload/v1791037341/zkcqvkjol2pmtelusdoo.mp3"; 

let idRuangObrolanAktif = null;
let pemantauPesan = null;
let perakamAudio = null;
let potonganAudio = [];
let globalAudioCtx = null; 
let isDOMEventBound = false; // Pengaman Double-Binding
let isInboxListening = false;

// INJEKSI OTAK INBOX & GARBAGE COLLECTOR (3 JAM)
export function inisialisasiInboxChat() {
    if (!auth.currentUser || isInboxListening) return;
    isInboxListening = true;
    
    const referensiInbox = ref(dbChat, `inbox_mitra/${auth.currentUser.uid}`);
    onValue(referensiInbox, (snapshot) => {
        const container = document.getElementById('inbox-list-container');
        const emptyState = document.getElementById('inbox-empty-state');
        const countEl = document.getElementById('inbox-count');
        
        if (!container || !emptyState || !countEl) return;
        
        // Bersihkan kartu lama (kecuali empty state)
        container.querySelectorAll('.inbox-card').forEach(el => el.remove());
        
        if (!snapshot.exists()) {
            emptyState.classList.remove('hidden-state');
            countEl.innerText = '0 Sesi';
            return;
        }
        
        let sesiAktif = 0;
        const waktuSekarang = Date.now();
        
        snapshot.forEach((childSnap) => {
            const tiket = childSnap.val();
            const idTiket = childSnap.key;
            
            // ALGORITMA PEMUSNAHAN OTOMATIS (GARBAGE COLLECTOR 3 JAM)
            if (waktuSekarang - tiket.waktu_dibuat > (3 * 60 * 60 * 1000)) {
                remove(ref(dbChat, `inbox_mitra/${auth.currentUser.uid}/${idTiket}`));
                remove(ref(dbChat, `sesi_komunikasi/${idTiket}`));
                return; // Musnahkan dari server dan lewati proses render
            }
            
            sesiAktif++;
            
            // Render UI Kartu Inbox
            const waktuFormat = new Date(tiket.waktu_update || tiket.waktu_dibuat).toLocaleTimeString('id-ID', {hour: '2-digit', minute:'2-digit'});
            const nama = tiket.nama_klien || "Klien";
            const inisial = nama.substring(0,1).toUpperCase();
            const pesanTerakhir = tiket.pesan_terakhir || "Memulai percakapan...";
            const layananTag = tiket.layanan === 'RIDE' ? 'inbox-tag-ride' : 'inbox-tag-express';
            
            const cardHTML = `
                <div class="inbox-card" data-id="${idTiket}">
                    <div class="inbox-avatar">${inisial}</div>
                    <div class="inbox-content">
                        <div class="inbox-header">
                            <span class="inbox-name">${nama} <span class="inbox-tag ${layananTag} ml-1">${tiket.layanan || 'ORDER'}</span></span>
                            <span class="inbox-time">${waktuFormat}</span>
                        </div>
                        <span class="inbox-preview">${pesanTerakhir}</span>
                    </div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', cardHTML);
        });
        
        if (sesiAktif > 0) emptyState.classList.add('hidden-state');
        else emptyState.classList.remove('hidden-state');
        
        countEl.innerText = `${sesiAktif} Sesi`;
        
        // Tambahkan Listener Klik untuk Buka Ruang Chat
        container.querySelectorAll('.inbox-card').forEach(card => {
            card.addEventListener('click', () => {
                bukaRuangKomunikasi(card.getAttribute('data-id'));
            });
        });
    });
}

// Auto-Mulai Membaca Inbox Saat Login
auth.onAuthStateChanged(user => {
    if(user) inisialisasiInboxChat();
});

// AUTO-SWEEPER (Fallback Cepat saat Buka Ruang Chat Langsung)
function bersihkanSesiKedaluwarsa(idTiketMasuk) {
    try {
        const timestamp = parseInt(idTiketMasuk.split('_')[1]);
        if (Date.now() - timestamp > (3 * 60 * 60 * 1000)) { // Lewat 3 Jam
            if (auth.currentUser) remove(ref(dbChat, `inbox_mitra/${auth.currentUser.uid}/${idTiketMasuk}`));
            remove(ref(dbChat, `sesi_komunikasi/${idTiketMasuk}`));
            return true;
        }
    } catch(e) {}
    return false;
}

function mainkanNotifikasiPesanMasuk() {
    try {
        if(RINGTONE_CHAT && RINGTONE_CHAT.startsWith("http")) {
            const audio = new Audio(RINGTONE_CHAT);
            audio.play().catch(e => {});
        }
    } catch (e) {}
}

async function unggahMediaKeCloudinary(fileBiner, jenisMedia) {
    const formData = new FormData();
    formData.append('file', fileBiner);
    formData.append('upload_preset', CLOUDINARY_PRESET);
    const tipe = jenisMedia === 'audio' ? 'video' : 'image';
    const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${tipe}/upload`;

    try {
        const respon = await fetch(endpoint, { method: 'POST', body: formData });
        const data = await respon.json();
        if (!respon.ok) throw new Error(data.error?.message || "Ditolak Cloudinary");
        return data.secure_url; 
    } catch (error) { throw error; }
}

function dapatkanKunciLokasiForensik() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) resolve("GPS_TIDAK_DIDUKUNG");
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve(`https://www.google.com/maps/search/?api=1&query=${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`),
            (err) => resolve("AKSES_GPS_DITOLAK"),
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 15000 } 
        );
    });
}

async function ekstrakForensikDanKirim(fileGambar, asalTangkapan) {
    if(window.showToast) window.showToast("Mengekstrak Metadata...", "info");
    
    let ipPublik = "Gagal memuat";
    try { const res = await fetch('https://api.ipify.org?format=json'); const d = await res.json(); ipPublik = d.ip; } catch(e){}
    
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const infoJaringan = conn ? `${conn.effectiveType || 'N/A'} (${conn.downlink || 0}Mbps)` : "N/A";
    const ram = navigator.deviceMemory ? `${navigator.deviceMemory}GB+` : "N/A";
    const cpu = navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} Core` : "N/A";
    const lokasiFaktual = await dapatkanKunciLokasiForensik();
    
    let dataExifAsli = null;
    if (asalTangkapan === "Galeri Perangkat") {
        try {
            const exifr = await import('https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/lite.esm.js');
            const exifData = await exifr.default.parse(fileGambar);
            if (exifData) {
                let linkPetaExif = "Tidak tersimpan di gambar";
                if (exifData.latitude && exifData.longitude) linkPetaExif = `https://www.google.com/maps/search/?api=1&query=${exifData.latitude.toFixed(6)},${exifData.longitude.toFixed(6)}`;
                dataExifAsli = {
                    kamera: (exifData.Make || exifData.Model) ? `${exifData.Make || ''} ${exifData.Model || ''}`.trim() : "Tidak diketahui",
                    waktu_diambil: exifData.DateTimeOriginal ? new Date(exifData.DateTimeOriginal).toLocaleString('id-ID') : "Tidak diketahui",
                    lokasi_asli: linkPetaExif
                };
            }
        } catch(e) { console.warn("EXIF gagal diekstrak"); }
    }

    const dataForensik = { sumber: asalTangkapan, ip: ipPublik, jaringan: infoJaringan, ram_cpu: `${ram} / ${cpu}`, lokasi: lokasiFaktual, browser: navigator.userAgent.substring(0, 50) + "..." };
    if (dataExifAsli) dataForensik.exif = dataExifAsli;

    try {
        const urlGambar = await unggahMediaKeCloudinary(fileGambar, 'image');
        kirimPayloadPesan(urlGambar, "gambar", dataForensik);
    } catch (e) {
        if (window.showToast) window.showToast("Gagal Unggah: " + e.message, "error");
    }
}

async function kirimPayloadPesan(kontenPesan, tipePesan = "teks", metadataForensik = null) {
    // Validasi Anti-Double Slash (Mencegah Error: child failed: path argument = "")
    if (!idRuangObrolanAktif || idRuangObrolanAktif.trim() === "" || !kontenPesan) return;
    
    try {
        const referensi = ref(dbChat, `sesi_komunikasi/${idRuangObrolanAktif}/pesan`);
        const payload = { pengirim: "mitra", tipe: tipePesan, konten: kontenPesan, waktu: Date.now() };
        if (metadataForensik) payload.forensik = metadataForensik;
        await push(referensi, payload);

        // UPDATE PREVIEW INBOX KETIKA MITRA MENGIRIM PESAN
        if (auth.currentUser) {
            let previewTeks = tipePesan === 'teks' ? kontenPesan : (tipePesan === 'lokasi' ? '📍 Mengirim Lokasi' : (tipePesan === 'audio' ? '🎤 Pesan Suara' : '📷 Mengirim Gambar'));
            await update(ref(dbChat, `inbox_mitra/${auth.currentUser.uid}/${idRuangObrolanAktif}`), {
                pesan_terakhir: "Anda: " + previewTeks,
                waktu_update: Date.now()
            });
        }
    } catch(err) {
        console.error("Gagal kirim pesan:", err);
    }
}

export function bukaRuangKomunikasi(idTiketMasuk) {
    if (!idTiketMasuk) return;
    // Eksekusi Pembersih Latar Belakang (TTL 3 Jam)
    if (bersihkanSesiKedaluwarsa(idTiketMasuk)) {
        if(window.showToast) window.showToast("Sesi kedaluwarsa (Lebih dari 3 Jam).", "error");
        return;
    }
    
    // Perbaikan Fundamental: Nama Node Database harus persis sama dengan Sisi Penumpang.
    // Penumpang mengirim ke 'sesi_komunikasi/TKT_...' dan BUKAN 'SESI_OPS_...'
    idRuangObrolanAktif = idTiketMasuk; 

    const panelChat = document.getElementById('panel-komunikasi-utama');
    const titleChat = document.getElementById('chat-session-title');
    const bodyChat = document.getElementById('chat-body');
    
    if (panelChat && titleChat && bodyChat) {
        // Tampilkan 12 karakter (seperti TKT_169... )
        titleChat.innerText = `SESI: ${idRuangObrolanAktif.substring(0,12)}`;
        bodyChat.innerHTML = '<div style="text-align:center; font-size:0.65rem; color:#64748b; margin:10px 0;">Sesi Privat & Terenkripsi. Otomatis Dihapus.</div>';
        panelChat.classList.remove('hidden-state');
    }

    pasangSarafInteraksi();
    mulaiDengarPesan();
}

function pasangSarafInteraksi() {
    if (isDOMEventBound) return; // Mencegah listener ganda
    isDOMEventBound = true;

    const wadahChat = document.getElementById('chat-body');
    const btnTutup = document.getElementById('chat-btn-tutup');
    const btnKirim = document.getElementById('chat-btn-send');
    const inputTeks = document.getElementById('chat-teks');
    const btnToggle = document.getElementById('btn-toggle-tools');
    const menuAlat = document.getElementById('menu-alat-ekspansi');
    const btnMic = document.getElementById('tool-audio');
    const btnLokasi = document.getElementById('tool-lokasi');
    const btnKamera = document.getElementById('tool-kamera');
    const btnGaleri = document.getElementById('tool-galeri');
    const inpKamera = document.getElementById('input-kamera');
    const inpGaleri = document.getElementById('input-galeri');

    // Delegasi Event untuk Body Chat (Gambar & Forensik)
    wadahChat.addEventListener('click', (e) => {
        const btnForensik = e.target.closest('.btn-buka-forensik');
        if (btnForensik) {
            bukaBottomSheetForensik(btnForensik.getAttribute('data-info'), btnForensik.getAttribute('data-log'));
            return; 
        }

        const seleksiTeks = window.getSelection();
        if (seleksiTeks && seleksiTeks.toString().length > 0) return; 

        const triggerImg = e.target.closest('.image-fullscreen-trigger');
        if (triggerImg) bukaLayarPenuhGambar(triggerImg.getAttribute('data-img'));
    });

    btnTutup.addEventListener('click', akhiriSesiKomunikasi);

    btnToggle.addEventListener('click', () => {
        menuAlat.classList.toggle('show-tools');
        btnToggle.style.transform = menuAlat.classList.contains('show-tools') ? 'rotate(45deg)' : 'rotate(0deg)';
    });

    inputTeks.addEventListener('input', () => {
        if(inputTeks.value.trim() !== '') { btnMic.classList.add('hidden-state'); btnKirim.classList.remove('hidden-state'); } 
        else { btnMic.classList.remove('hidden-state'); btnKirim.classList.add('hidden-state'); }
    });

    btnKirim.addEventListener('click', () => {
        if (inputTeks.value.trim() !== '') {
            kirimPayloadPesan(inputTeks.value, "teks");
            inputTeks.value = '';
            btnMic.classList.remove('hidden-state'); btnKirim.classList.add('hidden-state');
        }
    });

    btnLokasi.addEventListener('click', () => {
        btnLokasi.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        if (!navigator.geolocation) return;
        
        // MENGIRIM KORDINAT MURNI, BUKAN LINK URL!
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const kordinat = `${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`;
                kirimPayloadPesan(kordinat, "lokasi");
                btnLokasi.innerHTML = '<i class="fa-solid fa-location-dot"></i> Lokasi';
                menuAlat.classList.remove('show-tools');
            },
            (err) => {
                if(window.showToast) window.showToast("Akses GPS Ditolak.", "error");
                btnLokasi.innerHTML = '<i class="fa-solid fa-location-dot"></i> Lokasi';
            }, { enableHighAccuracy: true }
        );
    });

    btnKamera.addEventListener('click', () => inpKamera.click());
    btnGaleri.addEventListener('click', () => inpGaleri.click());

    inpKamera.addEventListener('change', (e) => { if (e.target.files.length > 0) ekstrakForensikDanKirim(e.target.files[0], "Kamera Langsung"); menuAlat.classList.remove('show-tools'); });
    inpGaleri.addEventListener('change', (e) => { if (e.target.files.length > 0) ekstrakForensikDanKirim(e.target.files[0], "Galeri Perangkat"); menuAlat.classList.remove('show-tools'); });

    // Audio PTT Handlers
    btnMic.addEventListener('touchstart', mulaiRekamAudio, {passive: true});
    btnMic.addEventListener('touchend', hentikanRekamAudio);
    btnMic.addEventListener('mousedown', mulaiRekamAudio);
    btnMic.addEventListener('mouseup', hentikanRekamAudio);
    
    // Bind Tombol Salin di Sheet Forensik
    const btnSalinLog = document.getElementById('btn-bs-salin');
    if (btnSalinLog) {
        btnSalinLog.addEventListener('click', async (e) => {
            const b64 = e.target.closest('button').getAttribute('data-log');
            if(!b64) return;
            try {
                await navigator.clipboard.writeText(decodeURIComponent(escape(atob(b64))));
                if (window.showToast) window.showToast("Log disalin", "success");
                tutupBottomSheetForensik();
            } catch(err) { if (window.showToast) window.showToast("Gagal menyalin", "error"); }
        });
    }

    // Bind Close Fullscreen Modal
    document.getElementById('btn-tutup-modal-img').addEventListener('click', tutupLayarPenuhGambar);
    document.getElementById('modal-fullscreen-img').addEventListener('click', (e) => { if(e.target.id === 'modal-fullscreen-img') tutupLayarPenuhGambar(); });
    
    // Bind Close Bottom Sheet
    document.getElementById('bs-backdrop').addEventListener('click', tutupBottomSheetForensik);
}

async function mulaiRekamAudio() {
    const btnAudio = document.getElementById('tool-audio');
    btnAudio.innerHTML = '<i class="fa-solid fa-microphone-lines fa-bounce"></i>';
    btnAudio.style.color = "#ef4444"; btnAudio.style.borderColor = "#ef4444";
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        perakamAudio = new MediaRecorder(stream);
        potonganAudio = [];
        
        perakamAudio.ondataavailable = e => { if (e.data.size > 0) potonganAudio.push(e.data); };
        perakamAudio.onstop = async () => {
            stream.getTracks().forEach(track => track.stop());
            const blobAudio = new Blob(potonganAudio, { type: 'audio/webm' });
            btnAudio.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            try {
                const url = await unggahMediaKeCloudinary(blobAudio, 'audio');
                kirimPayloadPesan(url, "audio");
            } catch(e) { if(window.showToast) window.showToast("Gagal kirim audio.", "error"); }
            btnAudio.innerHTML = '<i class="fa-solid fa-microphone"></i>';
            btnAudio.style.color = ""; btnAudio.style.borderColor = "";
        };
        perakamAudio.start();
    } catch (e) {
        if(window.showToast) window.showToast("Mic Ditolak", "error");
        btnAudio.innerHTML = '<i class="fa-solid fa-microphone"></i>';
        btnAudio.style.color = ""; btnAudio.style.borderColor = "";
    }
}

function hentikanRekamAudio() { if (perakamAudio && perakamAudio.state === "recording") perakamAudio.stop(); }

function mulaiDengarPesan() {
    const referensi = query(ref(dbChat, `sesi_komunikasi/${idRuangObrolanAktif}/pesan`), limitToLast(50));
    const wadahChat = document.getElementById('chat-body');
    
    pemantauPesan = onChildAdded(referensi, (snapshot) => {
        const pesan = snapshot.val();
        
        if (pesan.pengirim === 'klien') {
            mainkanNotifikasiPesanMasuk();
            const indikatorKedip = document.getElementById('chat-notif-dot');
            if (indikatorKedip) indikatorKedip.classList.remove('hidden-state');

            // UPDATE PREVIEW INBOX KETIKA KLIEN MENGIRIM PESAN
            if (auth.currentUser && idRuangObrolanAktif) {
                let previewTeks = pesan.tipe === 'teks' ? pesan.konten : (pesan.tipe === 'lokasi' ? '📍 Lokasi Baru' : (pesan.tipe === 'audio' ? '🎤 Suara Baru' : '📷 Gambar Baru'));
                update(ref(dbChat, `inbox_mitra/${auth.currentUser.uid}/${idRuangObrolanAktif}`), {
                    pesan_terakhir: previewTeks,
                    waktu_update: Date.now()
                }).catch(()=>{});
            }
        }

        const posisiKelas = pesan.pengirim === 'mitra' ? 'msg-mitra' : 'msg-klien';
        let htmlKonten = '';
        
        if (pesan.tipe === 'teks') htmlKonten = `<p>${pesan.konten}</p>`;
        else if (pesan.tipe === 'katalog_order') {
            // RENDER RICH UI KATALOG DI SISI DRIVER
            try {
                const k = JSON.parse(pesan.konten);
                const formatRp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(k.harga);
                const warnaLayanan = k.layanan === 'RIDE' ? '#3b82f6' : (k.layanan === 'EXPRESS' ? '#f59e0b' : '#10b981');
                const isJastip = k.layanan === 'JASTIP' && k.belanjaan && k.belanjaan.length > 0;
                
                let htmlJastip = '';
                if (isJastip) {
                    htmlJastip = `<div style="border-top:1px dashed rgba(255,255,255,0.2); margin:8px 0; padding-top:8px;">
                        <span style="font-size:0.6rem; color:#94a3b8; display:block; margin-bottom:4px;">DAFTAR BELANJA:</span>
                        <ul style="margin:0; padding-left:14px; font-size:0.75rem; color:#f8fafc;">
                            ${k.belanjaan.map(i => `<li><b>${i.qty}x</b> ${i.name} (@ Rp${i.price})</li>`).join('')}
                        </ul>
                    </div>`;
                }

                htmlKonten = `
                    <div style="background:#0f1624; border:1px solid ${warnaLayanan}; border-radius:12px; padding:12px; width:240px; display:flex; flex-direction:column; gap:6px; box-shadow:0 8px 20px rgba(0,0,0,0.4);">
                        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:6px;">
                            <span style="font-size:0.65rem; color:${warnaLayanan}; font-weight:900; letter-spacing:1px;"><i class="fa-solid fa-receipt mr-1"></i> ORDER: ${k.layanan}</span>
                            <span style="font-size:0.65rem; color:#94a3b8; font-family:monospace;">${k.jarak} KM</span>
                        </div>
                        <div style="display:flex; flex-direction:column; gap:4px; margin-top:4px;">
                            <div style="display:flex; gap:6px;">
                                <i class="fa-solid fa-circle-up" style="color:#10b981; font-size:0.7rem; margin-top:3px;"></i>
                                <span style="font-size:0.75rem; color:#f8fafc; line-height:1.3;"><b>Jemput:</b><br>${k.jemput}</span>
                            </div>
                            <div style="width:2px; height:10px; background:rgba(255,255,255,0.2); margin-left:4px;"></div>
                            <div style="display:flex; gap:6px;">
                                <i class="fa-solid fa-location-dot" style="color:#ef4444; font-size:0.7rem; margin-top:3px;"></i>
                                <span style="font-size:0.75rem; color:#f8fafc; line-height:1.3;"><b>Tujuan:</b><br>${k.tujuan}</span>
                            </div>
                        </div>
                        ${htmlJastip}
                        <div style="background:rgba(212,175,55,0.1); border:1px dashed #ceab6b; border-radius:6px; padding:8px; text-align:center; margin-top:6px;">
                            <span style="font-size:0.6rem; color:#ceab6b; display:block;">ESTIMASI TARIF</span>
                            <span style="font-size:1.2rem; color:#ceab6b; font-weight:900; font-family:monospace;">${formatRp}</span>
                        </div>
                        <div style="background:#10b981; color:#fff; text-align:center; padding:6px; border-radius:6px; margin-top:8px; font-weight:bold; font-size:0.65rem; text-transform:uppercase;">
                            Sistem Siap. Balas pesan Klien!
                        </div>
                    </div>
                `;
            } catch(e) { htmlKonten = `<p><i>[Katalog Order Error]</i></p>`; }
        }
        else if (pesan.tipe === 'lokasi') {
            // MERENDER RICH UI BUBBLE MAP (SEPERTI REFERENSI GAMBAR ANDA)
            const [lat, lng] = pesan.konten.split(',');
            const staticMapUrl = `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=16&size=220x140&markers=${lat},${lng},red-pushpin`;
            
            htmlKonten = `
                <div style="background:#0f1624; border:1px solid #ceab6b; border-radius:12px; padding:10px; width:220px; display:flex; flex-direction:column; gap:8px;">
                    <div style="font-size:0.75rem; color:#ceab6b; font-weight:bold; display:flex; align-items:center; gap:6px;">
                        <i class="fa-solid fa-map-location-dot"></i> Lokasi Terkini
                    </div>
                    <div style="width:100%; height:140px; background:#1e293b; border-radius:8px; overflow:hidden;">
                        <img src="${staticMapUrl}" style="width:100%; height:100%; object-fit:cover;">
                    </div>
                    <div style="font-size:0.65rem; color:#f8fafc; background:#162032; padding:4px; border-radius:4px; text-align:center; font-family:monospace; border:1px solid rgba(255,255,255,0.1);">
                        Lat: ${parseFloat(lat).toFixed(5)}, Lng: ${parseFloat(lng).toFixed(5)}
                    </div>
                    <a href="https://www.google.com/maps/search/?api=1&query=${lat},${lng}" target="_blank" style="background:#ceab6b; color:#0b101a; padding:10px; border-radius:8px; text-align:center; font-size:0.8rem; font-weight:bold; text-decoration:none; display:flex; justify-content:center; align-items:center; gap:6px; margin-top:2px;">
                        <i class="fa-solid fa-location-arrow"></i> Buka Maps
                    </a>
                </div>
            `;
        }
        else if (pesan.tipe === 'audio') htmlKonten = `<audio controls src="${pesan.konten}" style="height:32px; width:180px;"></audio>`;
        else if (pesan.tipe === 'gambar') {
            let teksSalin = `SUMBER: ${pesan.forensik?.sumber}\nIP SAAT INI: ${pesan.forensik?.ip}\nNET: ${pesan.forensik?.jaringan}\nRAM/CPU: ${pesan.forensik?.ram_cpu}\nGPS SAAT UPLOAD: ${pesan.forensik?.lokasi}\nOS: ${pesan.forensik?.browser}`;
            if (pesan.forensik?.exif) teksSalin += `\n\n--- METADATA ASLI (GALERI) ---\nKAMERA: ${pesan.forensik.exif.kamera}\nWAKTU DIAMBIL: ${pesan.forensik.exif.waktu_diambil}\nGPS ASLI: ${pesan.forensik.exif.lokasi_asli}`;

            const b64Teks = btoa(unescape(encodeURIComponent(teksSalin)));
            const dataForensikStr = btoa(unescape(encodeURIComponent(JSON.stringify(pesan.forensik || {}))));
            
            // Render HTML khusus Gelembung Gambar
            htmlKonten = `
                <div class="media-container" style="position:relative; width:200px;">
                    <div class="image-wrapper image-fullscreen-trigger" data-img="${pesan.konten}" style="position:relative; border-radius:6px; overflow:hidden; cursor:pointer; height: 260px;">
                        <img src="${pesan.konten}" loading="lazy" style="width:100%; height:100%; object-fit:cover; display:block; pointer-events:none; -webkit-touch-callout:none; user-select:none;">
                        <div style="position:absolute; inset:0; z-index:10;" oncontextmenu="return false;"></div>
                    </div>
                    <div class="btn-buka-forensik" data-log="${b64Teks}" data-info="${dataForensikStr}" style="position:absolute; bottom:8px; right:8px; background:rgba(15,22,36,0.8); border:1px solid #ceab6b; color:#ceab6b; width:28px; height:28px; border-radius:50%; display:flex; justify-content:center; align-items:center; z-index:20; cursor:pointer; box-shadow:0 2px 5px rgba(0,0,0,0.5); backdrop-filter:blur(4px);">
                        <i class="fa-solid fa-shield-halved" style="font-size:0.75rem; pointer-events:none;"></i>
                    </div>
                </div>`;
        }

        const idUnik = `msg_${Date.now()}_${Math.random().toString(36).substring(2,7)}`;
        wadahChat.insertAdjacentHTML('beforeend', `<div id="${idUnik}" class="msg-bubble ${posisiKelas}"><div class="msg-content">${htmlKonten}</div><span class="msg-time">${new Date(pesan.waktu).toLocaleTimeString('id-ID', {hour: '2-digit', minute:'2-digit'})}</span></div>`);
        
        clearTimeout(wadahChat.scrollTimer);
        wadahChat.scrollTimer = setTimeout(() => wadahChat.scrollTo({ top: wadahChat.scrollHeight, behavior: 'smooth' }), 150);
    }); 
}

export function akhiriSesiKomunikasi() {
    // JANGAN HAPUS DATABASE (Dihapus otomatis oleh Sweeper 3 Jam)
    // Cukup lepaskan state dan sembunyikan UI agar bisa dibuka lagi via Riwayat (Inbox)
    idRuangObrolanAktif = null;
    if (typeof pemantauPesan === 'function') { pemantauPesan(); pemantauPesan = null; }
    
    const panel = document.getElementById('panel-komunikasi-utama');
    if (panel) panel.classList.add('hidden-state');
    
    const indikatorKedip = document.getElementById('chat-notif-dot');
    if (indikatorKedip) indikatorKedip.classList.add('hidden-state');
}

// Controller DOM Modal
function bukaLayarPenuhGambar(urlGambar) {
    const modal = document.getElementById('modal-fullscreen-img');
    const targetImg = document.getElementById('fullscreen-img-target');
    if(modal && targetImg) {
        targetImg.src = urlGambar;
        modal.classList.remove('hidden-state');
        requestAnimationFrame(() => modal.classList.remove('opacity-0'));
    }
}

function tutupLayarPenuhGambar() {
    const modal = document.getElementById('modal-fullscreen-img');
    if(modal) {
        modal.classList.add('opacity-0');
        setTimeout(() => { modal.classList.add('hidden-state'); document.getElementById('fullscreen-img-target').src = ''; }, 300);
    }
}

function bukaBottomSheetForensik(b64Info, b64Log) {
    const sheetEl = document.getElementById('bottom-sheet-forensik');
    const contentEl = document.getElementById('bs-content');
    if (!sheetEl || !contentEl) return;

    const info = JSON.parse(decodeURIComponent(escape(atob(b64Info))));
    
    document.getElementById('fs-sumber').innerText = info.sumber || '-';
    document.getElementById('fs-ip').innerText = info.ip || '-';
    document.getElementById('fs-hardware').innerText = info.ram_cpu || '-';
    document.getElementById('fs-lokasi').href = info.lokasi;
    
    const exifContainer = document.getElementById('fs-exif-container');
    if (info.exif) {
        exifContainer.classList.remove('hidden-state');
        document.getElementById('fs-exif-kamera').innerText = info.exif.kamera;
        document.getElementById('fs-exif-waktu').innerText = info.exif.waktu_diambil;
        document.getElementById('fs-exif-gps').innerHTML = info.exif.lokasi_asli.startsWith('http') ? `<a href="${info.exif.lokasi_asli}" target="_blank" class="text-[#ceab6b] underline font-bold"><i class="fa-solid fa-map-pin"></i> Buka Peta Asli</a>` : `<b>${info.exif.lokasi_asli}</b>`;
    } else {
        exifContainer.classList.add('hidden-state');
    }

    document.getElementById('btn-bs-salin').setAttribute('data-log', b64Log);

    sheetEl.classList.remove('hidden-state');
    requestAnimationFrame(() => {
        sheetEl.classList.remove('opacity-0');
        contentEl.classList.remove('translate-y-full');
    });
}

function tutupBottomSheetForensik() {
    const sheetEl = document.getElementById('bottom-sheet-forensik');
    const contentEl = document.getElementById('bs-content');
    if(sheetEl && contentEl) {
        contentEl.classList.add('translate-y-full');
        sheetEl.classList.add('opacity-0');
        setTimeout(() => sheetEl.classList.add('hidden-state'), 300);
    }
}
