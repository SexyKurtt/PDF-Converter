// Aetheria PDF Converter - PDF Generation Utility (v1.1)
// Author: Aetheria Synthesizer

const { PDFDocument, StandardFonts, rgb, PageSizes } = require('pdf-lib');
const { degrees, PDFFont } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp'); // Görüntü işleme için
const mammoth = require('mammoth'); // DOCX -> HTML için
const puppeteer = require('puppeteer'); // HTML -> PDF için
const xlsx = require('xlsx'); // XLSX okuma için

// --- Yardımcı Fonksiyon: Puppeteer Tarayıcı Yönetimi ---
// Tarayıcı örneğini yönetmek için basit bir sarmalayıcı
// Daha yoğun kullanımda havuzlama (pooling) düşünülebilir.
let browserInstance = null;
async function getBrowser() {
    if (!browserInstance || !browserInstance.isConnected()) {
        console.log("Launching new Puppeteer browser instance...");
        try {
            // 1. Önce varsayılan yapılandırmayla puppeteer-core kullanarak dene
            try {
                console.log("Attempting to use puppeteer-core with system browser...");
                const puppeteerCore = require('puppeteer-core');
                
                // Windows için olası tarayıcı yolları
                const browserPaths = [
                    // Edge - Windows'ta varsayılan olarak yüklü
                    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
                    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
                    // Chrome yolları
                    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                    // Diğer olası Chrome yolları
                    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
                    // Firefox yolları
                    'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
                    'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe'
                ];
                
                // İlk bulunan tarayıcıyı kullan
                let executablePath = null;
                for (const browserPath of browserPaths) {
                    try {
                        if (require('fs').existsSync(browserPath)) {
                            executablePath = browserPath;
                            console.log(`Found browser at: ${browserPath}`);
                            break;
                        }
                    } catch (err) {
                        // Yol kontrolü hata verirse devam et
                    }
                }
                
                if (executablePath) {
                    browserInstance = await puppeteerCore.launch({
                        headless: true,
                        executablePath: executablePath,
                        args: ['--no-sandbox', '--disable-setuid-sandbox']
                    });
                    
                    console.log(`Successfully launched browser: ${executablePath}`);
                    
                    browserInstance.on('disconnected', () => {
                        console.log("Browser instance disconnected.");
                        browserInstance = null;
                    });
                    
                    return browserInstance;
                } else {
                    console.log("No system browser found, trying alternative method...");
                }
            } catch (coreError) {
                console.warn(`puppeteer-core approach failed: ${coreError.message}`);
            }
            
            // 2. Varsayılan puppeteer kullanmayı dene (kendi Chrome'unu indirir)
            try {
                console.log("Attempting to use regular puppeteer...");
                const puppeteer = require('puppeteer');
                
        browserInstance = await puppeteer.launch({
                    headless: "new", // Modern headless modu
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
                
                console.log("Successfully launched puppeteer with bundled Chromium");
                
        browserInstance.on('disconnected', () => {
                    console.log("Browser instance disconnected.");
            browserInstance = null;
        });
                
                return browserInstance;
            } catch (puppeteerError) {
                console.error(`Regular puppeteer approach failed: ${puppeteerError.message}`);
                throw puppeteerError; // Diğer yöntemlerde başarısız olursa hatayı fırlat
            }
        } catch (error) {
            console.error("Browser launch error:", error);
            
            // Hata durumunda standart PDF-Lib'e geri dön
            console.log("Browser could not be launched, using PDF-Lib method instead.");
            // null döndürerek alternatif yöntemlere yönlendirme yapılacak
            return null;
        }
    }
    return browserInstance;
}

// Uygulama kapanırken tarayıcıyı kapatmayı dene (her zaman çalışmayabilir)
process.on('exit', async () => {
    if (browserInstance) {
        console.log("Closing Puppeteer browser instance on exit...");
        await browserInstance.close();
        browserInstance = null;
    }
});

// --- Yardımcı Fonksiyon: Türkçe Karakter Desteği İçin Unicode Yazı Formatı Ayarı ---
async function drawTextWithUnicode(page, text, options) {
    // PDFDocument ile Unicode metin çizme
    const { x, y, font, size, color, lineHeight } = options;
    page.drawText(text, {
        x,
        y,
        font,
        size,
        color,
        lineHeight,
        encoding: 'unicode' // Unicode kodlaması kullanılıyor
    });
}

// --- Yeni Yaklaşım: TXT/CSV Dosyalarını HTML Üzerinden PDF'e Dönüştürme ---
async function txtToPdfViaPuppeteer(textContent, tempDir, fontFamily = 'Arial') {
    // Geçici HTML dosyası oluştur
    const tempHtmlPath = path.join(tempDir, `text_${Date.now()}.html`);
    
    // HTML içeriği hazırla
    let htmlContent = `<!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Converted Text</title>
        <style>
            body {
                font-family: ${fontFamily}, sans-serif;
                line-height: 1.5;
                margin: 20mm;
                white-space: pre-wrap;
            }
        </style>
    </head>
    <body>
        ${textContent.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
    </body>
    </html>`;
    
    // Geçici HTML dosyasını kaydet
    await fs.writeFile(tempHtmlPath, htmlContent, 'utf-8');
    
    // Puppeteer ile PDF'e dönüştür
    const browser = await getBrowser();
    
    // Browser başlatılamadıysa null dönecek, bu durumda alternatif yöntem kullanılmalı
    if (!browser) {
        throw new Error("Puppeteer tarayıcısı başlatılamadı.");
    }
    
    const page = await browser.newPage();
    await page.goto(`file://${tempHtmlPath}`, { waitUntil: 'networkidle0' });
    
    const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' }
    });
    
    await page.close();
    
    return { pdfBuffer, tempHtmlPath };
}

