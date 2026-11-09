// Görünüm Değiştirme Fonksiyonu
function switchView(viewId) {
    document.querySelectorAll('.view').forEach(v => {
        v.classList.remove('active');
    });
    document.getElementById(viewId).classList.add('active');
}

// Ardışık Akış Senaryosu (Örn: ID girmeden QR ile otomatik devralma)
function startIntegratedWorkflow() {
    // Önce ALŞ09 modülüne gidip hocanın QR kodunu tarama adımını tetikler
    switchView('als09-view');
    if (typeof initTeacherQRCodeScan === 'function') {
        initTeacherQRCodeScan();
    }
}

// Service Worker Kaydı (HTTPS üzerinden yayınlandığında çalışır)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker Kaydedildi:', reg.scope))
            .catch(err => console.error('Service Worker Kayıt Hatası:', err));
    });
}

let videoStream = null;
let scanningActive = false;

async function startQRScanner() {
    const video = document.getElementById('qr-video');
    const canvasElement = document.getElementById('qr-canvas');
    const canvas = canvasElement.getContext('2d');
    const resultDiv = document.getElementById('scan-result');
    const startBtn = document.getElementById('start-camera-btn');

    startBtn.style.display = 'none';
    resultDiv.textContent = "Kamera açılıyor ve taranıyor...";

    try {
        // Telefonun arka kamerasını (environment) önceliklendiriyoruz (Pixel 7 için idealdir)
        videoStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "environment" } 
        });
        
        video.srcObject = videoStream;
        video.setAttribute("playsinline", true); // iOS/Android uyumluluğu için
        await video.play();
        
        scanningActive = true;
        requestAnimationFrame(() => tick(video, canvas, canvasElement, resultDiv));

    } catch (err) {
        console.error("Kamera hatası:", err);
        resultDiv.textContent = "Kamera erişimi reddedildi veya desteklenmiyor!";
        startBtn.style.display = 'inline-block';
    }
}

function tick(video, canvas, canvasElement, resultDiv) {
    if (!scanningActive) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvasElement.height = video.videoHeight;
        canvasElement.width = video.videoWidth;
        
        // Video karesini canvas üzerine çiziyoruz
        canvas.drawImage(video, 0, canvasElement.width, canvasElement.height);
        
        // Piksel verilerini alıp jsQR'a gönderiyoruz
        const imageData = canvas.getImageData(0, 0, canvasElement.width, canvasElement.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
        });

        if (code) {
            // QR Kod başarıyla okundu!
            resultDiv.textContent = `Başarılı! Okunan Veri: ${code.data}`;
            
            // Pixel 7 gibi destekleyen cihazlarda başarılı okumada hafif titreşim (Haptic Feedback)
            if (navigator.vibrate) {
                navigator.vibrate(100);
            }

            // Kamerayı durdur ve akışı sonlandır
            stopQRScanner();

            // BURADA: code.data içindeki değere göre (örn. WebRTC bağlantı bilgisi / dosya ID'si) 
            // ALŞ09'un dosya alma fonksiyonlarını tetikleyebilirsin.
            handleQRCodeData(code.data);
            return;
        }
    }
    
    // Kod bulunamadıysa taramaya devam et
    if (scanningActive) {
        requestAnimationFrame(() => tick(video, canvas, canvasElement, resultDiv));
    }
}

function stopQRScanner() {
    scanningActive = false;
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
    const startBtn = document.getElementById('start-camera-btn');
    if (startBtn) {
        startBtn.style.display = 'inline-block';
    }
}

function handleQRCodeData(data) {
    console.log("Hocadan gelen QR verisi işleniyor:", data);
    // Örnek: Bu aşamadan sonra WebRTC peer bağlantı aşamasına geçiş yapabilirsin.
}

let peerConnection;
let dataChannel;

// STUN sunucuları (Aynı yerel ağda veya test ortamında çalışırken opsiyoneldir ama NAT geçişi için gereklidir)
const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

