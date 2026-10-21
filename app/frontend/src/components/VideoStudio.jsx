import React, { useState, useEffect, useRef } from "react";
import { uiText } from "../i18n";
import {
  Film,
  Sparkles,
  Upload,
  Play,
  Pause,
  Download,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Sliders,
  Layers,
  Clock,
  Zap,
  Info,
  FolderOpen,
  Check,
} from "lucide-react";
import { stopServer, stopLlm, downloadVideoModel, downloadSnapshotModel, revealFileInFolder } from "../services/api";

export default function VideoStudio({
  specs,
  showAlert,
  showConfirm,
  checkAndConfirmInterruption,
  isVideoGenerating,
  setIsVideoGenerating
}) {
  const [prompt, setPrompt] = useState("");
  const [videoMode, setVideoMode] = useState("t2v"); // t2v (Text to Video) or i2v (Image to Video)
  const [selectedEngine, setSelectedEngine] = useState("animatediff-v15");
  const [inputImage, setInputImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [durationSec, setDurationSec] = useState(3);
  const [fps, setFps] = useState(16);
  const [resolution, setResolution] = useState("512x512");
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [videos, setVideos] = useState([]);
  const [activeVideo, setActiveVideo] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoModels, setVideoModels] = useState([]);
  const [openedFolderKey, setOpenedFolderKey] = useState(null);

  const videoRef = useRef(null);

  const vramGb = Number(specs?.gpu_vram_gb || 0);
  const isVramLow = vramGb > 0 && vramGb < 6;
  // Only conclude "no GPU" once the hardware query has actually finished.
  const isCpuOnly = !specs?.loading && !specs?.unavailable && vramGb === 0;
  const chosenModel = videoModels.find((m) => m.id === selectedEngine || (selectedEngine === "animatediff" && m.id === "animatediff-v15"));
  const isCloudVideo = Boolean(selectedEngine.startsWith("cloud:") || chosenModel?.isCloud);

  // Donanım Koruması: Yerel modele geçildiğinde 1080p/4K çözünürlüğü ve uzun süreyi otomatik sıfırla
  useEffect(() => {
    if (!isCloudVideo) {
      if (resolution === "1920x1080" || resolution === "1080x1920" || resolution === "3840x2160" || resolution === "1280x720") {
        setResolution("512x512");
      }
      if (durationSec > 5) {
        setDurationSec(3);
      }
    } else {
      setResolution("1920x1080");
      if (durationSec !== 6 && durationSec !== 10) {
        setDurationSec(6);
      }
    }
  }, [isCloudVideo]);

  useEffect(() => {
    fetch("/api/video/gallery")
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.videos)) {
          setVideos(data.videos);
          if (data.videos.length > 0) {
            setActiveVideo(data.videos[0]);
          }
        }
      })
      .catch(() => {});

    fetch("/api/video/models")
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.models)) {
          setVideoModels(data.models);
          const current = data.models.find(m => m.id === selectedEngine && m.installed);
          if (!current) {
            const installed = data.models.find((m) => m.installed && !m.isCloud) || data.models.find((m) => m.installed);
            if (installed) {
              setSelectedEngine(installed.id);
            }
          }
        }
      })
      .catch(() => {});
  }, []);

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setInputImage(file);
      setImagePreview(URL.createObjectURL(file));
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim() && videoMode === "t2v") {
      showAlert?.({ title: uiText("Uyarı", "Warning"), message: uiText("Lütfen bir video oluşturma istemi (prompt) girin.", "Please enter a video prompt.") });
      return;
    }
    if (videoMode === "i2v" && !inputImage) {
      showAlert?.({ title: uiText("Uyarı", "Warning"), message: uiText("Lütfen hareketlendirmek için bir başlangıç görseli seçin.", "Please select a start image to animate.") });
      return;
    }

    if (checkAndConfirmInterruption) {
      const canProceed = await checkAndConfirmInterruption("video");
      if (!canProceed) return;
    }

    // Check if the selected engine/model is installed
    const modelToUse = chosenModel || videoModels.find((m) => m.id === selectedEngine);
    if (modelToUse && modelToUse.supported === false) {
      showAlert?.({ title: uiText("Bu Sürümde Entegre Değil", "Not Integrated in This Version"), message: modelToUse.notes || `${modelToUse.name} bu sürümde kullanılamaz.`, danger: true });
      return;
    }
    if (modelToUse && modelToUse.isCloud && !modelToUse.installed) {
      showAlert?.({ title: uiText("API Anahtarı Gerekli", "API Key Required"), message: uiText("Bu bulut video modeli için 'Hibrit API & Bulut' sekmesinden MiniMax API anahtarınızı kaydedin.", "Save your MiniMax API key in the 'Hybrid API & Cloud' tab to use this cloud video model."), danger: true });
      return;
    }
    if (modelToUse && !modelToUse.installed && !selectedEngine.startsWith("cloud:") && !modelToUse.isCloud) {
      const minVram = Number(modelToUse.minVramGb || 8);
      if (vramGb > 0 && vramGb < minVram) {
        const proceed = await showConfirm?.({
          title: uiText("Donanım Yetersizliği Uyarısı", "Insufficient Hardware Warning"),
          message: uiText(`Seçtiğiniz "${modelToUse.name}" modeli için en az ${minVram} GB VRAM (ekran kartı belleği) önerilmektedir.\n\nSisteminizde tespit edilen VRAM: ${vramGb} GB.\n\nBu model donanımınızın sınırlarını aşabilir, bellek yetersizliği hatası (OOM) verebilir veya aşırı yavaş çalışabilir.\n\nYine de bu modeli indirmek ve kuyruğa eklemek istiyor musunuz?`, `At least ${minVram} GB VRAM (graphics memory) is recommended for "${modelToUse.name}".\n\nDetected VRAM: ${vramGb} GB.\n\nThis model may exceed your hardware limits, fail with an out-of-memory (OOM) error or run very slowly.\n\nDownload it and add it to the queue anyway?`),
          confirmLabel: uiText("Yine de İndir ve Kuyruğa Al", "Download and Queue Anyway"),
          cancelLabel: "Vazgeç",
          danger: true,
        });
        if (!proceed) return;
      } else {
        const proceed = await showConfirm?.({
          title: uiText("Model İndirme Onayı", "Confirm Model Download"),
          message: uiText(`Seçtiğiniz "${modelToUse.name}" (${modelToUse.approxSize || "Büyük Model"}) henüz bilgisayarınızda indirilmemiş.\n\nModeli şimdi arka planda indirmek istiyor musunuz? İndirme işlemi bittiğinde bu model doğrudan kullanılabilir olacaktır.`, `"${modelToUse.name}" (${modelToUse.approxSize || "Large model"}) is not downloaded yet.\n\nDownload it in the background now? The model will be ready to use as soon as the download finishes.`),
          confirmLabel: uiText("İndirmeyi Başlat", "Start Download"),
          cancelLabel: "İptal",
        });
        if (!proceed) return;
      }

      // Start background download
      try {
        const res = modelToUse.snapshotId
          ? await downloadSnapshotModel(modelToUse.snapshotId, modelToUse.name, "video")
          : await downloadVideoModel(modelToUse.url, modelToUse.filename, modelToUse.name);
        if (res?.ok) {
          showAlert?.({
            title: uiText("İndirme Başlatıldı", "Download Started"),
            message: uiText(`"${modelToUse.name}" modeli indirme kuyruğuna alındı. İlerleme durumunu en üstteki durum çubuğundan canlı olarak takip edebilirsiniz. İndirme bittiğinde doğrudan videonuzu üretebilirsiniz.`, `"${modelToUse.name}" was added to the download queue. You can follow the progress in the status bar at the top. Once it finishes you can generate your video right away.`),
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
      return;
    }

    if (isCpuOnly) {
      const proceed = await showConfirm?.({
        title: uiText("Düşük Donanım Uyarısı", "Low Hardware Warning"),
        message: uiText("Sisteminizde harici ekran kartı (GPU) tespit edilemedi. İşlemci (CPU) ile video üretimi 30-60 dakika sürebilir ve bilgisayarı yavaşlatabilir. Yine de devam etmek istiyor musunuz?", "No dedicated graphics card (GPU) was detected. Generating video on the CPU can take 30-60 minutes and slow down your computer. Continue anyway?"),
        confirmLabel: "Yine de Dene",
        cancelLabel: "İptal",
        danger: true,
      });
      if (!proceed) return;
    }

    if (selectedEngine === "svd-xt" || videoMode === "i2v") {
      if (!inputImage) {
        showAlert?.({
          title: uiText("Başlangıç Görseli Gerekli", "Start Image Required"),
          message: uiText("Seçilen Stable Video Diffusion (SVD-XT) modeli 'Görselden Video' (Image-to-Video) modelidir ve canlandırılacak bir başlangıç görseli gerektirir.\n\nLütfen sol paneldeki 'Başlangıç Görseli' alanına bir resim yükleyin ya da doğrudan metinden video üretmek için 'Wan 2.1 1.3B' veya 'AnimateDiff' motorunu seçin.", "The selected Stable Video Diffusion (SVD-XT) model is an image-to-video model and needs a start image to animate.\n\nUpload an image in the 'Start Image' field on the left, or pick 'Wan 2.1 1.3B' or 'AnimateDiff' to generate video from text."),
          danger: true,
        });
        setVideoMode("i2v");
        return;
      }
    }

    // Free GPU VRAM from Image and LLM models for heavy video generation
    try {
      await stopServer();
      await stopLlm();
    } catch (_) {}

    setIsGenerating(true);
    setIsVideoGenerating?.(true);
    setProgress(4);

    let inputImageBase64 = null;
    if (videoMode === "i2v" && inputImage) {
      inputImageBase64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(inputImage);
      });
    }

    const startTime = Date.now();

    // Simüle / API / Yerel çağrı
    try {
      const res = await fetch("/api/video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          mode: videoMode,
          engine: selectedEngine,
          duration: durationSec,
          fps,
          resolution,
          inputImageBase64,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Video motoru başlatılamadı.");
      }

      let latestVideo = data.video;

      // Poll video render progress until complete or interrupted
      let completed = false;
      while (!completed) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const statusRes = await fetch("/api/video/status");
          const statusData = await statusRes.json();
          if (statusData.ok) {
            if (statusData.video) {
              latestVideo = { ...latestVideo, ...statusData.video };
            }
            if (!statusData.active) {
              if (statusData.status === "error") {
                throw new Error(statusData.error || "Video üretimi sırasında bir hata oluştu.");
              }
              completed = true;
              setProgress(100);
              break;
            }
            setProgress(statusData.progress || 0);
          }
        } catch (pollErr) {
          if (pollErr.message && !pollErr.message.includes("fetch")) {
            throw pollErr;
          }
        }
      }

      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
      const chosenObj = videoModels.find((m) => m.id === selectedEngine) || chosenModel;

      const generatedVideo = {
        id: latestVideo?.id || ("vid_" + Date.now()),
        name: latestVideo?.name || `${latestVideo?.id || "video"}.mp4`,
        url: latestVideo?.url || (latestVideo?.id ? `/video-outputs/${latestVideo.id}.mp4` : null),
        prompt,
        mode: videoMode,
        engine: selectedEngine,
        engineName: chosenObj?.name || selectedEngine,
        duration: durationSec,
        fps,
        resolution,
        genDuration: `${elapsedSec}s`,
        createdAt: new Date().toISOString()
      };

      if (generatedVideo.url) {
        setVideos((prev) => [generatedVideo, ...prev.filter(v => v.id !== generatedVideo.id)]);
        setActiveVideo(generatedVideo);
        setTimeout(() => {
          if (videoRef.current) {
            videoRef.current.load();
            videoRef.current.play().catch(() => {});
          }
        }, 200);
      }
    } catch (err) {
      showAlert?.({
        title: uiText("Video Üretim Bilgisi", "Video Generation Info"),
        message: err.message || "Yerel video modeli henüz indirilmemiş veya yapılandırılmamış.",
        danger: true,
      });
    } finally {
      setIsGenerating(false);
      setIsVideoGenerating?.(false);
      setProgress(0);
    }
  };

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  return (
    <div className="video-studio-container" style={{ display: "flex", flex: 1, height: "100%", overflow: "hidden" }}>
      {/* Sol Panel: Parametreler ve İstem */}
      <div
        style={{
          width: "420px",
          minWidth: "380px",
          background: "var(--md-sys-color-surface-container-low)",
          borderRight: "1px solid var(--md-sys-color-outline-variant)",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          overflow: "hidden",
        }}
      >
        {/* Kaydırılabilir Form İçeriği */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 20px 12px 20px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
            <Film size={22} color="var(--md-sys-color-primary)" />
            <h2 style={{ fontSize: "18px", fontWeight: "700", margin: 0 }}>Yapay Zekâ Video Stüdyosu</h2>
          </div>

          {/* Donanım Bilgilendirme Rozeti */}
          {isCpuOnly ? (
            <div
              style={{
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: "10px",
                padding: "8px 12px",
                marginBottom: "14px",
                display: "flex",
                alignItems: "flex-start",
                gap: "8px",
                color: "#ef4444",
                fontSize: "12px",
              }}
            >
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
              <div>
                <strong>GPU Bulunamadı:</strong> Yerel video üretimi yüksek ekran kartı gücü gerektirir. Sadece CPU ile çalıştırmak aşırı uzun sürebilir.
              </div>
            </div>
          ) : isVramLow ? (
            <div
              style={{
                background: "rgba(245, 158, 11, 0.12)",
                border: "1px solid rgba(245, 158, 11, 0.3)",
                borderRadius: "10px",
                padding: "8px 12px",
                marginBottom: "14px",
                display: "flex",
                alignItems: "flex-start",
                gap: "8px",
                color: "#f59e0b",
                fontSize: "12px",
              }}
            >
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
              <div>
                <strong>Düşük VRAM ({vramGb} GB):</strong> Hafif <em>AnimateDiff</em> modeli önerilir. Ağır Wan 2.1 modelleri belleği aşabilir.
              </div>
            </div>
          ) : (
            <div
              style={{
                background: "rgba(16, 185, 129, 0.12)",
                border: "1px solid rgba(16, 185, 129, 0.3)",
                borderRadius: "10px",
                padding: "8px 12px",
                marginBottom: "14px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                color: "#10b981",
                fontSize: "12px",
              }}
            >
              <CheckCircle2 size={16} />
              <span>Donanımınız yerel video üretimi için uygun ({vramGb} GB VRAM).</span>
            </div>
          )}

          {/* Video Uretim Modu Sekmesi */}
          <div style={{ display: "flex", background: "var(--md-sys-color-surface-container-high)", borderRadius: "8px", padding: "3px", marginBottom: "14px" }}>
            <button
              onClick={() => {
                setVideoMode("t2v");
                if (selectedEngine === "svd-xt") {
                  setSelectedEngine("wan21-1.3b");
                }
              }}
              style={{
                flex: 1,
                padding: "7px 10px",
                borderRadius: "6px",
                border: "none",
                fontSize: "12px",
                fontWeight: "600",
                cursor: "pointer",
                background: videoMode === "t2v" ? "var(--md-sys-color-primary)" : "transparent",
                color: videoMode === "t2v" ? "var(--md-sys-color-on-primary)" : "inherit",
                transition: "all 0.15s ease",
              }}
            >
              Metinden Video (T2V)
            </button>
            <button
              onClick={() => {
                setVideoMode("i2v");
                if (selectedEngine !== "svd-xt") {
                  setSelectedEngine("svd-xt");
                }
              }}
              style={{
                flex: 1,
                padding: "7px 10px",
                borderRadius: "6px",
                border: "none",
                fontSize: "12px",
                fontWeight: "600",
                cursor: "pointer",
                background: videoMode === "i2v" ? "var(--md-sys-color-primary)" : "transparent",
                color: videoMode === "i2v" ? "var(--md-sys-color-on-primary)" : "inherit",
                transition: "all 0.15s ease",
              }}
            >
              Görselden Video (I2V)
            </button>
          </div>

          {/* Görsel Yükleme (i2v modu için) */}
          {videoMode === "i2v" && (
            <div style={{ marginBottom: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <label style={{ fontSize: "13px", fontWeight: "600" }}>
                  Başlangıç Görseli:
                </label>
                {imagePreview && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setInputImage(null);
                      setImagePreview(null);
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--md-sys-color-error, #ef4444)",
                      fontSize: "11px",
                      fontWeight: "600",
                      cursor: "pointer",
                      padding: "2px 6px",
                    }}
                  >
                    Görseli Kaldır
                  </button>
                )}
              </div>
              <div
                style={{
                  border: "2px dashed var(--md-sys-color-outline-variant)",
                  borderRadius: "10px",
                  padding: imagePreview ? "8px" : "14px",
                  textAlign: "center",
                  cursor: "pointer",
                  background: "var(--md-sys-color-surface)",
                  position: "relative",
                  transition: "border-color 0.2s ease",
                }}
                onClick={() => document.getElementById("video-img-upload")?.click()}
              >
                {imagePreview ? (
                  <div>
                    <img
                      src={imagePreview}
                      alt="Yüklenen Görsel"
                      style={{
                        maxHeight: "100px",
                        maxWidth: "100%",
                        borderRadius: "6px",
                        objectFit: "contain",
                        display: "block",
                        margin: "0 auto",
                      }}
                    />
                    <span style={{ display: "block", marginTop: "4px", fontSize: "11px", color: "var(--md-sys-color-on-surface-variant)" }}>
                      Görseli değiştirmek için tıklayın
                    </span>
                  </div>
                ) : (
                  <div style={{ color: "var(--md-sys-color-on-surface-variant)", fontSize: "12px", padding: "6px 0" }}>
                    <Upload size={20} style={{ margin: "0 auto 4px auto", display: "block" }} />
                    Görsel yüklemek için tıklayın veya sürükleyin
                  </div>
                )}
                <input id="video-img-upload" type="file" accept="image/*" onChange={handleImageUpload} style={{ display: "none" }} />
              </div>
            </div>
          )}

          {/* İstem (Prompt) Girişi */}
          <div style={{ marginBottom: "14px" }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}>
              Video İstemi (Prompt):
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Örn: Dramatic cinematic drone shot of huge ocean waves crashing against rocky cliffs at golden hour sunset, slow motion 4k, hyperrealistic..."
              rows={3}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid var(--md-sys-color-outline)",
                background: "var(--md-sys-color-surface)",
                color: "var(--md-sys-color-on-surface)",
                fontSize: "13px",
                resize: "vertical",
                boxSizing: "border-box",
                minHeight: "68px",
              }}
            />

            {/* Hızlı Video İlhamı Butonları (Kompakt Rozetler) */}
            <div style={{ marginTop: "6px" }}>
              <span style={{ fontSize: "10px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.4px", color: "var(--md-sys-color-outline)", display: "block", marginBottom: "5px" }}>
                Hızlı İlham (Hazır Şablonlar):
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                <button
                  type="button"
                  className="glass-suggestion-pill"
                  style={{ fontSize: "11px", padding: "4px 8px" }}
                  onClick={() => setPrompt("Dramatic cinematic drone shot of huge ocean waves crashing against rocky cliffs at golden hour sunset, slow motion 4k, hyperrealistic, photorealistic")}
                  title="Okyanus Dalgası & Gün Batımı"
                >
                  Okyanus & Gün Batımı
                </button>
                <button
                  type="button"
                  className="glass-suggestion-pill"
                  style={{ fontSize: "11px", padding: "4px 8px" }}
                  onClick={() => setPrompt("Sleek futuristic spacecraft flying through a glowing colorful nebula in deep space, stardust particles, cinematic sci-fi movie scene, smooth camera panning")}
                  title="Kozmik Uzay Gemisi"
                >
                  Kozmik Gemi
                </button>
                <button
                  type="button"
                  className="glass-suggestion-pill"
                  style={{ fontSize: "11px", padding: "4px 8px" }}
                  onClick={() => setPrompt("Gentle pink cherry blossom petals falling across a peaceful Japanese garden path, sunlight streaming through trees, atmospheric, smooth motion")}
                  title="Kiraz Çiçekleri Yağmuru"
                >
                  Kiraz Çiçekleri (Sakura)
                </button>
                <button
                  type="button"
                  className="glass-suggestion-pill"
                  style={{ fontSize: "11px", padding: "4px 8px" }}
                  onClick={() => setPrompt("Hyperlapse camera gliding through a neon-lit futuristic cyberpunk city with flying vehicles and glowing holographic signs at night, cinematic 4k")}
                  title="Siberpunk Gece Trafiği"
                >
                  Siberpunk Gece
                </button>
                <button
                  type="button"
                  className="glass-suggestion-pill"
                  style={{ fontSize: "11px", padding: "4px 8px" }}
                  onClick={() => setPrompt("Majestic lion walking through golden savanna grass, wind blowing mane, extreme close-up, dramatic cinematic lighting, slow motion, 8k")}
                  title="Vahşi Doğa Ağır Çekim"
                >
                  Vahşi Doğa (Ağır Çekim)
                </button>
              </div>
            </div>
          </div>

          {/* Model Motoru Seçimi */}
          <div style={{ marginBottom: "14px" }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}>
              Video Modeli / Motoru:
            </label>
            <select
              value={selectedEngine}
              onChange={(e) => {
                const eng = e.target.value;
                setSelectedEngine(eng);
                if (eng === "svd-xt") {
                  setVideoMode("i2v");
                }
              }}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: "8px",
                border: "1px solid var(--md-sys-color-outline)",
                background: "var(--md-sys-color-surface)",
                color: "var(--md-sys-color-on-surface)",
                fontSize: "13px",
              }}
            >
              {videoModels.length > 0 ? (
                <>
                  <optgroup label="Yerel Modeller (NVIDIA GPU)">
                    {videoModels.filter(m => !m.isCloud && m.supported !== false).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} {m.installed ? "[Hazır]" : `[İndirilmedi - ${m.approxSize || ""}]`}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Bulut API (MiniMax anahtarı gerekir, ücretli)">
                    {videoModels.filter(m => m.isCloud).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} {m.installed ? "" : "[API anahtarı yok]"}
                      </option>
                    ))}
                  </optgroup>
                </>
              ) : (
                <>
                  <option value="animatediff-v15">AnimateDiff v1.5 v2 + Realistic Vision 5.1 (T2V)</option>
                  <option value="wan21-1.3b">Wan 2.1 T2V 1.3B (Diffusers)</option>
                  <option value="svd-xt">Stable Video Diffusion XT 1.1 (I2V)</option>
                </>
              )}
            </select>
            {selectedEngine === "svd-xt" && (
              <div style={{ marginTop: "6px", padding: "8px 10px", borderRadius: "6px", background: "rgba(99, 102, 241, 0.1)", border: "1px solid rgba(99, 102, 241, 0.3)", fontSize: "11px", color: "var(--md-sys-color-primary)", display: "flex", alignItems: "flex-start", gap: "6px" }}>
                <Info size={15} style={{ flexShrink: 0, marginTop: "2px" }} />
                <div>
                  <strong>Görselden Video (I2V):</strong> SVD-XT, başlangıç görselini hareketlendirir. Lütfen yukarıdaki "Başlangıç Görseli" alanından bir resim yükleyiniz.
                </div>
              </div>
            )}
            {selectedEngine.startsWith("cloud:") || chosenModel?.isCloud ? (
              <div style={{ marginTop: "6px", padding: "6px 10px", borderRadius: "6px", background: "rgba(139, 92, 246, 0.1)", border: "1px solid rgba(139, 92, 246, 0.3)", fontSize: "11px", color: "#a78bfa", display: "flex", alignItems: "center", gap: "6px" }}>
                <CheckCircle2 size={15} />
                <span><strong>[Bulut API]</strong> {chosenModel?.name || selectedEngine} bulut sunucuları üzerinden video üretimine hazır.</span>
              </div>
            ) : chosenModel?.installed ? (
              <div style={{ marginTop: "6px", padding: "6px 10px", borderRadius: "6px", background: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.3)", fontSize: "11px", color: "#10b981", display: "flex", alignItems: "center", gap: "6px" }}>
                <CheckCircle2 size={15} />
                <span><strong>[Hazır]</strong> {chosenModel.name} bilgisayarınızda kurulu ve video üretimine hazır.</span>
              </div>
            ) : (chosenModel && !chosenModel.installed && !chosenModel.isCloud && !selectedEngine.startsWith("cloud:")) ? (
              vramGb > 0 && vramGb < (chosenModel.minVramGb || 8) ? (
                <div style={{ marginTop: "6px", padding: "6px 10px", borderRadius: "6px", background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.3)", fontSize: "11px", color: "#ef4444", display: "flex", alignItems: "flex-start", gap: "6px" }}>
                  <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: "2px" }} />
                  <div>
                    <strong>[Donanım Uyarısı]:</strong> Bu model en az {chosenModel.minVramGb} GB VRAM önerir (Mevcut GPU: {vramGb} GB).
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: "6px", padding: "6px 10px", borderRadius: "6px", background: "rgba(59, 130, 246, 0.1)", border: "1px solid rgba(59, 130, 246, 0.3)", fontSize: "11px", color: "#3b82f6", display: "flex", alignItems: "flex-start", gap: "6px" }}>
                  <Download size={15} style={{ flexShrink: 0, marginTop: "2px" }} />
                  <div>
                    <strong>Model İndirilmedi ({chosenModel.approxSize}):</strong> Modeli aramakla uğraşmadan aşağıdaki butondan indirebilirsiniz.
                  </div>
                </div>
              )
            ) : null}
          </div>

          {/* Ayarlar (Süre, Çözünürlük) */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "8px" }}>
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: "600", marginBottom: "4px" }}>Süre:</label>
              <select
                value={durationSec}
                onChange={(e) => setDurationSec(Number(e.target.value))}
                style={{ width: "100%", padding: "7px 8px", borderRadius: "6px", border: "1px solid var(--md-sys-color-outline)", background: "var(--md-sys-color-surface)", color: "inherit", fontSize: "12px" }}
              >
                {isCloudVideo ? (
                  <>
                    <option value={6}>6 Saniye</option>
                    <option value={10}>10 Saniye</option>
                  </>
                ) : (
                  <>
                    <option value={2}>2 Saniye (Hızlı)</option>
                    <option value={3}>3 Saniye (Standart)</option>
                    <option value={5}>5 Saniye (Maksimum Yerel)</option>
                  </>
                )}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: "600", marginBottom: "4px" }}>Çözünürlük:</label>
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                style={{ width: "100%", padding: "7px 8px", borderRadius: "6px", border: "1px solid var(--md-sys-color-outline)", background: "var(--md-sys-color-surface)", color: "inherit", fontSize: "12px" }}
              >
                {isCloudVideo ? (
                  <>
                    <option value="1920x1080">768P (MiniMax Hailuo)</option>
                  </>
                ) : (
                  <>
                    <optgroup label="Yerel Donanım Çözünürlükleri (GPU Dostu)">
                      <option value="512x512">512 x 512 (Hızlı Standart - Düşük VRAM)</option>
                      <option value="768x432">768 x 432 (16:9 Yatay)</option>
                      <option value="432x768">432 x 768 (9:16 Dikey)</option>
                      <option value="832x480">832 x 480 (480p Wan 2.1)</option>
                    </optgroup>
                  </>
                )}
              </select>
            </div>
          </div>
          {isCloudVideo ? (
            <div style={{ marginBottom: "10px", fontSize: "11px", color: "#a78bfa", display: "flex", alignItems: "center", gap: "6px" }}>
              <CheckCircle2 size={14} />
              <span>[Bulut Video]: MiniMax Hailuo 768P çözünürlükte 6 veya 10 saniyelik video üretir; üretim birkaç dakika sürebilir ve ücretlidir.</span>
            </div>
          ) : (
            <div style={{ marginBottom: "10px", fontSize: "11px", color: "var(--md-sys-color-outline)", display: "flex", alignItems: "center", gap: "6px" }}>
              <AlertTriangle size={14} style={{ color: "#f59e0b" }} />
              <span>[Yerel Donanım Koruması]: Ekran kartınızın kilitlenmemesi için 1080p/4K kilitlidir (Maks 768px / 5s).</span>
            </div>
          )}
        </div>

        {/* Sabit Alt Eylem Alanı (Üret Butonu Daima Görünür) */}
        <div
          style={{
            padding: "12px 20px 14px 20px",
            borderTop: "1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.08))",
            background: "var(--md-sys-color-surface-container, rgba(28, 28, 33, 0.98))",
            backdropFilter: "blur(12px)",
            flexShrink: 0,
            zIndex: 10,
            boxShadow: "0 -4px 12px rgba(0, 0, 0, 0.12)",
          }}
        >
          {/* Üret Butonu */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating}
            className="btn-beam"
            style={{ width: "100%", height: "46px" }}
          >
            <div className="btn-content">
              {isGenerating ? (
                <>
                  <Sparkles size={18} className="spin" />
                  <span>Video Üretiliyor... ({progress}%)</span>
                </>
              ) : chosenModel && !chosenModel.installed ? (
                <>
                  <Download size={18} />
                  <span>Modeli İndir ve Hazırla ({chosenModel.approxSize || "İndir"})</span>
                </>
              ) : (
                <>
                  <Film size={18} />
                  <span>Videoyu Üret (Render Video)</span>
                </>
              )}
            </div>
          </button>
        </div>
      </div>

      {/* Sağ Panel: Oynatıcı & Çıktı Alanı */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "24px", background: "var(--md-sys-color-surface)", overflowY: "auto" }}>
        <h3 style={{ fontSize: "16px", fontWeight: "700", marginBottom: "16px" }}>Önizleme ve Oynatıcı</h3>

        {/* Video Uretim Metadata Bilgi Karti (En Basta) */}
        {activeVideo && (
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
                  background: "linear-gradient(135deg, #8b5cf6, #3b82f6)",
                  padding: "2px 8px",
                  borderRadius: "6px",
                  fontSize: "0.72rem",
                  letterSpacing: "0.03em"
                }}>
                  VİDEO MODELİ
                </span>
                <strong style={{ color: "var(--md-sys-color-on-surface)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {activeVideo.engineName || videoModels.find(m => m.id === activeVideo.engine)?.name || activeVideo.engine || "Bilinmiyor (eski kayıt)"}
                </strong>
              </div>
              {activeVideo.genDuration && (
                <div style={{ display: "flex", alignItems: "center", gap: "4px", color: "#10b981", fontWeight: 700, fontSize: "0.82rem" }}>
                  <span>️ {activeVideo.genDuration} üretim süresi</span>
                </div>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", color: "var(--md-sys-color-outline)", fontSize: "0.78rem" }}>
              {/* Only show settings that were actually recorded for this video. */}
              {activeVideo.resolution && (
                <>
                  <div title="Video Çözünürlüğü ve Kare Hızı">
                    <span style={{ fontWeight: 600, color: "var(--md-sys-color-on-surface-variant)" }}>Ölçek & Hız:</span> {activeVideo.resolution}{activeVideo.fps ? ` @ ${activeVideo.fps} FPS` : ""}
                  </div>
                  <span>•</span>
                </>
              )}
              {activeVideo.duration && (
                <>
                  <div title="Video Uzunluğu">
                    <span style={{ fontWeight: 600, color: "var(--md-sys-color-on-surface-variant)" }}>Süre:</span> {activeVideo.duration} saniye
                  </div>
                  <span>•</span>
                </>
              )}
              {activeVideo.mode && (
                <div title="Üretim Modu" style={{ color: "var(--md-sys-color-primary)", fontWeight: 600 }}>
                  {activeVideo.mode === "i2v" ? "i2v (Görselden Video)" : "t2v (Metinden Video)"}
                </div>
              )}
              {activeVideo.prompt && (
                <>
                  <span>•</span>
                  <div style={{ maxWidth: "450px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={activeVideo.prompt}>
                    <span style={{ fontWeight: 600, color: "var(--md-sys-color-on-surface-variant)" }}>İstem:</span> "{activeVideo.prompt}"
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <div
          style={{
            flex: 1,
            maxHeight: "520px",
            background: "#000",
            borderRadius: "14px",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            border: "1px solid var(--md-sys-color-outline-variant)",
          }}
        >
          {activeVideo && activeVideo.url ? (
            <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <video
                key={activeVideo.url}
                ref={videoRef}
                src={activeVideo.url}
                loop
                controls
                autoPlay
                playsInline
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />
              <div style={{ position: "absolute", top: "12px", right: "12px", zIndex: 10 }}>
                <button
                  type="button"
                  onClick={() => handleRevealFolder({ url: activeVideo.url, filename: activeVideo.name, type: "video" }, "active_video")}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 12px",
                    background: "rgba(0,0,0,0.72)",
                    backdropFilter: "blur(12px)",
                    borderRadius: "8px",
                    color: "#fff",
                    fontSize: "12px",
                    fontWeight: "600",
                    border: "1px solid rgba(255,255,255,0.2)",
                    boxShadow: "0 2px 10px rgba(0,0,0,0.5)",
                    cursor: "pointer"
                  }}
                  title="Videoyu klasöründe göster"
                >
                  {openedFolderKey === "active_video" ? (
                    <>
                      <Check size={14} style={{ color: "#10b981" }} />
                      <span style={{ color: "#10b981" }}>Klasör Açıldı</span>
                    </>
                  ) : (
                    <>
                      <FolderOpen size={14} />
                      <span>Klasöre Git</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "center", color: "#6b7280" }}>
              <Film size={48} style={{ margin: "0 auto 12px auto", opacity: 0.4 }} />
              <p style={{ margin: 0, fontSize: "14px" }}>Henüz bir video üretilmedi.</p>
              <p style={{ margin: "4px 0 0 0", fontSize: "12px", opacity: 0.7 }}>Sol taraftan isteminizi girip "Videoyu Üret" butonuna basın.</p>
            </div>
          )}
        </div>

        {/* Üretilen Video Geçmişi */}
        <div style={{ marginTop: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h4 style={{ fontSize: "14px", fontWeight: "600", margin: 0 }}>Üretilen Videolar ({videos.length}):</h4>
            <button
              type="button"
              onClick={() => handleRevealFolder({ folder: "video" }, "video_gallery_header")}
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
              title="Video klasörünü aç"
            >
              {openedFolderKey === "video_gallery_header" ? (
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
          </div>
          {videos.length === 0 ? (
            <p style={{ fontSize: "13px", color: "var(--md-sys-color-on-surface-variant)" }}>Galeri boş.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "12px" }}>
              {videos.map((vid, idx) => (
                <div
                  key={vid.id || idx}
                  onClick={() => {
                    setActiveVideo(vid);
                    setTimeout(() => {
                      if (videoRef.current) {
                        videoRef.current.load();
                        videoRef.current.play().catch(() => {});
                      }
                    }, 100);
                  }}
                  style={{
                    borderRadius: "8px",
                    overflow: "hidden",
                    cursor: "pointer",
                    border: activeVideo?.url === vid.url ? "2px solid var(--md-sys-color-primary)" : "1px solid var(--md-sys-color-outline-variant)",
                    background: "#000",
                    position: "relative"
                  }}
                  title={vid.prompt || vid.name}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRevealFolder({ url: vid.url, filename: vid.name, type: "video" }, `vid_${vid.id || idx}`);
                    }}
                    style={{
                      position: "absolute",
                      top: "6px",
                      right: "6px",
                      background: "rgba(0,0,0,0.7)",
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: "4px",
                      padding: "4px",
                      color: openedFolderKey === `vid_${vid.id || idx}` ? "#10b981" : "#fff",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      zIndex: 2
                    }}
                    title="Klasörde Göster"
                  >
                    {openedFolderKey === `vid_${vid.id || idx}` ? <Check size={12} /> : <FolderOpen size={12} />}
                  </button>
                  <video key={vid.url} src={vid.url} muted playsInline style={{ width: "100%", height: "90px", objectFit: "cover" }} />
                  <div style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    padding: "3px 6px",
                    background: "linear-gradient(transparent, rgba(0,0,0,0.85))",
                    fontSize: "10px",
                    color: "#fff",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis"
                  }}>
                    {vid.prompt ? (vid.prompt.length > 25 ? vid.prompt.slice(0, 22) + "..." : vid.prompt) : (vid.name || "Video")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