// --- Alternatif Yöntem: TXT/CSV Dosyalarını Doğrudan PDF-Lib ile İşle ---
async function txtToPdfViaLib(textContent, pdfDoc) {
    const page = pdfDoc.addPage(PageSizes.A4);
    const { width, height } = page.getSize();
    
    // Standard font kullan (Türkçe karakter desteği sınırlı olabilir)
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontSize = 11; // Biraz daha büyük font
    const lineHeight = fontSize * 1.3; // Satır yüksekliği
    const margin = { top: 50, right: 50, bottom: 50, left: 50 };
    
    // Metin içeriğini hazırla
    const lines = textContent.split(/\r?\n/);
    let currentPage = page;
    let y = height - margin.top;
    
    console.log(`Alternatif yöntem: ${lines.length} satır metin ekleniyor...`);
    
    // ASCII formatına dönüştür
    const toASCII = (text) => {
        if (!text) return '';
        try {
            return text
                // Türkçe karakterler
                .replace(/ç/g, 'c').replace(/Ç/g, 'C')
                .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
                .replace(/ı/g, 'i').replace(/İ/g, 'I')
                .replace(/ö/g, 'o').replace(/Ö/g, 'O')
                .replace(/ş/g, 's').replace(/Ş/g, 'S')
                .replace(/ü/g, 'u').replace(/Ü/g, 'U')
                // Diğer Latince karakterler
                .replace(/[áàâäãå]/g, 'a').replace(/[ÁÀÂÄÃÅ]/g, 'A')
                .replace(/[éèêë]/g, 'e').replace(/[ÉÈÊË]/g, 'E')
                .replace(/[íìîï]/g, 'i').replace(/[ÍÌÎÏ]/g, 'I')
                .replace(/[óòôöõø]/g, 'o').replace(/[ÓÒÔÖÕØ]/g, 'O')
                .replace(/[úùûü]/g, 'u').replace(/[ÚÙÛÜ]/g, 'U')
                .replace(/[ýÿ]/g, 'y').replace(/[ÝŸ]/g, 'Y')
                .replace(/ñ/g, 'n').replace(/Ñ/g, 'N')
                .replace(/æ/g, 'ae').replace(/Æ/g, 'AE')
                .replace(/œ/g, 'oe').replace(/Œ/g, 'OE')
                .replace(/ß/g, 'ss')
                .replace(/ç/g, 'c').replace(/Ç/g, 'C')
                // Para birimleri ve yaygın semboller
                .replace(/[€£¥₺]/g, '')
                .replace(/[©®™]/g, '')
                // Noktalama ve diğer
                .replace(/[""''«»]/g, '"')
                .replace(/[–—]/g, '-')
                // Son olarak geriye kalan ASCII-dışı karakterleri temizle
                .replace(/[^\x00-\x7F]/g, '');
        } catch (error) {
            console.warn(`toASCII dönüşümünde hata: ${error.message}`);
            // Hata durumunda basit temizleme yaparak dön
            return text.replace(/[^\x00-\x7F]/g, '');
        }
    };
    
    // Satır bölme fonksiyonu - uzun satırları kelime sınırlarından böler
    const wrapText = (text, maxWidth) => {
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';
        
        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const testWidth = font.widthOfTextAtSize(testLine, fontSize);
            
            if (testWidth <= maxWidth) {
                currentLine = testLine;
            } else {
                // Mevcut satırı ekle
                if (currentLine) lines.push(currentLine);
                // Yeni satırı başlat
                currentLine = word;
                
                // Tek kelime bile sığmıyorsa, karakterlerden böl
                if (font.widthOfTextAtSize(word, fontSize) > maxWidth) {
                    const chars = word.split('');
                    currentLine = '';
                    let charLine = '';
                    
                    for (const char of chars) {
                        const testChar = charLine + char;
                        if (font.widthOfTextAtSize(testChar, fontSize) <= maxWidth) {
                            charLine = testChar;
                        } else {
                            lines.push(charLine);
                            charLine = char;
                        }
                    }
                    
                    if (charLine) {
                        currentLine = charLine;
                    }
                }
            }
        }
        
        if (currentLine) {
            lines.push(currentLine);
        }
        
        return lines;
    };
    
    // Tüm metin satırlarını işle
    for (const line of lines) {
        // ASCII'ye dönüştür
        const asciiLine = toASCII(line);
        
        // Satırı genişliğe göre sar
        const usableWidth = width - margin.left - margin.right;
        const wrappedLines = wrapText(asciiLine, usableWidth);
        
        for (const wrappedLine of wrappedLines) {
            // Sayfa sınırını kontrol et, gerekirse yeni sayfa ekle
            if (y < margin.bottom + fontSize) {
                currentPage = pdfDoc.addPage(PageSizes.A4);
                y = height - margin.top;
            }
            
            // Metni çiz
            currentPage.drawText(wrappedLine, {
                x: margin.left,
                y: y,
                font: font,
                size: fontSize,
                color: rgb(0, 0, 0)
            });
            
            // Sonraki satıra geç
            y -= lineHeight;
        }
        
        // Paragraflarda ekstra boşluk bırak (her orijinal satırdan sonra)
        if (wrappedLines.length > 0) {
            y -= fontSize * 0.3; // Paragraf boşluğu
        }
    }
    
    return pdfDoc;
}

// --- Yardımcı Fonksiyon: Güvenli Dosya Okuma ---
async function safeReadFile(filePath, options = {}) {
    try {
        return await fs.readFile(filePath, options);
    } catch (error) {
        console.error(`Error reading file ${filePath}: ${error.code} - ${error.message}`);
        
        // Dosya bulunamadı veya erişim reddedildi hatalarını özelleştir
        if (error.code === 'ENOENT') {
            throw new Error(`File not found: ${path.basename(filePath)}`);
        } else if (error.code === 'EACCES') {
            throw new Error(`Access denied to file: ${path.basename(filePath)}`);
        }
        
        // Diğer hataları yeniden fırlat
        throw error;
    }
}

// --- DOCX Dosya Formatını Kontrol Et ---
async function isValidDocx(filePath) {
    try {
        // 1. Dosyanın varlığını ve boyutunu kontrol et
        const stats = await fs.stat(filePath).catch(err => {
            console.error(`File stat error for ${filePath}: ${err.message}`);
            return null;
        });
        
        if (!stats) return false;
        
        if (stats.size < 4) {
            console.warn(`File ${filePath} is too small to be a valid DOCX (${stats.size} bytes)`);
            return false;
        }
        
        console.log(`Checking DOCX validity for ${filePath} (${stats.size} bytes)`);

        try {
            // 2. DOCX dosyaları aslında ZIP arşividir, ilk baytlarını kontrol et
            const buffer = await fs.readFile(filePath, {encoding: null}).catch(err => {
                console.error(`File read error for ${filePath}: ${err.message}`);
                return null;
            });
            
            if (!buffer || buffer.length < 4) {
                console.warn(`Could not read file header: ${filePath}`);
                return false;
            }
            
            // ZIP dosyası imzası: "PK\x03\x04" (hex: 50 4B 03 04)
            const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B && 
                        buffer[2] === 0x03 && buffer[3] === 0x04;
            
            console.log(`File signature check: ${isZip ? 'Valid ZIP signature' : 'Invalid ZIP signature'}`);
            
            if (!isZip) {
                console.warn(`File ${filePath} is not a valid ZIP/DOCX file (wrong signature bytes)`);
                return false;
            }
            
            return true;
        } catch (readError) {
            console.error(`Error reading file header: ${readError.message}`);
            return false;
        }
    } catch (error) {
        console.error(`Error checking DOCX validity: ${error.message}`);
        return false;
    }
}

