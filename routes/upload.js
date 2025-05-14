// Aetheria PDF Converter - Upload & Conversion Route (v1.3.1 - Fixed fs import)
// Author: Aetheria Synthesizer

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs'); // <<< DÜZELTME: Standart fs modülü import edildi
const archiver = require('archiver');
const { generatePdf } = require('../utils/pdfGenerator');

const router = express.Router();

// Vercel için geçici dosya yollarını /tmp altına taşıyoruz
const UPLOADS_DIR = process.env.VERCEL ? '/tmp/uploads' : path.join(__dirname, '..', 'uploads');
const GENERATED_PDFS_DIR = process.env.VERCEL ? '/tmp/generated_pdfs' : path.join(__dirname, '..', 'generated_pdfs');
const TEMP_DIR = process.env.VERCEL ? '/tmp/temp' : path.join(__dirname, '..', 'temp');

// --- Kabul Edilen Türler ---
const ALLOWED_MIME_TYPES = [
    'image/jpeg','image/png','image/gif','image/bmp','image/tiff','image/webp','image/svg+xml',
    'text/plain','text/csv','text/html',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
    'application/msword', // DOC (eski Word formatı)
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // XLSX
    'application/vnd.ms-excel' // XLS (eski Excel formatı)
];
const displayTypes = "JPG, PNG, GIF, BMP, TIFF, WebP, SVG, TXT, CSV, HTML, DOC, DOCX, XLS, XLSX";

