// Aetheria PDF Converter - Main Server Logic (v1.3 - Batch Support & Cleanup)
// Author: Aetheria Synthesizer

const express = require('express');
const path = require('path');
const fs = require('fs'); // Senkron kontroller ve stream için
const fsPromises = require('fs').promises; // Asenkron dosya işlemleri (temizlik için)
const uploadRouter = require('./routes/upload'); // Rota modülümüzü içe aktarıyoruz

const app = express();
// Vercel için port yapılandırması
const PORT = process.env.PORT || 3000;

// --- Dizin Yolları ---
// Vercel için geçici dosya yollarını /tmp altına taşıyoruz
const UPLOADS_DIR = process.env.VERCEL ? '/tmp/uploads' : path.join(__dirname, 'uploads');
const GENERATED_PDFS_DIR = process.env.VERCEL ? '/tmp/generated_pdfs' : path.join(__dirname, 'generated_pdfs');
const TEMP_DIR = process.env.VERCEL ? '/tmp/temp' : path.join(__dirname, 'temp');

// --- Sunucu Başlangıcında Dizin Oluşturma ---
// Uygulamanın ihtiyaç duyduğu klasörlerin var olduğundan emin olalım.
[UPLOADS_DIR, GENERATED_PDFS_DIR, TEMP_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        try {
            fs.mkdirSync(dir, { recursive: true }); // Gerekirse iç içe oluştur
            console.log(`Directory created: ${dir}`);
        } catch (err) {
            console.error(`Fatal Error: Could not create directory ${dir}. Please check permissions.`, err);
            process.exit(1); // Uygulamayı durdur, çünkü klasörler olmadan çalışamaz
        }
    }
});

// --- Middleware'ler ---
app.use(express.json()); // Gelen JSON isteklerini parse et
app.use(express.urlencoded({ extended: true })); // Gelen URL-encoded istekleri parse et
app.use(express.static(path.join(__dirname, 'public'))); // 'public' klasörünü statik olarak sun

// --- Temel Rotalar ---
// Ana sayfa isteği
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Dosya yükleme ve dönüştürme API'si
app.use('/api/upload', uploadRouter);