// --- Yardımcı Fonksiyon: Bozuk DOCX Dosyasını Düzelt ---
async function repairAndSaveDocx(inputPath, outputPath) {
    try {
        console.log(`Attempting to repair DOCX file: ${inputPath} -> ${outputPath}`);
        
        // Dosya varlığını kontrol et
        const exists = await fs.stat(inputPath).catch(() => false);
        if (!exists) {
            console.error(`Input file does not exist: ${inputPath}`);
            return { success: false, error: 'Input file not found' };
        }
        
        // Dosyayı oku - tam encoding ile
        const buffer = await fs.readFile(inputPath, {encoding: null});
        
        if (!buffer || buffer.length === 0) {
            console.error(`Empty file: ${inputPath}`);
            return { success: false, error: 'Empty input file' };
        }
        
        console.log(`Read ${buffer.length} bytes from input file`);
        
        // Yeni dosya için dizini oluştur
        const dir = path.dirname(outputPath);
        await fs.mkdir(dir, { recursive: true }).catch(() => {});
        
        // Sadece bayt olarak kopyalayarak yeni bir dosyaya yaz
        await fs.writeFile(outputPath, buffer);
        
        console.log(`Wrote ${buffer.length} bytes to: ${outputPath}`);
        
        // Çözüm başarılı mı kontrol et
        const isValid = await isValidDocx(outputPath);
        
        return { 
            success: isValid, 
            path: outputPath,
            message: isValid ? 'Successfully repaired file' : 'File still invalid after repair attempt'
        };
    } catch (error) {
        console.error(`Error repairing DOCX: ${error.message}`);
        return { success: false, error: error.message };
    }
}

/**
 * NOT: Eğer yukarıdaki yöntemler başarısız olursa, docx-preview paketi kullanılabilir
 * Bu paket daha toleranslı bir DOCX ayrıştırıcısı kullanır
 * 
 * Kurulum: npm install docx-preview
 * 
 * Kullanım örneği:
 * const { renderAsync } = require('docx-preview');
 * const buffer = await fs.readFile(docxPath);
 * const container = document.createElement('div');
 * await renderAsync(buffer, container);
 * const htmlContent = container.innerHTML;
 */

/**
 * Verilen dosyayı PDF'e dönüştürür (Genişletilmiş Formatlar).
 * @param {string} inputPath - Dönüştürülecek dosyanın yolu.
 * @param {string} originalFilename - Orijinal dosya adı.
 * @param {string} mimeType - Dosyanın MIME türü.
 * @param {string} outputDir - Oluşturulan PDF'in kaydedileceği dizin.
 * @param {string} tempDir - Ara dosyalar için geçici dizin.
 * @returns {Promise<string>} Oluşturulan PDF dosyasının adı.
 */
