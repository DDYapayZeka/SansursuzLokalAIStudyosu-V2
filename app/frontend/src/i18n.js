// DD:YZ Studio Bilingual Localization Engine (Primary Default: Turkish 'tr', Secondary: English 'en')

export const TR_TO_EN_EXACT = {
  // Sidebar & Navigation
  "DD:YZ Stüdyo": "DD:YZ Studio",
  "Yapay Zekâ Sohbeti": "AI Chat Studio",
  "Yapay Zeka Sohbeti": "AI Chat Studio",
  "Görsel Stüdyosu": "Image Studio",
  "Ses & Müzik Stüdyosu": "Audio & Music Studio",
  "Video Stüdyosu": "Video Studio",
  "Ses Tanıma (Whisper)": "Speech to Text (Whisper)",
  "Model Merkezi": "Model Hub",
  "Hibrit API & Bulut": "Hybrid API & Cloud",
  "Ayarlar & Güncelleme": "Settings & Updates",
  "Kayıtlı sohbet bulunmuyor": "No saved conversations",
  "Kayıtlı ses dökümü bulunmuyor": "No saved transcripts",
  "Sohbet Geçmişini Gizle": "Hide Chat History",
  "Sohbet Geçmişini Göster": "Show Chat History",
  "Sohbeti Sil": "Delete Conversation",
  "Döküm Geçmişini Gizle": "Hide Transcript History",
  "Döküm Geçmişini Göster": "Show Transcript History",
  "Dökümü Sil": "Delete Transcript",
  "Sürüm: v2.0.0": "Version: v2.0.0",
  "DD:YZ YouTube Kanalı": "DD:YZ YouTube Channel",
  "Yerel Donanım Özeti": "Local Hardware Summary",
  "Donanım algılanıyor...": "Detecting hardware...",
  "Donanım bilgisi alınamadı": "Hardware info unavailable",
  "GPU algılanamadı": "No GPU detected",
  "Ayarlar & Güncelleme sayfasına git": "Go to Settings & Updates",

  // TopStatusBar
  "Model Yüklü (Metin)": "Model Loaded (Text)",
  "Model Yüklü (Görsel)": "Model Loaded (Image)",
  "Sunucu Çalışıyor": "Server Running",
  "Yerel Mod": "Local Mode",
  "Yan Menüyü Daralt": "Collapse Sidebar",
  "Yan Menüyü Genişlet": "Expand Sidebar",
  "Kuyruk Bekliyor": "Queue Pending",
  "İncele": "Inspect",
  "Tema Seçimi": "Select Theme",
  "Güncelleme Var!": "Update Available!",
  "v2.0.0 Güncelleme": "v2.0.0 Update",
  "Durduruluyor": "Stopping...",
  "Sunucuyu Durdur": "Stop Server",
  "İşlemci Kullanımı (CPU Usage)": "CPU Usage",
  "Sistem Belleği Kullanımı (RAM Usage)": "System Memory (RAM) Usage",
  "Türkçe (Ana Dil)": "Turkish (Primary)",
  "İngilizce (English)": "English",

  // Common Buttons & Badges
  "[Hazır]": "[Ready]",
  "[İndirilmedi]": "[Not Installed]",
  "Hazır": "Ready",
  "Kurulu": "Installed",
  "İndirildi": "Downloaded",
  "İndir": "Download",
  "Kaydet": "Save",
  "İptal": "Cancel",
  "İptal Et": "Cancel",
  "Vazgeç": "Cancel",
  "Kaldır": "Remove",
  "Sil": "Delete",
  "Yenile": "Refresh",
  "Kopyala": "Copy",
  "Kopyalandı": "Copied",
  "Klasörde Göster": "Show in Folder",
  "Klasör Açıldı": "Folder Opened",
  "Rastgele": "Random",
  "Rastgele (-1)": "Random (-1)",
  "Modeli Yükle": "Load Model",
  "Yüklendi (Loaded)": "Loaded",
  "Yükleniyor...": "Loading...",
  "Modeli Durdur": "Stop Model",

  // TextChat Studio
  "Yeni Sohbet": "New Chat",
  "Sohbeti Temizle": "Clear Chat",
  "Derin Düşünme": "DeepThink",
  "Sen": "You",
  "YZ": "AI",
  "Yerel YZ": "Local AI",
  "Kaynaklar": "Sources",
  "Bu model çeviri yapmaz (yalnızca yazıya döker). İngilizce çeviri için Whisper Small veya Base seçin.": "This model cannot translate (transcription only). Choose Whisper Small or Base to translate to English.",
  "Yazdığınız tarife göre 44.1 kHz stereo müzik üretir; 8 adımda çalıştığı için çok hızlıdır. En iyi sonuç için İngilizce tarif önerilir.":
    "Generates 44.1 kHz stereo music from your description; it runs in 8 steps, so it is very fast. English descriptions give the best results.",
  "Bu model en fazla 120 saniye üretir.": "This model generates up to 120 seconds.",
  "Tarifinize göre 44.1 kHz stereo ses efekti, ambiyans ve foley sesleri üretir; işlemcide bile hızlıdır.":
    "Generates 44.1 kHz stereo sound effects, ambience and foley from your description; fast even on the CPU.",
  "Yazdığınız Türkçe veya İngilizce metin tarifine göre enstrümantal fon müziği, melodi ve ritim üretir.":
    "Generates instrumental background music, melody and rhythm from your Turkish or English description.",
  "Müzik veya melodi karıştırmadan, Türkçe veya İngilizce tarifinize göre saf ses efekti, ambiyans ve foley sesleri üretir.":
    "Generates pure sound effects, ambience and foley from your Turkish or English description, without mixing in music.",
  "Seda-v0.2 (Ahmet Atasoğlu): Yalnızca Türkçe, CPU'da çalışan Zipformer modeli (FLEURS-tr %6.38 WER). Noktalama, büyük harf, kesme işareti ve rakamları kendisi yazar; altyazı zamanları konuşma aralarından gerçek olarak çıkarılır.":
    "Seda-v0.2 (Ahmet Atasoğlu): Turkish-only Zipformer model that runs on the CPU (FLEURS-tr 6.38% WER). It writes punctuation, capitals, apostrophes and digits itself; subtitle times come from the real pauses in the speech.",
  "Otomatik": "Auto",
  "Modelin kaç katmanının GPU VRAM'ine aktarılacağını belirler. Otomatik (önerilen): llama.cpp, VRAM'e sığan en fazla katmanı kendisi seçer. Elle verilen değer VRAM'i aşarsa Windows modeli sistem belleğine taşır ve yanıtlar çok yavaşlar veya zaman aşımına uğrar.": "How many model layers are offloaded to GPU VRAM. Auto (recommended): llama.cpp picks the most layers that fit in VRAM. A manual value larger than VRAM makes Windows spill the model to system memory, so replies become very slow or time out.",
  "Model klasöründen sil": "Delete from models folder",
  "Hugging Face GGUF modellerinde ara...": "Search Hugging Face GGUF models...",
  "Aramayı temizle": "Clear search",
  "Sohbet geçmişini aç/kapat": "Toggle chat history",
  "Yeni sohbet başlat": "Start new chat",
  "Dosya veya görsel ekle": "Attach files or images",
  "Web aramasını kapat": "Disable web search",
  "Web aramasını aç": "Enable web search",
  "Üretimi durdur": "Stop generation",
  "DeepThink akıl yürütmesini aç": "Enable DeepThink reasoning",
  "DeepThink akıl yürütmesini kapat": "Disable DeepThink reasoning",
  "Web Arama": "Web Search",
  "Gönder": "Send",
  "Durdur": "Stop",
  "Düşünüyor...": "Thinking...",
  "Yanıt üretiliyor...": "Generating response...",

  // Image Generator Studio
  "Görsel Üretim Stüdyosu": "Image Generation Studio",
  "Görsel Üretim Modeli": "Image Generation Model",
  "Seçili Dosya:": "Selected File:",
  "Görsel İstemi (Prompt)": "Image Prompt",
  "Hazır Görsel Şablonları (Örnek İstemler):": "Preset Image Templates (Sample Prompts):",
  "Fotogerçekçi Sinematik Portre (85mm Stüdyo Işığı)": "Photorealistic Cinematic Portrait (85mm Studio Lighting)",
  "Siberpunk Gece Şehri ve Neon Yansımalar": "Cyberpunk Night City & Neon Reflections",
  "Epik Fantastik Dağ Kalesi ve Şafak Manzarası": "Epic Fantasy Mountain Citadel at Sunrise",
  "Lüks Süper Otomobil ve Stüdyo Ürün Çekimi": "Luxury Supercar Studio Commercial Shot",
  "Büyülü Biyolüminesans Orman ve Doğa Sanatı": "Enchanted Bioluminescent Forest & Nature Art",
  "İzometrik 3D Minyatür Oyun ve Simyacı Atölyesi": "Isometric 3D Miniature Alchemist Workshop",
  "Temel Görsel (Init Image - Opsiyonel)": "Base Image (Init Image - Optional)",
  "Temel Görsel Hazır": "Base Image Ready",
  "Temel Görsel Yükle (Image-to-Image)": "Upload Base Image (Image-to-Image)",
  "Dönüştürme Gücü (Denoising Strength)": "Denoising Strength",
  "Görsel Üretim Parametreleri (Generation Parameters)": "Image Generation Parameters",
  "Ölçek ve En-Boy Oranı (Resolution & Aspect Ratio)": "Resolution & Aspect Ratio",
  "1:1 Kare": "1:1 Square",
  "4:3 Fotoğraf": "4:3 Photo",
  "16:9 Yatay": "16:9 Landscape",
  "9:16 Dikey": "9:16 Portrait",
  "Genişlik (Width px)": "Width (px)",
  "Yükseklik (Height px)": "Height (px)",
  "Görselin çerçeve oranını ve piksel boyutunu belirler. SD 1.5 modelleri 512px, SDXL modelleri 1024px taban ölçekte en yüksek netliği verir.":
    "Sets the aspect ratio and pixel dimensions. SD 1.5 models perform best at 512px base, SDXL models at 1024px base.",
  "Detay Adımı (Steps)": "Detail Steps",
  "Görüntünün kaç adımda işleneceği. Lightning modellerde 4-6, standart modellerde 20-30 adım önerilir.":
    "Number of denoising steps. 4-6 steps for Lightning models, 20-30 steps for standard models.",
  "İstem Uyumu (CFG Ölçeği)": "Prompt Adherence (CFG Scale)",
  "Modelin isteminize bağlılığı. Lightning için 1.0-2.0, standart SDXL/SD 1.5 için 5.0-7.5 idealdir.":
    "How strictly the model follows your prompt. 1.0-2.0 for Lightning, 5.0-7.5 for standard SDXL/SD 1.5.",
  "Örnekleyici (Sampler)": "Sampler Algorithm",
  "Gürültü çözme algoritması (Genel kullanım için Euler Ancestral önerilir).":
    "Denoising algorithm (Euler Ancestral is recommended for general use).",
  "Tohum Değeri (Seed)": "Seed Value",
  "-1 her seferinde yeni görsel üretir; sabit sayı aynı kompozisyonu korur.":
    "-1 generates a new variation each time; a fixed number preserves the composition.",
  "Negatif İstem (Negative Prompt - İstenmeyen Öğeler)": "Negative Prompt (Unwanted Elements)",
  "+ Standart Kalite Filtresi Ekle": "+ Add Standard Quality Filter",
  "Görselde yer almasını istemediğiniz bozuklukları veya nesneleri hariç tutar.":
    "Excludes unwanted artifacts or elements from the generated image.",
  "Görseli Üret (Generate Image)": "Generate Image",
  "Temel Görselden Üret (Image-to-Image)": "Generate from Base Image (Image-to-Image)",
  "Görsel Üretiliyor...": "Generating Image...",
  "GÖRSEL MODELİ": "IMAGE MODEL",
  "Ölçek:": "Scale:",
  "Adım:": "Steps:",
  "Örnekleyici:": "Sampler:",
  "Ultra-HD Yerel Yapay Zekâ Kanvası": "Ultra-HD Local AI Canvas",
  "Sıfır bulut bağımlılığı. Tamamen yerel donanımınızla yüksek kaliteli fotogerçekçi, sinematik ve sanatsal dijital görseller üretin.":
    "Zero cloud dependency. Generate high-quality photorealistic, cinematic, and artistic digital images entirely on your local hardware.",
  "Hızlı İlham (En Yüksek Kalite İçin İngilizce İstemler):": "Quick Inspiration (English Prompts for Highest Quality):",
  "Uretim Basarisiz": "Generation Failed",

  // Speech & Harfiyen Studio
  "Ses Tanıma, Türkçe Akıllı Noktalama & Altyazı Stüdyosu (Whisper & Harfiyen)":
    "Speech Recognition, Smart Punctuation & Subtitle Studio (Whisper & Harfiyen)",
  "Mikrofon kaydını veya ses/video dosyalarını (WAV, MP3, M4A, MP4) yerel olarak yazıya dökün; Harfiyen motoruyla Türkçe noktalama/kesme işaretlerini düzeltin, SRT/VTT altyazı ve Karaoke video üretin.":
    "Transcribe microphone recordings or audio/video files (WAV, MP3, M4A, MP4) locally; apply smart punctuation, export SRT/VTT subtitles, and render Karaoke videos.",
  "Çalıştırma Ortamı (Speech Runtime)": "Speech Runtime",
  "Hazır (Ready)": "Ready",
  "Kurulu (Installed)": "Installed",
  "Arka Uç Eksik": "Backend Missing",
  "Konuşma Tanıma Modeli (Speech Model)": "Speech Recognition Model",
  "Hızlandırıcı (Backend)": "Accelerator (Backend)",
  "Otomatik (Kuruluysa GPU)": "Auto (GPU if installed)",
  "Dil (Language)": "Language",
  "İş Parçacığı (Threads)": "CPU Threads",
  "Harfiyen Türkçe Akıllı Noktalama & TDK İmla Motoru": "Harfiyen Turkish Smart Punctuation & Grammar Engine",
  "(Özel ad kesme işareti, soru/nokta ve sayı yazımı)": "(Proper noun apostrophes, punctuation & number formatting)",
  "İngilizce'ye Çevir (Translate to English)": "Translate to English",
  "Ses & Video Girişi (Audio / Video Input)": "Audio / Video Input",
  "Dosya seçilmedi": "No file selected",
  "Mikrofonla kaydedin veya Ses / Video yükleyin": "Record with microphone or upload Audio / Video",
  "WAV, MP3, M4A, OGG, WebM ve MP4 dosyaları otomatik olarak 16 kHz mono PCM16 WAV formatına dönüştürülür.":
    "WAV, MP3, M4A, OGG, WebM, and MP4 files are automatically converted to 16 kHz mono PCM16 WAV.",
  "Kaydı Başlat": "Start Recording",
  "Kaydı Durdur": "Stop Recording",
  "Ses / Video Yükle (WAV, MP3, MP4)": "Upload Audio / Video (WAV, MP3, MP4)",
  "Sesi Kaldır": "Remove Audio",
  "Yazıya Dök ve Altyazı Üret (Transcribe)": "Transcribe & Generate Subtitles",
  "Yazıya Dökülen Metin ve Zaman Kodlu Altyazı (Transcript & Subtitles)": "Transcript & Timestamped Subtitles",
  "Zaman Damgalarını Göster": "Show Timestamps",
  "Harfiyen İmla Düzelt": "Format Turkish Punctuation",
  "SRT Altyazı": "SRT Subtitles",
  "VTT Altyazı": "VTT Subtitles",
  "Harfiyen Türkçe Seslendirme ve Dublaj (TTS Voice-Over)": "Harfiyen Turkish Voice-Over & Dubbing (TTS)",
  "Yazıya dökülen metni yerel 48 kHz Türkçe ses motorlarıyla stüdyo kalitesinde seslendirin.":
    "Synthesize studio-quality 48 kHz voice-over from the transcript using local TTS engines.",
  "Metni Seslendir (Dublaj Üret)": "Synthesize Voice-Over (Dub)",
  "Seslendiriliyor...": "Synthesizing...",
  "Harfiyen Altyazılı Video, Karaoke & Ses Aurası Stüdyosu (Reels / Shorts / YouTube)":
    "Harfiyen Subtitled Video, Karaoke & Audio Aura Studio (Reels / Shorts / YouTube)",
  "Altyazılı Videoyu İndir (.WebM)": "Download Subtitled Video (.WebM)",
  "Video Kaydediliyor (Ses Oynatılıyor)...": "Recording Video (Playing Audio)...",
  "Altyazı Stili (Caption Style)": "Caption Style",
  "Video Çerçeve Oranı (Aspect Ratio)": "Video Aspect Ratio",
  "Ses Aurası Teması (Audio Aura)": "Audio Aura Theme",
  "Yukarıdaki ses oynatıcısını başlattığınızda Ses Aurası ve Karaoke kelime vurguları gerçek zamanlı olarak canlanır.":
    "Start the audio player above to animate the Audio Aura and Karaoke word highlights in real time.",

  // Model Manager & Settings
  "Uyumlu En Verimli Modelleri İndir": "Download Optimal Compatible Models",
  "Gorunum ve Temalar": "Appearance, Language & Themes",
  "Görünüm, Dil ve Temalar": "Appearance, Language & Themes",
  "Uygulama Dili (Application Language)": "Application Language",
  "Renk Temalari": "Color Themes",
  "Metin ve Arayüz Büyüklüğü (UI Scale)": "Text & UI Scale",
  "Küçük": "Small",
  "Orta": "Medium",
  "Büyük": "Large",
  "Hassas Boyut Ayarı": "Fine Size Adjustment",
  "Performans Profili": "Performance Profile",
  "Düşük (Tasarruf)": "Low (Power Saver)",
  "Dengeli": "Balanced",
  "Yüksek": "High",
  "Özel": "Custom",
  "Şimdi Otomatik Güncelle (İndir ve Kur)": "Auto Update Now (Download & Install)",
  "Güncelleniyor...": "Updating...",
  "GitHub Sayfası": "GitHub Page",
  "Sürüm Notlarını ve GitHub Sayfasını Aç": "Open Release Notes & GitHub Page",
  "KURULU SÜRÜM": "INSTALLED VERSION",
  "DAĞITIM KANALI": "RELEASE CHANNEL",
  "SON DENETLEME": "LAST CHECKED",
  "Henüz yapılmadı": "Not checked yet",
  "Denetlemek için butona basın": "Click the button to check",
  "Sistem güncel": "System up to date",
  "Yeni güncelleme var!": "New update available!",
};