// --- Güncellenmiş İndirme Rotası (PDF ve ZIP dosyaları için) ---
app.get('/download/:filename', (req, res, next) => {
    const filename = req.params.filename;
    // Güvenlik: Sadece dosya adını al, dizin yolunu temizle
    const safeFilename = path.basename(filename);
    // Dosyanın olması gereken yer
    const filePath = path.join(GENERATED_PDFS_DIR, safeFilename);

    // 1. Dosyanın varlığını ve doğru klasörde olduğunu asenkron olarak kontrol et
    fs.access(filePath, fs.constants.F_OK, (err) => {
        if (err || !filePath.startsWith(GENERATED_PDFS_DIR)) {
            const error = new Error('File not found or access denied.');
            error.status = 404;
            return next(error); // Hata işleyiciye yönlendir
        }

        // 2. Dosya türüne göre Content-Type belirle
        let contentType = 'application/octet-stream'; // Bilinmeyenler için varsayılan
        const lowerCaseFilename = safeFilename.toLowerCase();
        if (lowerCaseFilename.endsWith('.pdf')) {
            contentType = 'application/pdf';
        } else if (lowerCaseFilename.endsWith('.zip')) {
            contentType = 'application/zip';
        }

        // 3. İndirme için gerekli HTTP başlıklarını ayarla
        res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`); // Tarayıcıya indirmesini söyle
        res.setHeader('Content-Type', contentType); // Dosya türünü belirt

        // 4. Dosyayı okuma akışı (Read Stream) oluştur
        const fileStream = fs.createReadStream(filePath);

        // 5. Akışı yanıt (Response) akışına yönlendir (pipe)
        fileStream.pipe(res);

        // 6. Akış Hatalarını Dinle
        fileStream.on('error', (streamErr) => {
            console.error(`Error streaming file ${safeFilename}:`, streamErr);
            // Yanıt başlıkları gönderilmediyse hata işleyiciye yönlendir,
            // gönderildiyse istemci bağlantıyı sonlandıracaktır.
            if (!res.headersSent) {
                next(streamErr);
            } else {
                // Başlıklar gönderilmişse, sadece bağlantıyı kapatmaya çalış.
                res.end();
            }
        });

        // 7. İndirme sonrası basit temizlik denemesi (asıl temizlik periyodik görevde)
        // Bu kısım, dosya hala kullanımdayken silme sorunları yaşayabilir.
        const cleanupAttempt = () => {
            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr && unlinkErr.code !== 'ENOENT') { // Dosya yok hatasını görmezden gel
                    // console.warn(`Could not delete ${safeFilename} immediately after download:`, unlinkErr.code);
                }
            });
        };
        res.on('finish', cleanupAttempt); // Başarıyla bittiğinde
        res.on('close', () => { if (!res.writableEnded) { cleanupAttempt(); } }); // Bağlantı koptuğunda

    });
});

// --- Periyodik Temizlik Ayarları ---
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 dakikada bir
const MAX_FILE_AGE_MS = 10 * 60 * 1000; // 10 dakikadan eski dosyaları sil
const DIRECTORIES_TO_CLEAN = [UPLOADS_DIR, GENERATED_PDFS_DIR, TEMP_DIR];

/**
 * Belirtilen dizinlerde belirli bir yaştan eski dosyaları asenkron olarak siler.
 */
async function cleanupOldFiles() {
    console.log(`\n🧹 [${new Date().toISOString()}] Starting cleanup task...`);
    const now = Date.now();
    let deletedCount = 0;
    let checkedCount = 0;

    for (const dir of DIRECTORIES_TO_CLEAN) {
        try {
            // console.log(`   Checking directory: ${dir}`);
            const files = await fsPromises.readdir(dir);
            checkedCount += files.length;

            if (files.length === 0) continue; // Boşsa devam et

            for (const file of files) {
                // Gizli dosyaları veya dizinleri atla (isteğe bağlı, örn: .gitkeep)
                if (file.startsWith('.')) continue;

                const filePath = path.join(dir, file);
                try {
                    const stats = await fsPromises.stat(filePath);
                    // Sadece dosyaları kontrol et, dizinleri atla
                    if (!stats.isFile()) continue;

                    const fileAge = now - stats.mtimeMs; // Son değiştirilme zamanına göre yaş

                    if (fileAge > MAX_FILE_AGE_MS) {
                        await fsPromises.unlink(filePath);
                        deletedCount++;
                        // console.log(`   Deleted old file: ${filePath} (Age: ${Math.round(fileAge / 60000)} mins)`);
                    }
                } catch (statOrUnlinkError) {
                    // Dosya o anda silinemezse veya stat alınamazsa logla ve devam et
                    if (statOrUnlinkError.code !== 'ENOENT') {
                       console.warn(`   Could not process/delete file ${filePath}:`, statOrUnlinkError.message);
                    }
                }
            }
        } catch (readDirError) {
            // Dizin yoksa veya okunamıyorsa logla
            if (readDirError.code !== 'ENOENT') {
               console.error(`   Error reading directory ${dir} for cleanup:`, readDirError);
            } else {
               // console.log(`   Directory not found (skipping cleanup): ${dir}`);
            }
        }
    }
    if (deletedCount > 0 || checkedCount > 0) {
      console.log(`🧹 Cleanup finished. Checked approx ${checkedCount} items, deleted ${deletedCount} old files.`);
    } else {
      console.log(`🧹 Cleanup finished. No old files found to delete.`);
    }
}

/**
 * Periyodik temizlik görevini ayarlayan ve başlatan fonksiyon.
 */
function startCleanupTask() {
    // Vercel'de periyodik görevleri çalıştırmak için farklı bir yaklaşım gerekebilir
    if (!process.env.VERCEL) {
        console.log(`🧹 Scheduling periodic cleanup every ${CLEANUP_INTERVAL_MS / 60000} minutes.`);
        console.log(`   Files older than ${MAX_FILE_AGE_MS / 60000} minutes in specified directories will be deleted.`);
        // Görevi hemen bir kez çalıştır
        cleanupOldFiles().catch(err => console.error("Initial cleanup task failed:", err));
        // Belirlenen aralıklarla tekrar çalıştır
        setInterval(() => {
            cleanupOldFiles().catch(err => console.error("Periodic cleanup task failed:", err));
        }, CLEANUP_INTERVAL_MS);
    }
}

// --- Merkezi Hata İşleyici Middleware ---
// Rotalarda next(err) çağrıldığında veya bir hata oluştuğunda çalışır.
app.use((err, req, res, next) => {
    // Hatanın tüm detaylarını sunucu konsoluna logla
    console.error("--- An Error Occurred ---");
    console.error("Timestamp:", new Date().toISOString());
    console.error("Route:", req.originalUrl);
    console.error("Method:", req.method);
    console.error("Status Code:", err.status || 500);
    console.error("Error Message:", err.message);
    // Stack trace'i sadece geliştirme ortamında veya hata nesnesinde varsa logla
    if (process.env.NODE_ENV === 'development' || err.stack) {
        console.error("Stack Trace:", err.stack || "(Not available)");
    }
    console.error("--- End Error ---");

    const statusCode = err.status || 500; // HTTP durum kodu
    const errorMessage = err.message || 'Internal Server Error'; // İstemciye gönderilecek mesaj

    // Eğer yanıt başlıkları henüz gönderilmediyse, istemciye JSON hatası gönder
    if (!res.headersSent) {
        res.status(statusCode).json({
            success: false,
            error: {
                message: errorMessage
                // Geliştirme ortamında daha fazla detay gönderebilirsiniz:
                // details: process.env.NODE_ENV === 'development' ? err.stack : undefined
            }
        });
    } else {
        // Yanıt zaten gönderilmeye başlandıysa, hatayı sadece loglamakla yetin
        console.error("Headers already sent, cannot send error JSON to client for this request.");
    }
});

// --- Sunucuyu Başlat ---
// Vercel için export edilebilir bir handler oluştur
if (process.env.VERCEL) {
    module.exports = app;
} else {
    app.listen(PORT, () => {
        console.log(`\n✨ Aetheria PDF Converter v1.3 is listening gracefully on port ${PORT}`);
        console.log(`   Now with Batch Magic & Auto-Cleanup! ✨`);
        console.log(`   Access the portal at: http://localhost:${PORT}\n`);
        // Periyodik Temizlik Görevini Başlat
        startCleanupTask();
    });
}