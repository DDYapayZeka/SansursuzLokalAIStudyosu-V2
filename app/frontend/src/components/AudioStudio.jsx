import React, { useState, useRef, useEffect } from "react";
import { uiText } from "../i18n";
import {
  Volume2,
  Mic,
  Music,
  Share2,
  Upload,
  Play,
  Pause,
  Download,
  Trash2,
  Sparkles,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Cpu,
  Layers,
  Wand2,
  FolderOpen,
  RefreshCw,
  Check,
} from "lucide-react";
import { downloadMusicModel, downloadSnapshotModel, downloadTtsModel, revealFileInFolder } from "../services/api";

export default function AudioStudio({
  specs,
  showAlert,
  showConfirm,
  checkAndConfirmInterruption,
  isAudioGenerating,
  setIsAudioGenerating
}) {
  const [subTab, setSubTab] = useState("tts"); // 'tts' | 'music'

  // 1. SES ÜRETİMİ (TTS) State
  const [ttsEngine, setTtsEngine] = useState("antalia"); // 'antalia' | 'ema-lightning' | 'omnivoice' | 'supertonic' | 'kokoro' | 'piper'
  const [ttsText, setTtsText] = useState("");
  const [ttsSpeed, setTtsSpeed] = useState(1.0);
  const [ttsVoice, setTtsVoice] = useState("antalia_dogal");

  // Zero-Shot Voice Cloning (OmniVoice) State
  const [cloneRefAudio, setCloneRefAudio] = useState("");
  const [cloneRefText, setCloneRefText] = useState("");
  const [cloneInstruct, setCloneInstruct] = useState("");
  const [referenceVoicesList, setReferenceVoicesList] = useState([]);
  const [isUploadingVoice, setIsUploadingVoice] = useState(false);
  const [omniStatus, setOmniStatus] = useState({ installed: false, downloading: false, progressPct: 0, downloadedMb: 0, totalMb: 2337 });
  const voiceFileInputRef = useRef(null);

  // 2. MÜZİK ÜRETİMİ VE SES EFEKTİ (SFX) State
  const [musicModels, setMusicModels] = useState([]);
  const [musicModel, setMusicModel] = useState("musicgen-small");
  const [musicPrompt, setMusicPrompt] = useState("");
  const [musicDuration, setMusicDuration] = useState(15);
  const [sfxPrompt, setSfxPrompt] = useState("");
  const [sfxDuration, setSfxDuration] = useState(6);
  const [sfxModel, setSfxModel] = useState("audioldm2-large");
  const [lastGeneratedInfo, setLastGeneratedInfo] = useState(null);
  const [audioMetadata, setAudioMetadata] = useState(null);
  const [audioHistory, setAudioHistory] = useState([]);

  // Genel
  const [isProcessing, setIsProcessing] = useState(false);
  const [liveProgress, setLiveProgress] = useState({ active: false, percent: 0, phase: "", mode: "" });
  const [audioUrl, setAudioUrl] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [openedFolderKey, setOpenedFolderKey] = useState(null);

  const handleRevealFolder = async (params, key = "main") => {
    setOpenedFolderKey(key);
    try {
      const res = await revealFileInFolder(params);
      if (!res?.ok && showAlert) {
        showAlert({ title: uiText("Klasör Açılamadı", "Could Not Open Folder"), message: res?.error || "Hedef klasör açılamadı." });
      }
    } catch (err) {
      if (showAlert) showAlert({ title: "Hata", message: err.message });
    }
    setTimeout(() => setOpenedFolderKey(null), 2000);
  };

  const audioRef = useRef(null);

  const chosenMusicModel = musicModels.find((m) => m.id === musicModel || m.filename === musicModel);

  const fetchAudioHistory = async () => {
    try {
      const res = await fetch("/api/audio/history");
      const data = await res.json();
      if (res.ok && Array.isArray(data.items)) {
        setAudioHistory(data.items);
      }
    } catch (_) {}
  };

  const fetchMusicModels = async () => {
    try {
      const res = await fetch("/api/music/models");
      const data = await res.json();
      if (res.ok && data.models) {
        setMusicModels(data.models);
      }
    } catch (_) {}
  };

  const fetchReferenceVoices = async () => {
    try {
      const res = await fetch("/api/audio/reference-voices");
      const data = await res.json();
      if (res.ok && data.voices) {
        setReferenceVoicesList(data.voices);
        if (data.voices.length > 0 && !cloneRefAudio) {
          setCloneRefAudio(data.voices[0].path);
        }
      }
    } catch (_) {}
  };

  const fetchOmniStatus = async () => {
    try {
      const res = await fetch("/api/audio/omnivoice-status");
      const data = await res.json();
      if (res.ok && data) {
        setOmniStatus(data);
      }
    } catch (_) {}
  };

  useEffect(() => {
    fetchMusicModels();
    fetchReferenceVoices();
    fetchOmniStatus();
    fetchAudioHistory();
  }, []);

  useEffect(() => {
    if (ttsEngine !== "omnivoice" || omniStatus.installed) return;
    const timer = setInterval(fetchOmniStatus, 2000);
    return () => clearInterval(timer);
  }, [ttsEngine, omniStatus.installed]);

  useEffect(() => {
    if (!isProcessing) {
      setLiveProgress({ active: false, percent: 0, phase: "", mode: "" });
      return;
    }

    let isMounted = true;
    let curPct = 6;
    setLiveProgress({ active: true, percent: 6, phase: "İşlem başlatılıyor...", mode: subTab });

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/audio/progress");
        if (res.ok && isMounted) {
          const data = await res.json();
          if (data && data.active) {
            const targetPct = Math.max(curPct, Number(data.progress) || 0);
            curPct = targetPct;
            setLiveProgress({
              active: true,
              percent: Math.min(99, Math.max(curPct, 6)),
              phase: data.phase || (subTab === "sfx" ? "Ses efekti işleniyor..." : subTab === "music" ? "Müzik sentezleniyor..." : "Seslendirme yapılıyor..."),
              mode: data.mode || subTab
            });
            return;
          }
        }
      } catch (_) {}

      if (isMounted) {
        curPct = Math.min(96, curPct + (curPct < 25 ? 4 : curPct < 65 ? 2 : 1));
        setLiveProgress(prev => ({
          ...prev,
          active: true,
          percent: curPct,
          phase: prev.phase || (subTab === "sfx" ? "Ses efekti akustik difüzyonu işleniyor..." : subTab === "music" ? "Müzik ses dalgaları sentezleniyor..." : "Yapay zekâ ses sentezleme...")
        }));
      }
    }, 350);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [isProcessing, subTab]);

  const handleVoiceUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingVoice(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64Data = reader.result;
        const res = await fetch("/api/audio/upload-reference-voice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            data: base64Data
          })
        });
        const data = await res.json();
        if (res.ok && data.path) {
          setCloneRefAudio(data.path);
          fetchReferenceVoices();
          showAlert?.({
            title: uiText("Ses Örneği Yüklendi", "Voice Sample Uploaded"),
            message: uiText(`"${file.name}" ses klonlama referansı olarak kaydedildi.`, `"${file.name}" was saved as a voice cloning reference.`)
          });
        } else {
          throw new Error(data.error || "Ses yükleme başarısız oldu.");
        }
      } catch (err) {
        showAlert?.({ title: uiText("Yükleme Hatası", "Upload Error"), message: err.message, danger: true });
      } finally {
        setIsUploadingVoice(false);
      }
    };
    reader.readAsDataURL(file);
  };



  const handleDownloadMusicModelDirect = async (model) => {
    if (!model) return;
    if (model.supported === false) {
      showAlert?.({ title: uiText("Bu Sürümde Entegre Değil", "Not Integrated in This Version"), message: model.notes || `${model.name} bu sürümde kullanılamaz.` });
      return;
    }
    const proceed = await showConfirm?.({
      title: uiText("Model İndirilsin mi?", "Download Model?"),
      message: uiText(`"${model.name}" modeli (${model.approxSize || "?"}) bilgisayarınıza indirilecek. Onaylıyor musunuz?`, `"${model.name}" (${model.approxSize || "?"}) will be downloaded to your computer. Continue?`),
      confirmLabel: uiText("Modeli İndir", "Download Model"),
      cancelLabel: "Vazgeç",
    });
    if (!proceed) return;

    try {
      const res = model.snapshotId
        ? await downloadSnapshotModel(model.snapshotId, model.name, "music")
        : await downloadMusicModel(model.url, model.filename, model.name);
      if (res?.ok) {
        showAlert?.({
          title: uiText("İndirme Başlatıldı", "Download Started"),
          message: uiText(`"${model.name}" indirme kuyruğuna alındı. İlerleme durumunu en üstteki indirme çubuğundan canlı takip edebilirsiniz. İndirme bittiğinde doğrudan müzik üretebilirsiniz.`, `"${model.name}" was added to the download queue. You can follow the progress in the download bar at the top. Once it finishes you can generate music right away.`),
        });
      } else {
        showAlert?.({
          title: uiText("İndirme Hatası", "Download Error"),
          message: res?.error || "Model indirme işlemi başlatılamadı.",
          danger: true,
        });
      }
    } catch (err) {
      showAlert?.({
        title: uiText("İndirme Hatası", "Download Error"),
        message: err.message || "Model indirme işlemi başlatılamadı.",
        danger: true,
      });
    }
  };



  const handleEngineChange = (newEngine) => {
    setTtsEngine(newEngine);
    if (newEngine === "antalia") {
      setTtsVoice("antalia_dogal");
    } else if (newEngine === "ahenk-cep") {
      setTtsVoice("ahenk_neutral");
    } else if (newEngine === "ema-lightning") {
      setTtsVoice("ema_kadin");
    } else if (newEngine === "omnivoice") {
      setTtsVoice("omnivoice_clone");
    } else if (newEngine === "kokoro") {
      setTtsVoice("af_heart");
    } else if (newEngine === "piper") {
      setTtsVoice("dfki");
    } else if (newEngine === "supertonic") {
      setTtsVoice("M1");
    } else if (newEngine === "elevenlabs") {
      setTtsVoice("eleven_rachel");
    } else if (newEngine === "openai") {
      setTtsVoice("alloy");
    } else if (newEngine === "minimax") {
      setTtsVoice("English_Graceful_Lady");
    }
  };

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleGenerateTTS = async () => {
    if (!ttsText.trim()) {
      showAlert?.({ title: "Metin Eksik", message: uiText("Lütfen seslendirilecek bir Türkçe metin girin.", "Please enter the text to be spoken.") });
      return;
    }

    if (checkAndConfirmInterruption) {
      const proceed = await checkAndConfirmInterruption("audio");
      if (!proceed) return;
    }

    setIsProcessing(true);
    setIsAudioGenerating?.(true);
    const genStartTime = performance.now();
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, 300000);

    try {
      const res = await fetch("/api/audio/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({
          engine: ttsEngine,
          text: ttsText,
          voice: ttsVoice,
          speed: ttsSpeed,
          ref_audio: cloneRefAudio || undefined,
          ref_text: cloneRefText || undefined,
          instruct: cloneInstruct || undefined,
        }),
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (res.ok && data.url) {
        setAudioUrl(data.url);
        const elapsedSec = ((performance.now() - genStartTime) / 1000).toFixed(1);
        const engineFullName = ttsEngine === "antalia"
          ? "Antalia-2 Mini (7.62M, 48 kHz)"
          : ttsEngine === "ahenk-cep"
            ? "Ahenk Cep Türkçe (8.6M, 48 kHz, 7 üslup)"
            : ttsEngine === "ema-lightning"
              ? (ttsVoice === "ema_erkek" ? "Antalia-2 Mini (EMA erkek seçeneği)" : "EMA Lightning (8.6M, 48 kHz)")
              : ttsEngine === "omnivoice"
                ? "OmniVoice (600+ dil, zero-shot)"
                : ttsEngine === "supertonic"
                  ? "Supertone Supertonic-3 (~99M ONNX)"
                  : ttsEngine === "kokoro"
                    ? "Kokoro-82M v1.0 (İngilizce)"
                    : ttsEngine === "piper"
                      ? "Piper TTS (tr_TR dfki medium)"
                      : ttsEngine === "openai"
                        ? "OpenAI tts-1-hd"
                        : ttsEngine === "minimax"
                          ? "MiniMax speech-2.8-hd"
                          : "ElevenLabs eleven_multilingual_v2";
        const supertonicVoiceNames = {
          "M1": "M1 (Tok & Kararlı Erkek)", "M2": "M2 (Doğal & Samimi Erkek)", "M3": "M3 (Akıcı & Dinamik Erkek)", "M4": "M4 (Genç & Enerjik Erkek)", "M5": "M5 (Derin Anlatıcı Erkek)",
          "F1": "F1 (Doğal & Berrak Kadın)", "F2": "F2 (Kurumsal & Spiker Kadın)", "F3": "F3 (Canlı & Neşeli Kadın)", "F4": "F4 (Akıcı Podcast Kadın)", "F5": "F5 (Sıcak Masal Kadın)"
        };
        const ahenkVoiceNames = {
          "ahenk_neutral": "Ahenk Doğal / Nötr Ton (48kHz)",
          "ahenk_cheerful": "Ahenk Neşeli ve Canlı Ton (48kHz)",
          "ahenk_calm": "Ahenk Sakin ve Dingin Ton (48kHz)",
          "ahenk_empathetic": "Ahenk Empatik ve Şefkatli Ton (48kHz)",
          "ahenk_sad": "Ahenk Hüzünlü ve Duygusal Ton (48kHz)",
          "ahenk_surprised": "Ahenk Şaşkın ve Heyecanlı Ton (48kHz)",
          "ahenk_angry": "Ahenk Öfkeli ve Sert Ton (48kHz)",
        };
        const voiceDisplay = ttsEngine === "antalia" ? "Antalia erkek sesi"
          : ttsEngine === "ahenk-cep" ? (ahenkVoiceNames[ttsVoice] || "Ahenk Cep nötr üslup")
          : ttsEngine === "omnivoice" ? (cloneRefAudio ? "Referans ses klonu" : (cloneInstruct ? "Ses tasarımı" : "Otomatik ses"))
          : ttsVoice === "ema_kadin" ? "EMA sesi (standart hız)"
          : ttsVoice === "ema_sakin" ? "EMA sesi (0.92x)"
          : ttsVoice === "ema_haber" ? "EMA sesi (1.08x)"
          : ttsVoice === "ema_erkek" ? "Erkek ses (Antalia-2 Mini)"
          : ttsVoice === "ema_genc" ? "EMA sesi (1.06x)"
          : ttsEngine === "supertonic" && supertonicVoiceNames[String(ttsVoice).toUpperCase()] ? `Supertonic ${String(ttsVoice).toUpperCase()}`
          : ttsVoice;
        setAudioMetadata({
          model: engineFullName,
          engineType: ttsEngine.toUpperCase(),
          scale: (ttsEngine === "ema-lightning" || ttsEngine === "antalia" || ttsEngine === "ahenk-cep") ? "48.000 Hz • 16-bit PCM WAV • Mono"
            : ttsEngine === "supertonic" ? "44.100 Hz • 16-bit PCM WAV • Mono"
            : ttsEngine === "omnivoice" || ttsEngine === "kokoro" ? "24.000 Hz • 16-bit PCM WAV • Mono"
            : ttsEngine === "piper" ? "22.050 Hz • WAV • Mono"
            : "MP3 (bulut servisi)",
          genDuration: `${elapsedSec}s`,
          mode: ttsEngine === "omnivoice" ? (cloneRefAudio ? "Zero-Shot Ses Klonlama" : "Ses Tasarımı / TTS") : "Metinden Sese Doğal Sentez (TTS)",
          params: `Ses: ${voiceDisplay} • Hız: ${ttsSpeed}x`,
          prompt: ttsText,
        });
        setLastGeneratedInfo({
          type: `Ses Üretimi (${ttsEngine.toUpperCase()})`,
          prompt: ttsText,
          duration: `${elapsedSec}s`,
          model: engineFullName,
        });
        fetchAudioHistory();
      } else {
        throw new Error(data.error || "Seslendirme motoru yanıt vermedi.");
      }
    } catch (err) {
      clearTimeout(timeoutId);
      showAlert?.({
        title: uiText("Seslendirme Hatası", "Speech Synthesis Error"),
        message: err.name === "AbortError"
          ? "Seslendirme işlemi zaman aşımına uğradı (300 saniye). Lütfen tekrar deneyiniz."
          : (err.message || "Seçilen seslendirme motoru başlatılamadı."),
        danger: true,
      });
    } finally {
      clearTimeout(timeoutId);
      setIsProcessing(false);
      setIsAudioGenerating?.(false);
    }
  };

  const handleGenerateMusic = async () => {
    if (chosenMusicModel && !chosenMusicModel.installed) {
      handleDownloadMusicModelDirect(chosenMusicModel);
      return;
    }

    if (!musicPrompt.trim()) {
      showAlert?.({ title: uiText("Uyarı", "Warning"), message: uiText("Lütfen bir müzik istemi (prompt) girin.", "Please enter a music prompt.") });
      return;
    }

    if (checkAndConfirmInterruption) {
      const proceed = await checkAndConfirmInterruption("audio");
      if (!proceed) return;
    }

    setIsProcessing(true);
    setIsAudioGenerating?.(true);
    const genStartTime = performance.now();
    try {
      const isSfxModel = musicModel.includes("sfx") || musicModel.includes("audioldm");
      const res = await fetch("/api/audio/music", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: musicPrompt,
          duration: musicDuration,
          model: musicModel,
          mode: isSfxModel ? "sfx" : "music",
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        const url = data.url || data.audioUrl;
        if (url) {
          setAudioUrl(url);
          const elapsedSec = ((performance.now() - genStartTime) / 1000).toFixed(1);
          const musicModelFullName = chosenMusicModel?.name || (musicModel === "musicgen-small" ? "Meta AudioCraft MusicGen Small (300M)" : musicModel);
          const isSfx = Boolean(data.audio?.isSfx);
          setAudioMetadata({
            model: musicModelFullName,
            engineType: isSfx ? "Yapay Zekâ Ses Efekti (SFX / Foley)" : "Meta MusicGen",
            scale: `${data.audio?.sampleRate || 32000} Hz • 16-bit PCM WAV • Mono`,
            genDuration: data.audio?.genDuration || `${elapsedSec}s`,
            mode: isSfx ? `Yapay Zekâ Ses Efekti (${musicDuration} Saniye)` : `Yapay Zekâ Müzik Üretimi (${musicDuration} Saniye)`,
            params: `Uzunluk: ${musicDuration}s • Otoregresif Nöral Ses Sentezi (Seed: ${data.audio?.seed || "Rastgele"})`,
            prompt: musicPrompt,
          });
          setLastGeneratedInfo({
            type: isSfx ? "Ses Efekti (SFX)" : "Müzik / Parça",
            prompt: musicPrompt,
            duration: `${musicDuration}s (Üretim: ${data.audio?.genDuration || `${elapsedSec}s`})`,
            model: musicModelFullName,
          });
          fetchAudioHistory();
        }
        showAlert?.({ title: uiText("Müzik Üretimi Tamamlandı", "Music Generation Complete"), message: data.message || "Müzik parçası başarıyla üretildi!" });
      } else {
        throw new Error(data.error || "Müzik motoru başlatılamadı.");
      }
    } catch (err) {
      showAlert?.({ title: uiText("Müzik Bilgisi", "Music Info"), message: err.message, danger: true });
    } finally {
      setIsProcessing(false);
      setIsAudioGenerating?.(false);
    }
  };

  const handleGenerateSfx = async () => {
    if (!sfxPrompt.trim()) {
      showAlert?.({ title: uiText("Uyarı", "Warning"), message: uiText("Lütfen üretmek istediğiniz ses efektini tarif edin (Türkçe veya İngilizce).", "Please describe the sound effect you want (Turkish or English).") });
      return;
    }

    if (checkAndConfirmInterruption) {
      const proceed = await checkAndConfirmInterruption("audio");
      if (!proceed) return;
    }

    setIsProcessing(true);
    setIsAudioGenerating?.(true);
    const genStartTime = performance.now();
    try {
      const res = await fetch("/api/audio/music", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: sfxPrompt,
          duration: sfxDuration,
          model: sfxModel,
          mode: "sfx",
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        const url = data.url || data.audioUrl;
        if (url) {
          setAudioUrl(url);
          const elapsedSec = ((performance.now() - genStartTime) / 1000).toFixed(1);
          const modelName = sfxModel.includes("large")
            ? "AudioLDM 2 Large (En İyi - Sinematik Foley)"
            : (sfxModel.includes("2") || sfxModel.includes("base"))
            ? "AudioLDM 2 Base (En Verimli Orta - Dengeli)"
            : "AudioLDM-S Full (En Verimli Küçük - Hızlı)";
          setAudioMetadata({
            model: modelName,
            engineType: "Yapay Zekâ Ses Efekti (SFX / Foley)",
            scale: `${data.audio?.sampleRate || 16000} Hz • 16-bit PCM`,
            genDuration: data.audio?.genDuration || `${elapsedSec}s`,
            mode: `Yapay Zekâ Ses Efekti (${sfxDuration} Saniye)`,
            params: `Model: ${modelName} • Uzunluk: ${sfxDuration}s • Akustik Difüzyon (Seed: ${data.audio?.seed || "Rastgele"})`,
            prompt: sfxPrompt,
          });
          setLastGeneratedInfo({
            type: "Ses Efekti (SFX)",
            prompt: sfxPrompt,
            duration: `${sfxDuration}s (Üretim: ${data.audio?.genDuration || `${elapsedSec}s`})`,
            model: modelName,
          });
          fetchAudioHistory();
        }
        showAlert?.({ title: uiText("Ses Efekti Üretildi", "Sound Effect Generated"), message: data.message || "Ses efekti başarıyla üretildi!" });
      } else {
        throw new Error(data.error || "Ses efekti motoru başlatılamadı.");
      }
    } catch (err) {
      showAlert?.({ title: uiText("Ses Efekti Hatası", "Sound Effect Error"), message: err.message, danger: true });
    } finally {
      setIsProcessing(false);
      setIsAudioGenerating?.(false);
    }
  };

  return (
    <div className="audio-studio-container" style={{ display: "flex", flex: 1, height: "100%", overflow: "hidden" }}>
      {/* Sol Panel: Kontroller */}
      <div
        style={{
          width: "440px",
          minWidth: "400px",
          background: "var(--md-sys-color-surface-container-low)",
          borderRight: "1px solid var(--md-sys-color-outline-variant)",
          display: "flex",
          flexDirection: "column",
          padding: "20px",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
          <Volume2 size={24} color="var(--md-sys-color-primary)" />
          <h2 style={{ fontSize: "18px", fontWeight: "700", margin: 0 }}>Gelişmiş Ses & Müzik Stüdyosu</h2>
        </div>

        {/* Alt Sekmeler (TTS / Müzik / SFX) */}
        <div style={{ display: "flex", background: "var(--md-sys-color-surface-container-high)", borderRadius: "8px", padding: "3px", marginBottom: "20px", gap: "2px" }}>
          <button
            onClick={() => setSubTab("tts")}
            style={{
              flex: 1,
              padding: "8px 4px",
              borderRadius: "6px",
              border: "none",
              fontSize: "12px",
              fontWeight: "600",
              cursor: "pointer",
              background: subTab === "tts" ? "var(--md-sys-color-primary)" : "transparent",
              color: subTab === "tts" ? "var(--md-sys-color-on-primary)" : "inherit",
            }}
          >
            Seslendirme (TTS)
          </button>
          <button
            onClick={() => setSubTab("music")}
            style={{
              flex: 1,
              padding: "8px 4px",
              borderRadius: "6px",
              border: "none",
              fontSize: "12px",
              fontWeight: "600",
              cursor: "pointer",
              background: subTab === "music" ? "var(--md-sys-color-primary)" : "transparent",
              color: subTab === "music" ? "var(--md-sys-color-on-primary)" : "inherit",
            }}
          >
            Müzik Üretimi
          </button>
          <button
            onClick={() => setSubTab("sfx")}
            style={{
              flex: 1,
              padding: "8px 4px",
              borderRadius: "6px",
              border: "none",
              fontSize: "12px",
              fontWeight: "600",
              cursor: "pointer",
              background: subTab === "sfx" ? "var(--md-sys-color-primary)" : "transparent",
              color: subTab === "sfx" ? "var(--md-sys-color-on-primary)" : "inherit",
            }}
          >
            Ses Efekti (SFX)
          </button>
        </div>

        {/* --- 1. SEKME: METİNDEN SESE (TTS) --- */}
        {subTab === "tts" && (
          <div>
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}>
                Türkçe Ses Motoru Seçin:
              </label>
              <select
                value={ttsEngine}
                onChange={(e) => handleEngineChange(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: "8px",
                  border: "1px solid var(--md-sys-color-outline)",
                  background: "var(--md-sys-color-surface)",
                  color: "var(--md-sys-color-on-surface)",
                  fontSize: "13px",
                }}
              >
                <option value="antalia">Antalia-2 Mini (Türkçe, 48 kHz, erkek sesi) [Yerel - Önerilen]</option>
                <option value="ahenk-cep">Ahenk Cep (Türkçe, 48 kHz, kadın sesi, 7 üslup) [Yerel - Önerilen]</option>
                <option value="ema-lightning">EMA Lightning (Türkçe, 48 kHz) [Yerel - Önerilen]</option>
                <option value="supertonic">Supertone Supertonic-3 (31 dil, 10 ses) [Yerel]</option>
                <option value="omnivoice">OmniVoice (ses klonlama, 600+ dil) [Yerel - GPU önerilir]</option>
                <option value="kokoro">Kokoro-82M (yalnızca İngilizce sesler) [Yerel]</option>
                <option value="piper">Piper TTS Türkçe DFKI [Yerel - elle kurulum gerekir]</option>
                <option value="elevenlabs">ElevenLabs Multilingual v2 [Bulut API]</option>
                <option value="openai">OpenAI tts-1-hd (6 ses) [Bulut API]</option>
                <option value="minimax">MiniMax speech-2.8-hd [Bulut API]</option>
              </select>
            </div>

            {/* Seslendirmen / Ses Karakteri Seçimi */}
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}>
                Ses Karakteri / Konuşmacı:
              </label>
              <select
                value={ttsVoice}
                onChange={(e) => setTtsVoice(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: "8px",
                  border: "1px solid var(--md-sys-color-outline)",
                  background: "var(--md-sys-color-surface)",
                  color: "var(--md-sys-color-on-surface)",
                  fontSize: "13px",
                }}
              >
                {ttsEngine === "ahenk-cep" && (
                  <>
                    <option value="ahenk_neutral">Ahenk Cep - Doğal / Nötr Ton (48kHz Stüdyo)</option>
                    <option value="ahenk_cheerful">Ahenk Cep - Neşeli ve Canlı Ton (48kHz Stüdyo)</option>
                    <option value="ahenk_calm">Ahenk Cep - Sakin ve Dingin Ton (48kHz Stüdyo)</option>
                    <option value="ahenk_empathetic">Ahenk Cep - Empatik ve Şefkatli Ton (48kHz Stüdyo)</option>
                    <option value="ahenk_sad">Ahenk Cep - Hüzünlü ve Duygusal Ton (48kHz Stüdyo)</option>
                    <option value="ahenk_surprised">Ahenk Cep - Şaşkın ve Heyecanlı Ton (48kHz Stüdyo)</option>
                    <option value="ahenk_angry">Ahenk Cep - Öfkeli ve Sert Ton (48kHz Stüdyo)</option>
                  </>
                )}
                {ttsEngine === "antalia" && (
                  <>
                    <option value="antalia_dogal">Antalia erkek sesi - standart hız (1.0x)</option>
                    <option value="antalia_tok">Antalia erkek sesi - yavaş (0.94x)</option>
                    <option value="antalia_akici">Antalia erkek sesi - hızlı (1.08x)</option>
                    <option value="antalia_sicak">Antalia erkek sesi - biraz yavaş (0.96x)</option>
                    <option value="antalia_genc">Antalia erkek sesi - biraz hızlı (1.05x)</option>
                  </>
                )}
                {ttsEngine === "ema-lightning" && (
                  <>
                    <option value="ema_kadin">EMA sesi - standart hız (1.0x)</option>
                    <option value="ema_sakin">EMA sesi - yavaş (0.92x)</option>
                    <option value="ema_genc">EMA sesi - biraz hızlı (1.06x)</option>
                    <option value="ema_haber">EMA sesi - hızlı (1.08x)</option>
                    <option value="ema_erkek">Erkek ses (Antalia-2 Mini ile üretilir)</option>
                  </>
                )}
                {ttsEngine === "omnivoice" && (
                  <>
                    <option value="omnivoice_clone">Referans Ses Klonu (Yüklenen Ses Örneği)</option>
                    <option value="omnivoice_auto">Otomatik Doğal Ses (Foundation)</option>
                  </>
                )}
                {ttsEngine === "kokoro" && (
                  <>
                    <option value="af_heart">Heart - Kadın (ABD İngilizcesi)</option>
                    <option value="af_bella">Bella - Kadın (ABD İngilizcesi)</option>
                    <option value="af_nicole">Nicole - Kadın (ABD İngilizcesi)</option>
                    <option value="am_michael">Michael - Erkek (ABD İngilizcesi)</option>
                    <option value="am_adam">Adam - Erkek (ABD İngilizcesi)</option>
                    <option value="bf_emma">Emma - Kadın (İngiliz İngilizcesi)</option>
                    <option value="bm_george">George - Erkek (İngiliz İngilizcesi)</option>
                  </>
                )}
                {ttsEngine === "piper" && (
                  <>
                    <option value="dfki">DFKI - Türkçe erkek sesi (tek konuşmacı)</option>
                  </>
                )}
                {ttsEngine === "supertonic" && (
                  <>
                    <option value="M1">M1 - Tok ve Kararlı Erkek Sesi</option>
                    <option value="M2">M2 - Doğal ve Samimi Erkek Sesi</option>
                    <option value="M3">M3 - Akıcı ve Dinamik Erkek Sesi</option>
                    <option value="M4">M4 - Genç ve Enerjik Erkek Sesi</option>
                    <option value="M5">M5 - Derin Anlatıcı Erkek Sesi</option>
                    <option value="F1">F1 - Doğal ve Berrak Kadın Sesi</option>
                    <option value="F2">F2 - Kurumsal Spiker Kadın Sesi</option>
                    <option value="F3">F3 - Canlı ve Neşeli Kadın Sesi</option>
                    <option value="F4">F4 - Akıcı Podcast Kadın Sesi</option>
                    <option value="F5">F5 - Sıcak Masal Kadın Sesi</option>
                  </>
                )}
                {ttsEngine === "elevenlabs" && (
                  <>
                    <option value="eleven_rachel">Rachel - ElevenLabs kadın sesi</option>
                    <option value="eleven_adam">Adam - ElevenLabs erkek sesi</option>
                  </>
                )}
                {ttsEngine === "openai" && (
                  <>
                    <option value="alloy">Alloy - OpenAI Dengeli ve Doğal Ses</option>
                    <option value="echo">Echo - OpenAI Sıcak ve Güvenilir Erkek</option>
                    <option value="fable">Fable - OpenAI Melodik ve Hikaye Sesi</option>
                    <option value="onyx">Onyx - OpenAI Derin ve Tok Spiker Erkek</option>
                    <option value="nova">Nova - OpenAI Canlı ve Dinamik Kadın</option>
                    <option value="shimmer">Shimmer - OpenAI Berrak ve Samimi Kadın</option>
                  </>
                )}
                {ttsEngine === "minimax" && (
                  <>
                    <option value="English_Graceful_Lady">Graceful Lady - kadın (Türkçe vurgu ile)</option>
                    <option value="English_Insightful_Speaker">Insightful Speaker - erkek (Türkçe vurgu ile)</option>
                    <option value="English_Persuasive_Man">Persuasive Man - erkek (Türkçe vurgu ile)</option>
                    <option value="English_expressive_narrator">Expressive Narrator - anlatıcı (Türkçe vurgu ile)</option>
                  </>
                )}
              </select>
              {ttsEngine === "antalia" && (
                <div style={{ marginTop: "6px", fontSize: "0.75rem", color: "var(--md-sys-color-outline)" }}>
                  Antalia-2 Mini tek bir sentetik erkek sesine sahiptir; buradaki seçenekler yalnızca konuşma hızını değiştirir. Farklı ses karakterleri için Supertonic-3, ses klonlama için OmniVoice kullanın.
                </div>
              )}
              {ttsEngine === "ahenk-cep" && (
                <div style={{ marginTop: "6px", fontSize: "0.75rem", color: "var(--md-sys-color-outline)" }}>
                  Ahenk Cep tek bir tasarlanmış kadın sesiyle 7 üslupta konuşur (üslup farkları hafiftir). Ağırlıklar CC-BY-4.0: yayınlarken modele atıf yapın.
                </div>
              )}
              {ttsEngine === "ema-lightning" && (
                <div style={{ marginTop: "6px", fontSize: "0.75rem", color: "var(--md-sys-color-outline)" }}>
                  EMA Lightning tek seslidir; seçenekler konuşma hızını değiştirir. "Erkek" seçeneği Antalia-2 Mini modeliyle üretilir.
                </div>
              )}
              {ttsEngine === "kokoro" && (
                <div style={{ marginTop: "6px", fontSize: "0.75rem", color: "#f59e0b" }}>
                  Kokoro'nun Türkçe sesi yoktur. Türkçe metin deneysel fonetik dönüşümle okunur ve aksanlı / doğal olmayan sonuç verir; Türkçe için Antalia, Ahenk, EMA veya Supertonic önerilir.
                </div>
              )}
              {ttsEngine === "piper" && (
                <div style={{ marginTop: "6px", fontSize: "0.75rem", color: "#f59e0b" }}>
                  Piper otomatik kurulmaz: piper.exe'yi app/tools/piper, tr_TR-dfki-medium.onnx ve .onnx.json dosyalarını app/tts-models/piper klasörüne koyun.
                </div>
              )}
            </div>

            {/* Zero-Shot Ses Klonlama Kontrolleri (OmniVoice Seçiliyse) */}
            {ttsEngine === "omnivoice" && (
              <div
                style={{
                  marginBottom: "16px",
                  padding: "14px",
                  borderRadius: "10px",
                  background: "rgba(59, 130, 246, 0.05)",
                  border: "1px solid rgba(59, 130, 246, 0.2)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <label style={{ fontSize: "12px", fontWeight: "700", color: "var(--md-sys-color-primary)" }}>
                    Zero-Shot Referans Ses Örneği (3-10 Saniye):
                  </label>
                  <button
                    type="button"
                    onClick={() => voiceFileInputRef.current?.click()}
                    disabled={isUploadingVoice}
                    className="m3-btn m3-btn-outlined"
                    style={{ fontSize: "11px", height: "30px", padding: "0 10px", borderRadius: "6px" }}
                  >
                    <Upload size={13} style={{ marginRight: "4px" }} />
                    <span>{isUploadingVoice ? "Yükleniyor..." : "Yeni Ses Örneği Yükle"}</span>
                  </button>
                  <input
                    ref={voiceFileInputRef}
                    type="file"
                    accept="audio/*"
                    onChange={handleVoiceUpload}
                    style={{ display: "none" }}
                  />
                </div>

                <div style={{ marginBottom: "10px" }}>
                  <select
                    value={cloneRefAudio}
                    onChange={(e) => {
                      const selectedPath = e.target.value;
                      setCloneRefAudio(selectedPath);
                      const foundVoice = referenceVoicesList.find((v) => v.path === selectedPath || v.filename === selectedPath);
                      if (foundVoice && foundVoice.transcript) {
                        setCloneRefText(foundVoice.transcript);
                      }
                    }}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--md-sys-color-outline)",
                      background: "var(--md-sys-color-surface)",
                      color: "inherit",
                      fontSize: "12px",
                    }}
                  >
                    <option value="">-- Kayıtlı Referans Ses Seçin (Veya yukarıdan yeni yükleyin) --</option>
                    {referenceVoicesList.map((v) => (
                      <option key={v.filename} value={v.path}>
                        {v.name} ({Math.round(v.sizeBytes / 1024)} KB)
                      </option>
                    ))}
                  </select>
                </div>

                {cloneRefAudio && (
                  <div style={{ marginBottom: "10px", padding: "8px 10px", borderRadius: "6px", background: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.2)", fontSize: "11px", color: "#10b981", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span>Aktif Referans: <strong>{cloneRefAudio.split(/[\\/]/).pop()}</strong></span>
                    <button
                      type="button"
                      onClick={() => setCloneRefAudio("")}
                      style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer", fontSize: "11px", textDecoration: "underline" }}
                    >
                      Kaldır
                    </button>
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: "600", marginBottom: "4px", opacity: 0.8 }}>
                      Referans Sesin Metni (İsteğe bağlı):
                    </label>
                    <input
                      type="text"
                      value={cloneRefText}
                      onChange={(e) => setCloneRefText(e.target.value)}
                      placeholder="Ses örneğinde okunan metin (daha kesin klonlama için, boş bırakılabilir)"
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        borderRadius: "6px",
                        border: "1px solid var(--md-sys-color-outline)",
                        background: "var(--md-sys-color-surface)",
                        color: "inherit",
                        fontSize: "12px",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>

                  {!cloneRefAudio && (
                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: "600", marginBottom: "4px", opacity: 0.8 }}>
                        Ses Tasarımı Tarifi (Referans ses yoksa):
                      </label>
                      <input
                        type="text"
                        value={cloneInstruct}
                        onChange={(e) => setCloneInstruct(e.target.value)}
                        placeholder="Örn: Tok, sakin ve güven veren bir Türkçe radyo spikeri sesi"
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          borderRadius: "6px",
                          border: "1px solid var(--md-sys-color-outline)",
                          background: "var(--md-sys-color-surface)",
                          color: "inherit",
                          fontSize: "12px",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* OmniVoice model durumu */}
            {ttsEngine === "omnivoice" && !omniStatus.installed && (
              <div style={{ marginBottom: "14px", padding: "12px 14px", borderRadius: "10px", background: "rgba(59, 130, 246, 0.08)", border: "1px solid rgba(59, 130, 246, 0.3)", fontSize: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", color: "#3b82f6" }}>
                  <strong>{omniStatus.downloading ? "OmniVoice modeli indiriliyor (≈3.3 GB)..." : "OmniVoice modeli (≈3.3 GB) henüz indirilmedi."}</strong>
                  {!omniStatus.downloading && (
                    <button
                      type="button"
                      className="m3-btn m3-btn-outlined"
                      style={{ height: "28px", padding: "0 10px", fontSize: "11px" }}
                      onClick={async () => {
                        const res = await downloadTtsModel("omnivoice");
                        if (!res?.ok) showAlert?.({ title: uiText("İndirme Hatası", "Download Error"), message: res?.error || "İndirme başlatılamadı.", danger: true });
                        fetchOmniStatus();
                      }}
                    >
                      Şimdi İndir
                    </button>
                  )}
                </div>
                <div style={{ fontSize: "11px", opacity: 0.75, marginTop: "6px" }}>
                  İlerleme üst bardaki indirme göstergesinden izlenebilir. Gerekli Python paketi: pip install omnivoice.
                </div>
              </div>
            )}

            {/* Motor Açıklama Rozeti */}
            <div
              style={{
                fontSize: "12px",
                padding: "8px 12px",
                borderRadius: "8px",
                background: "rgba(59, 130, 246, 0.1)",
                color: "#3b82f6",
                marginBottom: "16px",
                border: "1px solid rgba(59, 130, 246, 0.2)",
              }}
            >
              {ttsEngine === "antalia" && "Antalia-2 Mini: 7.62M parametre (~31 MB), 48 kHz, tek sentetik erkek sesi; sayı, tarih ve tutarları kendi normalleştiricisiyle okur. Freya-TR-Eval WER %1.02. CPU'da gerçek zamandan hızlı."}
              {ttsEngine === "ahenk-cep" && "Ahenk Cep: 8.6M parametre (~34 MB), 48 kHz, tek tasarlanmış kadın sesi, 7 üslup (nötr, neşeli, sakin, empatik, hüzünlü, şaşkın, öfkeli). trnorm ile sayı/tarih/para okuma."}
              {ttsEngine === "ema-lightning" && "EMA Lightning: 8.6M parametre (~34 MB), 4 adımlı DiT flow-matching, 48 kHz. Freya-TR-Eval'de %0.92 WER."}
              {ttsEngine === "omnivoice" && "OmniVoice (k2-fsa): kısa (3-10 sn) bir referans sesle zero-shot klonlama veya metinle ses tasarımı; Türkçe dahil 600+ dil."}
              {ttsEngine === "kokoro" && "Kokoro: 82M parametreli hızlı İngilizce TTS (ABD / İngiltere sesleri)."}
              {ttsEngine === "supertonic" && "Supertone Supertonic-3: ~99M parametreli ONNX motoru, Türkçe dahil 31 dil, 10 hazır ses (M1-M5, F1-F5) ve <laugh>, <breath>, <sigh> etiketleri."}
              {ttsEngine === "piper" && "Piper: CPU'da çok hızlı, 22.05 kHz tek sesli Türkçe TTS (elle kurulum gerekir)."}
              {ttsEngine === "elevenlabs" && "ElevenLabs: Kayıtlı API anahtarınızla eleven_multilingual_v2 modeli (Türkçe destekli) üzerinden bulut seslendirme. Ücretlidir."}
              {ttsEngine === "openai" && "OpenAI TTS: Kayıtlı OpenAI anahtarınızla tts-1-hd modeli ve 6 ses (alloy, echo, fable, onyx, nova, shimmer). OpenAI bu modeli Ocak 2027'de kapatacağını duyurdu."}
              {ttsEngine === "minimax" && "MiniMax: Kayıtlı MiniMax anahtarınızla speech-2.8-hd modeli; Türkçe için language_boost=Turkish kullanılır. Ücretlidir."}
            </div>

            {/* Metin Giriş Alanı */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <label style={{ fontSize: "13px", fontWeight: "600" }}>
                  Okunacak Türkçe Metin:
                </label>
                <span style={{ fontSize: "11px", opacity: 0.7 }}>{ttsText.length} karakter</span>
              </div>
              <textarea
                value={ttsText}
                onChange={(e) => setTtsText(e.target.value)}
                placeholder="Seslendirmek istediğiniz Türkçe metni buraya yazın..."
                rows={5}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--md-sys-color-outline)",
                  background: "var(--md-sys-color-surface)",
                  color: "var(--md-sys-color-on-surface)",
                  fontSize: "13px",
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
              <div style={{ marginTop: "10px" }}>
                <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.4px", color: "var(--md-sys-color-outline)", display: "block", marginBottom: "6px" }}>
                  Hızlı Test Metinleri (Örnek Seslendirmeler):
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    onClick={() => {
                      handleEngineChange("antalia");
                      setTtsVoice("antalia_dogal");
                      setTtsText("Antalia-2 Mini, yalnızca 7,6 milyon parametreyle 48 kilohertz Türkçe konuşma üretir.");
                    }}
                    title="Antalia-2 Mini ses testi"
                  >
                    Antalia-2 Mini (Standart Hız Testi)
                  </button>
                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    onClick={() => {
                      handleEngineChange("antalia");
                      setTtsVoice("antalia_tok");
                      setTtsText("Son dakika haberi: Yerel yapay zeka stüdyosu yeni nesil Türkçe ses modelleriyle başarıyla güncellendi.");
                    }}
                    title="Antalia-2 Mini yavaş tempo testi"
                  >
                    Antalia-2 Mini (Yavaş Tempo / Haber Metni)
                  </button>
                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    onClick={() => {
                      handleEngineChange("antalia");
                      setTtsVoice("antalia_genc");
                      setTtsText("Selam herkese! Bugün harika bir proje üzerinde çalışıyoruz, hazır mısınız?");
                    }}
                    title="Antalia-2 Mini hızlı tempo testi"
                  >
                    Antalia-2 Mini (Hızlı Tempo Testi)
                  </button>
                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    onClick={() => {
                      handleEngineChange("ahenk-cep");
                      setTtsVoice("ahenk_cheerful");
                      setTtsText("Harika bir gün! Ahenk Türkçe ses motoru neşeli ve duygulu tonuyla tamamen yerel olarak konuşuyor.");
                    }}
                    title="Ahenk Cep Neşeli Ton Testi"
                  >
                    Ahenk Cep 48kHz (Neşeli ve Canlı Ton Testi)
                  </button>
                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    onClick={() => {
                      handleEngineChange("ahenk-cep");
                      setTtsVoice("ahenk_calm");
                      setTtsText("Sakin bir an, derin bir nefes. Bugün her şey yolunda ve huzurlu ilerliyor.");
                    }}
                    title="Ahenk Cep Sakin Ton Testi"
                  >
                    Ahenk Cep 48kHz (Sakin ve Dingin Ton Testi)
                  </button>
                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    onClick={() => {
                      handleEngineChange("ema-lightning");
                      setTtsVoice("ema_kadin");
                      setTtsText("EMA Lightning, 8.6 milyon parametre ve 4 adımlı DiT mimarisiyle 48 kilohertz stüdyo kalitesinde Türkçe ses sentezler.");
                    }}
                    title="EMA Lightning Kadın Sesi Testi"
                  >
                    EMA Lightning 48kHz (Kadın Sesi Testi)
                  </button>

                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    onClick={() => {
                      handleEngineChange("omnivoice");
                      setTtsVoice("omnivoice_clone");
                      setTtsText("OmniVoice Zero-Shot ses klonlama motoru, yüklediğiniz kısa ses örneğinin akustik karakterini anında kopyalayarak bu metni okur.");
                    }}
                    title="OmniVoice Zero-Shot Klonlama Testi"
                  >
                    OmniVoice (Zero-Shot Klonlama Testi)
                  </button>
                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    onClick={() => {
                      handleEngineChange("kokoro");
                      setTtsVoice("af_heart");
                      setTtsText("Hello! This voice was generated locally on your computer with the Kokoro text to speech model.");
                    }}
                    title="Kokoro İngilizce ses testi"
                  >
                    Kokoro (İngilizce Ses Testi)
                  </button>
                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    onClick={() => {
                      handleEngineChange("supertonic");
                      setTtsVoice("M1");
                      setTtsText("Merhaba! Supertone Supertonic 3 Türkçe ses motoru, 99 milyon parametre ve 10 farklı karakter tonuyla yerel olarak konuşuyor.");
                    }}
                    title="Supertone Supertonic-3 Erkek M1 Sesi"
                  >
                    Supertone Supertonic-3 (Tok Erkek M1 Testi)
                  </button>
                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    onClick={() => {
                      handleEngineChange("supertonic");
                      setTtsVoice("F1");
                      setTtsText("Harika bir haber bu! Gerçekten başardığımıza inanamıyorum. Şimdi bir sonraki adıma geçebiliriz.");
                    }}
                    title="Supertone Supertonic-3 Kadın F1 Sesi"
                  >
                    Supertone Supertonic-3 (Doğal Kadın F1 Testi)
                  </button>
                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    onClick={() => setTtsText("Sayın müşterimiz, 14 Ekim saat 14:30'daki kontrol randevunuz başarıyla oluşturuldu. Referans kodunuz: TR-8924.")}
                    title="Randevu ve Hizmet Onayı"
                  >
                    Randevu ve Hizmet Onayı (Alania Corpus)
                  </button>
                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    onClick={() => setTtsText("Hesabınızdan 1.450 TL tutarında para transferi gerçekleştirildi. Kalan kullanılabilir bakiyeniz 12.870 TL'dir.")}
                    title="Banka ve Finans Bildirimi"
                  >
                    Banka ve Finans Bildirimi (Alania Corpus)
                  </button>
                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    onClick={() => setTtsText("Merhaba! Derine Dalıyoruz: Yapay Zekâ kanalına hoş geldiniz. Bu ses, harici hiçbir bulut servisi kullanılmadan tamamen kendi bilgisayarınızda yerel olarak üretildi.")}
                    title="Stüdyo Tanıtım Metni"
                  >
                    Stüdyo Tanıtım Metni
                  </button>
                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    onClick={() => setTtsText("Yapay zekâ teknolojileri hızla gelişmeye devam ediyor. Yerel donanım üzerinde çalışan açık kaynaklı modeller artık stüdyo kalitesinde ses ve müzik üretebiliyor.")}
                    title="Teknoloji ve Yapay Zekâ Haberi"
                  >
                    Teknoloji ve Yapay Zekâ Haberi
                  </button>
                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    onClick={() => setTtsText("Evrenin derinliklerinde, yıldız tozlarından doğan bir bilinç vardı. Zaman usulca akıyor, galaksilerin sessiz şarkısı sonsuz uzayda yankılanıyordu.")}
                    title="Edebi Kitap ve Sesli Hikâye"
                  >
                    Edebi Kitap ve Sesli Hikâye
                  </button>
                </div>
              </div>
            </div>

            {/* Hız Ayarı */}
            <div style={{ marginBottom: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", fontWeight: "600", marginBottom: "4px" }}>
                <span>Konuşma Hızı:</span>
                <span>{ttsSpeed}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={ttsSpeed}
                onChange={(e) => setTtsSpeed(Number(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>

            <button
              type="button"
              onClick={handleGenerateTTS}
              disabled={isProcessing || (ttsEngine === "omnivoice" && !omniStatus.installed)}
              className="btn-beam"
              style={{ width: "100%", height: "48px" }}
            >
              <div className="btn-content">
                <span>{
                  isProcessing ? `Seslendiriliyor... %${liveProgress.percent}` :
                  (ttsEngine === "omnivoice" && !omniStatus.installed) ? `OmniVoice Modeli İndiriliyor (%${omniStatus.progressPct})...` :
                  (ttsEngine === "omnivoice" && cloneRefAudio) ? "Referans Sesle Klonla ve Seslendir (Clone & Generate)" :
                  "Metni Seslendir (Generate Speech)"
                }</span>
              </div>
            </button>
          </div>
        )}

        {/* --- 2. SEKME: MÜZİK ÜRETİMİ --- */}
        {subTab === "music" && (
          <div>
            <div
              style={{
                fontSize: "12px",
                padding: "10px 12px",
                borderRadius: "8px",
                background: "rgba(16, 185, 129, 0.1)",
                color: "#10b981",
                marginBottom: "16px",
                border: "1px solid rgba(16, 185, 129, 0.2)",
              }}
            >
              <strong>Meta AudioCraft MusicGen:</strong> Yazdığınız Türkçe veya İngilizce metin tarifine göre enstrümantal fon müziği, melodi ve ritim üretir.
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "12px", fontWeight: "600", marginBottom: "6px" }}>
                Müzik Modeli Seçin:
              </label>
              <select
                value={musicModel}
                onChange={(e) => setMusicModel(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.15))",
                  background: "#161824",
                  backgroundColor: "#161824",
                  color: "#f8fafc",
                  colorScheme: "dark",
                  fontSize: "13px",
                  outline: "none"
                }}
              >
                {musicModels.filter(m => !m.id.includes("sfx") && !m.id.includes("audioldm") && m.supported !== false).length > 0 ? (
                  musicModels.filter(m => !m.id.includes("sfx") && !m.id.includes("audioldm") && m.supported !== false).map((m) => (
                    <option key={m.id} value={m.id} style={{ backgroundColor: "#161824", color: "#f8fafc", padding: "8px 12px" }}>
                      {m.name} {m.installed ? "[Hazır]" : `[İndirilmedi - ${m.approxSize || "İndir"}]`}
                    </option>
                  ))
                ) : (
                  <>
                    <option value="musicgen-small" style={{ backgroundColor: "#161824", color: "#f8fafc" }}>Meta MusicGen Small (300M)</option>
                    <option value="musicgen-medium" style={{ backgroundColor: "#161824", color: "#f8fafc" }}>Meta MusicGen Medium (1.5B)</option>
                    <option value="musicgen-large" style={{ backgroundColor: "#161824", color: "#f8fafc" }}>Meta MusicGen Large (3.3B)</option>
                  </>
                )}
              </select>

              {/* Müzik Modeli Hazır / İndirilmedi Rozeti */}
              {chosenMusicModel && chosenMusicModel.installed ? (
                <div style={{ marginTop: "8px", padding: "8px 12px", borderRadius: "6px", background: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.3)", fontSize: "12px", color: "#10b981", display: "flex", alignItems: "center", gap: "6px" }}>
                  <CheckCircle2 size={15} />
                  <span><strong>Hazır:</strong> {chosenMusicModel.name} modeli kurulu ve kullanıma hazır.</span>
                </div>
              ) : chosenMusicModel && !chosenMusicModel.installed ? (
                <div style={{ marginTop: "8px", padding: "10px 12px", borderRadius: "8px", background: "rgba(245, 158, 11, 0.1)", border: "1px solid rgba(245, 158, 11, 0.3)", fontSize: "12px", color: "#f59e0b" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: "700" }}>
                      <AlertTriangle size={15} />
                      <span>Model İndirilmedi</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDownloadMusicModelDirect(chosenMusicModel)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        padding: "4px 10px",
                        borderRadius: "6px",
                        background: "#f59e0b",
                        color: "#000",
                        border: "none",
                        fontSize: "11px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      <Download size={13} />
                      <span>Şimdi İndir ({chosenMusicModel.approxSize})</span>
                    </button>
                  </div>
                  <div style={{ fontSize: "11px", opacity: 0.85 }}>
                    Bu modeli kullanabilmek için önce bilgisayarınıza indirilmesi gerekir.
                  </div>
                </div>
              ) : null}
            </div>

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}>
                Müzik İstemi (Türkçe veya İngilizce Prompt):
              </label>
              <textarea
                value={musicPrompt}
                onChange={(e) => setMusicPrompt(e.target.value)}
                placeholder="Örn: Epik sinematik orkestra müziği, keman ve davullar... veya Chill lofi hip-hop beat, soft vintage electric piano chords, 85 bpm..."
                rows={4}
                style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--md-sys-color-outline)", background: "var(--md-sys-color-surface)", color: "inherit", fontSize: "13px", boxSizing: "border-box" }}
              />

              {/* Hızlı Müzik İlham Butonları */}
              <div style={{ marginTop: "10px" }}>
                <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.4px", color: "var(--md-sys-color-outline)", display: "block", marginBottom: "6px" }}>
                  Müzik İlhamı (Melodi & Parça İstemleri):
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    onClick={() => {
                      setMusicPrompt("Chill lofi hip-hop beat, soft vintage electric piano chords, warm vinyl crackle, mellow bassline, relaxed study music, 85 bpm");
                    }}
                    title="Lofi Hip-Hop Chill"
                  >
                    Lofi Hip-Hop Chill (Çalışma ve Odaklanma)
                  </button>
                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    onClick={() => {
                      setMusicPrompt("80s synthwave electronic track with punchy analog synthesizer, retro drum machine, driving bassline, neon night drive vibe, 120 bpm");
                    }}
                    title="Synthwave 80s Retro"
                  >
                    Synthwave 80s Retro (Gece Sürüşü)
                  </button>
                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    onClick={() => {
                      setMusicPrompt("Epic cinematic orchestral music, powerful brass and strings crescendo, dramatic percussion, adventure movie soundtrack");
                    }}
                    title="Sinematik Epik Orkestra"
                  >
                    Sinematik Epik Orkestra (Film Müziği)
                  </button>
                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    onClick={() => {
                      setMusicPrompt("Warm acoustic guitar and smooth upright double bass jazz melody, cozy coffee shop ambience, peaceful and uplifting");
                    }}
                    title="Akustik Kafe Cazı"
                  >
                    Akustik Kafe Cazı (Huzurlu Melodi)
                  </button>
                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    onClick={() => {
                      setMusicPrompt("Emotional Anatolian folk instrumental music, warm acoustic baglama lute and mystical ney reed flute melody, calm atmospheric studio recording");
                    }}
                    title="Anadolu Akustik Enstrümantal"
                  >
                    Anadolu Akustik Bağlama ve Ney (Duygusal Melodi)
                  </button>
                </div>
              </div>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <label style={{ fontSize: "12px", fontWeight: "600" }}>Parça Uzunluğu (Süre):</label>
                <span style={{ fontSize: "12px", fontWeight: "700", color: "var(--md-sys-color-primary)" }}>
                  {musicDuration >= 60 ? `${Math.floor(musicDuration / 60)} dk ${musicDuration % 60 ? `${musicDuration % 60} sn` : ""}` : `${musicDuration} sn`}
                </span>
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px" }}>
                <select
                  value={[5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300].includes(musicDuration) ? musicDuration : "custom"}
                  onChange={(e) => {
                    if (e.target.value !== "custom") {
                      setMusicDuration(Number(e.target.value));
                    }
                  }}
                  style={{ flex: 1, padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--md-sys-color-outline)", background: "var(--md-sys-color-surface)", color: "inherit", fontSize: "13px" }}
                >
                  <option value={5}>5 Saniye (Hızlı Önizleme)</option>
                  <option value={10}>10 Saniye (Kısa Jingle)</option>
                  <option value={15}>15 Saniye (Sosyal Medya / Story)</option>
                  <option value={20}>20 Saniye (Standart Tanıtım)</option>
                  <option value={30}>30 Saniye (Standart Klip)</option>
                  <option value={45}>45 Saniye (Genişletilmiş Klip)</option>
                  <option value={60}>60 Saniye (1 Dakika - Tam Parça)</option>
                  <option value={90}>90 Saniye (1.5 Dakika)</option>
                  <option value={120}>120 Saniye (2 Dakika)</option>
                  <option value={180}>180 Saniye (3 Dakika - Tam Şarkı)</option>
                  <option value={240}>240 Saniye (4 Dakika)</option>
                  <option value={300}>300 Saniye (5 Dakika - Uzun Kompozisyon)</option>
                  <option value="custom">Özel Süre...</option>
                </select>
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <input
                    type="number"
                    min="3"
                    max="300"
                    step="1"
                    value={musicDuration}
                    onChange={(e) => setMusicDuration(Math.max(3, Math.min(300, Number(e.target.value) || 15)))}
                    style={{ width: "68px", padding: "8px 6px", borderRadius: "6px", border: "1px solid var(--md-sys-color-outline)", background: "var(--md-sys-color-surface)", color: "inherit", fontSize: "13px", textAlign: "center" }}
                    title="Özel süre (saniye)"
                  />
                  <span style={{ fontSize: "12px", opacity: 0.8 }}>sn</span>
                </div>
              </div>
              <input
                type="range"
                min="3"
                max="300"
                step="1"
                value={musicDuration > 300 ? 300 : musicDuration}
                onChange={(e) => setMusicDuration(Number(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>

            <button
              type="button"
              onClick={handleGenerateMusic}
              disabled={isProcessing}
              className="btn-beam"
              style={{ width: "100%", height: "48px" }}
            >
              <div className="btn-content">
                {chosenMusicModel && !chosenMusicModel.installed ? (
                  <>
                    <Download size={18} />
                    <span>Modeli İndir ve Hazırla ({chosenMusicModel.approxSize || "3.5 GB"})</span>
                  </>
                ) : (
                  <>
                    <Music size={18} />
                    <span>{isProcessing ? `Müzik Üretiliyor... %${liveProgress.percent}` : "Müziği Üret (Generate Music)"}</span>
                  </>
                )}
              </div>
            </button>
          </div>
        )}

        {/* --- 3. SEKME: SES EFEKTİ (SFX / FOLEY) --- */}
        {subTab === "sfx" && (
          <div>
            <div
              style={{
                fontSize: "12px",
                padding: "10px 12px",
                borderRadius: "8px",
                background: "rgba(6, 182, 212, 0.1)",
                color: "#06b6d4",
                marginBottom: "14px",
                border: "1px solid rgba(6, 182, 212, 0.25)",
              }}
            >
              <strong>AudioLDM 2 (Akustik Foley & SFX Motoru):</strong> Müzik veya melodi karıştırmadan, Türkçe veya İngilizce tarifinize göre saf ses efekti, ambiyans ve foley sesleri üretir.
            </div>

            <div style={{ marginBottom: "14px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}>
                Foley & Ses Efekti Modeli (Seviye):
              </label>
              <select
                value={sfxModel}
                onChange={(e) => setSfxModel(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.15))",
                  background: "#161824",
                  backgroundColor: "#161824",
                  color: "#f8fafc",
                  colorScheme: "dark",
                  fontSize: "13px",
                  boxSizing: "border-box",
                  outline: "none",
                }}
              >
                {musicModels.filter(m => m.id.includes("audioldm") || m.id.includes("sfx")).length > 0 ? (
                  musicModels.filter(m => m.id.includes("audioldm") || m.id.includes("sfx")).map((m) => (
                    <option key={m.id} value={m.id} style={{ backgroundColor: "#161824", color: "#f8fafc", padding: "8px 12px" }}>
                      {m.name} {m.installed !== false ? "[Hazır]" : `[İndirilmedi - ${m.approxSize || "İndir"}]`}
                    </option>
                  ))
                ) : (
                  <>
                    <option value="audioldm2-large" style={{ backgroundColor: "#161824", color: "#f8fafc" }}>AudioLDM 2 Large (6.0 GB)</option>
                    <option value="audioldm2" style={{ backgroundColor: "#161824", color: "#f8fafc" }}>AudioLDM 2 (4.5 GB)</option>
                    <option value="audioldm-small" style={{ backgroundColor: "#161824", color: "#f8fafc" }}>AudioLDM-S Full v2 (1.7 GB)</option>
                  </>
                )}
              </select>
            </div>

            {(() => {
              const chosenSfxObj = musicModels.find(m => m.id === sfxModel);
              const isSfxReady = !chosenSfxObj || chosenSfxObj.installed !== false;
              const sfxLabel = chosenSfxObj?.name || (sfxModel === "audioldm2-large" ? "AudioLDM 2 Large (750M Amiral Gemisi)" : sfxModel === "audioldm2" ? "AudioLDM 2 Base (Flan-T5 Dengeli)" : "AudioLDM-S Full (Hafif & Hızlı)");
              return isSfxReady ? (
                <div style={{ marginBottom: "14px", padding: "8px 12px", borderRadius: "6px", background: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.3)", fontSize: "12px", color: "#10b981", display: "flex", alignItems: "center", gap: "6px" }}>
                  <CheckCircle2 size={15} />
                  <span>
                    <strong>Hazır:</strong> {sfxLabel} ses efekti motoru kurulu ve kullanıma hazır.
                  </span>
                </div>
              ) : (
                <div style={{ marginBottom: "14px", padding: "10px 12px", borderRadius: "8px", background: "rgba(245, 158, 11, 0.1)", border: "1px solid rgba(245, 158, 11, 0.3)", fontSize: "12px", color: "#f59e0b" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: "700" }}>
                      <AlertTriangle size={15} />
                      <span>Model İndirilmedi</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDownloadMusicModelDirect(chosenSfxObj)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        padding: "4px 10px",
                        borderRadius: "6px",
                        background: "#f59e0b",
                        color: "#000",
                        border: "none",
                        fontSize: "11px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      <Download size={13} />
                      <span>Şimdi İndir ({chosenSfxObj?.approxSize || "2.8 GB"})</span>
                    </button>
                  </div>
                  <div style={{ fontSize: "11px", opacity: 0.85 }}>
                    Bu SFX modelini kullanabilmek için önce bilgisayarınıza indirilmesi gerekir.
                  </div>
                </div>
              );
            })()}

            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}>
                Ses Efekti Tarifi (Türkçe veya İngilizce):
              </label>
              <textarea
                value={sfxPrompt}
                onChange={(e) => setSfxPrompt(e.target.value)}
                placeholder="Örn: Şiddetli gök gürültüsü ve sağanak yağmur, spor araba motoru ve patinaj sesi, kırılan cam, lazer silahı ve patlama..."
                rows={4}
                style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--md-sys-color-outline)", background: "var(--md-sys-color-surface)", color: "inherit", fontSize: "13px", boxSizing: "border-box" }}
              />

              <div style={{ marginTop: "10px" }}>
                <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.4px", color: "#06b6d4", display: "block", marginBottom: "6px" }}>
                  Hazır Ses Efekti (SFX) Şablonları:
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    style={{ borderColor: "rgba(6, 182, 212, 0.4)" }}
                    onClick={() => setSfxPrompt("Loud thunderclap rumble, lightning strike, heavy rain downpour and howling storm wind, realistic field recording")}
                  >
                    Gök Gürültüsü ve Sağanak Yağmur Fırtınası
                  </button>
                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    style={{ borderColor: "rgba(6, 182, 212, 0.4)" }}
                    onClick={() => setSfxPrompt("Powerful V8 sports car engine roaring, aggressive revving, tires screeching and skidding on asphalt, high quality foley")}
                  >
                    Spor Araba Motoru ve Lastik Patinajı
                  </button>
                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    style={{ borderColor: "rgba(6, 182, 212, 0.4)" }}
                    onClick={() => setSfxPrompt("Massive cinematic explosion boom, deep sub-bass shockwave blast, falling debris and fire crackle")}
                  >
                    Sinematik Büyük Patlama ve Şok Dalgası
                  </button>
                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    style={{ borderColor: "rgba(6, 182, 212, 0.4)" }}
                    onClick={() => setSfxPrompt("Heavy impact crash followed by large glass window shattering and glass shards hitting the floor, crisp foley sound effect")}
                  >
                    Kırılan Cam ve Çarpma Efekti
                  </button>
                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    style={{ borderColor: "rgba(6, 182, 212, 0.4)" }}
                    onClick={() => setSfxPrompt("Futuristic sci-fi plasma laser gun firing zaps, energy shield hum and deep space cockpit mechanical whoosh")}
                  >
                    Bilim Kurgu Lazer Silahı ve Uzay Efekti
                  </button>
                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    style={{ borderColor: "rgba(6, 182, 212, 0.4)" }}
                    onClick={() => setSfxPrompt("Peaceful forest nature ambience, birds chirping and singing in trees, gentle wind and clear flowing water stream")}
                  >
                    Doğa Ambiyansı: Kuş Sesleri ve Akan Dere
                  </button>
                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    style={{ borderColor: "rgba(6, 182, 212, 0.4)" }}
                    onClick={() => setSfxPrompt("Slow footsteps walking on wooden floor, creepy old wooden door creaking open, dark horror suspense atmosphere")}
                  >
                    Korku ve Gerilim: Kapı Gıcırtısı ve Ayak Sesleri
                  </button>
                  <button
                    type="button"
                    className="glass-suggestion-pill"
                    style={{ borderColor: "rgba(6, 182, 212, 0.4)" }}
                    onClick={() => setSfxPrompt("Sharp metallic sword clash, steel blade slash and heavy knight armor impact, realistic combat foley")}
                  >
                    Orta Çağ Kılıç Çarpışması ve Zırh Sesi
                  </button>
                </div>
              </div>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <label style={{ fontSize: "12px", fontWeight: "600" }}>Efekt Süresi:</label>
                <span style={{ fontSize: "12px", fontWeight: "700", color: "#06b6d4" }}>{sfxDuration} sn</span>
              </div>
              <input
                type="range"
                min="2"
                max="20"
                step="1"
                value={sfxDuration}
                onChange={(e) => setSfxDuration(Number(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>

            <button
              type="button"
              onClick={handleGenerateSfx}
              disabled={isProcessing}
              className="btn-beam"
              style={{ width: "100%", height: "48px" }}
            >
              <div className="btn-content">
                <Wand2 size={18} />
                <span>{isProcessing ? `Ses Efekti Üretiliyor... %${liveProgress.percent}` : "Ses Efektini Üret (Generate SFX)"}</span>
              </div>
            </button>
          </div>
        )}
      </div>

      {/* Sağ Panel: Dalga Formu & Oynatıcı */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "24px", background: "var(--md-sys-color-surface)", overflowY: "auto" }}>
        <h3 style={{ fontSize: "16px", fontWeight: "700", marginBottom: "16px" }}>Ses Oynatıcı & Çıktı</h3>

        {/* Canlı İlerleme Çubuğu ve Durum Kartı */}
        {isProcessing && (
          <div style={{
            marginBottom: "16px",
            padding: "16px 18px",
            borderRadius: "14px",
            background: "linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(6, 182, 212, 0.12))",
            border: "1px solid rgba(6, 182, 212, 0.35)",
            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.2)",
            backdropFilter: "blur(12px)"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <RefreshCw className="progress-spinner" size={16} style={{ color: "#06b6d4" }} />
                <strong style={{ fontSize: "13px", color: "var(--md-sys-color-on-surface)" }}>
                  {subTab === "sfx" ? "Ses Efekti (SFX) Üretimi" : subTab === "music" ? "Yapay Zekâ Müzik Üretimi" : "Seslendirme (TTS)"}
                </strong>
              </div>
              <span style={{ fontSize: "15px", fontWeight: 800, color: "#10b981", fontFamily: "ui-monospace, monospace" }}>
                %{liveProgress.percent}
              </span>
            </div>
            <div style={{ height: "6px", width: "100%", background: "rgba(255, 255, 255, 0.1)", borderRadius: "99px", overflow: "hidden", marginBottom: "8px" }}>
              <div style={{
                height: "100%",
                width: `${liveProgress.percent}%`,
                background: "linear-gradient(90deg, #10b981, #06b6d4, #8b5cf6)",
                borderRadius: "99px",
                transition: "width 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
              }} />
            </div>
            <div style={{ fontSize: "11px", color: "var(--md-sys-color-on-surface-variant)", display: "flex", justifyContent: "space-between" }}>
              <span>{liveProgress.phase || "Ses dalgaları işleniyor..."}</span>
              <span style={{ opacity: 0.85, fontWeight: 600 }}>%{liveProgress.percent} tamamlandı</span>
            </div>
          </div>
        )}

        {/* Ses ve Müzik Üretim Metadata Bilgi Kartı (En Başta) */}
        {audioMetadata && audioUrl && (
          <div style={{
            marginBottom: "16px",
            padding: "12px 16px",
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.1))",
            borderRadius: "12px",
            backdropFilter: "blur(12px)",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            fontSize: "0.82rem"
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                <span style={{
                  fontWeight: 800,
                  color: "#ffffff",
                  background: "linear-gradient(135deg, #10b981, #06b6d4)",
                  padding: "2px 8px",
                  borderRadius: "6px",
                  fontSize: "0.72rem",
                  letterSpacing: "0.03em"
                }}>
                  SES MODELİ
                </span>
                <strong style={{ color: "var(--md-sys-color-on-surface)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {audioMetadata.model}
                </strong>
              </div>
              {audioMetadata.genDuration && (
                <div style={{ display: "flex", alignItems: "center", gap: "4px", color: "#10b981", fontWeight: 700, fontSize: "0.82rem" }}>
                  <span>{audioMetadata.genDuration} üretim süresi</span>
                </div>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", color: "var(--md-sys-color-outline)", fontSize: "0.78rem" }}>
              <div title="Ses Kalitesi ve Örnekleme Hızı">
                <span style={{ fontWeight: 600, color: "var(--md-sys-color-on-surface-variant)" }}>Ölçek / Format:</span> {audioMetadata.scale}
              </div>
              <span>•</span>
              <div title="Üretim Yöntemi" style={{ color: "var(--md-sys-color-primary)", fontWeight: 600 }}>
                {audioMetadata.mode}
              </div>
              {audioMetadata.params && (
                <>
                  <span>•</span>
                  <div>
                    <span style={{ fontWeight: 600, color: "var(--md-sys-color-on-surface-variant)" }}>Parametreler:</span> {audioMetadata.params}
                  </div>
                </>
              )}
              {audioMetadata.prompt && (
                <>
                  <span>•</span>
                  <div style={{ maxWidth: "450px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={audioMetadata.prompt}>
                    <span style={{ fontWeight: 600, color: "var(--md-sys-color-on-surface-variant)" }}>Metin / İstem:</span> "{audioMetadata.prompt}"
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <div
          style={{
            background: "var(--md-sys-color-surface-container)",
            borderRadius: "14px",
            padding: "32px",
            textAlign: "center",
            border: "1px solid var(--md-sys-color-outline-variant)",
            marginBottom: "24px",
          }}
        >
          {audioUrl ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <audio
                ref={audioRef}
                src={audioUrl}
                controls
                style={{ width: "100%", maxWidth: "520px", marginBottom: "20px" }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />
              <div style={{ display: "flex", justifyContent: "center", gap: "16px", alignItems: "center", marginBottom: "16px" }}>
                <button
                  type="button"
                  onClick={togglePlay}
                  className="m3-btn m3-btn-filled"
                  style={{ width: "54px", height: "54px", borderRadius: "50%", padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                  title={isPlaying ? "Durdur" : "Çal"}
                >
                  {isPlaying ? <Pause size={24} /> : <Play size={24} />}
                </button>
                <button
                  type="button"
                  onClick={() => handleRevealFolder({ url: audioUrl, type: "audio" }, "player")}
                  className="m3-btn m3-btn-outlined"
                  style={{ display: "inline-flex", alignItems: "center", gap: "8px", height: "46px", padding: "0 18px", borderRadius: "10px", fontWeight: 600, cursor: "pointer" }}
                  title="Ses dosyasını bilgisayardaki klasöründe göster"
                >
                  {openedFolderKey === "player" ? (
                    <>
                      <Check size={18} style={{ color: "#10b981" }} />
                      <span style={{ color: "#10b981" }}>Klasör Açıldı</span>
                    </>
                  ) : (
                    <>
                      <FolderOpen size={18} />
                      <span>Klasöre Git</span>
                    </>
                  )}
                </button>
              </div>
              {lastGeneratedInfo && (
                <div style={{ width: "100%", maxWidth: "520px", marginTop: "12px", padding: "14px 16px", borderRadius: "10px", background: "var(--md-sys-color-surface-container-high)", textAlign: "left", fontSize: "12px", border: "1px solid var(--md-sys-color-outline-variant)" }}>
                  <div style={{ fontWeight: 600, color: "var(--md-sys-color-primary)", marginBottom: "4px" }}>
                    {lastGeneratedInfo.type} ({lastGeneratedInfo.duration} sn) • {lastGeneratedInfo.model}
                  </div>
                  <div style={{ opacity: 0.85, fontStyle: "italic" }}>
                    "{lastGeneratedInfo.prompt}"
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <Volume2 size={48} style={{ opacity: 0.3, margin: "0 auto 12px auto" }} />
              <p style={{ margin: 0, fontSize: "14px", color: "var(--md-sys-color-on-surface-variant)" }}>
                Henüz üretilmiş bir ses veya müzik bulunmuyor.
              </p>
            </div>
          )}
        </div>

        {/* Geçmiş Ses, Müzik ve SFX Üretimleri Listesi */}
        <div style={{ marginTop: "12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
            <h4 style={{ fontSize: "14px", fontWeight: "700", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
              <Volume2 size={16} style={{ color: "var(--md-sys-color-primary)" }} />
              <span>Geçmiş Ses, Müzik ve SFX Üretimleri ({audioHistory.length})</span>
            </h4>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <button
                type="button"
                onClick={() => handleRevealFolder({ folder: "audio" }, "history_header")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  background: "var(--md-sys-color-surface-container-high)",
                  border: "1px solid var(--md-sys-color-outline-variant)",
                  color: "var(--md-sys-color-on-surface)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: "5px 10px",
                  borderRadius: "6px"
                }}
                title="Ses çıktıları klasörünü aç"
              >
                {openedFolderKey === "history_header" ? (
                  <>
                    <Check size={13} style={{ color: "#10b981" }} />
                    <span style={{ color: "#10b981" }}>Açıldı</span>
                  </>
                ) : (
                  <>
                    <FolderOpen size={13} />
                    <span>Klasöre Git</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={fetchAudioHistory}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  background: "var(--md-sys-color-surface-container-high)",
                  border: "1px solid var(--md-sys-color-outline-variant)",
                  color: "var(--md-sys-color-on-surface)",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: "5px 10px",
                  borderRadius: "6px"
                }}
                title="Geçmiş listesini yenile"
              >
                <RefreshCw size={12} />
                <span>Yenile</span>
              </button>
            </div>
          </div>

          {audioHistory.length === 0 ? (
            <div style={{ padding: "24px", textAlign: "center", borderRadius: "12px", background: "var(--md-sys-color-surface-container)", border: "1px solid var(--md-sys-color-outline-variant)", color: "var(--md-sys-color-on-surface-variant)", fontSize: "13px" }}>
              Henüz kaydedilmiş bir ses, müzik veya efekt üretimi bulunmuyor.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {audioHistory.map((item) => {
                const isCurrent = audioUrl === item.url;
                const isSfx = item.type === "sfx" || item.isSfx;
                const isTts = item.type === "tts";
                const badgeColor = isSfx ? "#06b6d4" : isTts ? "#10b981" : "#8b5cf6";
                const badgeBg = isSfx ? "rgba(6, 182, 212, 0.15)" : isTts ? "rgba(16, 185, 129, 0.15)" : "rgba(139, 92, 246, 0.15)";
                const typeLabel = isSfx ? "SFX" : isTts ? "TTS" : "MÜZİK";

                const handleSelect = () => {
                  setAudioUrl(item.url);
                  setAudioMetadata({
                    model: item.model || (isSfx ? "AudioLDM 2 Pure SFX" : isTts ? "TTS" : "MusicGen"),
                    engineType: isSfx ? "Yapay Zekâ Ses Efekti (SFX / Foley)" : isTts ? "Metinden Sese Doğal Sentez (TTS)" : "Meta AudioCraft MusicGen (CUDA)",
                    scale: `${item.sampleRate || (isSfx ? 16000 : 32000)} Hz • 16-bit Hi-Fi`,
                    genDuration: item.genDuration || `${item.duration}s`,
                    mode: isSfx ? `Ses Efekti (${item.duration}s)` : isTts ? `Doğal Sentez (${item.voice || "Ses"})` : `Müzik Parçası (${item.duration}s)`,
                    params: item.voice ? `Ses: ${item.voice}` : `Süre: ${item.duration}s`,
                    prompt: item.prompt || item.title,
                  });
                  setLastGeneratedInfo({
                    type: isSfx ? "Ses Efekti (SFX)" : isTts ? "Seslendirme (TTS)" : "Müzik / Parça",
                    prompt: item.prompt || item.title,
                    duration: `${item.duration}s`,
                    model: item.model,
                  });
                  setTimeout(() => {
                    if (audioRef.current) {
                      audioRef.current.play().catch(() => {});
                    }
                  }, 100);
                };

                return (
                  <div
                    key={item.id || item.url}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "12px 16px",
                      borderRadius: "10px",
                      background: isCurrent ? "rgba(16, 185, 129, 0.08)" : "var(--md-sys-color-surface-container)",
                      border: isCurrent ? "1px solid var(--md-sys-color-primary)" : "1px solid var(--md-sys-color-outline-variant)",
                      transition: "all 0.2s ease",
                      gap: "14px"
                    }}
                  >
                    {/* Play/Pause Button */}
                    <button
                      type="button"
                      onClick={handleSelect}
                      style={{
                        width: "38px",
                        height: "38px",
                        borderRadius: "50%",
                        border: "none",
                        background: isCurrent ? "var(--md-sys-color-primary)" : "var(--md-sys-color-surface-container-high)",
                        color: isCurrent ? "#ffffff" : "var(--md-sys-color-on-surface)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0
                      }}
                      title={isCurrent && isPlaying ? "Durdur" : "Çal"}
                    >
                      {isCurrent && isPlaying ? <Pause size={17} /> : <Play size={17} />}
                    </button>

                    {/* Metadata & Prompt */}
                    <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={handleSelect}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                        <span style={{ fontSize: "10px", fontWeight: 800, padding: "2px 6px", borderRadius: "4px", color: badgeColor, background: badgeBg, letterSpacing: "0.5px" }}>
                          {typeLabel}
                        </span>
                        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--md-sys-color-on-surface)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {item.prompt || item.title || item.filename}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px", color: "var(--md-sys-color-outline)", flexWrap: "wrap" }}>
                        {item.duration > 0 && <span>{item.duration} sn</span>}
                        <span>•</span>
                        <span>{item.model}</span>
                        {item.createdAt && (
                          <>
                            <span>•</span>
                            <span>{new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </>
                        )}
                        {item.size && (
                          <>
                            <span>•</span>
                            <span>{item.size}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Actions: Reveal in Folder & Delete */}
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRevealFolder({ url: item.url, filename: item.filename, type: item.type }, `row_${item.id || item.filename}`);
                        }}
                        style={{
                          padding: "6px 10px",
                          borderRadius: "6px",
                          color: "var(--md-sys-color-on-surface-variant)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          background: "var(--md-sys-color-surface-container-high)",
                          border: "1px solid var(--md-sys-color-outline-variant)",
                          cursor: "pointer",
                          fontSize: "11px",
                          fontWeight: 600
                        }}
                        title="Dosyayı klasöründe göster"
                      >
                        {openedFolderKey === `row_${item.id || item.filename}` ? (
                          <>
                            <Check size={13} style={{ color: "#10b981" }} />
                            <span style={{ color: "#10b981" }}>Açıldı</span>
                          </>
                        ) : (
                          <>
                            <FolderOpen size={13} />
                            <span>Klasöre Git</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = window.confirm("Bu ses kaydını silmek istediğinize emin misiniz?");
                          if (ok) {
                            try {
                              await fetch("/api/audio/delete", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ filename: item.filename, type: item.type })
                              });
                              if (audioUrl === item.url) {
                                setAudioUrl(null);
                              }
                              fetchAudioHistory();
                            } catch (_) {}
                          }
                        }}
                        style={{
                          padding: "6px 8px",
                          borderRadius: "6px",
                          border: "1px solid var(--md-sys-color-outline-variant)",
                          background: "transparent",
                          color: "var(--md-sys-color-outline)",
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center"
                        }}
                        title="Sil"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