const PAREN_ENGLISH_RE = /^(.+?)\s*\(([A-Za-z0-9\s\-/&,+.:']+)\)$/;

export function translateStringToEn(rawStr) {
  if (!rawStr || typeof rawStr !== "string") return rawStr;
  const trimmed = rawStr.trim();
  if (!trimmed) return rawStr;

  const leadingSpace = rawStr.match(/^\s*/)?.[0] || "";
  const trailingSpace = rawStr.match(/\s*$/)?.[0] || "";

  if (TR_TO_EN_EXACT[trimmed]) {
    return leadingSpace + TR_TO_EN_EXACT[trimmed] + trailingSpace;
  }

  // If formatted as "Türkçe Başlık (English Term)", extract or keep clean English
  const parenMatch = trimmed.match(PAREN_ENGLISH_RE);
  if (parenMatch) {
    const trPart = parenMatch[1].trim();
    const enPart = parenMatch[2].trim();
    if (/[a-zA-Z]{3,}/.test(enPart) && !/^(SD|ONNX|VRAM|RAM|CPU|GPU|WAV|MP3|MP4|SRT|VTT|Q4|Q8|FP16)/i.test(enPart)) {
      return leadingSpace + enPart + trailingSpace;
    }
    if (TR_TO_EN_EXACT[trPart]) {
      return leadingSpace + `${TR_TO_EN_EXACT[trPart]} (${enPart})` + trailingSpace;
    }
  }

  // Dynamic replacements for composite strings
  let out = trimmed;
  let changed = false;
  const replacements = [
    [/\[Hazır\]/g, "[Ready]"],
    [/\[İndirilmedi([^\]]*)\]/g, "[Not Installed$1]"],
    [/kurulu ve kullanıma hazır\./g, "is installed and ready to use."],
    [/üretim süresi/g, "generation time"],
    [/Adım/g, "Steps"],
    [/Rastgele/g, "Random"],
    [/sırada/g, "queued"],
    [/İndiriliyor/g, "Downloading"],
    [/Üretiliyor/g, "Generating"],
    [/ayar$/g, "settings"],
  ];

  for (const [regex, rep] of replacements) {
    if (regex.test(out)) {
      out = out.replace(regex, rep);
      changed = true;
    }
  }

  return changed ? leadingSpace + out + trailingSpace : rawStr;
}

function processDomTree(rootEl, lang) {
  if (!rootEl) return;

  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
  let textNode;
  while ((textNode = walker.nextNode())) {
    const parentTag = textNode.parentElement?.tagName;
    if (parentTag === "SCRIPT" || parentTag === "STYLE" || parentTag === "TEXTAREA" || parentTag === "CODE") {
      continue;
    }
    const currentVal = textNode.nodeValue;
    if (!currentVal || !currentVal.trim()) continue;

    // React may rewrite a node it rendered earlier (e.g. a toggling label); a value we did not
    // write ourselves is the new source text, otherwise the stale translation would come back.
    if (textNode.__origTr === undefined || (currentVal !== textNode.__origTr && currentVal !== textNode.__lastSet)) {
      textNode.__origTr = currentVal;
    }

    if (lang === "en") {
      const translated = translateStringToEn(textNode.__origTr);
      if (textNode.nodeValue !== translated) {
        textNode.nodeValue = translated;
      }
      textNode.__lastSet = translated;
    } else {
      if (textNode.__origTr !== undefined && textNode.nodeValue !== textNode.__origTr) {
        textNode.nodeValue = textNode.__origTr;
      }
    }
  }

  const elements = rootEl.querySelectorAll("[placeholder], [title]");
  elements.forEach((el) => {
    if (el.hasAttribute("placeholder")) {
      const curP = el.getAttribute("placeholder");
      if (el.__origPlaceholderTr === undefined || (curP !== el.__origPlaceholderTr && curP !== el.__lastPlaceholderSet)) {
        el.__origPlaceholderTr = curP;
      }
      if (lang === "en") {
        const trP = translateStringToEn(el.__origPlaceholderTr);
        if (curP !== trP) el.setAttribute("placeholder", trP);
        el.__lastPlaceholderSet = trP;
      } else if (el.__origPlaceholderTr !== undefined && curP !== el.__origPlaceholderTr) {
        el.setAttribute("placeholder", el.__origPlaceholderTr);
      }
    }
    if (el.hasAttribute("title")) {
      const curT = el.getAttribute("title");
      if (el.__origTitleTr === undefined || (curT !== el.__origTitleTr && curT !== el.__lastTitleSet)) {
        el.__origTitleTr = curT;
      }
      if (lang === "en") {
        const trT = translateStringToEn(el.__origTitleTr);
        if (curT !== trT) el.setAttribute("title", trT);
        el.__lastTitleSet = trT;
      } else if (el.__origTitleTr !== undefined && curT !== el.__origTitleTr) {
        el.setAttribute("title", el.__origTitleTr);
      }
    }
  });
}

let activeObserver = null;
let currentLang = "tr";

// For dialog texts that contain runtime values (file names, ports...) and therefore cannot be
// looked up in TR_TO_EN_EXACT: returns the Turkish text unless the UI language is English.
export function uiText(trText, enText) {
  let lang = currentLang;
  try {
    lang = document.documentElement.getAttribute("lang") || localStorage.getItem("uiLanguage") || currentLang;
  } catch (_) {}
  return lang === "en" ? enText : trText;
}

export function applyDocumentLanguage(lang = "tr") {
  currentLang = lang === "en" ? "en" : "tr";
  document.documentElement.setAttribute("lang", currentLang);
  try {
    localStorage.setItem("uiLanguage", currentLang);
  } catch (_) {}
  const root = document.getElementById("root") || document.body;
  processDomTree(root, currentLang);

  if (!activeObserver && typeof MutationObserver !== "undefined") {
    let rafId = null;
    activeObserver = new MutationObserver(() => {
      if (currentLang !== "en") return;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        processDomTree(document.getElementById("root") || document.body, currentLang);
      });
    });
    activeObserver.observe(root, {
      childList: true,
      subtree: true,
    });
  }
}
