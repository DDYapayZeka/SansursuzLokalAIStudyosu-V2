import React, { memo, useState, useRef, useCallback } from "react";
import { uiText } from "../i18n";
import { Sparkles, Download, Copy, RefreshCw, Check, Sliders, Trash2, ImagePlus, Wand2, Layers, CheckCircle2, AlertTriangle, FolderOpen } from "lucide-react";
import { 
  generateImage, 
  normalizeSdSampler,
  normalizeSdScheduler,
  startServer,
  stopServer, 
  waitForServerReady, 
  getBackendStatus, 
  getGenerationProgress, 
  saveGeneratedOutput, 
  deleteGeneratedOutputs,
  getLlmStatus,
  listLlmModels,
  listModels,
  downloadModel,
  startLlm,
  stopLlm,
  chatWithLlm,
  revealFileInFolder
} from "../services/api";

const GalleryItem = memo(({ img, idx, isSelected, onClick }) => {
  const handleClick = (e) => {
    onClick(idx, e);
  };
  const modelText = img.model ? formatImageModelName(img.model) : "Standart Model";
  const resText = `${img.width || 512} × ${img.height || 512} px`;
  const stepsText = img.steps || 20;
  const cfgText = img.cfgScale ?? 7;
  const samplerText = img.sampler || "euler_a";
  const seedText = img.seed ?? "Rastgele";
  const durText = typeof img.duration_sec === "number" ? `${img.duration_sec.toFixed(1)}s` : (img.duration_sec || "-");
  const tooltipText = [
    `Model: ${modelText}`,
    `Boyut: ${resText} | Adım: ${stepsText} | CFG: ${cfgText} | Örnekleyici: ${samplerText}`,
    `Seed: ${seedText} | Üretim Süresi: ${durText}`,
    `Prompt: ${img.prompt || "-"}`
  ].join("\n");
  return (
    <div
      className={`gallery-item ${isSelected ? "selected" : ""}`}
      onClick={handleClick}
      title={tooltipText}
    >
      <img src={img.url} className="gallery-thumb" alt="Thumbnail" loading="lazy" decoding="async" />
      <div className="gallery-item-meta-overlay">
        <div style={{ fontWeight: 700, color: "#a78bfa", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {modelText}
        </div>
        <div style={{ color: "#cbd5e1", fontSize: "0.63rem" }}>
          {resText} • {stepsText} Adım • CFG {cfgText}
        </div>
        <div style={{ color: "#94a3b8", fontSize: "0.62rem" }}>
          Seed: {seedText}{durText !== "-" ? ` • ${durText}` : ""}
        </div>
        {img.prompt && (
          <div style={{ color: "#f8fafc", fontSize: "0.62rem", marginTop: "2px", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {img.prompt}
          </div>
        )}
      </div>
      {isSelected && (
        <div className="gallery-select-badge">
          <Check size={14} />
        </div>
      )}
    </div>
  );
});

const formatImageModelName = (m) => {
  if (!m) return "";
  if (m.displayName) return m.displayName;
  if (m.name && m.name.trim()) return m.name;
  const raw = String(m.filename || m.id || m || "").trim();
  const lower = raw.toLowerCase();
  if (lower.includes("juggernaut") && (lower.includes("lightning") || lower.includes("4step"))) {
    return "Juggernaut XL Lightning (Ultra Hızlı 4 Adım)";
  }
  if (lower.includes("juggernaut")) {
    return "Juggernaut XL Photoreal (Stüdyo Kalitesi)";
  }
  if (lower.includes("realistic_vision") || lower.includes("realisticvision")) {
    return "Realistic Vision v5.1 (Fotogerçekçi Portre & Doğa)";
  }
  if (lower.includes("dreamshaper")) {
    return "DreamShaper 8 (Sanatsal, Çizim & İllüstrasyon)";
  }
  if (lower.includes("v1-5") || lower.includes("sd15") || lower.includes("sd-1.5")) {
    return "Stable Diffusion v1.5 (Klasik Standart)";
  }
  return raw.replace(/\.safetensors$/i, "").replace(/[-_]/g, " ");
};

const IMAGE_CATALOG = [
  {
    name: "Juggernaut XL v9 Lightning",
    displayName: "Juggernaut XL Lightning (Ultra Hızlı 4 Adım)",
    filename: "Juggernaut_RunDiffusionPhoto2_Lightning_4Steps.safetensors",
    approxSize: "7.1 GB",
    url: "https://huggingface.co/RunDiffusion/Juggernaut-XL-Lightning/resolve/main/Juggernaut_RunDiffusionPhoto2_Lightning_4Steps.safetensors",
  },
  {
    name: "Realistic Vision v5.1",
    displayName: "Realistic Vision v5.1 (Fotogerçekçi Portre & Doğa)",
    filename: "Realistic_Vision_V5.1_fp16-no-ema.safetensors",
    approxSize: "2.1 GB",
    url: "https://huggingface.co/SG161222/Realistic_Vision_V5.1_noVAE/resolve/main/Realistic_Vision_V5.1_fp16-no-ema.safetensors",
  },
  {
    name: "DreamShaper 8",
    displayName: "DreamShaper 8 (Sanatsal, Çizim & İllüstrasyon)",
    filename: "DreamShaper_8_pruned.safetensors",
    approxSize: "2.1 GB",
    url: "https://huggingface.co/Lykon/DreamShaper/resolve/main/DreamShaper_8_pruned.safetensors",
  },
  {
    name: "Stable Diffusion v1.5",
    displayName: "Stable Diffusion v1.5 (Klasik Standart)",
    filename: "v1-5-pruned-emaonly.safetensors",
    approxSize: "4.3 GB",
    url: "https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5/resolve/main/v1-5-pruned-emaonly.safetensors",
  },
  {
    name: "DreamShaper XL Lightning",
    displayName: "DreamShaper XL Lightning (Hızlı Sanatsal SDXL)",
    filename: "DreamShaperXL_Lightning.safetensors",
    approxSize: "6.9 GB",
    url: "https://huggingface.co/Lykon/dreamshaper-xl-lightning/resolve/main/DreamShaperXL_Lightning.safetensors",
  },
  {
    name: "RealVisXL V5.0",
    displayName: "RealVisXL v5.0 (Ultra Fotogerçekçi SDXL)",
    filename: "RealVisXL_V5.0_fp16.safetensors",
    approxSize: "6.9 GB",
    url: "https://huggingface.co/SG161222/RealVisXL_V5.0/resolve/main/RealVisXL_V5.0_fp16.safetensors",
  },
  {
    name: "CyberRealistic V8",
    displayName: "CyberRealistic v8 (Hi-Fi Fotogerçekçilik SD 1.5)",
    filename: "CyberRealistic_V8_FP16.safetensors",
    approxSize: "2.1 GB",
    url: "https://huggingface.co/cyberdelia/CyberRealistic/resolve/main/CyberRealistic_V8_FP16.safetensors",
  },
  {
    name: "OpenAI GPT Image 2",
    displayName: "[Bulut API] OpenAI GPT Image 2 (OpenAI anahtarı)",
    filename: "cloud:openai:gpt-image-2",
    approxSize: "Bulut API",
    installed: true,
    isCloud: true,
  },
  {
    name: "Google Gemini 2.5 Flash Image (Nano Banana)",
    displayName: "[Bulut API] Google Gemini 2.5 Flash Image - Nano Banana (Gemini anahtarı)",
    filename: "cloud:gemini:gemini-2.5-flash-image",
    approxSize: "Bulut API",
    installed: true,
    isCloud: true,
  },
  {
    name: "Nano Banana via OpenRouter",
    displayName: "[Bulut API] Gemini 2.5 Flash Image - Nano Banana (OpenRouter anahtarı)",
    filename: "cloud:openrouter:google/gemini-2.5-flash-image",
    approxSize: "Bulut API",
    installed: true,
    isCloud: true,
  },
  {
    name: "GPT-5 Image Mini via OpenRouter",
    displayName: "[Bulut API] OpenAI GPT-5 Image Mini (OpenRouter anahtarı)",
    filename: "cloud:openrouter:openai/gpt-5-image-mini",
    approxSize: "Bulut API",
    installed: true,
    isCloud: true,
  },
  {
    name: "MiniMax Image-01",
    displayName: "[Bulut API] MiniMax Image-01 (MiniMax anahtarı)",
    filename: "cloud:minimax:image-01",
    approxSize: "Bulut API",
    installed: true,
    isCloud: true,
  },
];

function Generator({
  prompt,
  setPrompt,
  negativePrompt,
  setNegativePrompt,
  constraints,
  setConstraints,
  activeModel,
  setActiveModel,
  serverRunning,
  setServerRunning,
  isLlmLoaded,
  setIsLlmLoaded,
  generatedImages,
  setGeneratedImages,
  isGenerating,
  setIsGenerating,
  generationProgress,
  setGenerationProgress,
  setActiveTab,
  showAlert = async ({ message }) => window.alert(message),
  showConfirm = async ({ message }) => window.confirm(message),
  specs,
  textSettings,
  checkAndConfirmInterruption,
}) {
  const [outputImage, setOutputImage] = useState(null);
  const [outputSeed, setOutputSeed] = useState(null);
  const [genDuration, setGenDuration] = useState(null);
  const [currentMetadata, setCurrentMetadata] = useState(null);
  const [copySuccess, setCopySuccess] = useState(false);
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

  const [elapsedTime, setElapsedTime] = useState(0);
  const [estimatedLeftTime, setEstimatedLeftTime] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  const [generationSpeed, setGenerationSpeed] = useState("");
  const [isCpuFallback, setIsCpuFallback] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRestartingBackend, setIsRestartingBackend] = useState(false);
  const [restartLoadProgress, setRestartLoadProgress] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [isDecoding, setIsDecoding] = useState(false);
  const [selectedGalleryIndexes, setSelectedGalleryIndexes] = useState([]);
  const [baseImage, setBaseImage] = useState(null);
  const [availableModels, setAvailableModels] = useState([]);
  const chosenImageModel = availableModels.find(
    (m) => m.filename === activeModel || m.name === activeModel || m.id === activeModel
  ) || availableModels.find(
    (m) => String(m.filename || "").toLowerCase() === String(activeModel || "").toLowerCase()
  );
  const timerRef = useRef(null);
  const abortControllerRef = useRef(null);
  const hasRealGenerationStepRef = useRef(false);

  const updateConstraint = (key, value) => {
    setConstraints((prev) => ({
      ...prev,
      [key]: value,
      ...(key === "steps"
        ? prev.backendType === "openvino-npu"
          ? { npuSteps: value }
          : { standardSteps: value }
        : {}),
    }));
  };

  const STUDIO_ASPECT_RATIOS = [
    { id: "1:1", label: "1:1 Kare", width: 512, height: 512, sdxl_width: 1024, sdxl_height: 1024, qhd_width: 2048, qhd_height: 2048, uhd_width: 4096, uhd_height: 4096 },
    { id: "4:3", label: "4:3 Fotoğraf", width: 640, height: 512, sdxl_width: 1152, sdxl_height: 896, qhd_width: 2304, qhd_height: 1728, uhd_width: 3840, uhd_height: 2880 },
    { id: "16:9", label: "16:9 Yatay", width: 768, height: 448, sdxl_width: 1344, sdxl_height: 768, qhd_width: 2560, qhd_height: 1440, uhd_width: 3840, uhd_height: 2160 },
    { id: "9:16", label: "9:16 Dikey", width: 448, height: 768, sdxl_width: 768, sdxl_height: 1344, qhd_width: 1440, qhd_height: 2560, uhd_width: 2160, uhd_height: 3840 },
  ];

  const applyStudioAspectRatio = (ratioId, baseTier) => {
    const isCloud = Boolean(chosenImageModel?.isCloud);
    const selected = STUDIO_ASPECT_RATIOS.find((r) => r.id === ratioId) || STUDIO_ASPECT_RATIOS[0];
    let w = selected.width;
    let h = selected.height;

    if (baseTier === "4k" && isCloud) {
      w = selected.uhd_width;
      h = selected.uhd_height;
    } else if (baseTier === "2k" && isCloud) {
      w = selected.qhd_width;
      h = selected.qhd_height;
    } else if (baseTier === "sdxl" || (!baseTier && (constraints.width || 512) * (constraints.height || 512) >= 700000 && !isCloud)) {
      w = selected.sdxl_width;
      h = selected.sdxl_height;
    } else if (baseTier === "sd15") {
      w = selected.width;
      h = selected.height;
    } else if (isCloud && (constraints.width || 512) >= 3000) {
      w = selected.uhd_width;
      h = selected.uhd_height;
    } else if (isCloud && (constraints.width || 512) >= 1800) {
      w = selected.qhd_width;
      h = selected.qhd_height;
    } else if ((constraints.width || 512) >= 1000) {
      w = selected.sdxl_width;
      h = selected.sdxl_height;
    }
    setConstraints((prev) => ({ ...prev, width: w, height: h }));
  };

  React.useEffect(() => {
    if (constraints.backendType === "apple-npu" || constraints.backendType === "openvino-npu") {
      setBaseImage(null);
    }
  }, [constraints.backendType]);

  React.useEffect(() => {
    listModels().then((modelsRes) => {
      const diskList = Array.isArray(modelsRes) ? modelsRes : (modelsRes?.models || []);
      const diskFilenames = new Set(diskList.map(m => String(m.filename || m.id || "").toLowerCase()));

      const combined = [];

      // 1. Installed models on disk
      for (const dm of diskList) {
        const fn = String(dm.filename || dm.id || "").toLowerCase();
        const catalogMatch = IMAGE_CATALOG.find(c => c.filename.toLowerCase() === fn);
        combined.push({
          ...dm,
          installed: true,
          displayName: catalogMatch?.displayName || formatImageModelName(dm),
          approxSize: dm.size || catalogMatch?.approxSize,
          url: catalogMatch?.url || null,
        });
      }

      // 2. Uninstalled catalog models
      for (const cm of IMAGE_CATALOG) {
        if (!diskFilenames.has(cm.filename.toLowerCase())) {
          combined.push({
            ...cm,
            installed: cm.isCloud ? true : false,
            size: cm.approxSize,
          });
        }
      }

      setAvailableModels(combined);

      if (!activeModel && combined.length > 0) {
        const firstInstalled = combined.find(m => m.installed && !m.isCloud) || combined.find(m => !m.isCloud) || combined[0];
        const defaultModel = firstInstalled.filename;
        setActiveModel?.(defaultModel);
        localStorage.setItem("active-model", defaultModel);
      }
    }).catch(() => {});
  }, [activeModel, setActiveModel]);

    // Model degistiginde lokal model icin 4K korumasi: VRAM patlamasini onle
  React.useEffect(() => {
    if (chosenImageModel && !chosenImageModel.isCloud) {
      if ((constraints.width || 512) > 1344 || (constraints.height || 512) > 1344) {
        setConstraints((prev) => ({
          ...prev,
          width: Math.min(1024, prev.width || 512),
          height: Math.min(1024, prev.height || 512)
        }));
      }
    }
  }, [chosenImageModel?.filename, chosenImageModel?.isCloud]);

  // chosenImageModel moved to top

  const handleDownloadDirect = async (model) => {
    if (!model || !model.url) {
      setActiveTab?.("models");
      return;
    }
    const proceed = await showConfirm?.({
      title: uiText("Görsel Modeli İndirilsin mi?", "Download Image Model?"),
      message: uiText(`"${model.displayName || model.name}" modeli (${model.approxSize || "Safetensors"}) bilgisayarınıza indirilecek. Onaylıyor musunuz?`, `"${model.displayName || model.name}" (${model.approxSize || "Safetensors"}) will be downloaded to your computer. Continue?`),
      confirmLabel: uiText("Modeli İndir", "Download Model"),
    });
    if (!proceed) return;
    try {
      await downloadModel(model.url, model.filename, model.name);
      showAlert?.({
        title: uiText("İndirme Başlatıldı", "Download Started"),
        message: uiText(`"${model.displayName || model.name}" indirmesi arka planda başlatıldı. İlerlemeyi Model Merkezi'nden takip edebilirsiniz.`, `"${model.displayName || model.name}" is downloading in the background. You can follow the progress in the Model Hub.`)
      });
    } catch (err) {
      showAlert?.({ title: uiText("İndirme Hatası", "Download Error"), message: err.message, danger: true });
    }
  };

  const handleBaseImageSelect = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrorMsg("Please choose an image file (PNG, JPG, or WEBP).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setBaseImage(reader.result);
    reader.onerror = () => setErrorMsg("Could not read the selected image file.");
    reader.readAsDataURL(file);
  };

  const handleClearBaseImage = () => setBaseImage(null);

  // Trigger main gorsel uretim process
  const handleGenerate = async () => {
    if (chosenImageModel && !chosenImageModel.installed && !chosenImageModel.isCloud) {
      handleDownloadDirect(chosenImageModel);
      return;
    }

    if (!prompt.trim()) return;

    // 1. Conflict & active generation guard
    if (checkAndConfirmInterruption) {
      const canProceed = await checkAndConfirmInterruption("image");
      if (!canProceed) return;
    }

    setErrorMsg(null);

    // 2. Resolve target image model if none is selected
    let targetModel = activeModel;
    if (!targetModel) {
      try {
        const modelsRes = await listModels();
        const availableModels = Array.isArray(modelsRes) ? modelsRes : (modelsRes?.models || []);
        if (availableModels.length > 0) {
          targetModel = availableModels[0].filename || availableModels[0].name;
          setActiveModel?.(targetModel);
          localStorage.setItem("active-model", targetModel);
        } else {
          showAlert?.({
            title: uiText("Görsel Modeli Bulunamadı", "No Image Model Found"),
            message: uiText("Görsel üretebilmek için en az bir model indirilmiş olmalıdır. Model Merkezi'nden Uyumlu En Verimli Modelleri tek tıkla indirebilirsiniz.", "At least one model must be downloaded to generate images. You can download the recommended compatible models from the Model Hub in one click."),
          });
          setActiveTab?.("models");
          return;
        }
      } catch (_) {}
    }

    const isCloudModel = String(targetModel || "").startsWith("cloud:");

    // 3. If an LLM was loaded in VRAM, gracefully unload it (not needed for cloud generation)
    if (isLlmLoaded && !isCloudModel) {
      try {
        await stopLlm();
        setIsLlmLoaded?.(false);
      } catch (_) {}
    }

    setIsRestartingBackend(true);
    setRestartLoadProgress({
      phase: `Model hazırlanıyor: ${targetModel || "Görsel Modeli"}...`,
      progress: 5,
    });

    let needsRestart = false;
    try {
      if (isCloudModel) throw Object.assign(new Error("cloud"), { skip: true });
      const status = await getBackendStatus();
      if (status && status.settings) {
        const settings = status.settings;
        const currentModelName = settings.model ? settings.model.split(/[\\/]/).pop() : null;
        const targetModelName = targetModel ? targetModel.split(/[\\/]/).pop() : null;
        const requestedBackend = constraints.backendType || (constraints.useGpu === false ? "cpu" : "auto");
        const currentBackend = settings.backendType || (settings.useGpu === false ? "cpu" : "auto");
        const shouldCompareModel = requestedBackend !== "openvino-npu";
        const isCoreMLBackend = requestedBackend === "apple-npu";

        const isNpuOrCoreML = requestedBackend === "openvino-npu" || requestedBackend === "apple-npu";

        if ((shouldCompareModel && currentModelName !== targetModelName) ||
            (!isCoreMLBackend && parseInt(settings.steps) !== parseInt(constraints.steps)) ||
            (!isCoreMLBackend && Math.abs(parseFloat(settings.cfgScale) - parseFloat(constraints.cfgScale)) > 0.05) ||
            (!isCoreMLBackend && normalizeSdSampler(settings.sampler) !== normalizeSdSampler(constraints.sampler)) ||
            (!isCoreMLBackend && parseInt(settings.threads) !== parseInt(constraints.threads)) ||
            Boolean(settings.useGpu) !== (constraints.useGpu !== false) ||
            (isNpuOrCoreML && parseInt(settings.width || 512) !== parseInt(constraints.width || 512)) ||
            (isNpuOrCoreML && parseInt(settings.height || 512) !== parseInt(constraints.height || 512)) ||
            currentBackend !== requestedBackend ||
            !status.ready) {
          needsRestart = true;
        }
      } else {
        needsRestart = true;
      }
    } catch (e) {
      needsRestart = !e?.skip;
    }

    if (needsRestart) {
      try {
        console.log("Starting / switching backend to image model:", targetModel);
        await startServer(targetModel, { ...constraints, autoSwap: true, cancelActive: true });
        let isReady = false;
        let crashError = null;
        const maxStartupPolls = (constraints.backendType === "openvino-npu" || constraints.backendType === "apple-npu") ? 1200 : 240;
        for (let i = 0; i < maxStartupPolls; i++) {
          const status = await getBackendStatus();
          if (status.loading) {
            setRestartLoadProgress({
              progress: status.loading.progress || 0,
              phase: status.loading.phase || `Model yükleniyor: ${targetModel}...`,
              speed: status.loading.speed || "",
              current: status.loading.current || 0,
              total: status.loading.total || 0,
              backendMode: status.loading.backendMode || status.settings?.backendMode || "",
              device: status.loading.device || status.settings?.backendDevice || "",
            });
          }
          if (status.ready) {
            isReady = true;
            setServerRunning?.(true);
            setActiveModel?.(targetModel);
            break;
          }
          if (status.error) {
            crashError = status.error;
            break;
          }
          if (!status.running && !status.loading?.active && i > 3) {
            crashError = "The backend process terminated immediately on startup.";
            break;
          }
          await new Promise((r) => setTimeout(r, 500));
        }

        if (!isReady) {
          throw new Error(crashError || "Backend server failed to start after applying configuration changes.");
        }
      } catch (err) {
        console.error("Failed to restart backend:", err);
        setErrorMsg(err.message || "Failed to sync settings with backend.");
        setIsRestartingBackend(false);
        return;
      }
    }
    setIsRestartingBackend(false);
    setRestartLoadProgress(null);

    if (timerRef.current) clearInterval(timerRef.current);
    setIsGenerating(true);
    setGenerationProgress(0);
    setElapsedTime(0);
    setCurrentStep(0);
    setGenerationSpeed("");
    hasRealGenerationStepRef.current = false;
    setIsCpuFallback(false);
    setIsDecoding(false);
    setGenDuration(null);
    setOutputImage(null);

    // Calculate dynamic step estimation times
    // CPU takes ~35s per step at 512px, ~140s at 1024px. GPU is ~0.04x of CPU time.
    const baseGpuStepTime = (constraints.width >= 1024 ? 140 : 35) * 0.04;
    const baseCpuStepTime = (constraints.width >= 1024 ? 140 : 35);
    
    const gpuSelected = (constraints.backendType || (constraints.useGpu === false ? "cpu" : "auto")) !== "cpu";
    let activeStepTime = gpuSelected ? baseGpuStepTime : baseCpuStepTime;
    let cpuFallbackDetected = false;
    let fallbackTime = 0;
    let fallbackProgress = 0;
    let elapsedSeconds = 0;

    setEstimatedLeftTime(Math.round(constraints.steps * activeStepTime));

    timerRef.current = setInterval(async () => {
      elapsedSeconds++;
      setElapsedTime(elapsedSeconds);

      try {
        const progress = await getGenerationProgress();
        if (progress && progress.active) {
          const decoding = progress.decoding || false;
          setIsDecoding(decoding);

          const step = decoding ? (progress.steps || constraints.steps || 20) : (progress.step || 0);
          const steps = progress.steps || constraints.steps || 20;
          const speed = decoding ? "" : (progress.speed || "");
          const numericSpeed = parseFloat(speed);
          const backendMode = String(progress.backendMode || "").toLowerCase();
          const backendDevice = String(progress.backendDevice || "").toLowerCase();
          const isConfirmedGpuBackend = (
            backendMode.includes("gpu") ||
            backendMode.includes("vulkan") ||
            backendMode.includes("cuda") ||
            backendMode.includes("rocm") ||
            backendMode.includes("metal") ||
            backendDevice.includes("vulkan") ||
            backendDevice.includes("cuda") ||
            backendDevice.includes("rocm")
          );

          if (decoding || progress.steps > 0) {
            hasRealGenerationStepRef.current = true;
            setCurrentStep(step);
          }
          if (!decoding) {
            setGenerationSpeed(speed);
          } else {
            setGenerationSpeed("decoding");
          }

          // Calculate progress percentage
          let progressPercent = 0;
          if (decoding) {
            progressPercent = 99;
          } else if (steps > 0) {
            progressPercent = Math.round((step / steps) * 100);
          }
          progressPercent = Math.min(99, progressPercent);
          if (decoding || progress.steps > 0) {
            setGenerationProgress(progressPercent);
          } else {
            setGenerationProgress((prev) => Math.max(prev, progressPercent));
          }

          // Calculate remaining time
          let remaining = 0;
          if (decoding) {
            remaining = 3;
          } else {
            if (!isNaN(numericSpeed) && numericSpeed > 0) {
              const remainingSteps = Math.max(0, steps - step);
              if (speed.includes("it/s")) {
                remaining = remainingSteps / numericSpeed;
              } else if (speed.includes("s/it")) {
                remaining = remainingSteps * numericSpeed;
              }
            } else {
              const activeStepTime = gpuSelected ? baseGpuStepTime : baseCpuStepTime;
              remaining = Math.max(0, (steps - step) * activeStepTime);
            }
          }

          // Detect CPU fallback / slow uretim if GPU was requested but it runs slow
          if (gpuSelected && !cpuFallbackDetected && !isConfirmedGpuBackend) {
            const isSlowItS = speed.includes("it/s") && numericSpeed < 0.2;
            const isSlowSIt = speed.includes("s/it") && numericSpeed > 5.0;
            if (isSlowItS || isSlowSIt) {
              cpuFallbackDetected = true;
              setIsCpuFallback(true);
            }
          }

          setEstimatedLeftTime(Math.round(remaining));
        } else {
          // Creep up slowly while yukleniyor the model/preparing
          setGenerationProgress((prev) => Math.min(15, prev + 1));
          setEstimatedLeftTime((prev) => Math.max(1, prev - 1));
        }
      } catch (e) {
        console.warn("Failed to get generation progress, running simulation fallback:", e);

        // Fallback simulation logic
        if (gpuSelected && !cpuFallbackDetected && elapsedSeconds > constraints.steps * baseGpuStepTime * 1.3) {
          cpuFallbackDetected = true;
          setIsCpuFallback(true);
          activeStepTime = baseCpuStepTime;
          fallbackTime = elapsedSeconds;
          fallbackProgress = Math.min(95, Math.round((elapsedSeconds / (constraints.steps * baseGpuStepTime)) * 100));
        }

        let step = Math.min(constraints.steps - 1, Math.floor(elapsedSeconds / activeStepTime));
        let expectedTotal = constraints.steps * activeStepTime;
        if (elapsedSeconds >= expectedTotal) {
          const computedStepTime = Math.ceil(elapsedSeconds / Math.max(0.5, step));
          activeStepTime = Math.max(activeStepTime + 15, computedStepTime + 15);
          expectedTotal = constraints.steps * activeStepTime;
          step = Math.min(constraints.steps - 1, Math.floor(elapsedSeconds / activeStepTime));
        }
        const remaining = Math.max(1, expectedTotal - elapsedSeconds);
        setEstimatedLeftTime(Math.round(remaining));

        let progressPercent = 0;
        if (cpuFallbackDetected) {
          const remainingProgress = 99 - fallbackProgress;
          const remainingTime = expectedTotal - fallbackTime;
          if (remainingTime > 0) {
            const ratio = Math.min(1.0, (elapsedSeconds - fallbackTime) / remainingTime);
            if (ratio < 0.85) {
              progressPercent = Math.round(fallbackProgress + ratio * remainingProgress);
            } else {
              const x = (elapsedSeconds - (fallbackTime + remainingTime * 0.85)) / (activeStepTime * 2);
              const decay = 1 - Math.exp(-x);
              progressPercent = Math.min(99, Math.round(fallbackProgress + 0.85 * remainingProgress + (0.14 * remainingProgress) * decay));
            }
          } else {
            progressPercent = 99;
          }
        } else {
          if (elapsedSeconds < expectedTotal * 0.85) {
            progressPercent = Math.round((elapsedSeconds / expectedTotal) * 100);
          } else {
            const x = (elapsedSeconds - expectedTotal * 0.85) / (activeStepTime * 2);
            const decay = 1 - Math.exp(-x);
            progressPercent = Math.min(99, Math.round(85 + 14 * decay));
          }
        }
        if (!hasRealGenerationStepRef.current) {
          setGenerationProgress((p) => Math.max(p, progressPercent));
        }
      }
    }, 1000);

    try {
      abortControllerRef.current = new AbortController();
      const result = await generateImage(
        prompt,
        negativePrompt,
        constraints,
        targetModel,
        baseImage,
        (prog) => setGenerationProgress((prev) => Math.max(prev, prog)),
        abortControllerRef.current.signal
      );

      if (timerRef.current) clearInterval(timerRef.current);
      setGenerationProgress(100);
      setCurrentStep(constraints.steps);
      setEstimatedLeftTime(0);
      setGenerationSpeed("");

      const metadata = {
        prompt: prompt,
        negativePrompt: negativePrompt,
        seed: result.seed,
        steps: constraints.steps,
        cfgScale: constraints.cfgScale,
        width: constraints.width,
        height: constraints.height,
        sampler: isCloudModel ? null : constraints.sampler,
        model: targetModel,
        mode: baseImage ? "img2img" : "txt2img",
        denoisingStrength: baseImage ? constraints.denoisingStrength : null,
        duration_sec: result.duration_sec,
        timestamp: new Date().toLocaleTimeString(),
      };
      let savedOutput = null;
      let savedUrl = null;
      try {
        savedOutput = await saveGeneratedOutput(result.image, metadata);
        savedUrl = savedOutput.url;
        if (!savedUrl) {
          throw new Error("The local server saved the image but did not return a file URL.");
        }
      } catch (saveErr) {
        console.error("Generated image could not be saved:", saveErr);
        throw new Error(`Image generated but could not be saved to USB: ${saveErr.message || saveErr}`);
      }

      setOutputImage(savedUrl);
      setOutputSeed(result.seed);
      setGenDuration(result.duration_sec);
      setCurrentMetadata(metadata);

      const historyItem = {
        ...metadata,
        ...(savedOutput || {}),
        url: savedUrl,
      };

      setGeneratedImages((prev) => [historyItem, ...prev]);
    } catch (e) {
      if (e.name === "AbortError") {
        console.log("Generation request was aborted by the user");
      } else {
        console.error("Generation failed:", e);
        setErrorMsg(e.message || "Generation failed. Please try again.");
      }
      if (timerRef.current) clearInterval(timerRef.current);
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };

  // Durdur/Iptal Uretim Handler
  const handleCancelGeneration = async () => {
    if (await showConfirm({
      title: uiText("Üretim Durdurulsun mu?", "Stop Generation?"),
      message: uiText("Devam eden görsel üretimi iptal edilecek ve yerel model sunucusu yeniden başlayabilir.", "The current image generation will be cancelled and the local model server may restart."),
      confirmLabel: uiText("Durdur", "Stop"),
      danger: true,
    })) {
      if (timerRef.current) clearInterval(timerRef.current);
      
      // Set cancelling state first to keep the progress overlay aktif in cancelling mode
      setIsCancelling(true);
      
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      
      try {
        console.log("Cancelling: Stopping server to kill generation threads...");
        await stopServer();
        setCurrentStep(0);
        setGenerationSpeed("");
        setIsDecoding(false);
        hasRealGenerationStepRef.current = false;

        if (activeModel) {
          console.log("Cancelling: Restarting server for future generations...");
          await startServer(activeModel, constraints);
          const ready = await waitForServerReady();
          if (!ready) {
            console.warn("Server failed to restart properly.");
          }
        }
      } catch (err) {
        console.error("Failed to restart server on cancellation:", err);
      } finally {
        setIsCancelling(false);
        setIsGenerating(false);
        setGenerationProgress(0);
        setEstimatedLeftTime(0);
      }
    }
  };

  // Copy generated gorsel to clipboard
  const handleCopyImage = async () => {
    if (!outputImage) return;
    try {
      if (outputImage.startsWith("data:image")) {
        // base64 conversion for clipboard
        const response = await fetch(outputImage);
        const blob = await response.blob();
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type]: blob })
        ]);
      } else {
        // Remote Unsplash gorseller fallback (draw on canvas then copy)
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = outputImage;
        img.onload = async () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          canvas.toBlob(async (blob) => {
            await navigator.clipboard.write([
              new ClipboardItem({ [blob.type]: blob })
            ]);
          }, "image/png");
        };
      }
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error("Failed to copy image:", err);
    }
  };

  // Indir generated gorsel
  const handleDownload = () => {
    if (!outputImage) return;
    const link = document.createElement("a");
    link.href = outputImage;
    link.download = `diffusion-${outputSeed || Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadImageUrl = (url, filename = `diffusion-${Date.now()}.png`) => {
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Reuse ipucu ayarlar from gecmis
  const loadHistoryItem = useCallback((item) => {
    setPrompt(item.prompt);
    setNegativePrompt(item.negativePrompt);
    setConstraints((prev) => ({
      ...prev,
      steps: item.steps,
      cfgScale: item.cfgScale,
      width: item.width,
      height: item.height,
      sampler: item.sampler,
      seed: item.seed,
    }));
    setOutputImage(item.url);
    setOutputSeed(item.seed);
    setGenDuration(item.duration_sec ?? item.durationSec ?? null);
    setCurrentMetadata(item);
  }, [setPrompt, setNegativePrompt, setConstraints]);

  const toggleGallerySelection = useCallback((idx, event) => {
    const multi = event.ctrlKey || event.metaKey || event.shiftKey;
    setSelectedGalleryIndexes((prev) => {
      if (!multi) return [idx];
      return prev.includes(idx) ? prev.filter((item) => item !== idx) : [...prev, idx];
    });
    if (generatedImages[idx]) {
      loadHistoryItem(generatedImages[idx]);
    }
  }, [generatedImages, loadHistoryItem]);

  const selectedGalleryItems = selectedGalleryIndexes
    .map((idx) => generatedImages[idx])
    .filter(Boolean);

  const clearGallerySelection = () => {
    setSelectedGalleryIndexes([]);
  };

  const useSelectedGalleryItem = () => {
    if (selectedGalleryItems[0]) {
      loadHistoryItem(selectedGalleryItems[0]);
    }
  };

  const downloadSelectedGalleryItems = () => {
    selectedGalleryItems.forEach((item, index) => {
      const seed = item.seed ?? Date.now();
      downloadImageUrl(item.url, `diffusion-${seed}-${index + 1}.png`);
    });
  };

  const deleteSelectedGalleryItems = async () => {
    if (selectedGalleryItems.length === 0) return;
    const count = selectedGalleryItems.length;
    const confirmed = await showConfirm({
      title: uiText("Seçili Çıktılar Silinsin mi?", "Delete Selected Outputs?"),
      message: uiText(`Seçili ${count} çıktı diskten silinsin mi? Görsel ve bilgi (metadata) dosyaları silinir.`, `Delete ${count} selected output${count === 1 ? "" : "s"} from disk? This removes the image and metadata files.`),
      confirmLabel: uiText("Sil", "Delete"),
      danger: true,
    });
    if (!confirmed) return;

    try {
      await deleteGeneratedOutputs(selectedGalleryItems);
      const selectedSet = new Set(selectedGalleryIndexes);
      setGeneratedImages((prev) => prev.filter((_, idx) => !selectedSet.has(idx)));
      setSelectedGalleryIndexes([]);

      if (selectedGalleryItems.some((item) => item.url === outputImage)) {
        setOutputImage(null);
        setOutputSeed(null);
        setGenDuration(null);
      }
    } catch (err) {
      console.error("Failed to delete selected outputs:", err);
      showAlert({
        title: uiText("Silme Başarısız", "Delete Failed"),
        message: err.message || String(err),
        danger: true,
      });
    }
  };

  return (
    <div className="workspace-area">
      <div className="workspace-title-section">
        <h2 className="workspace-title">Generator Dashboard</h2>
        <p className="workspace-subtitle">
          Create high-fidelity images completely locally on your external drive.
        </p>
      </div>

      <div className="generator-layout">
        {/* Left Side: Parameters & Input */}
        <div>
          <div className="m3-card">
            <h3 className="m3-card-title">
              <Sparkles size={18} style={{ color: "var(--md-sys-color-primary)" }} />
              Generation Workspace
            </h3>

            <div className="m3-field-group">
              {/* Görsel Modeli Seçimi (Image Model Selector) */}
              <div className="m3-text-field" style={{ marginBottom: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <label className="m3-text-field-label" style={{ margin: 0, fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
                    <Layers size={15} style={{ color: "var(--md-sys-color-primary)" }} />
                    <span>Görsel Üretim Modeli</span>
                  </label>
                  {chosenImageModel?.installed ? (
                    <span style={{ fontSize: "0.72rem", padding: "2px 8px", borderRadius: "6px", background: "rgba(16, 185, 129, 0.15)", color: "#10b981", fontWeight: 700 }}>
                      [Hazır]
                    </span>
                  ) : chosenImageModel && !chosenImageModel.installed ? (
                    <span style={{ fontSize: "0.72rem", padding: "2px 8px", borderRadius: "6px", background: "rgba(245, 158, 11, 0.15)", color: "#f59e0b", fontWeight: 700 }}>
                      [İndirilmedi]
                    </span>
                  ) : null}
                </div>
                <select
                  value={activeModel || ""}
                  onChange={(e) => {
                    const selected = e.target.value;
                    setActiveModel?.(selected);
                    localStorage.setItem("active-model", selected);
                  }}
                  disabled={isGenerating}
                  className="m3-select"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.15))",
                    background: "#161824",
                    backgroundColor: "#161824",
                    color: "#f8fafc",
                    colorScheme: "dark",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    outline: "none"
                  }}
                >
                  {availableModels.length === 0 ? (
                    <option value="" style={{ backgroundColor: "#161824", color: "#94a3b8" }}>
                      Model yükleniyor...
                    </option>
                  ) : (
                    availableModels.map((m) => {
                      const val = m.filename || m.name || m.id;
                      const label = m.displayName || m.name || formatImageModelName(m);
                      const sizeText = m.size || m.approxSize ? `(${m.size || m.approxSize})` : "";
                      const statusBadge = m.isCloud ? "[Bulut API]" : (m.installed ? "[Hazır]" : `[İndirilmedi - ${m.approxSize || "İndir"}]`);
                      return (
                        <option
                          key={val}
                          value={val}
                          style={{
                            backgroundColor: "#161824",
                            color: (m.installed || m.isCloud) ? "#f8fafc" : "#94a3b8",
                            padding: "8px 12px"
                          }}
                        >
                          {label} {sizeText} {statusBadge}
                        </option>
                      );
                    })
                  )}
                </select>

                {/* Görsel Modeli Hazır / İndirilmedi Rozet Kartı */}
                {chosenImageModel?.installed ? (
                  <div style={{
                    marginTop: "8px",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    background: "rgba(16, 185, 129, 0.1)",
                    border: "1px solid rgba(16, 185, 129, 0.3)",
                    fontSize: "12px",
                    color: "#10b981",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "8px"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <CheckCircle2 size={15} />
                      <span><strong>{chosenImageModel.isCloud ? "[Bulut API]" : "[Hazır]"}</strong> {chosenImageModel.displayName || chosenImageModel.name} {chosenImageModel.isCloud ? "bulut API ile üretime hazır." : "kurulu ve kullanıma hazır."}</span>
                    </div>
                    {chosenImageModel.size && (
                      <span style={{ fontSize: "11px", fontWeight: 700, color: "#10b981", background: "rgba(16, 185, 129, 0.2)", padding: "2px 8px", borderRadius: "4px" }}>
                        {chosenImageModel.size}
                      </span>
                    )}
                  </div>
                ) : chosenImageModel && !chosenImageModel.installed ? (
                  <div style={{
                    marginTop: "8px",
                    padding: "10px 12px",
                    borderRadius: "8px",
                    background: "rgba(245, 158, 11, 0.1)",
                    border: "1px solid rgba(245, 158, 11, 0.3)",
                    fontSize: "12px",
                    color: "#f59e0b"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: "700" }}>
                        <AlertTriangle size={15} />
                        <span>[İndirilmedi] {chosenImageModel.displayName || chosenImageModel.name}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDownloadDirect(chosenImageModel)}
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
                        <span>Şimdi İndir ({chosenImageModel.approxSize || "İndir"})</span>
                      </button>
                    </div>
                    <div style={{ fontSize: "11px", opacity: 0.85 }}>
                      Bu modeli kullanabilmek için önce bilgisayarınıza indirilmesi gerekir.
                    </div>
                  </div>
                ) : null}

                {activeModel && (
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "6px", fontSize: "0.74rem", color: "var(--md-sys-color-outline)" }}>
                    <span>Seçili Dosya:</span>
                    <code style={{ color: "var(--md-sys-color-primary)", fontWeight: 600, background: "rgba(255,255,255,0.05)", padding: "2px 6px", borderRadius: "4px" }}>
                      {activeModel}
                    </code>
                  </div>
                )}
              </div>

              {/* Prompt Textarea */}
              <div className="m3-text-field">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <label className="m3-text-field-label" style={{ margin: 0 }}>Görsel İstemi (Prompt)</label>
                </div>
                <textarea
                  className="m3-textarea"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Hayal ettiğiniz sahneyi detaylandırın (İngilizce istemler en yüksek kaliteyi verir; ör. 'Cyberpunk futuristic city at night, neon lights, 8k render' veya aşağıdaki hazır şablonlardan birini seçin)..."
                  disabled={isGenerating}
                />

                <div style={{ marginTop: "10px" }}>
                  <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.4px", color: "var(--md-sys-color-primary)", display: "block", marginBottom: "6px" }}>
                    Hazır Görsel Şablonları (Örnek İstemler):
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <button
                      type="button"
                      className="glass-suggestion-pill"
                      onClick={() => setPrompt("Photorealistic cinematic portrait of a charismatic explorer, 85mm f/1.4 lens photography, natural skin texture, dramatic golden hour rim lighting, soft bokeh background, 8k resolution, masterpiece")}
                      disabled={isGenerating}
                    >
                      Fotogerçekçi Sinematik Portre (85mm Stüdyo Işığı)
                    </button>
                    <button
                      type="button"
                      className="glass-suggestion-pill"
                      onClick={() => setPrompt("Futuristic cyberpunk metropolis at night, crystal glass skyscrapers, neon hologram reflections on wet rain-soaked asphalt, volumetric cinematic fog and lighting, photorealistic, 8k resolution, masterpiece")}
                      disabled={isGenerating}
                    >
                      Siberpunk Gece Şehri ve Neon Yansımalar
                    </button>
                    <button
                      type="button"
                      className="glass-suggestion-pill"
                      onClick={() => setPrompt("Epic fantasy ancient citadel perched on a misty mountain peak at sunrise, dramatic clouds, waterfalls cascading into a glowing valley, cinematic concept art, matte painting, ultra detailed, 8k")}
                      disabled={isGenerating}
                    >
                      Epik Fantastik Dağ Kalesi ve Şafak Manzarası
                    </button>
                    <button
                      type="button"
                      className="glass-suggestion-pill"
                      onClick={() => setPrompt("Sleek futuristic electric supercar in a minimalist dark architectural studio, soft overhead diffused studio lighting, carbon fiber and liquid metal reflections, commercial photography, 8k octane render")}
                      disabled={isGenerating}
                    >
                      Lüks Süper Otomobil ve Stüdyo Ürün Çekimi
                    </button>
                    <button
                      type="button"
                      className="glass-suggestion-pill"
                      onClick={() => setPrompt("Enchanted bioluminescent forest at twilight, glowing mushrooms and ethereal crystal flora, mystical fireflies, crystal clear stream reflecting starry nebula sky, breathtaking nature photography, 8k")}
                      disabled={isGenerating}
                    >
                      Büyülü Biyolüminesans Orman ve Doğa Sanatı
                    </button>
                    <button
                      type="button"
                      className="glass-suggestion-pill"
                      onClick={() => setPrompt("Cute isometric 3D diorama of a cozy medieval alchemist workshop and magical garden, warm glowing lanterns, miniature details, tilt-shift lens, Blender 3D cycles render, stylized art")}
                      disabled={isGenerating}
                    >
                      İzometrik 3D Minyatür Oyun ve Simyacı Atölyesi
                    </button>
                  </div>
                </div>
              </div>

              {constraints.backendType !== "apple-npu" && constraints.backendType !== "openvino-npu" && (
                <div className="m3-text-field">
                  <label className="m3-text-field-label">Temel Görsel (Init Image - Opsiyonel)</label>
                  {baseImage ? (
                    <div style={{ display: "flex", gap: "12px", alignItems: "center", padding: "12px", background: "var(--md-sys-color-surface-variant)", borderRadius: "var(--md-shape-corner-medium)", border: "1px solid var(--md-sys-color-outline-variant)" }}>
                      <img src={baseImage} alt="Base" style={{ width: "64px", height: "64px", objectFit: "cover", borderRadius: "8px", flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>Temel Görsel Hazır</div>
                        <div style={{ fontSize: "0.75rem", color: "var(--md-sys-color-outline)" }}>
                          Yapay zeka bu görseli isteminize göre yeniden şekillendirecektir.
                        </div>
                      </div>
                      <button type="button" className="m3-btn m3-btn-error" style={{ height: "34px", flexShrink: 0 }} onClick={handleClearBaseImage} disabled={isGenerating}>
                        <Trash2 size={14} />
                        <span>Kaldır</span>
                      </button>
                    </div>
                  ) : (
                    <label className="import-box" style={{ margin: 0, padding: "16px", cursor: isGenerating ? "not-allowed" : "pointer" }}>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        style={{ display: "none" }}
                        onChange={handleBaseImageSelect}
                        disabled={isGenerating}
                      />
                      <ImagePlus className="import-icon" />
                      <span style={{ fontWeight: 600 }}>Temel Görsel Yükle (Image-to-Image)</span>
                      <span style={{ fontSize: "0.75rem", color: "var(--md-sys-color-outline)", textAlign: "center" }}>
                        İsteğe bağlı. Mevcut bir görselinizi baz alarak yeni bir varyasyon üretin.
                      </span>
                    </label>
                  )}

                  {baseImage && (
                    <div style={{ marginTop: "12px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", marginBottom: "4px" }}>
                        <span>Dönüştürme Gücü (Denoising Strength)</span>
                        <span style={{ fontWeight: 600 }}>{constraints.denoisingStrength.toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="1"
                        step="0.05"
                        value={constraints.denoisingStrength}
                        onChange={(e) => setConstraints((prev) => ({ ...prev, denoisingStrength: parseFloat(e.target.value) }))}
                        disabled={isGenerating}
                        style={{ width: "100%" }}
                      />
                      <div style={{ fontSize: "0.72rem", color: "var(--md-sys-color-outline)", marginTop: "2px" }}>
                        Düşük değer orijinal görsele sadık kalır; yüksek değer yapay zekaya daha fazla yaratıcılık tanır (0.7 önerilir).
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Interactive Generation Parameters (Directly Editable in Studio) */}
              <div
                className="m3-text-field"
                style={{
                  padding: "14px",
                  borderRadius: "12px",
                  background: "rgba(255, 255, 255, 0.025)",
                  border: "1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.1))",
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label className="m3-text-field-label" style={{ margin: 0, display: "flex", alignItems: "center", gap: "6px", fontWeight: 700 }}>
                    <Sliders size={15} style={{ color: "var(--md-sys-color-primary)" }} />
                    <span>Görsel Üretim Parametreleri (Generation Parameters)</span>
                  </label>
                  <span style={{ fontSize: "0.72rem", color: "var(--md-sys-color-outline)", fontWeight: 600 }}>
                    {constraints.width} × {constraints.height} px • {constraints.steps} Adım • CFG {constraints.cfgScale}
                  </span>
                </div>

                {/* 1. Çözünürlük ve En-Boy Oranı (Scale & Aspect Ratio) */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                    <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--md-sys-color-on-surface)" }}>
                      Ölçek ve En-Boy Oranı (Resolution & Aspect Ratio)
                    </span>
                    <div style={{ display: "flex", gap: "4px" }}>
                      {(chosenImageModel?.isCloud ? [
                        { id: "sd15", label: "512px" },
                        { id: "sdxl", label: "1024px (HD)" },
                        { id: "2k", label: "2K (2048px)" },
                        { id: "4k", label: "4K (Ultra HD)" }
                      ] : [
                        { id: "sd15", label: "512px (SD 1.5)" },
                        { id: "sdxl", label: "1024px (SDXL)" }
                      ]).map((tier) => {
                        const isCurrent4K = (constraints.width || 512) >= 3000;
                        const isCurrent2K = (constraints.width || 512) >= 1800 && (constraints.width || 512) < 3000;
                        const isCurrentSDXL = (constraints.width || 512) >= 900 && (constraints.width || 512) < 1800;
                        const isCurrentSD15 = (constraints.width || 512) < 900;
                        const active = (tier.id === "4k" && isCurrent4K) ||
                          (tier.id === "2k" && isCurrent2K) ||
                          (tier.id === "sdxl" && isCurrentSDXL) ||
                          (tier.id === "sd15" && isCurrentSD15);
                        return (
                          <button
                            key={tier.id}
                            type="button"
                            disabled={isGenerating}
                            onClick={() => {
                              const matchedRatio = STUDIO_ASPECT_RATIOS.find((r) => {
                                return Math.abs(r.width - constraints.width) < 32 ||
                                  Math.abs(r.sdxl_width - constraints.width) < 32 ||
                                  Math.abs(r.qhd_width - constraints.width) < 32 ||
                                  Math.abs(r.uhd_width - constraints.width) < 32;
                              })?.id || "1:1";
                              applyStudioAspectRatio(matchedRatio, tier.id);
                            }}
                            style={{
                              padding: "3px 8px",
                              fontSize: "0.7rem",
                              fontWeight: 700,
                              borderRadius: "6px",
                              border: active ? "1px solid var(--md-sys-color-primary)" : "1px solid rgba(255,255,255,0.12)",
                              background: active ? (tier.id === "4k" ? "rgba(168, 85, 247, 0.25)" : "rgba(59, 130, 246, 0.2)") : "rgba(255,255,255,0.04)",
                              color: active ? (tier.id === "4k" ? "#c084fc" : "#60a5fa") : "var(--md-sys-color-outline)",
                              cursor: isGenerating ? "not-allowed" : "pointer"
                            }}
                          >
                            {tier.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px", marginBottom: "8px" }}>
                    {STUDIO_ASPECT_RATIOS.map((ratio) => {
                      const is4K = chosenImageModel?.isCloud && (constraints.width || 512) >= 3000;
                      const is2K = chosenImageModel?.isCloud && (constraints.width || 512) >= 1800 && (constraints.width || 512) < 3000;
                      const isSDXL = (constraints.width || 512) >= 900 && (constraints.width || 512) < 1800;
                      let rw = ratio.width;
                      let rh = ratio.height;
                      let currentTier = "sd15";
                      if (is4K) { rw = ratio.uhd_width; rh = ratio.uhd_height; currentTier = "4k"; }
                      else if (is2K) { rw = ratio.qhd_width; rh = ratio.qhd_height; currentTier = "2k"; }
                      else if (isSDXL) { rw = ratio.sdxl_width; rh = ratio.sdxl_height; currentTier = "sdxl"; }
                      const isActive = Math.abs(constraints.width - rw) < 24 && Math.abs(constraints.height - rh) < 24;
                      return (
                        <button
                          key={ratio.id}
                          type="button"
                          className={`m3-btn ${isActive ? "m3-btn-filled" : "m3-btn-outlined"}`}
                          onClick={() => applyStudioAspectRatio(ratio.id, currentTier)}
                          disabled={isGenerating}
                          style={{ padding: "6px 4px", height: "auto", display: "flex", flexDirection: "column", gap: "2px", fontSize: "0.75rem" }}
                        >
                          <span style={{ fontWeight: 700 }}>{ratio.label}</span>
                          <span style={{ fontSize: "0.66rem", opacity: 0.85 }}>{rw}×{rh}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <div>
                      <label style={{ fontSize: "0.7rem", color: "var(--md-sys-color-outline)", display: "block", marginBottom: "2px" }}>
                        Genişlik (Width px)
                      </label>
                      <input
                        type="number"
                        className="m3-input"
                        value={constraints.width}
                        onChange={(e) => updateConstraint("width", Math.max(256, Math.min(2048, Math.round((parseInt(e.target.value) || 512) / 64) * 64)))}
                        min="256"
                        max={chosenImageModel?.isCloud ? "4096" : "1344"}
                        step="64"
                        disabled={isGenerating}
                        style={{ padding: "6px 10px", fontSize: "0.8rem" }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "0.7rem", color: "var(--md-sys-color-outline)", display: "block", marginBottom: "2px" }}>
                        Yükseklik (Height px)
                      </label>
                      <input
                        type="number"
                        className="m3-input"
                        value={constraints.height}
                        onChange={(e) => updateConstraint("height", Math.max(256, Math.min(2048, Math.round((parseInt(e.target.value) || 512) / 64) * 64)))}
                        min="256"
                        max={chosenImageModel?.isCloud ? "4096" : "1344"}
                        step="64"
                        disabled={isGenerating}
                        style={{ padding: "6px 10px", fontSize: "0.8rem" }}
                      />
                    </div>
                  </div>
                  {chosenImageModel?.isCloud ? (
                    <div style={{ marginTop: "6px", fontSize: "0.72rem", color: "#60a5fa", display: "flex", alignItems: "center", gap: "6px" }}>
                      <CheckCircle2 size={13} />
                      <span>[Bulut API 4K Modu Aktif]: 2K (1440p) ve 4K Ultra HD (4096px) bulut sunucularında yüksek kalitede üretilebilir.</span>
                    </div>
                  ) : (
                    <div style={{ marginTop: "6px", fontSize: "0.72rem", color: "var(--md-sys-color-outline)", display: "flex", alignItems: "center", gap: "6px" }}>
                      <AlertTriangle size={13} style={{ color: "#f59e0b" }} />
                      <span>[Yerel Donanım Koruması]: Ekran kartınızın VRAM belleğini korumak için 2K/4K kilitlenmiştir (Maksimum 1024x1024 SDXL).</span>
                    </div>
                  )}
                  <div style={{ fontSize: "0.7rem", color: "var(--md-sys-color-outline)", marginTop: "4px" }}>
                    Görselin çerçeve oranını ve piksel boyutunu belirler. SD 1.5 modelleri 512px, SDXL modelleri 1024px taban ölçekte en yüksek netliği verir.
                  </div>
                </div>

                {/* 2. Adım Sayısı (Steps) & 3. CFG Ölçeği (CFG Scale) */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.78rem", marginBottom: "4px" }}>
                      <span style={{ fontWeight: 600 }}>Detay Adımı (Steps)</span>
                      <span style={{ fontWeight: 700, color: "var(--md-sys-color-primary)" }}>{constraints.steps}</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="50"
                      step="1"
                      value={constraints.steps}
                      onChange={(e) => updateConstraint("steps", parseInt(e.target.value) || 20)}
                      disabled={isGenerating}
                      style={{ width: "100%", cursor: isGenerating ? "not-allowed" : "pointer" }}
                    />
                    <div style={{ fontSize: "0.68rem", color: "var(--md-sys-color-outline)", marginTop: "2px", lineHeight: 1.35 }}>
                      Görüntünün kaç adımda işleneceği. Lightning modellerde 4-6, standart modellerde 20-30 adım önerilir.
                    </div>
                  </div>

                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.78rem", marginBottom: "4px" }}>
                      <span style={{ fontWeight: 600 }}>İstem Uyumu (CFG Ölçeği)</span>
                      <span style={{ fontWeight: 700, color: "var(--md-sys-color-primary)" }}>{Number(constraints.cfgScale || 1.0).toFixed(1)}</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="15"
                      step="0.5"
                      value={constraints.cfgScale || 1.0}
                      onChange={(e) => updateConstraint("cfgScale", parseFloat(e.target.value) || 1.0)}
                      disabled={isGenerating}
                      style={{ width: "100%", cursor: isGenerating ? "not-allowed" : "pointer" }}
                    />
                    <div style={{ fontSize: "0.68rem", color: "var(--md-sys-color-outline)", marginTop: "2px", lineHeight: 1.35 }}>
                      Modelin isteminize bağlılığı. Lightning için 1.0-2.0, standart SDXL/SD 1.5 için 5.0-7.5 idealdir.
                    </div>
                  </div>
                </div>

                {/* 4. Örnekleyici (Sampler) & 5. Tohum (Seed) */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <div>
                    <label style={{ fontSize: "0.76rem", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                      Örnekleyici (Sampler)
                    </label>
                    <select
                      className="m3-input"
                      value={normalizeSdSampler(constraints.sampler)}
                      onChange={(e) => updateConstraint("sampler", e.target.value)}
                      disabled={isGenerating}
                      style={{ width: "100%", padding: "7px 10px", fontSize: "0.78rem", background: "#161824", color: "#f8fafc", colorScheme: "dark", cursor: "pointer" }}
                    >
                      <option value="euler_a">Euler Ancestral (euler_a - Hızlı & Canlı)</option>
                      <option value="euler">Euler (euler - Dengeli & Kararlı)</option>
                      <option value="dpm++2m">DPM++ 2M (dpm++2m - Yüksek Detay)</option>
                      <option value="dpm++2mv2">DPM++ 2M v2 (dpm++2mv2 - Net Kontrast)</option>
                      <option value="dpm++2s_a">DPM++ 2S Ancestral (dpm++2s_a - Fotogerçekçi)</option>
                      <option value="er_sde">ER-SDE (er_sde - Stüdyo Fotogerçekçilik)</option>
                      <option value="heun">Heun (heun - Hassas Dokular)</option>
                      <option value="ddim_trailing">DDIM Trailing (ddim_trailing - Klasik)</option>
                      <option value="lcm">LCM (lcm - 4-8 Adım Hızlı)</option>
                    </select>
                    <div style={{ fontSize: "0.68rem", color: "var(--md-sys-color-outline)", marginTop: "3px", lineHeight: 1.35 }}>
                      Gürültü çözme algoritması. SD 1.5 için Euler Ancestral, Lightning/Turbo için Euler önerilir.
                    </div>
                    <label style={{ fontSize: "0.76rem", fontWeight: 600, display: "block", margin: "8px 0 4px" }}>
                      Zamanlayıcı (Scheduler)
                    </label>
                    <select
                      className="m3-input"
                      value={normalizeSdScheduler(constraints.scheduler)}
                      onChange={(e) => updateConstraint("scheduler", e.target.value)}
                      disabled={isGenerating}
                      style={{ width: "100%", padding: "7px 10px", fontSize: "0.78rem", background: "#161824", color: "#f8fafc", colorScheme: "dark", cursor: "pointer" }}
                    >
                      <option value="">Otomatik (model varsayılanı)</option>
                      <option value="sgm_uniform">SGM Uniform (Lightning / Turbo için)</option>
                      <option value="karras">Karras (DPM++ 2M ile önerilir)</option>
                      <option value="discrete">Discrete (klasik)</option>
                      <option value="exponential">Exponential</option>
                      <option value="simple">Simple</option>
                      <option value="ays">Align Your Steps (AYS)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: "0.76rem", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                      Tohum Değeri (Seed)
                    </label>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <input
                        type="number"
                        className="m3-input"
                        value={constraints.seed}
                        onChange={(e) => updateConstraint("seed", parseInt(e.target.value) || -1)}
                        placeholder="-1 (Rastgele)"
                        disabled={isGenerating}
                        style={{ flex: 1, minWidth: 0, padding: "7px 10px", fontSize: "0.78rem" }}
                      />
                      <button
                        type="button"
                        className="m3-btn m3-btn-tonal"
                        onClick={() => updateConstraint("seed", -1)}
                        disabled={isGenerating}
                        title="Her üretimde farklı kompozisyon için -1 (Rastgele) yap"
                        style={{ padding: "0 10px", fontSize: "0.72rem", height: "34px", flexShrink: 0 }}
                      >
                        Rastgele
                      </button>
                    </div>
                    <div style={{ fontSize: "0.68rem", color: "var(--md-sys-color-outline)", marginTop: "3px", lineHeight: 1.35 }}>
                      -1 her seferinde yeni görsel üretir; sabit sayı aynı kompozisyonu korur.
                    </div>
                  </div>
                </div>

                {/* 6. Negatif İstem (Negative Prompt) */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                    <label style={{ fontSize: "0.76rem", fontWeight: 600 }}>
                      Negatif İstem (Negative Prompt - İstenmeyen Öğeler)
                    </label>
                    <button
                      type="button"
                      onClick={() => setNegativePrompt("blurry, low quality, lowres, bad anatomy, deformed hands, extra fingers, watermark, text, signature, cropped, worst quality")}
                      disabled={isGenerating}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--md-sys-color-primary)",
                        fontSize: "0.7rem",
                        fontWeight: 600,
                        cursor: isGenerating ? "not-allowed" : "pointer",
                        padding: 0
                      }}
                    >
                      + Standart Kalite Filtresi Ekle
                    </button>
                  </div>
                  <input
                    type="text"
                    className="m3-input"
                    value={negativePrompt || ""}
                    onChange={(e) => setNegativePrompt(e.target.value)}
                    placeholder="Görselde istemediğiniz kusurlar (ör. blurry, low quality, deformed, watermark)..."
                    disabled={isGenerating}
                    style={{ width: "100%", padding: "7px 10px", fontSize: "0.78rem" }}
                  />
                  <div style={{ fontSize: "0.68rem", color: "var(--md-sys-color-outline)", marginTop: "3px" }}>
                    Görselde yer almasını istemediğiniz bozuklukları veya nesneleri hariç tutar.
                  </div>
                </div>
              </div>

              {/* Generate or Download Trigger Button */}
              {chosenImageModel && !chosenImageModel.installed && !chosenImageModel.isCloud ? (
                <button
                  type="button"
                  className="btn-beam"
                  style={{ width: "100%", height: "52px", marginTop: "10px", background: "rgba(245, 158, 11, 0.2)", borderColor: "#f59e0b" }}
                  onClick={() => handleDownloadDirect(chosenImageModel)}
                  title="Modeli bilgisayarınıza indirin"
                >
                  <div className="btn-content" style={{ color: "#f59e0b", fontWeight: 700, gap: "8px" }}>
                    <Download size={18} />
                    <span>Modeli İndir ve Hazırla ({chosenImageModel.approxSize || "6.6 GB"})</span>
                  </div>
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-beam"
                  style={{ width: "100%", height: "52px", marginTop: "10px" }}
                  onClick={() => {
                    if (isGenerating) return;
                    if (!prompt.trim()) {
                      showAlert({
                        title: uiText("İstem (Prompt) Eksik", "Prompt Missing"),
                        message: uiText("Lütfen üretmek istediğiniz görseli anlatan bir istem (prompt) yazın.", "Please write a prompt describing the image you want."),
                        danger: false
                      });
                      return;
                    }
                    handleGenerate();
                  }}
                  disabled={isGenerating}
                  title="Görsel üretimini başlat (Üzerine geldiğinizde lazer ışığı döner)"
                >
                  <div className="btn-content">
                    <Sparkles size={18} />
                    <span>
                      {isGenerating
                        ? "Görsel Üretiliyor..."
                        : baseImage
                        ? "Temel Görselden Üret (Image-to-Image)"
                        : "Görseli Üret (Generate Image)"}
                    </span>
                  </div>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right Side: Image Output Preview */}
        <div className="m3-card output-panel">
          {outputImage && !isGenerating && (
            <div style={{
              width: "100%",
              marginBottom: "14px",
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
                    background: "var(--md-sys-color-primary, #3b82f6)",
                    padding: "2px 8px",
                    borderRadius: "6px",
                    fontSize: "0.72rem",
                    letterSpacing: "0.03em"
                  }}>
                    GÖRSEL MODELİ
                  </span>
                  <strong style={{ color: "var(--md-sys-color-on-surface)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={currentMetadata?.model || activeModel || "Standart Model"}>
                    {currentMetadata?.model || activeModel || "Standart Model"}
                  </strong>
                </div>
                {(genDuration || currentMetadata?.duration_sec) && (
                  <div style={{ display: "flex", alignItems: "center", gap: "4px", color: "#10b981", fontWeight: 700, fontSize: "0.82rem" }}>
                    <span>{typeof (currentMetadata?.duration_sec ?? genDuration) === "number" ? (currentMetadata?.duration_sec ?? genDuration).toFixed(1) : (currentMetadata?.duration_sec ?? genDuration)}s üretim süresi</span>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", color: "var(--md-sys-color-outline)", fontSize: "0.78rem" }}>
                <div title="Görsel Çözünürlüğü / Ölçeği">
                  <span style={{ fontWeight: 600, color: "var(--md-sys-color-on-surface-variant)" }}>Ölçek:</span> {currentMetadata?.width || constraints.width} × {currentMetadata?.height || constraints.height} px
                </div>
                <span>•</span>
                <div title="Örnekleme Adım Sayısı">
                  <span style={{ fontWeight: 600, color: "var(--md-sys-color-on-surface-variant)" }}>Adım:</span> {currentMetadata?.steps || constraints.steps}
                </div>
                <span>•</span>
                <div title="CFG Ölçeği">
                  <span style={{ fontWeight: 600, color: "var(--md-sys-color-on-surface-variant)" }}>CFG:</span> {currentMetadata?.cfgScale || constraints.cfgScale}
                </div>
                <span>•</span>
                <div title="Örnekleyici (Sampler)">
                  <span style={{ fontWeight: 600, color: "var(--md-sys-color-on-surface-variant)" }}>Örnekleyici:</span> {currentMetadata?.sampler || constraints.sampler}
                </div>
                <span>•</span>
                <div title="Rastgele Tohum (Seed)">
                  <span style={{ fontWeight: 600, color: "var(--md-sys-color-on-surface-variant)" }}>Seed:</span> {currentMetadata?.seed ?? outputSeed ?? "Rastgele"}
                </div>
                {(currentMetadata?.mode || baseImage) && (
                  <>
                    <span>•</span>
                    <div style={{ color: "var(--md-sys-color-primary)", fontWeight: 600 }}>
                      {currentMetadata?.mode === "img2img" || baseImage ? "img2img (Görselden)" : "txt2img (Metinden)"}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
          <div className="output-image-container">
            {isGenerating || isCancelling || isRestartingBackend ? (
              <div className="progress-overlay">
                {isRestartingBackend ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", padding: "20px" }}>
                    <div className="progress-spinner"></div>
                    <div className="progress-text" style={{ fontSize: "1.1rem", fontWeight: 700, textAlign: "center" }}>
                      Syncing Settings & Initializing...
                    </div>
                    {restartLoadProgress ? (
                      <div style={{ width: "min(360px, 90%)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "0.82rem", fontWeight: 700, marginBottom: "6px" }}>
                          <span>
                            {restartLoadProgress.phase}
                            {restartLoadProgress.speed ? ` (${restartLoadProgress.speed})` : ""}
                          </span>
                          <span>
                            {restartLoadProgress.total > 0
                              ? `Loaded ${restartLoadProgress.current} / ${restartLoadProgress.total} tensors`
                              : `${Math.round(restartLoadProgress.progress)}%`}
                          </span>
                        </div>
                        <div className="progress-bar-container" style={{ margin: 0 }}>
                          <div
                            className="progress-bar-fill"
                            style={{ width: `${Math.min(100, Math.max(0, restartLoadProgress.progress))}%`, transition: "width 0.25s ease" }}
                          ></div>
                        </div>
                        {(restartLoadProgress.backendMode || restartLoadProgress.device) && (
                          <div style={{ fontSize: "0.78rem", opacity: 0.8, textAlign: "center", marginTop: "8px" }}>
                            Loading on {restartLoadProgress.backendMode || "backend"}{restartLoadProgress.device ? `  ${restartLoadProgress.device}` : ""}
                          </div>
                        )}
                      </div>
                    ) : (
                      <p style={{ fontSize: "0.85rem", opacity: 0.8, textAlign: "center", maxWidth: "280px", margin: 0 }}>
                        Adjusting inference settings and restarting the local model server.
                      </p>
                    )}
                  </div>
                ) : isCancelling ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", padding: "20px" }}>
                    <div className="progress-spinner"></div>
                    <div className="progress-text" style={{ fontSize: "1.1rem", fontWeight: 700, textAlign: "center" }}>
                      Cancelling Generation...
                    </div>
                    <p style={{ fontSize: "0.85rem", opacity: 0.8, textAlign: "center", maxWidth: "280px", margin: 0 }}>
                      Stopping CPU/GPU execution threads and reloading model weights. Please wait a moment.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="progress-spinner"></div>
                    <div className="progress-text" style={{ fontSize: "1.1rem", fontWeight: 700 }}>
                      {isDecoding ? "Decoding Latents..." : "Generating Locally..."}
                    </div>
                    
                    {isCpuFallback && (
                      <div style={{ fontSize: "0.8rem", color: "var(--md-sys-color-primary)", fontWeight: 600, background: "var(--md-sys-color-primary-container)", padding: "4px 12px", borderRadius: "12px", margin: "4px 0 8px 0", animation: "pulse 2s infinite" }}>
                         CPU Fallback Detected (Running Slower)
                      </div>
                    )}

                    {/* Real-time stats display */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", width: "80%", margin: "8px 0 0 0", fontSize: "0.85rem", opacity: 0.9 }}>
                      <div style={{ textAlign: "left" }}>
                        <strong>Step:</strong> {currentStep} / {constraints.steps} ({Math.max(0, constraints.steps - currentStep)} left)
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <strong>Elapsed:</strong> {elapsedTime}s{generationSpeed && ` (${generationSpeed === "decoding" ? "decoding" : generationSpeed})`}
                      </div>
                    </div>

                    <div className="progress-bar-container" style={{ margin: "4px 0 10px 0" }}>
                      <div
                        className="progress-bar-fill"
                        style={{ width: `${generationProgress}%`, transition: "width 1s linear" }}
                      ></div>
                    </div>
                    
                    <div style={{ fontSize: "0.85rem", opacity: 0.8, display: "flex", gap: "8px", alignItems: "center" }}>
                      <span>Progress: {generationProgress}%</span>
                      <span></span>
                      <span>Est. remaining: {estimatedLeftTime}s</span>
                    </div>

                    <button 
                      className="m3-btn m3-btn-error" 
                      style={{ marginTop: "16px", height: "36px", padding: "0 24px" }}
                      onClick={handleCancelGeneration}
                    >
                      Stop Generating
                    </button>
                  </>
                )}
              </div>
            ) : outputImage ? (
              <>
                <img
                  src={outputImage}
                  className="output-image"
                  alt="Generated Output"
                  title={[
                    `Model: ${formatImageModelName(currentMetadata?.model || activeModel || "Standart Model")}`,
                    `Boyut: ${currentMetadata?.width || constraints.width} × ${currentMetadata?.height || constraints.height} px | Adım: ${currentMetadata?.steps || constraints.steps} | CFG: ${currentMetadata?.cfgScale || constraints.cfgScale} | Örnekleyici: ${currentMetadata?.sampler || constraints.sampler}`,
                    `Seed: ${currentMetadata?.seed ?? outputSeed ?? "Rastgele"} | Üretim Süresi: ${typeof (currentMetadata?.duration_sec ?? genDuration) === "number" ? (currentMetadata?.duration_sec ?? genDuration).toFixed(1) + "s" : "-"}`,
                    `Prompt: ${currentMetadata?.prompt || prompt || "-"}`
                  ].join("\n")}
                />
                <div className="output-image-meta-overlay">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                    <strong style={{ color: "#a78bfa", fontSize: "0.8rem" }}>
                      {formatImageModelName(currentMetadata?.model || activeModel || "Standart Model")}
                    </strong>
                    {(currentMetadata?.duration_sec ?? genDuration) && (
                      <span style={{ color: "#10b981", fontWeight: 700, fontSize: "0.74rem" }}>
                        {typeof (currentMetadata?.duration_sec ?? genDuration) === "number" ? (currentMetadata?.duration_sec ?? genDuration).toFixed(1) : (currentMetadata?.duration_sec ?? genDuration)}s
                      </span>
                    )}
                  </div>
                  <div style={{ color: "#cbd5e1", fontSize: "0.73rem", marginBottom: "4px" }}>
                    Boyut: <strong>{currentMetadata?.width || constraints.width} × {currentMetadata?.height || constraints.height} px</strong> • Adım: <strong>{currentMetadata?.steps || constraints.steps}</strong> • CFG: <strong>{currentMetadata?.cfgScale || constraints.cfgScale}</strong> • Sampler: <strong>{currentMetadata?.sampler || constraints.sampler}</strong> • Seed: <strong>{currentMetadata?.seed ?? outputSeed ?? "Rastgele"}</strong>
                  </div>
                  {(currentMetadata?.prompt || prompt) && (
                    <div style={{ color: "#f8fafc", fontSize: "0.72rem", opacity: 0.92, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      <strong>Prompt:</strong> {currentMetadata?.prompt || prompt}
                    </div>
                  )}
                </div>
              </>
            ) : errorMsg ? (
              <div style={{ textAlign: "center", padding: "24px", color: "var(--md-sys-color-error)", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
                <div style={{ background: "rgba(239, 68, 68, 0.1)", padding: "16px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: "bold" }}>Uretim Basarisiz</h3>
                <p style={{ margin: 0, fontSize: "0.95rem", opacity: 0.9, maxWidth: "320px", lineHeight: "1.4" }}>
                  {errorMsg}
                </p>
                <div style={{ marginTop: "8px", fontSize: "0.85rem", opacity: 0.8, color: "var(--md-sys-color-on-surface-variant)" }}>
                  Hint: Try lowering the resolution in the <strong>Gorsel Constraints</strong> settings (e.g., to 512x512).
                </div>
              </div>
            ) : (
              <div className="apple-glass-empty-portal">
                <div className="apple-glass-hero-bg" style={{ backgroundImage: "url('/apple_glass_hero.jpg')" }} />
                <div className="apple-glass-hero-overlay" />
                <div className="apple-glass-hero-card">
                  <div className="apple-glass-emblem-wrap">
                    <img src="/logo.png?v=2" alt="Crystal Logo" className="apple-glass-emblem" />
                    <div className="apple-glass-emblem-sheen" />
                  </div>
                  <div className="apple-glass-hero-badge">
                    <Sparkles size={13} className="hero-sparkle-icon" />
                    <span>DD:YZ Liquid Glass Studio</span>
                  </div>
                  <h3 className="apple-glass-hero-title">Ultra-HD Yerel Yapay Zekâ Kanvası</h3>
                  <p className="apple-glass-hero-desc">
                    Sıfır bulut bağımlılığı. Tamamen yerel donanımınızla yüksek kaliteli fotogerçekçi, sinematik ve sanatsal dijital görseller üretin.
                  </p>
                  <div className="apple-glass-prompt-suggestions">
                    <span className="suggestion-label">Hızlı İlham (En Yüksek Kalite İçin İngilizce İstemler):</span>
                    <button
                      type="button"
                      className="glass-suggestion-pill"
                      onClick={() => setPrompt("Futuristic cyberpunk metropolis at night, crystal glass skyscrapers, neon hologram reflections on wet asphalt, volumetric cinematic lighting, photorealistic, 8k resolution, highly detailed, masterpiece")}
                      title="Siberpunk Şehir İstemi (İngilizce)"
                    >
                       Siberpunk Kristal Şehir (Cyberpunk City)
                    </button>
                    <button
                      type="button"
                      className="glass-suggestion-pill"
                      onClick={() => setPrompt("Intricate optical crystal glass prism sculpture, chromatic dispersion, internal quantum light rays, clean dark background, studio lighting, sharp focus, 8k octane render, hyperdetailed")}
                      title="Prizma Kristal Sanatı İstemi (İngilizce)"
                    >
                       Prizmatik Kristal Sanatı (Prism Art)
                    </button>
                    <button
                      type="button"
                      className="glass-suggestion-pill"
                      onClick={() => setPrompt("Bioluminescent cosmic celestial flower floating in deep space, glowing nebula clouds, stardust particles, vibrant colors, cinematic space art, ultra high resolution")}
                      title="Kozmik Nebula Çiçeği İstemi (İngilizce)"
                    >
                       Biyolüminesans Nebula (Cosmic Flower)
                    </button>
                    <button
                      type="button"
                      className="glass-suggestion-pill"
                      onClick={() => setPrompt("Cinematic portrait of a futuristic explorer with subtle neon rim light, detailed eyes, 85mm lens photography, natural skin texture, bokeh background, dramatic lighting, photorealistic")}
                      title="Sinematik Portre İstemi (İngilizce)"
                    >
                       Sinematik Portre (Cinematic Portrait)
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {outputImage && !isGenerating && (
            <div className="image-actions">
              <button className="m3-btn m3-btn-tonal" onClick={handleCopyImage}>
                {copySuccess ? <Check size={16} /> : <Copy size={16} />}
                <span>{copySuccess ? "Copied" : "Copy"}</span>
              </button>
              <button
                className="m3-btn m3-btn-outlined"
                onClick={() => handleRevealFolder({ url: outputImage, image: currentMetadata?.image, type: "image" }, "main_image")}
                title="Görseli klasöründe göster"
              >
                {openedFolderKey === "main_image" ? (
                  <>
                    <Check size={16} style={{ color: "#10b981" }} />
                    <span style={{ color: "#10b981" }}>Klasör Açıldı</span>
                  </>
                ) : (
                  <>
                    <FolderOpen size={16} />
                    <span>Klasöre Git</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* History / Gallery Grid */}
      <div className="gallery-section">
        <div className="gallery-header">
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <h3 className="m3-card-title" style={{ marginBottom: 0 }}>Recent Çıktılar Galerisi</h3>
            <button
              type="button"
              className="m3-btn m3-btn-outlined"
              style={{ padding: "4px 10px", fontSize: "12px", height: "auto" }}
              onClick={() => handleRevealFolder({ folder: "image" }, "gallery_header")}
              title="Görsel çıktıları klasörünü aç"
            >
              {openedFolderKey === "gallery_header" ? (
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
          {selectedGalleryItems.length > 0 && (
            <div className="gallery-selection-actions">
              <span className="gallery-selection-count">{selectedGalleryItems.length} selected</span>
              <button className="m3-btn m3-btn-tonal" onClick={useSelectedGalleryItem}>
                <Check size={14} />
                <span>Kullan</span>
              </button>
              <button
                className="m3-btn m3-btn-outlined"
                onClick={() => {
                  const first = selectedGalleryItems[0];
                  handleRevealFolder({ url: first?.url, image: first?.image, type: "image" }, "gallery_selected");
                }}
                title="Seçilen görseli klasöründe göster"
              >
                {openedFolderKey === "gallery_selected" ? (
                  <>
                    <Check size={14} style={{ color: "#10b981" }} />
                    <span style={{ color: "#10b981" }}>Açıldı</span>
                  </>
                ) : (
                  <>
                    <FolderOpen size={14} />
                    <span>Klasöre Git</span>
                  </>
                )}
              </button>
              <button className="m3-btn m3-btn-error" onClick={deleteSelectedGalleryItems}>
                <Trash2 size={14} />
                <span>Sil</span>
              </button>
              <button className="m3-btn m3-btn-outlined" onClick={clearGallerySelection}>
                Clear
              </button>
            </div>
          )}
        </div>
        {generatedImages.length === 0 ? (
          <div className="m3-card gallery-empty">
            No images generated in this session yet. Everything will be saved directly on your external drive.
          </div>
        ) : (
          <>
            <div className="gallery-hint">Click to sec one gorsel. Ctrl-click or Shift-click to sec multiple.</div>
            <div className="gallery-grid">
              {generatedImages.map((img, idx) => (
                <GalleryItem
                  key={img.image || idx}
                  img={img}
                  idx={idx}
                  isSelected={selectedGalleryIndexes.includes(idx)}
                  onClick={toggleGallerySelection}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default memo(Generator);