async function generatePdf(inputPath, originalFilename, mimeType, outputDir, tempDir) {
    const pdfDoc = await PDFDocument.create();
    let tempFiles = [inputPath]; // Silinecek dosyaları takip et
    let generatedPdfPath = ''; // Oluşturulan PDF yolu

    try {
        console.log(`Starting conversion for ${mimeType}`);

        switch (mimeType) {
            // --- Doğrudan Desteklenen Görüntüler ---
            case 'image/jpeg':
            case 'image/png':
                {
                    const fileBuffer = await fs.readFile(inputPath);
                    const image = mimeType === 'image/jpeg'
                        ? await pdfDoc.embedJpg(fileBuffer)
                        : await pdfDoc.embedPng(fileBuffer);
                    const { width, height } = image.scale(1);
                    const page = pdfDoc.addPage([width, height]);
                    page.drawImage(image, { x: 0, y: 0, width, height });
                    console.log(`Embedded ${mimeType} image.`);
                }
                break;

            // --- Sharp ile Dönüştürülecek Görüntüler ---
            case 'image/gif':
            case 'image/bmp':
            case 'image/tiff':
            case 'image/webp':
                {
                    console.log(`Converting ${mimeType} to PNG using Sharp...`);
                    const pngBuffer = await sharp(inputPath)
                        // GIF için sadece ilk kareyi al (basitleştirme)
                        .png()
                        .toBuffer();
                    const image = await pdfDoc.embedPng(pngBuffer);
                    const { width, height } = image.scale(1);
                    const page = pdfDoc.addPage([width, height]);
                    page.drawImage(image, { x: 0, y: 0, width, height });
                    console.log(`Embedded converted ${mimeType} image.`);
                }
                break;

             // --- SVG (Sharp ile Rasterleştirme) ---
            case 'image/svg+xml':
                {
                    console.log(`Converting SVG to PNG using Sharp...`);
                    // SVG'yi okurken yoğunluk (density) belirterek çözünürlüğü artırabiliriz
                    const pngBuffer = await sharp(inputPath, { density: 300 }) // Örnek: 300 DPI
                        .png()
                        .toBuffer();
                    const image = await pdfDoc.embedPng(pngBuffer);
                    const { width, height } = image.scale(1);
                    const page = pdfDoc.addPage([width, height]);
                    page.drawImage(image, { x: 0, y: 0, width, height });
                    console.log(`Embedded rasterized SVG image.`);
                }
                break;

            // --- Düz Metin ve CSV ---
            case 'text/plain':
            case 'text/csv':
                {
                    // Metin içeriğini oku
                    const textContent = await fs.readFile(inputPath, 'utf-8');
                    console.log(`Converting ${mimeType} to PDF...`);
                    
                    try {
                        // Önce Puppeteer ile deniyoruz (tam Türkçe desteği için)
                        console.log(`Trying HTML + Puppeteer method first for Unicode support...`);
                        const fontFamily = mimeType === 'text/csv' ? 'Courier, monospace' : 'Arial, sans-serif';
                        const { pdfBuffer, tempHtmlPath } = await txtToPdfViaPuppeteer(textContent, tempDir, fontFamily);
                        tempFiles.push(tempHtmlPath);
                        
                        // PDF buffer'ı PDF-Lib ile birleştir
                        const tempPdfDoc = await PDFDocument.load(pdfBuffer);
                        const copiedPages = await pdfDoc.copyPages(tempPdfDoc, tempPdfDoc.getPageIndices());
                        copiedPages.forEach(page => pdfDoc.addPage(page));
                        
                        console.log(`Successfully converted ${mimeType} to PDF with full Unicode support.`);
                    } catch (puppeteerError) {
                        // Puppeteer başarısız olursa, alternatif yöntemi kullan
                        console.warn(`Puppeteer method failed: ${puppeteerError.message}`);
                        console.log(`Falling back to PDF-Lib direct text rendering (limited character support)...`);
                        
                        // PDF-Lib ile doğrudan metin ekle (Türkçe karakterler sınırlı)
                        await txtToPdfViaLib(textContent, pdfDoc);
                        console.log(`Converted ${mimeType} to PDF using fallback method.`);
                    }
                }
                break;

            // --- HTML (Puppeteer ile) ---
            case 'text/html':
                {
                    console.log(`Converting HTML to PDF using Puppeteer...`);
                    const browser = await getBrowser();
                    const page = await browser.newPage();
                    const htmlContent = await fs.readFile(inputPath, 'utf-8');
                    // HTML içeriğini doğrudan yükle
                    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
                    // Veya dosyadan yükle: await page.goto(`file://${inputPath}`, { waitUntil: 'networkidle0' });

                    const pdfBuffer = await page.pdf({
                        format: 'A4',
                        printBackground: true, // Arka planları yazdır
                        margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' }
                    });
                    await page.close(); // Sayfayı kapat

                    // Oluşturulan PDF'i pdf-lib ile birleştir (veya doğrudan buffer'ı kullan)
                    const tempPdfDoc = await PDFDocument.load(pdfBuffer);
                    const copiedPages = await pdfDoc.copyPages(tempPdfDoc, tempPdfDoc.getPageIndices());
                    copiedPages.forEach((copiedPage) => pdfDoc.addPage(copiedPage));
                    console.log(`Converted HTML to PDF.`);
                }
                break;

            // --- DOCX (Mammoth -> HTML -> Puppeteer) ---
            case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
                {
                    try {
                    console.log(`Converting DOCX to HTML using Mammoth...`);
                        
                        // Uzantı tespiti ve düzeltme
                        const fileExt = path.extname(originalFilename).toLowerCase();
                        const hasValidExtension = ['.docx', '.doc'].includes(fileExt);
                        
                        console.log(`Original filename: ${originalFilename}, extension: ${fileExt}, valid extension: ${hasValidExtension}`);
                        
                        // Dosya içeriğini raw olarak oku
                        const fileBuffer = await fs.readFile(inputPath, {encoding: null})
                            .catch(err => {
                                console.error(`Error reading DOCX file: ${err.message}`);
                                throw new Error(`Could not read document file: ${err.message}`);
                            });
                                
                        // Debug: Buffer boyutu kontrolü
                        console.log(`Read DOCX file buffer: ${fileBuffer.length} bytes`);
                        
                        // Yeni bir geçici dosya oluştur - uzantı kontrolü ile
                        const tempDocxPath = path.join(tempDir, `temp_${Date.now()}.docx`); // Her zaman küçük harfli .docx uzantısı
                        
                        await fs.writeFile(tempDocxPath, fileBuffer)
                            .catch(err => {
                                console.error(`Error creating temporary file: ${err.message}`);
                                throw new Error(`Failed to create temporary file: ${err.message}`);
                            });
                            
                        tempFiles.push(tempDocxPath);
                        
                        console.log(`Created temporary copy of document with standardized extension (.docx): ${tempDocxPath}`);
                        
                        // Dosya formatını kontrol et
                        const isValid = await isValidDocx(tempDocxPath);
                        
                        let docxPathToUse = tempDocxPath;
                        
                        // Eğer geçerli değilse, onarma işlemi dene
                        if (!isValid) {
                            console.log(`Document file is not in a valid DOCX/ZIP format, attempting to repair...`);
                            const repairedPath = path.join(tempDir, `repaired_${Date.now()}.docx`);
                            const repairResult = await repairAndSaveDocx(tempDocxPath, repairedPath);
                            
                            if (repairResult.success) {
                                console.log(`Successfully repaired document file at ${repairedPath}`);
                                tempFiles.push(repairedPath);
                                docxPathToUse = repairedPath;
                            } else {
                                console.warn(`Failed to repair document file: ${repairResult.error || 'Unknown error'}`);
                                
                                // Alternatif yönteme geç
                                throw new Error(`Invalid DOCX format: ${repairResult.error || 'Document is not a valid Word file'}`);
                            }
                        }
                        
                        // Mammoth'u normalize edilmiş/onarılmış dosya üzerinde çalıştır
                        console.log(`Processing document with Mammoth from: ${docxPathToUse}`);
                        let mammothResult;
                        
                        try {
                            // Mammoth ayarlarını daha sağlam hale getir
                            mammothResult = await mammoth.convertToHtml({ 
                                path: docxPathToUse,
                                includeDefaultStyleMap: true,
                                preserveEmptyParagraphs: true,
                                styleMap: [
                                    "p[style-name='Heading 1'] => h1:fresh",
                                    "p[style-name='Heading 2'] => h2:fresh",
                                    "p[style-name='Heading 3'] => h3:fresh",
                                    "p[style-name='Title'] => h1.title:fresh"
                                ],
                                transformDocument: mammoth.transforms.paragraph(function(paragraph) {
                                    // Boş paragrafları tut ama görsel olarak ayır
                                    if (paragraph.content.length === 0) {
                                        return { type: "paragraph", content: [{ type: "text", value: " " }] };
                                    }
                                    return paragraph;
                                })
                            });
                            
                            // Debug: Mammoth dönüşüm sonucu
                            console.log(`Mammoth conversion result: ${mammothResult.messages.length} messages`);
                            if (mammothResult.messages.length > 0) {
                                console.log(`Mammoth messages: ${JSON.stringify(mammothResult.messages)}`);
                            }
                            
                        } catch (mammothError) {
                            console.error(`Mammoth HTML conversion error: ${mammothError.message}`);
                            throw new Error(`Document format error: ${mammothError.message}`);
                        }
                            
                    const htmlContent = mammothResult.value;
                        
                        // Debug: HTML içerik kontrolü
                        console.log(`Generated HTML content length: ${htmlContent ? htmlContent.length : 0} bytes`);
                        
                        if (!htmlContent || htmlContent.trim() === '') {
                            console.warn('Document file contains no extractable content via Mammoth');
                            throw new Error('Document file contains no extractable content');
                        }
                        
                        // Geliştirilmiş HTML şablonu
                        const enhancedHtmlContent = `<!DOCTYPE html>
                        <html>
                        <head>
                            <meta charset="UTF-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <title>Converted Document: ${originalFilename}</title>
                            <style>
                                body {
                                    font-family: 'Arial', sans-serif;
                                    font-size: 12pt;
                                    line-height: 1.5;
                                    margin: 20mm;
                                    color: #333;
                                    text-rendering: optimizeLegibility;
                                }
                                h1, h2, h3, h4, h5, h6 {
                                    margin-top: 1.25em;
                                    margin-bottom: 0.5em;
                                    page-break-after: avoid;
                                    color: #000;
                                    font-weight: bold;
                                }
                                h1 { font-size: 18pt; }
                                h2 { font-size: 16pt; }
                                h3 { font-size: 14pt; }
                                p {
                                    margin-bottom: 0.5em;
                                    text-align: justify;
                                }
                                ul, ol {
                                    margin-bottom: 1em;
                                    padding-left: 2em;
                                }
                                li {
                                    margin-bottom: 0.25em;
                                }
                                table {
                                    border-collapse: collapse;
                                    width: 100%;
                                    margin: 1em 0;
                                    page-break-inside: auto;
                                }
                                th, td {
                                    border: 1px solid #ddd;
                                    padding: 8px;
                                    page-break-inside: avoid;
                                }
                                th {
                                    background-color: #f2f2f2;
                                    font-weight: bold;
                                }
                                img {
                                    max-width: 100%;
                                    height: auto;
                                }
                                a {
                                    color: #0066cc;
                                    text-decoration: underline;
                                }
                                /* Sayfa sonu kontrolü */
                                .page-break {
                                    page-break-after: always;
                                }
                                /* Üstbilgi ve altbilgi için stiller */
                                @page {
                                    margin: 15mm;
                                }
                                /* Boş paragraflar */
                                p:empty::after {
                                    content: " ";
                                    display: block;
                                    min-height: 1em;
                                }
                            </style>
                        </head>
                        <body>
                            <h1 class="document-title">${path.basename(originalFilename, fileExt)}</h1>
                            <div class="document-content">
                                ${htmlContent}
                            </div>
                        </body>
                        </html>`;
                        
                    // Oluşan HTML'i geçici bir dosyaya yaz (Puppeteer için daha güvenilir)
                        const tempHtmlPath = path.join(tempDir, `${path.basename(docxPathToUse)}.html`);
                        await fs.writeFile(tempHtmlPath, enhancedHtmlContent, 'utf-8');
                    tempFiles.push(tempHtmlPath); // Temizlik listesine ekle
                    console.log(`DOCX converted to temporary HTML: ${tempHtmlPath}`);

                    console.log(`Converting temporary HTML to PDF using Puppeteer...`);
                    const browser = await getBrowser();
                        
                        if (!browser) {
                            throw new Error("Puppeteer tarayıcısı başlatılamadı.");
                        }
                        
                    const page = await browser.newPage();
                        
                        // İsteği izleme
                        page.on('requestfailed', request => {
                            console.log(`Request failed: ${request.url()}`);
                        });
                        
                        // Sayfa yüklenmeden önce hazırlık
                        await page.setViewport({ width: 1200, height: 1600 });
                        
                        // İçeriği yükle
                        try {
                            await page.goto(`file://${tempHtmlPath}`, { 
                                waitUntil: ['load', 'networkidle0'],
                                timeout: 30000
                            });
                        } catch (pageError) {
                            console.error(`Page navigation error: ${pageError.message}`);
                            throw pageError;
                        }
                        
                        // İçeriğin sayfaya doğru yüklendiğinden emin ol
                        const contentCheck = await page.evaluate(() => {
                            const content = document.querySelector('.document-content');
                            return content ? content.innerHTML.length : 0;
                        });
                        
                        console.log(`Content check in browser: ${contentCheck} characters of HTML content`);
                        
                        if (contentCheck < 10) {
                            console.warn(`Warning: Document content appears to be very short or empty in browser`);
                        }
                        
                        // PDF oluştur
                        const pdfBuffer = await page.pdf({ 
                            format: 'A4', 
                            printBackground: true, 
                            margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
                            displayHeaderFooter: true,
                            headerTemplate: '<div style="font-size: 8px; margin-left: 15mm; width: 100%;">' + path.basename(originalFilename, fileExt) + '</div>',
                            footerTemplate: '<div style="font-size: 8px; text-align: center; width: 100%;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
                        });
                        
                    await page.close();

                        console.log(`PDF buffer generated: ${pdfBuffer.length} bytes`);

                        // PDF buffer'ı PDF-Lib ile yükle
                    const tempPdfDoc = await PDFDocument.load(pdfBuffer);
                    const copiedPages = await pdfDoc.copyPages(tempPdfDoc, tempPdfDoc.getPageIndices());
                        
                        // Sayfaları ekle
                    copiedPages.forEach((copiedPage) => pdfDoc.addPage(copiedPage));
                        console.log(`Converted DOCX to PDF via HTML. Added ${copiedPages.length} pages.`);
                    } catch (puppeteerError) {
                        // Puppeteer başarısız olursa, düz metin olarak dene
                        console.warn(`Puppeteer method failed for DOCX: ${puppeteerError.message}`);
                        console.log(`Falling back to basic text conversion for DOCX...`);
                        
                        try {
                            // Mammoth ile düz metne dönüştür
                            // Normalize edilmiş dosya yolunu kullan (yukarıda oluşturulmuş olmalı)
                            const tempDocxPath = tempFiles.find(f => f !== inputPath && f.toLowerCase().endsWith('.docx'));
                            let mammothTextResult;
                            
                            if (!tempDocxPath || !await fs.stat(tempDocxPath).catch(() => false)) {
                                // Eğer yukarıdaki adımdan normalize edilmiş bir dosya yoksa, uzantısı ne olursa olsun
                                // ham dosyadan içerik çıkarmayı dene
                                console.log('No valid temporary document file found, trying direct text extraction...');
                                
                                try {
                                    // Doğrudan orijinal dosyadan metin çıkarmayı dene
                                    mammothTextResult = await mammoth.extractRawText({ 
                                        path: inputPath,
                                        preserveEmptyParagraphs: true
                                    }).catch(err => {
                                        console.error(`Raw text extraction error: ${err.message}`);
                                        throw err;
                                    });
                                            
                                    if (!mammothTextResult || !mammothTextResult.value) {
                                        throw new Error('No text content extracted');
                                    }
                                    
                                    console.log(`Successfully extracted text directly from original file: ${mammothTextResult.value.length} characters`);
                                } catch (directExtractionError) {
                                    console.error(`Direct extraction failed: ${directExtractionError.message}`);
                                    
                                    // Son çare olarak dosyayı yeniden kopyala ve dene
                                    console.log('Creating fresh temporary DOCX file for text extraction...');
                                    
                                    try {
                                        const fileBuffer = await fs.readFile(inputPath, {encoding: null});
                                        const newTempPath = path.join(tempDir, `temp_text_${Date.now()}.docx`);
                                        
                                        await fs.writeFile(newTempPath, fileBuffer);
                                        tempFiles.push(newTempPath);
                                        
                                        console.log(`Will use new temporary file: ${newTempPath}`);
                                        
                                        mammothTextResult = await mammoth.extractRawText({ 
                                            path: newTempPath,
                                            preserveEmptyParagraphs: true
                                        }).catch(err => {
                                            console.error(`Final text extraction attempt failed: ${err.message}`);
                                            throw new Error(`Document text extraction failed: ${err.message}`);
                                        });
                                    } catch (finalError) {
                                        // Son çare başarısız oldu, manuel metin hazırla
                                        console.warn('All extraction attempts failed, creating basic text content');
                                        mammothTextResult = { 
                                            value: `This document could not be converted properly.\nFilename: ${originalFilename}\nPlease check if the file is a valid Office document.` 
                                        };
                                    }
                                }
                            } else {
                                console.log(`Using existing temporary document file: ${tempDocxPath}`);
                                try {
                                    mammothTextResult = await mammoth.extractRawText({ 
                                        path: tempDocxPath,
                                        preserveEmptyParagraphs: true
                                    });
                                } catch (extractionError) {
                                    console.error(`Text extraction error: ${extractionError.message}`);
                                    
                                    // Hata durumunda manuel metin oluştur
                                    mammothTextResult = { 
                                        value: `This document could not be converted properly.\nFilename: ${originalFilename}\nPlease check if the file is a valid Office document.` 
                                    };
                                }
                            }
                            
                            // Dönüştürülen metin içeriğini kontrol et
                            const textContent = mammothTextResult.value || '';
                            console.log(`Extracted text content length: ${textContent.length} characters`);
                            
                            if (!textContent.trim()) {
                                console.warn('Document appears to be empty or corrupted');
                            }
                            
                            // Metin yerine HTML olarak tekrar dene
                            if (textContent.length > 0) {
                                try {
                                    console.log(`Trying to create PDF from raw text via HTML...`);
                                    
                                    // HTML içeriğini hazırla - satır aralarını düzgün formatlayarak
                                    const simpleHtmlContent = `<!DOCTYPE html>
                                    <html>
                                    <head>
                                        <meta charset="UTF-8">
                                        <title>${originalFilename}</title>
                                        <style>
                                            body { 
                                                font-family: Arial, sans-serif; 
                                                margin: 20mm;
                                                line-height: 1.5;
                                                white-space: pre-wrap;
                                            }
                                            h1 { font-size: 18pt; }
                                        </style>
                                    </head>
                                    <body>
                                        <h1>${path.basename(originalFilename, fileExt)}</h1>
                                        <div>${textContent.replace(/\n/g, '<br>')}</div>
                                    </body>
                                    </html>`;
                                    
                                    // Geçici HTML dosyasını kaydet
                                    const tempTextHtmlPath = path.join(tempDir, `docx_text_${Date.now()}.html`);
                                    await fs.writeFile(tempTextHtmlPath, simpleHtmlContent, 'utf-8');
                                    tempFiles.push(tempTextHtmlPath);
                                    
                                    // Puppeteer ile PDF'e dönüştür
                                    const browser = await getBrowser();
                                    
                                    if (browser) {
                                        const page = await browser.newPage();
                                        await page.goto(`file://${tempTextHtmlPath}`, { waitUntil: 'networkidle0' });
                                        
                                        const textPdfBuffer = await page.pdf({
                                            format: 'A4',
                                            printBackground: true,
                                            margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
                                            displayHeaderFooter: true,
                                            headerTemplate: '<div></div>',
                                            footerTemplate: '<div style="font-size: 8px; text-align: center; width: 100%;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
                                        });
                                        
                                        await page.close();
                                        
                                        // PDF buffer'ı birleştir
                                        const tempTextPdfDoc = await PDFDocument.load(textPdfBuffer);
                                        const copiedTextPages = await pdfDoc.copyPages(tempTextPdfDoc, tempTextPdfDoc.getPageIndices());
                                        copiedTextPages.forEach(page => pdfDoc.addPage(page));
                                        
                                        console.log(`Added DOCX content as formatted text via HTML method (${copiedTextPages.length} pages).`);
                                        return; // Başarılı olduk, devam etmeye gerek yok
                                    }
                                } catch (htmlTextError) {
                                    console.warn(`HTML text method failed: ${htmlTextError.message}`);
                                    // Düz metin yöntemine geri dön
                                }
                            }
                            
                            // Son çare: Düz metni PDF'e ekle
                            const page = pdfDoc.addPage(PageSizes.A4);
                            const { width, height } = page.getSize();
                            const baseFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
                            const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
                            const fontSize = 11;
                            const titleSize = 16;
                            const margin = { top: 50, right: 50, bottom: 50, left: 50 };
                            const lineHeight = fontSize * 1.4;
                            
                            let currentPage = page;
                            let y = height - margin.top;
                            
                            // Başlık olarak dosya adını ekle
                            currentPage.drawText(path.basename(originalFilename, path.extname(originalFilename)), {
                                x: margin.left,
                                y: y,
                                font: boldFont,
                                size: titleSize,
                                color: rgb(0, 0, 0)
                            });
                            
                            y -= titleSize * 2;
                            
                            // Metni satırlara böl
                            const lines = textContent.split(/\r?\n/);
                            
                            // Kullanılabilir genişliği hesapla
                            const usableWidth = width - margin.left - margin.right;
                            
                            // Her satırı işle
                            for (const line of lines) {
                                // Özel karakterleri düzenle
                                const processedLine = line.replace(/[^\x20-\x7E]/g, ' ');
                                
                                // Satırı kelime sınırlarında böl
                                const words = processedLine.split(' ');
                                let currentLine = '';
                                
                                for (const word of words) {
                                    const testLine = currentLine ? `${currentLine} ${word}` : word;
                                    const testWidth = baseFont.widthOfTextAtSize(testLine, fontSize);
                                    
                                    if (testWidth <= usableWidth) {
                                        currentLine = testLine;
                                    } else {
                                        // Mevcut satırı çiz
                                        if (currentLine) {
                                            // Sayfa sınırını kontrol et
                                            if (y < margin.bottom + fontSize) {
                                                currentPage = pdfDoc.addPage(PageSizes.A4);
                                                y = height - margin.top;
                                            }
                                            
                                            try {
                                                currentPage.drawText(currentLine, {
                                                    x: margin.left,
                                                    y: y,
                                                    font: baseFont,
                                                    size: fontSize,
                                                    color: rgb(0, 0, 0)
                                                });
                                            } catch (textDrawError) {
                                                console.warn(`Error drawing text: ${textDrawError.message}`);
                                            }
                                            
                                            y -= lineHeight;
                                        }
                                        
                                        // Yeni satırı başlat
                                        currentLine = word;
                                    }
                                }
                                
                                // Son satırı çiz
                                if (currentLine) {
                                    // Sayfa sınırını kontrol et
                                    if (y < margin.bottom + fontSize) {
                                        currentPage = pdfDoc.addPage(PageSizes.A4);
                                        y = height - margin.top;
                                    }
                                    
                                    try {
                                        currentPage.drawText(currentLine, {
                                            x: margin.left,
                                            y: y,
                                            font: baseFont,
                                            size: fontSize,
                                            color: rgb(0, 0, 0)
                                        });
                                    } catch (textDrawError) {
                                        console.warn(`Error drawing text: ${textDrawError.message}`);
                                    }
                                    
                                    y -= lineHeight;
                                } else if (line.trim() === '') {
                                    // Boş satır durumunda sadece boşluk bırak
                                    y -= lineHeight;
                                }
                            }
                            
                            console.log(`Added DOCX data as basic text using direct PDF rendering method.`);
                        } catch (fallbackError) {
                            console.error(`Even fallback method failed for DOCX: ${fallbackError.message}`);
                            
                            // Son çare olarak boş bir sayfa ekle ve hata mesajı koy
                            const errorPage = pdfDoc.addPage(PageSizes.A4);
                            const { width, height } = errorPage.getSize();
                            const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
                            const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
                            
                            // Başlık
                            errorPage.drawText('Document Conversion Error', {
                                x: 50,
                                y: height - 50,
                                font: boldFont,
                                size: 16,
                                color: rgb(0.8, 0, 0)
                            });
                            
                            // Hata mesajı
                            errorPage.drawText(`Could not convert document: ${originalFilename}`, {
                                x: 50,
                                y: height - 80,
                                font: font,
                                size: 12,
                                color: rgb(0, 0, 0)
                            });
                            
                            errorPage.drawText(`Error: ${fallbackError.message || 'Unknown conversion error'}`, {
                                x: 50,
                                y: height - 100,
                                font: font,
                                size: 10,
                                color: rgb(0.3, 0.3, 0.3)
                            });
                            
                            console.log(`Added error page for failed DOCX conversion.`);
                        }
                    }
                }
                break;

            // --- XLSX (SheetJS ile Oku, HTML Tablo Olarak Yaz ve Puppeteer ile Dönüştür) ---
             case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
                {
                    console.log(`Reading XLSX data using SheetJS...`);
                    const workbook = xlsx.readFile(inputPath);
                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];
                    
                    try {
                        // Önce Puppeteer ile deneyelim (tam format ve Unicode desteği için)
                        console.log(`Converting XLSX to HTML table with Puppeteer...`);
                        
                        // XLSX'i HTML tablosuna dönüştür
                        const htmlTable = xlsx.utils.sheet_to_html(worksheet);
                        
                        // HTML içeriğini hazırla - geliştirilmiş tablo stili
                        const htmlContent = `<!DOCTYPE html>
                        <html>
                        <head>
                            <meta charset="UTF-8">
                            <title>Converted Spreadsheet</title>
                            <style>
                                body { 
                                    font-family: Arial, sans-serif; 
                                    margin: 10mm;
                                    font-size: 10pt;
                                }
                                table { 
                                    border-collapse: collapse; 
                                    width: 100%;
                                    margin: 0 auto;
                                    page-break-inside: auto;
                                }
                                th, td { 
                                    border: 1px solid #ddd; 
                                    padding: 6px;
                                    text-align: left;
                                    vertical-align: top;
                                    page-break-inside: avoid;
                                    max-width: 150px;
                                    overflow-wrap: break-word;
                                }
                                th { 
                                    background-color: #f2f2f2; 
                                    font-weight: bold;
                                }
                                tr { 
                                    page-break-inside: avoid; 
                                    page-break-after: auto;
                                }
                                thead { display: table-header-group; }
                                tfoot { display: table-footer-group; }
                            </style>
                        </head>
                        <body>
                            ${htmlTable}
                        </body>
                        </html>`;
                        
                        // Geçici HTML dosyasını kaydet
                        const tempHtmlPath = path.join(tempDir, `xlsx_${Date.now()}.html`);
                        await fs.writeFile(tempHtmlPath, htmlContent, 'utf-8');
                        tempFiles.push(tempHtmlPath);
                        
                        // Puppeteer ile PDF'e dönüştür - Geliştirilmiş ayarlar
                        const browser = await getBrowser();
                        
                        if (!browser) {
                            throw new Error("Puppeteer tarayıcısı başlatılamadı.");
                        }
                        
                        const page = await browser.newPage();
                        await page.goto(`file://${tempHtmlPath}`, { waitUntil: 'networkidle0' });
                        
                        // Tablo boyutunu belirlemek için sayfadaki içeriği ölç
                        const tableSize = await page.evaluate(() => {
                            const table = document.querySelector('table');
                            if (!table) return { width: 0, height: 0 };
                            return {
                                width: table.offsetWidth,
                                height: table.offsetHeight
                            };
                        });
                        
                        // Tablo boyutuna göre yatay veya dikey mod seç
                        const isLandscape = tableSize.width > 500; // 500px'den geniş tablolar için yatay mod
                        
                        const pdfBuffer = await page.pdf({ 
                            format: 'A4', 
                            printBackground: true, 
                            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
                            landscape: isLandscape,
                            scale: 0.9, // Sayfaya sığdırmak için küçük bir ölçekleme
                            displayHeaderFooter: true,
                            headerTemplate: '<div></div>', // Boş üstbilgi
                            footerTemplate: '<div style="font-size: 8px; text-align: center; width: 100%;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>', // Sayfa numarası
                        });
                        await page.close();
                        
                        // PDF buffer'ı PDF-Lib ile birleştir
                        const tempPdfDoc = await PDFDocument.load(pdfBuffer);
                        const copiedPages = await pdfDoc.copyPages(tempPdfDoc, tempPdfDoc.getPageIndices());
                        copiedPages.forEach(page => pdfDoc.addPage(page));
                        
                        console.log(`Added XLSX data as formatted HTML table with full Unicode support.`);
                    } catch (puppeteerError) {
                        // Puppeteer başarısız olursa, basit CSV metni olarak ekle
                        console.warn(`Puppeteer method failed for XLSX: ${puppeteerError.message}`);
                        console.log(`Falling back to basic text conversion for XLSX...`);
                        
                        // XLSX'i CSV formatına dönüştür
                    const csvData = xlsx.utils.sheet_to_csv(worksheet);

                        // CSV verilerini geliştirilmiş tablo formatıyla ekle
                    const page = pdfDoc.addPage(PageSizes.A4);
                    const { width, height } = page.getSize();
                        
                        // Sayfayı hazırla
                        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
                        const headerFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
                        const titleFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
                        
                    const fontSize = 9;
                        const titleSize = 14;
                        const margin = { top: 50, right: 40, bottom: 50, left: 40 };
                        const lineHeight = fontSize * 1.2;
                        
                        let currentPage = page;
                        let y = height - margin.top;
                        
                        // Başlık ekle
                        const sheetName = firstSheetName || "Spreadsheet";
                        currentPage.drawText(sheetName, {
                            x: margin.left,
                            y: y,
                            font: titleFont,
                            size: titleSize,
                            color: rgb(0, 0, 0)
                        });
                        
                        y -= titleSize * 2;
                        
                        // CSV verilerini tabloya çevir
                        const rows = csvData.split(/\r?\n/);
                        if (rows.length === 0) return; // Boş dosya
                        
                        // Özel karakterleri yönet - PDF-Lib ile kullanılabilecek kodlama
                        const sanitizeText = (text) => {
                            if (!text) return '';
                            try {
                                // İlk olarak yaygın özel karakterleri işle
                                return text
                                    .replace(/&quot;/g, '"')
                                    .replace(/&amp;/g, '&')
                                    .replace(/&lt;/g, '<')
                                    .replace(/&gt;/g, '>')
                                    .replace(/&nbsp;/g, ' ')
                                    // Karakter limitini kontrol et ve kes (overflow önleme)
                                    .substring(0, 100);
                            } catch (error) {
                                console.warn(`Text sanitization error: ${error.message}`);
                                return text.substring(0, 100);
                            }
                        };
                        
                        // Sütun genişliklerini belirle
                        const calculateColumnWidths = (rows) => {
                            const columnWidths = [];
                            const maxColumns = rows.reduce((max, row) => Math.max(max, row.split(',').length), 0);
                            
                            // Her sütun için maksimum genişliği hesapla
                            for (let col = 0; col < maxColumns; col++) {
                                let maxWidth = 0;
                                for (let row of rows) {
                                    const cells = row.split(',');
                                    if (cells[col]) {
                                        // Hücre içeriğine göre genişlik tahmini (karakter sayısı * ortalama karakter genişliği)
                                        const cellWidth = sanitizeText(cells[col]).length * (fontSize * 0.6);
                                        maxWidth = Math.max(maxWidth, cellWidth);
                                    }
                                }
                                columnWidths.push(Math.min(maxWidth, 120)); // Maksimum sütun genişliği sınırlaması
                            }
                            
                            // Toplam genişlik kontrolü
                            const availableWidth = width - margin.left - margin.right;
                            const totalWidth = columnWidths.reduce((sum, w) => sum + w, 0);
                            
                            // Sütunları mevcut alana ölçekle
                            if (totalWidth > availableWidth) {
                                const scaleFactor = availableWidth / totalWidth;
                                return columnWidths.map(w => w * scaleFactor);
                            }
                            
                            return columnWidths;
                        };
                        
                        const columnWidths = calculateColumnWidths(rows);
                        
                        // Her bir satırı işle
                        for (let i = 0; i < rows.length; i++) {
                            const row = rows[i];
                            if (!row.trim()) continue; // Boş satırları atla
                            
                            const cells = row.split(',');
                            
                            // Sayfa taşma kontrolü
                            if (y < margin.bottom + fontSize * 2) {
                                currentPage = pdfDoc.addPage(PageSizes.A4);
                                y = height - margin.top;
                                
                                // Yeni sayfada başlık tekrar edilir
                                currentPage.drawText(`${sheetName} (devam)`, {
                                    x: margin.left,
                                    y: y,
                                    font: titleFont,
                                    size: titleSize - 2,
                                    color: rgb(0, 0, 0)
                                });
                                y -= titleSize;
                                
                                // Başlık satırını yeni sayfada tekrarla
                                if (i > 0) {
                                    y -= lineHeight;
                                    const headerRow = rows[0].split(',');
                                    
                                    // Başlık arka planı
                                    currentPage.drawRectangle({
                                        x: margin.left,
                                        y: y - fontSize,
                                        width: width - margin.left - margin.right,
                                        height: fontSize + 8,
                                        color: rgb(0.9, 0.9, 0.9),
                                        borderWidth: 0.5,
                                        borderColor: rgb(0.7, 0.7, 0.7),
                                    });
                                    
                                    let headerX = margin.left;
                                    for (let j = 0; j < headerRow.length; j++) {
                                        if (j < columnWidths.length) {
                                            const cellValue = sanitizeText(headerRow[j] || '');
                                            currentPage.drawText(cellValue, {
                                                x: headerX + 4,
                                                y: y,
                                                font: headerFont,
                            size: fontSize,
                                                color: rgb(0, 0, 0)
                                            });
                                            headerX += columnWidths[j] + 8; // 8px hücreler arası boşluk
                                        }
                                    }
                                    
                                    y -= lineHeight + 8;
                                }
                            }
                            
                            const isHeader = (i === 0); // İlk satır başlık
                            let x = margin.left;
                            
                            // Başlık satırı için arka plan çiz
                            if (isHeader) {
                                currentPage.drawRectangle({
                                    x: margin.left,
                                    y: y - fontSize,
                                    width: width - margin.left - margin.right,
                                    height: fontSize + 8,
                                    color: rgb(0.9, 0.9, 0.9),
                                    borderWidth: 0.5,
                                    borderColor: rgb(0.7, 0.7, 0.7),
                                });
                            }
                            
                            // Satır için çizgi altlık çiz (zebra görünümü için)
                            if (!isHeader && i % 2 === 0) {
                                currentPage.drawRectangle({
                                    x: margin.left,
                                    y: y - fontSize,
                                    width: width - margin.left - margin.right,
                                    height: fontSize + 6,
                                    color: rgb(0.97, 0.97, 0.97),
                                });
                            }
                            
                            // Her hücreyi çiz
                            for (let j = 0; j < cells.length; j++) {
                                if (j < columnWidths.length) {
                                    const cellValue = sanitizeText(cells[j] || '');
                                    
                                    // Hücre değerini çiz
                                    currentPage.drawText(cellValue, {
                                        x: x + 4, // Hücre iç kenar boşluğu
                                        y: y,
                                        font: isHeader ? headerFont : font,
                                        size: fontSize,
                                        color: rgb(0, 0, 0)
                                    });
                                    
                                    // Sonraki sütuna geç
                                    x += columnWidths[j] + 8; // 8px hücreler arası boşluk
                                }
                            }
                            
                            // Sonraki satıra geç
                            y -= lineHeight + 6; // Satır aralığı
                        }
                        
                        console.log(`Added XLSX data as formatted table using enhanced fallback method.`);
                    }
                }
                break;

            default:
                throw new Error(`Unsupported file type: ${mimeType}`);
        }

        // --- PDF Kaydetme ---
        const pdfBytes = await pdfDoc.save();
        const baseName = path.parse(originalFilename).name;
        const pdfFilename = `${baseName}-${Date.now()}.pdf`;
        generatedPdfPath = path.join(outputDir, pdfFilename);
        await fs.writeFile(generatedPdfPath, pdfBytes);
        console.log(`PDF saved successfully: ${generatedPdfPath}`);

        return pdfFilename; // Oluşturulan dosyanın adını döndür

    } catch (error) {
        console.error('Error in pdfGenerator:', error);
        // Hata durumunda oluşturulmuş olabilecek PDF'i silmeye çalış
        if (generatedPdfPath && await fs.stat(generatedPdfPath).catch(() => false)) {
            await fs.unlink(generatedPdfPath).catch(e => console.error(`Could not delete incomplete PDF: ${generatedPdfPath}`, e));
        }
        // Hata detayını koruyarak tekrar fırlat
        throw new Error(`PDF generation failed: ${error.message || error}`);
    } finally {
        // --- Geçici Dosyaları Temizle ---
        console.log("Cleaning up temporary files:", tempFiles);
        for (const tempPath of tempFiles) {
             // inputPath dışındaki ara dosyaları sil (inputPath route'da siliniyor)
            if (tempPath !== inputPath) {
                 try {
                     if (await fs.stat(tempPath).catch(() => false)) { // Dosya var mı kontrol et
                         await fs.unlink(tempPath);
                         console.log(`Deleted temporary file: ${tempPath}`);
                     }
                 } catch (cleanupError) {
                     console.error(`Error deleting temporary file ${tempPath}:`, cleanupError);
                 }
            }
        }
        // Not: Puppeteer tarayıcısı burada kapatılmıyor, tekrar kullanılabilir.
        // Uygulama kapanışında veya belirli bir süre işlem yapılmadığında kapatılabilir.
    }
}

module.exports = { 
    generatePdf,
    isValidDocx,
    repairAndSaveDocx 
};