// --- Multer Yapılandırması ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        // Dosya adını normalize et ve rastgele bir ek ile yeniden adlandır
        const originalName = file.originalname || 'unnamed_file';
        const fileExt = path.extname(originalName).toLowerCase(); // Uzantıyı küçük harfe çevir
        const baseName = path.basename(originalName, path.extname(originalName));
        const safeBaseName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_'); // Güvenli karakterler
        
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${safeBaseName}-${uniqueSuffix}${fileExt}`);
    }
});

// Geliştirilmiş dosya filtresi - MIME tipleri ve uzantı uyumluluğu kontrolü
const fileFilter = (req, file, cb) => {
    // Uzantıyı kontrol et ve normalize et
    const originalExt = path.extname(file.originalname || '').toLowerCase();
    
    // MIME tipini kontrol et
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        // DOCX dosyaları için ek kontrol
        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            // Uzantı .docx veya .DOCX olmalı, değilse bile ilerle ama log al
            if (originalExt !== '.docx') {
                console.warn(`Warning: File with DOCX MIME type has non-standard extension: ${originalExt}. Will process anyway.`);
            }
        }
        
        // XLSX dosyaları için ek kontrol
        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
            // Uzantı .xlsx veya .XLSX olmalı, değilse bile ilerle ama log al
            if (originalExt !== '.xlsx') {
                console.warn(`Warning: File with XLSX MIME type has non-standard extension: ${originalExt}. Will process anyway.`);
            }
        }
        
        cb(null, true);
    } else {
        // Hata mesajında tüm desteklenen türleri listele
        cb(new Error(`Invalid file type (${file.mimetype}) for ${file.originalname}. Allowed: ${displayTypes}`), false);
    }
};

const MAX_FILES_SERVER = 20;
const MAX_FILE_SIZE_SERVER = 25 * 1024 * 1024;
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: MAX_FILE_SIZE_SERVER,
        files: MAX_FILES_SERVER
    }
}).array('filesToConvert', MAX_FILES_SERVER);


// --- POST /api/upload Endpoint ---
router.post('/', (req, res, next) => {
    upload(req, res, async (err) => {
        // Multer Hataları
        if (err instanceof multer.MulterError) {
            console.error('Multer error:', err);
            let message = `File upload error: ${err.message}`;
            if (err.code === 'LIMIT_FILE_SIZE') message = `Bir dosya boyutu limitini (${formatFileSize(MAX_FILE_SIZE_SERVER)}) aştı.`;
            if (err.code === 'LIMIT_FILE_COUNT') message = `Maksimum dosya sayısı (${MAX_FILES_SERVER}) aşıldı.`;
            return res.status(400).json({ success: false, message });
        } else if (err) {
            console.error('Upload filter/other error:', err);
            return res.status(400).json({ success: false, message: err.message || 'Upload failed.' });
        }

        // Dosya Yoksa
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: 'No files uploaded.' });
        }

        // Dosyaları İşleme
        const filesToProcess = req.files;
        const results = [];
        const successfulPdfPaths = [];
        let conversionErrors = 0;

        console.log(`Received ${filesToProcess.length} files for conversion.`);

        const processingPromises = filesToProcess.map(async (file) => {
            const uploadedFilePath = file.path;
            const originalFilename = file.originalname;
            const mimeType = file.mimetype;
            let generatedPdfFilename = null;

            try {
                console.log(`Processing: ${originalFilename} (${mimeType})`);
                generatedPdfFilename = await generatePdf(
                    uploadedFilePath,
                    originalFilename,
                    mimeType,
                    GENERATED_PDFS_DIR,
                    TEMP_DIR
                );
                const pdfPath = path.join(GENERATED_PDFS_DIR, generatedPdfFilename);
                successfulPdfPaths.push({ path: pdfPath, name: generatedPdfFilename });
                console.log(`Success: ${originalFilename} -> ${generatedPdfFilename}`);
                return {
                    originalFilename: originalFilename,
                    status: 'success',
                    pdfName: generatedPdfFilename,
                    error: null
                };
            } catch (conversionError) {
                conversionErrors++;
                console.error(`Error converting ${originalFilename}:`, conversionError.message);
                return {
                    originalFilename: originalFilename,
                    status: 'error',
                    pdfName: null,
                    error: conversionError.message || 'Unknown conversion error'
                };
            } finally {
                // Yüklenen orijinal dosyayı sil
                try {
                    // <<< DÜZELTME: fs.promises kullanıldı
                    await fs.promises.unlink(uploadedFilePath);
                } catch (unlinkError) {
                    if (unlinkError.code !== 'ENOENT') {
                       console.error(`Error deleting uploaded file ${uploadedFilePath}:`, unlinkError);
                    }
                }
            }
        });

        const settledResults = await Promise.allSettled(processingPromises);

        settledResults.forEach(result => {
            if (result.status === 'fulfilled') {
                results.push(result.value);
            } else {
                console.error("Unexpected error during Promise.allSettled:", result.reason);
                 results.push({
                     originalFilename: 'Unknown',
                     status: 'error',
                     pdfName: null,
                     error: 'An unexpected internal error occurred during processing.'
                 });
                 conversionErrors++;
            }
        });

        // ZIP Oluşturma
        if (successfulPdfPaths.length > 0) {
            const zipFilename = `aetheria_converted_${Date.now()}.zip`;
            const zipFilePath = path.join(GENERATED_PDFS_DIR, zipFilename);
             // <<< DÜZELTME: Standart fs kullanılıyor
            const output = fs.createWriteStream(zipFilePath);
            const archive = archiver('zip', { zlib: { level: 9 } });

            return new Promise((resolve, reject) => {
                 output.on('close', () => {
                    console.log(`ZIP archive created: ${zipFilename} (${archive.pointer()} total bytes)`);
                    res.json({
                        success: conversionErrors === 0,
                        message: conversionErrors === 0
                            ? `${results.length} dosya başarıyla dönüştürüldü.`
                            : `${successfulPdfPaths.length} dosya dönüştürüldü, ${conversionErrors} hata oluştu.`,
                        results: results,
                        zipFilename: zipFilename
                    });
                    resolve();
                });

                archive.on('warning', (err) => {
                    if (err.code === 'ENOENT') { console.warn('Archiver warning:', err); }
                    else { reject(err); }
                });
                archive.on('error', (err) => { reject(err); });

                archive.pipe(output);
                successfulPdfPaths.forEach(pdfInfo => {
                    archive.file(pdfInfo.path, { name: pdfInfo.name });
                });
                archive.finalize();
            })
            .catch(zipError => {
                 console.error("Failed to finalize ZIP:", zipError);
                 res.status(500).json({
                     success: false,
                     message: 'Dosyalar dönüştürüldü ancak ZIP arşivi oluşturulamadı.',
                     results: results,
                     zipFilename: null
                 });
            });

        } else {
            // Hiçbir dosya başarılı olmadıysa
            console.log("No files were converted successfully.");
            res.status(400).json({
                success: false,
                message: 'Hiçbir dosya dönüştürülemedi.',
                results: results,
                zipFilename: null
            });
        }
    });
});

// Dosya boyutunu formatlama
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

module.exports = router;