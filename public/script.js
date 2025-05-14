// Aetheria PDF Converter - Frontend Logic (v1.3 - Batch Processing & Enhanced UI)
// Author: Aetheria Synthesizer

document.addEventListener('DOMContentLoaded', () => {

    // --- DOM Elementlerini Seçme ---
    const uploadForm = document.getElementById('upload-form');
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileListArea = document.getElementById('file-list-area'); // Dosya listesi alanı
    const fileListUl = document.getElementById('file-list');       // Dosya listesi (ul)
    const convertBtn = document.getElementById('convert-btn');
    const btnContent = convertBtn.querySelector('.btn-content'); // Buton içeriği (ikon+metin)
    const btnText = convertBtn.querySelector('.btn-text'); // Buton metni span'ı
    const spinner = convertBtn.querySelector('.spinner-alt'); // Yükleme göstergesi
    const statusDiv = document.getElementById('status'); // Genel durum mesajı alanı
    const statusIconSpan = statusDiv.querySelector('.status-icon'); // Durum ikonu (CSS ile yönetilir)
    const statusTextSpan = statusDiv.querySelector('.status-text'); // Durum metni
    const resultDiv = document.getElementById('result'); // Sonuç (indirme linki) alanı

    // --- Ayarlar ve Limitler (Client-Side) ---
    // Backend ile tutarlı olmalı!
    const ALLOWED_MIME_TYPES = [
        'image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff', 'image/webp', 'image/svg+xml',
        'text/plain', 'text/csv', 'text/html',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' // XLSX
    ];
    const ALLOWED_EXTENSIONS_DISPLAY = "JPG, PNG, GIF, BMP, TIFF, WebP, SVG, TXT, CSV, HTML, DOCX, XLSX";
    const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB (dosya başına)
    const MAX_TOTAL_SIZE = 100 * 1024 * 1024; // 100MB (toplam)
    const MAX_FILES = 20; // Maksimum dosya sayısı

    // --- Dosya Türüne Göre İkon Eşleştirme ---
    const fileTypeIcons = {
        'image/jpeg': '🖼️', 'image/png': '🖼️', 'image/gif': '🖼️', 'image/bmp': '🖼️', 'image/tiff': '🖼️', 'image/webp': '🖼️', 'image/svg+xml': '🎨',
        'text/plain': '📄', 'text/csv': '📊', 'text/html': '🌐',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📜', // DOCX
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '📈', // XLSX
        'default': '📁' // Eşleşmezse varsayılan
    };

    // Seçilen dosyaları saklamak için dizi
    let selectedFiles = [];

    // --- Olay Dinleyicileri (Event Listeners) ---

    // 1. Sürükle-Bırak Alanı Olayları
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault(); // Varsayılanı engelle
        dropZone.classList.add('drag-over'); // Stil ekle
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over'); // Stili kaldır
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault(); // Varsayılanı engelle
        dropZone.classList.remove('drag-over'); // Stili kaldır
        handleFiles(e.dataTransfer.files); // Dosyaları işle
    });

    // 2. Dosya Seçim Input'u Değiştiğinde
    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files); // Dosyaları işle
    });

    // 3. Form Gönderildiğinde (Dönüştür Butonuna Tıklandığında)
    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault(); // Formun normal gönderimini engelle
        if (selectedFiles.length === 0) {
            showStatus('Lütfen dönüştürmek için bir veya daha fazla dosya seçin.', 'error');
            shakeElement(dropZone); // Drop zone'u salla
            return; // İşlemi durdur
        }

        // Arayüzü yükleme durumuna getir
        disableButton(true);
        updateAllFileStatusIcons('converting'); // Tüm dosya ikonlarını 'dönüştürülüyor' yap
        showStatus(`Dosyalar (${selectedFiles.length}) yükleniyor ve sihir yapılıyor...`, 'info');
        resultDiv.innerHTML = ''; // Önceki indirme linkini temizle

        // FormData nesnesi oluştur
        const formData = new FormData();
        // Seçilen tüm dosyaları aynı alan adı altında ekle
        selectedFiles.forEach(file => {
            formData.append('filesToConvert', file, file.name); // Backend'deki multer.array() ile eşleşmeli
        });

        try {
            // Backend API'sine POST isteği gönder
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
                // Content-Type: multipart/form-data otomatik olarak ayarlanır
            });
            // Yanıtı JSON olarak işle
            const result = await response.json();

            // --- Yanıtı Değerlendir (Toplu İşlem Sonuçları) ---
            if (response.ok && result.success) {
                // Tam Başarı Durumu
                showStatus(`Başarılı: ${result.results.length} dosya dönüştürüldü!`, 'success');
                displayDownloadLink(result.zipFilename, result.results.length); // ZIP indirme linki
                flashGlow(document.querySelector('.container')); // Başarı efekti
                updateFileListStatus(result.results); // Liste ikonlarını güncelle
            } else if (response.ok && !result.success && result.results && result.results.length > 0) {
                // Kısmi Başarı Durumu (Bazı hatalar var ama ZIP oluşturuldu)
                const successCount = result.results.filter(r => r.status === 'success').length;
                const errorCount = result.results.length - successCount;
                showStatus(`Kısmi Başarı: ${successCount} dosya dönüştürüldü, ${errorCount} hata oluştu.`, 'warning');
                displayDownloadLink(result.zipFilename, successCount); // ZIP indirme linki (sadece başarılılar içinde)
                updateFileListStatus(result.results); // Liste ikonlarını güncelle
                shakeElement(statusDiv); // Durum mesajını salla
            } else {
                // Tam Başarısızlık veya Beklenmedik Sunucu Hatası
                let errorMessage = `Hata: ${result.message || response.statusText || 'Bilinmeyen bir sunucu hatası oluştu.'}`;
                // Eğer bireysel hata detayları varsa, ilkini ekleyelim
                if (result.results && Array.isArray(result.results)) {
                    const firstError = result.results.find(r => r.status === 'error');
                    if (firstError) {
                        errorMessage += ` (İlk hata: ${firstError.originalFilename} - ${firstError.error})`;
                    }
                }
                showStatus(errorMessage, 'error');
                updateFileListStatus(result.results || []); // Liste ikonlarını (varsa) güncelle
                shakeElement(convertBtn); // Butonu salla
            }

        } catch (error) {
            // Ağ Hatası veya Diğer Fetch Hataları
            console.error('Fetch error:', error);
            showStatus(`Bağlantı hatası: ${error.message}. Sunucu çalışıyor mu?`, 'error');
            updateAllFileStatusIcons('error'); // Tüm dosya ikonlarını hataya çevir
            shakeElement(convertBtn); // Butonu salla
        } finally {
            // İşlem bittiğinde (başarılı veya başarısız) butonu tekrar aktif et
            disableButton(false);
            // Başarısızlık durumunda seçimi temizlemek yerine kullanıcının tekrar denemesine izin vermek daha iyi olabilir.
        }
    });

    // --- Yardımcı Fonksiyonlar ---

    /**
     * Gelen dosya listesini işler: Doğrular, mevcut listeye ekler, UI'ı günceller.
     * @param {FileList} files - Input'tan veya sürükle-bıraktan gelen dosya listesi.
     */
    function handleFiles(files) {
        clearStatus(); // Önceki durum mesajlarını temizle
        resultDiv.innerHTML = ''; // Önceki indirme linkini temizle

        const newlyAddedFiles = []; // Bu işlemde geçerli bulunan dosyalar
        let currentTotalSize = selectedFiles.reduce((acc, file) => acc + file.size, 0); // Mevcut toplam boyut
        let individualErrors = []; // Bu işlemdeki dosya bazlı hatalar

        // Gelen her dosyayı kontrol et
        for (const file of files) {
            let fileIsValid = true;
            let errorMsg = '';

            // 1. Maksimum dosya sayısı kontrolü
            if (selectedFiles.length + newlyAddedFiles.length >= MAX_FILES) {
                errorMsg = `${file.name}: Maksimum dosya sayısı (${MAX_FILES}) aşıldı.`;
                fileIsValid = false;
            }
            // 2. Dosya türü kontrolü
            else if (!ALLOWED_MIME_TYPES.includes(file.type)) {
                errorMsg = `${file.name}: Geçersiz dosya türü (${file.type || 'bilinmiyor'}).`;
                fileIsValid = false;
            }
            // 3. Bireysel dosya boyutu kontrolü
            else if (file.size > MAX_FILE_SIZE) {
                errorMsg = `${file.name}: Dosya çok büyük (${formatFileSize(file.size)}). Maksimum: ${formatFileSize(MAX_FILE_SIZE)}.`;
                fileIsValid = false;
            }
            // 4. Toplam dosya boyutu kontrolü
            else if (currentTotalSize + file.size > MAX_TOTAL_SIZE) {
                errorMsg = `${file.name}: Toplam dosya boyutu limiti (${formatFileSize(MAX_TOTAL_SIZE)}) aşıldı.`;
                // Limiti aşan ilk dosyadan sonrasını eklemeyi durdurabiliriz
                individualErrors.push(errorMsg);
                break; // Döngüden çık
            }
            // 5. Aynı isimli dosya kontrolü (isteğe bağlı)
            else if (selectedFiles.some(f => f.name === file.name) || newlyAddedFiles.some(f => f.name === file.name)) {
                errorMsg = `${file.name}: Bu dosya zaten listede.`;
                fileIsValid = false;
            }

            // Hata varsa kaydet, yoksa geçerli listeye ekle
            if (!fileIsValid) {
                if (errorMsg) individualErrors.push(errorMsg);
            } else {
                newlyAddedFiles.push(file);
                currentTotalSize += file.size; // Geçerli dosyanın boyutunu toplama ekle
            }
        }

        // Yeni geçerli dosyaları ana listeye ekle
        selectedFiles.push(...newlyAddedFiles);

        // Dosya listesi arayüzünü güncelle
        updateFileListUI();

        // Bireysel ekleme hataları varsa göster
        if (individualErrors.length > 0) {
            // Hataları daha okunabilir yap (her biri yeni satırda)
            showStatus("Bazı dosyalar eklenemedi:\n- " + individualErrors.join("\n- "), 'warning');
            shakeElement(dropZone); // Hata varsa dropzone'u salla
        }

        // Seçili dosya varsa butonu aktif et
        convertBtn.disabled = selectedFiles.length === 0;
        // Input değerini temizle (aynı dosyaların tekrar seçilebilmesi için)
        fileInput.value = '';
    }

    /**
     * `selectedFiles` dizisine göre dosya listesi arayüzünü (ul) oluşturur/günceller.
     */
    function updateFileListUI() {
        if (selectedFiles.length === 0) {
            fileListArea.style.display = 'none'; // Liste boşsa alanı gizle
            convertBtn.disabled = true; // Butonu pasif yap
            return;
        }

        fileListUl.innerHTML = ''; // Mevcut listeyi temizle
        selectedFiles.forEach((file, index) => {
            const li = document.createElement('li');
            li.dataset.fileIndex = index; // Durum güncellemesi için index'i sakla

            // İkon
            const iconSpan = document.createElement('span');
            iconSpan.className = 'file-icon';
            iconSpan.textContent = fileTypeIcons[file.type] || fileTypeIcons['default'];

            // Dosya Adı
            const nameSpan = document.createElement('span');
            nameSpan.className = 'file-name';
            nameSpan.textContent = file.name;
            nameSpan.title = file.name; // Tam adı hover'da göster

            // Dosya Boyutu
            const sizeSpan = document.createElement('span');
            sizeSpan.className = 'file-size';
            sizeSpan.textContent = `(${formatFileSize(file.size)})`;

            // Durum İkonu (Başlangıç: Bekliyor)
            const statusIconSpan = document.createElement('span');
            statusIconSpan.className = 'file-status-icon pending';

            // Silme Butonu (Opsiyonel - CSS'i de eklenmeli)
            const removeBtn = document.createElement('button');
            removeBtn.className = 'file-remove-btn'; // CSS ile stil verilmeli
            removeBtn.innerHTML = '×'; // '×' işareti (daha uyumlu olabilir)
            removeBtn.title = 'Listeden kaldır';
            removeBtn.type = 'button'; // Formu submit etmesini engelle
            removeBtn.onclick = (e) => {
                e.stopPropagation(); // li elementine tıklamayı engelle
                removeFileFromList(index);
            };

            // Elementleri li'ye ekle
            li.appendChild(iconSpan);
            li.appendChild(nameSpan);
            li.appendChild(sizeSpan);
            li.appendChild(statusIconSpan);
            li.appendChild(removeBtn); // Silme butonu ekle

            // li'yi ul listesine ekle
            fileListUl.appendChild(li);
        });

        fileListArea.style.display = 'block'; // Liste alanını göster
        convertBtn.disabled = false; // Dosya varsa butonu aktif et
    }

    /**
     * Belirtilen index'teki dosyayı listeden ve `selectedFiles` dizisinden kaldırır.
     * @param {number} indexToRemove - Kaldırılacak dosyanın `selectedFiles` içindeki index'i.
     */
    function removeFileFromList(indexToRemove) {
        if (indexToRemove >= 0 && indexToRemove < selectedFiles.length) {
            selectedFiles.splice(indexToRemove, 1); // Diziden kaldır
            updateFileListUI(); // Listeyi yeniden oluştur (indexler kayacağı için en kolayı)
            clearStatus(); // Varsa önceki durum mesajını temizle
        }
    }


    /**
     * Sunucudan gelen sonuca göre dosya listesindeki durum ikonlarını günceller.
     * @param {Array} results - Sunucudan gelen `{originalFilename, status, error}` nesnelerini içeren dizi.
     */
    function updateFileListStatus(results) {
        if (!results || !Array.isArray(results)) return; // Geçersiz sonuçsa çık

        results.forEach(result => {
            // Sonuçtaki orijinal dosya adına göre listedeki elemanı bul
            const fileIndex = selectedFiles.findIndex(file => file.name === result.originalFilename);
            if (fileIndex !== -1) {
                // İlgili liste elemanını (li) bul
                const li = fileListUl.querySelector(`li[data-file-index="${fileIndex}"]`);
                if (li) {
                    // Durum ikonunu bul
                    const statusIcon = li.querySelector('.file-status-icon');
                    if (statusIcon) {
                        // İkonun sınıfını güncelle (pending, converting, success, error)
                        statusIcon.className = `file-status-icon ${result.status}`;
                        // Hata varsa, hatayı li elementinin title'ına ekle
                        if (result.status === 'error') {
                            li.title = `Hata: ${result.error || 'Bilinmeyen hata'}`;
                        } else {
                            li.removeAttribute('title'); // Başarılıysa veya bekliyorsa title'ı kaldır
                        }
                    }
                }
            } else {
                console.warn(`Could not find list item for result: ${result.originalFilename}`);
            }
        });
    }

    /**
     * Listedeki tüm dosyaların durum ikonunu belirtilen sınıfa ayarlar.
     * @param {string} statusClass - Ayarlanacak CSS sınıfı ('pending', 'converting', 'error' vb.).
     */
    function updateAllFileStatusIcons(statusClass) {
        const icons = fileListUl.querySelectorAll('.file-status-icon');
        icons.forEach(icon => {
            // Önceki durum sınıflarını temizle (pending, converting, success, error)
            icon.className = 'file-status-icon';
            // Yeni sınıfı ekle
            icon.classList.add(statusClass);
        });
    }

    /**
     * Genel durum mesajı alanını günceller.
     * @param {string} message - Gösterilecek mesaj.
     * @param {'info'|'success'|'error'|'warning'} type - Mesaj türü.
     */
    function showStatus(message, type = 'info') {
        // Mesajı birden fazla satıra bölüp göstermek için (hata listesi vb.)
        statusTextSpan.innerHTML = message.replace(/\n/g, '<br>'); // Yeni satırları <br> ile değiştir
        statusDiv.className = `status-message ${type} show`; // Görünür yap ve stil ver
        statusDiv.setAttribute('role', type === 'error' || type === 'warning' ? 'alert' : 'status'); // Erişilebilirlik
    }

    /** Genel durum mesajını temizler. */
    function clearStatus() {
        statusTextSpan.innerHTML = ''; // Metni temizle
        statusDiv.className = 'status-message'; // Sınıfları sıfırla
        statusDiv.removeAttribute('role');
    }

    /**
     * Sonuç alanında ZIP indirme bağlantısını oluşturur.
     * @param {string} zipFilename - İndirilecek ZIP dosyasının adı.
     * @param {number} fileCount - ZIP içindeki dosya sayısı.
     */
    function displayDownloadLink(zipFilename, fileCount) {
        resultDiv.innerHTML = ''; // Önceki linki temizle
        if (!zipFilename || fileCount <= 0) return; // Geçersizse link oluşturma

        const downloadLink = document.createElement('a');
        downloadLink.href = `/download/${encodeURIComponent(zipFilename)}`; // İndirme URL'si
        downloadLink.setAttribute('role', 'button');

        // ZIP ikonu (SVG)
        const iconSVG = `<span class="download-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-5 3v4c0 .55-.45 1-1 1h-2v2h-2v-2H8c-.55 0-1-.45-1-1V9c0-.55.45-1 1-1h6c.55 0 1 .45 1 1z M9 9v4h2v-2h2V9H9z"/></svg></span>`;
        // Link metnini ayarla
        downloadLink.innerHTML = `${iconSVG} ${fileCount} Dosya İçeren Arşivi İndir (.zip)`;

        // Linki sonuç alanına ekle
        resultDiv.appendChild(downloadLink);

        // Görünme animasyonu
        downloadLink.style.opacity = '0';
        downloadLink.style.transform = 'translateY(10px) rotateX(-20deg)'; // Başlangıç durumu
        setTimeout(() => {
            downloadLink.style.opacity = '1';
            downloadLink.style.transform = 'translateY(0) rotateX(0deg)'; // Son durum
            downloadLink.style.transition = 'opacity 0.4s ease-out, transform 0.4s ease-out'; // Geçiş
        }, 50); // Kısa gecikme
    }

    /** Dosya boyutunu formatlar (KB, MB vb.). */
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.max(0, Math.floor(Math.log(bytes) / Math.log(k)));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /** Dönüştürme butonunu yükleme/normal moda alır. */
    function disableButton(loading) {
        convertBtn.disabled = loading; // Tıklanabilirliği ayarla
        if (loading) {
            convertBtn.classList.add('loading'); // CSS sınıfı ekle
            spinner.style.display = 'flex'; // Spinner'ı göster
            btnContent.style.opacity = '0'; // Normal içeriği gizle
            btnContent.style.pointerEvents = 'none'; // İçeriğe tıklamayı engelle
        } else {
            convertBtn.classList.remove('loading'); // Sınıfı kaldır
            spinner.style.display = 'none'; // Spinner'ı gizle
            btnContent.style.opacity = '1'; // Normal içeriği göster
            btnContent.style.pointerEvents = 'auto';
        }
    }

    /** Bir elementi kısa süreliğine sallar. */
    function shakeElement(element) {
        if (!element) return;
        element.style.animation = 'none';
        requestAnimationFrame(() => { setTimeout(() => { element.style.animation = 'shake 0.5s ease-in-out'; }, 0); });
        const animationDuration = 500;
        setTimeout(() => { if (element.style.animation.includes('shake')) { element.style.animation = ''; } }, animationDuration);
    }

    /** Bir elemente kısa süreli parlama efekti ekler. */
    function flashGlow(element) {
        if (!element) return;
        const originalTransition = element.style.transition;
        const originalShadow = getComputedStyle(element).getPropertyValue('--box-shadow');
        element.style.transition = 'box-shadow 0.2s ease-out';
        element.style.boxShadow = '0 0 30px rgba(163, 140, 255, 0.5)';
        setTimeout(() => {
            element.style.boxShadow = originalShadow;
            setTimeout(() => { element.style.transition = originalTransition; }, 50);
        }, 300);
    }

    // --- Shake Animasyonunu CSS'e Ekle (Güvenli Yol) ---
    try {
        let styleSheet = Array.from(document.styleSheets).find(sheet => sheet.href && sheet.href.endsWith('style.css')) || document.styleSheets[0];
        if (styleSheet) {
            let rules;
            try { rules = styleSheet.cssRules || styleSheet.rules; } catch (e) { rules = null; } // CORS/Security hatasını yakala

            let shakeExists = false;
            if (rules) {
                for (let i = 0; i < rules.length; i++) {
                    if (rules[i].type === CSSRule.KEYFRAMES_RULE && rules[i].name === 'shake') {
                        shakeExists = true; break;
                    }
                }
            }

            if (!shakeExists) {
                styleSheet.insertRule(`@keyframes shake{0%,100%{transform:translateX(0)}10%,30%,50%,70%,90%{transform:translateX(-6px)}20%,40%,60%,80%{transform:translateX(6px)}}`, rules ? rules.length : 0);
                // console.log("Shake keyframes inserted via JavaScript.");
            }
        } else { console.warn("Could not find a suitable stylesheet for shake animation."); }
    } catch (e) { console.error("Error managing stylesheets for shake animation:", e); }

    // --- Sayfa Yüklendiğinde Animasyonları Etkinleştir ---
    window.addEventListener('load', () => { document.body.classList.remove('preload'); });

}); // DOMContentLoaded Sonu