async function handleQRCodeData(qrData) {
    try {
        console.log("QR Koddan alınan SDP Offer:", qrData);
        
        // Hocanın offer verisini JSON objesine çeviriyoruz
        const offerObj = JSON.parse(qrData);

        // 1. Yeni bir PeerConnection başlatıyoruz
        peerConnection = new RTCPeerConnection(rtcConfig);

        // 2. Hocanın açtığı veri kanalını (DataChannel) dinliyoruz
        peerConnection.ondatachannel = event => {
            dataChannel = event.channel;
            setupDataChannelEvents();
            console.log("Hocadan DataChannel bağlantısı alındı!");
        };

        // 3. Hocanın Offer verisini remote description olarak ayarlıyoruz
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offerObj));

        // 4. Öğrenci tarafı için Answer (Cevap) oluşturuyoruz
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        // 5. ICE adaylarının toplanmasını bekleyip öğrencinin cevap verisini hazırlıyoruz
        // Not: Gerçek senaryoda bu cevabı da bir QR kod olarak hocaya okutman gerekebilir.
        console.log("Öğrenci Answer oluşturuldu. Hocaya aktarmak için hazır.");

    } catch (err) {
        console.error("WebRTC bağlantı hatası:", err);
    }
}

let incomingFileChunks = [];
let incomingFileMeta = null;

function setupDataChannelEvents() {
    dataChannel.onopen = () => {
        console.log("DataChannel açık ve veri transferine hazır!");
    };

    dataChannel.onmessage = event => {
        // Gelen veri metin (meta veri) veya dosya parçası (binary) olabilir
        if (typeof event.data === 'string') {
            try {
                const message = JSON.parse(event.data);
                if (message.type === 'file-meta') {
                    incomingFileMeta = message;
                    incomingFileChunks = [];
                    console.log(`Dosya bekleniyor: ${incomingFileMeta.name} (${incomingFileMeta.size} bayt)`);
                }
            } catch (e) {
                console.log("Gelen mesaj:", event.data);
            }
        } else {
            // İkilik (binary) dosya parçası geldi
            incomingFileChunks.push(event.data);

            // Tüm parçalar geldiyse dosyayı birleştirip indirilebilir yapalım
            // (Alternatif olarak transfer tamamlandı sinyali beklenebilir)
            console.log(`Parça alındı. Toplam parça: ${incomingFileChunks.length}`);
        }
    };

    dataChannel.onclose = () => {
        console.log("DataChannel kapatıldı.");
    };
}

// Hoca tarafında bağlantı başlatma örneği
async function startHostingFile(fileObject) {
    const pc = new RTCPeerConnection(rtcConfig);
    
    // Veri kanalı oluşturuluyor
    const dc = pc.createDataChannel("file-transfer");
    
    dc.onopen = () => {
        console.log("Öğrenciye bağlantı kuruldu, dosya bilgisi gönderiliyor...");
        
        // Önce dosya adını ve boyutunu gönderiyoruz
        dc.send(JSON.stringify({
            type: 'file-meta',
            name: fileObject.name,
            size: fileObject.size,
            type: fileObject.type
        }));

        // Dosyayı parçalar halinde gönderelim (örn. 16KB chunk'lar)
        const chunkSize = 16384;
        const reader = new FileReader();
        let offset = 0;

        reader.onload = e => {
            dc.send(e.target.result);
            offset += e.target.result.byteLength;
            if (offset < fileObject.size) {
                readNextChunk();
            } else {
                console.log("Dosya aktarımı tamamlandı!");
            }
        };

        function readNextChunk() {
            const slice = fileObject.slice(offset, offset + chunkSize);
            reader.readAsArrayBuffer(slice);
        }

        readNextChunk();
    };

    // Offer oluşturup QR kod olarak ekranda göstermek için:
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // ICE adaylarının toplanması beklendikten sonra pc.localDescription.json() verisi 
    // bir QR kod kütüphanesi (örn. qrious veyaqrcodejs) ile ekranda QR koda dönüştürülür.
    console.log("Hoca Offer QR Kodu için hazır:", JSON.stringify(pc.localDescription));
}