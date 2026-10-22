import React, { memo, useEffect, useState, useCallback } from "react";
import { uiText } from "../i18n";
import {
  Crop, Sliders, Cpu, Info, MessageSquare, SlidersHorizontal, Zap,
  ChevronDown, Image, Type, Settings2, Gauge, Brain, Sparkles,
  Monitor, HardDrive, MemoryStick, Thermometer, Hash, Layers,
  ChevronRight, Box, Wand2, Lightbulb, RotateCcw, Check, Palette, Volume2,
  DownloadCloud, RefreshCw, ExternalLink, ShieldCheck, Globe
} from "lucide-react";
import {
  stopServer,
  formatBytes,
  normalizeSdSampler,
  normalizeSdScheduler,
  getLlmBackends,
  getLlmStats,
  getLlmStatus,
  benchmarkLlm,
  startLlm,
  stopLlm,
  downloadBackend,
  getDownloadProgress,
  getBackendOptions,
  checkAppUpdate,
  applyAppUpdate,
} from "../services/api";
import { THEMES } from "../themes";

const ASPECT_RATIOS = [
  { id: "1:1", label: "1:1 Square", width: 512, height: 512, sdxl_width: 1024, sdxl_height: 1024, desc: "Social posts & avatars" },
  { id: "4:3", label: "4:3 Photo", width: 640, height: 512, sdxl_width: 1152, sdxl_height: 896, desc: "Classic photo look" },
  { id: "16:9", label: "16:9 Landscape", width: 768, height: 448, sdxl_width: 1344, sdxl_height: 768, desc: "Widescreen landscape" },
  { id: "9:16", label: "9:16 Portrait", width: 448, height: 768, sdxl_width: 768, sdxl_height: 1344, desc: "Tall phone screen" }
];

const isSD15OrCustomModel = (modelName) => {
  if (!modelName) return true;
  const name = modelName.toLowerCase();
  if (name.includes("flux") || name.includes("schnell")) return false;
  if (name.includes("sdxl") || name.includes("lightning") || name.includes("turbo")) return false;
  if (name.includes("sd3")) return false;
  return true;
};

// --- Collapsible Card Component ---
function CollapsibleCard({ icon: Icon, title, subtitle, children, defaultExpanded = false, id, badge, badgeColor }) {
  const [isExpanded, setIsExpanded] = useState(() => {
    const saved = localStorage.getItem(`settings_card_${id}`);
    return saved !== null ? saved === "true" : defaultExpanded;
  });

  const toggle = useCallback(() => {
    const newState = !isExpanded;
    setIsExpanded(newState);
    localStorage.setItem(`settings_card_${id}`, String(newState));
  }, [isExpanded, id]);

  return (
    <div className="collapsible-card">
      <button
        className="collapsible-header"
        onClick={toggle}
        aria-expanded={isExpanded}
        type="button"
      >
        <div className="collapsible-header-left">
          <div className="collapsible-header-icon">
            <Icon size={18} />
          </div>
          <div>
            <div className="collapsible-header-title">
              {title}
              {badge && (
                <span 
                  className="collapsible-header-badge" 
                  style={{ 
                    background: badgeColor || "var(--md-sys-color-primary-container)",
                    color: badgeColor ? "#fff" : "var(--md-sys-color-on-primary-container)"
                  }}
                >
                  {badge}
                </span>
              )}
            </div>
            {subtitle && <div className="collapsible-header-subtitle">{subtitle}</div>}
          </div>
        </div>
        <div className="collapsible-header-right">
          <ChevronDown
            size={20}
            className={`collapsible-chevron ${isExpanded ? "expanded" : ""}`}
          />
        </div>
      </button>
      {isExpanded && (
        <div className="collapsible-content">
          {children}
        </div>
      )}
    </div>
  );
}

// --- Hardware Tier Badge Component ---
function HardwareTierBadge({ specs }) {
  if (!specs?.tier) return null;

  const tierConfig = {
    high: { icon: "", label: "Yuksek Performansli PC", color: "tier-high", accent: "#22c55e" },
    mid: { icon: "", label: "Dengeli PC", color: "tier-mid", accent: "#3b82f6" },
    low: { icon: "", label: "Dusuk Performansli PC", color: "tier-low", accent: "#f59e0b" },
  };

  const tier = tierConfig[specs.tier] || tierConfig.low;
  const rec = specs.recommended_text_settings;

  return (
    <div className={`hardware-tier-badge ${tier.color}`}>
      <div className="hardware-tier-header">
        <div className="hardware-tier-icon">{tier.icon}</div>
        <div className="hardware-tier-info">
          <div className="hardware-tier-name">{tier.label}</div>
          <div className="hardware-tier-specs">
            {specs.cpu_name}  {specs.cpu_cores_physical} cores  {specs.ram_total_gb}GB RAM
            {specs.gpu_name && specs.gpu_name !== "Loading..." && `  ${specs.gpu_name}`}
            {specs.gpu_vram_gb > 0 && `  ${specs.gpu_vram_gb}GB VRAM`}
          </div>
        </div>
      </div>
      {rec && (
        <>
          <div className="hardware-tier-divider" />
          <div className="hardware-tier-chips">
            <span className="hardware-tier-chip">Ctx: {rec.contextSize}</span>
            <span className="hardware-tier-chip">Threads: {rec.threads}</span>
            <span className="hardware-tier-chip">KV: {rec.cacheTypeK}</span>
            <span className="hardware-tier-chip">Batch: {rec.batchSize}</span>
            <span className="hardware-tier-chip">Profile: {rec.performanceProfile}</span>
          </div>
        </>
      )}
    </div>
  );
}

// --- Premium Toggle Component ---
function PremiumToggle({ checked, onChange, label, description }) {
  return (
    <label className="premium-toggle" style={{ cursor: "pointer" }}>
      <div
        className={`premium-toggle-checkbox ${checked ? "checked" : ""}`}
        onClick={() => onChange(!checked)}
        role="checkbox"
        aria-checked={checked}
      >
        {checked && <Check size={14} />}
      </div>
      <div style={{ flex: 1 }}>
        <div className="premium-toggle-label">{label}</div>
        {description && <div className="premium-toggle-desc">{description}</div>}
      </div>
    </label>
  );
}

// --- Section Header Component ---
function SectionHeader({ icon: Icon, title, count, color, isExpanded, onToggle }) {
  return (
    <div
      className="settings-section-header"
      style={{
        borderLeftColor: color,
        cursor: "pointer",
        userSelect: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      aria-expanded={isExpanded}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "14px", flex: 1 }}>
        <div className="settings-section-icon" style={{ background: color + "15", color }}>
          <Icon size={22} />
        </div>
        <div className="settings-section-title">{title}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        {count && (
          <span className="settings-section-count">{count} ayar</span>
        )}
        <ChevronDown
          size={20}
          style={{
            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.3s var(--md-transition-easing)",
            color: isExpanded ? "var(--md-sys-color-primary)" : "var(--md-sys-color-outline)",
            flexShrink: 0
          }}
        />
      </div>
    </div>
  );
}

const getSliderStyle = (value, min, max) => {
  const v = Number(value);
  const mn = Number(min);
  const mx = Number(max);
  const pct = mx === mn ? 0 : ((v - mn) / (mx - mn)) * 100;
  return { "--value": `${pct}%` };
};

// --- Main Ayarlar Component ---
function Settings({
  constraints,
  setConstraints,
  activeModel,
  specs,
  backendOptions,
  setBackendOptions,
  serverRunning,
  setServerRunning,
  setActiveModel,
  textSettings,
  setTextSettings,
  speechSettings,
  setSpeechSettings,
  ttsSettings,
  setTtsSettings,
  showAlert = async ({ message }) => window.alert(message),
  showConfirm = async ({ message }) => window.confirm(message),
  health,
  cleanupItems,
  isReadinessBusy,
  refreshReadiness,
  copyDiagnostics,
  cleanupSafeItems,
  diagnosticsCopied,
  theme,
  setTheme,
  fontSize,
  uiLanguage = "tr",
  setUiLanguage,
  setFontSize,
}) {
  const [llmStatus, setLlmStatus] = useState({ ready: false, settings: {} });
  const [llmBackends, setLlmBackends] = useState({ available: [], candidates: [] });
  const [llmStats, setLlmStats] = useState({ benchmarks: [] });
  const [benchmarkBusy, setBenchmarkBusy] = useState(false);
  const [backendDownload, setBackendDownload] = useState({
    active: false,
    backendId: "",
    progress: 0,
    speed: "",
    error: null,
  });

  const [updateInfo, setUpdateInfo] = useState(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateCheckedAt, setUpdateCheckedAt] = useState(null);
  const [isApplyingUpdate, setIsApplyingUpdate] = useState(false);

  const handleApplyUpdate = async (force = false) => {
    setIsApplyingUpdate(true);
    try {
      const res = await applyAppUpdate({ force });
      if (res && res.ok) {
        if (res.alreadyLatest) {
          await showAlert?.({
            title: uiText("Sistem Zaten Güncel", "Already Up to Date"),
            message: res.message || "Yerel sürümünüz zaten en güncel seviyede.",
          });
        } else {
          await showAlert?.({
            title: uiText("Güncelleme Tamamlandı", "Update Complete"),
            message: uiText(
              `${res.message || "Yeni sürüm başarıyla kuruldu. Uygulamayı kapatıp yeniden başlatın."} Arayüz şimdi yenilenecek.`,
              `The update was installed (${res.updatedVersion || ""}, ${res.updatedFilesCount || 0} files). Close the app and start it again (windows.bat on Windows) so every new feature is enabled. The interface will now reload.`
            ),
          });
          window.location.reload();
        }
      } else {
        await showAlert?.({
          title: uiText("Güncelleme Kurulamadı", "Update Could Not Be Installed"),
          message: res?.error || "Güncelleme paketi uygulanırken bir hata oluştu.",
          danger: true,
        });
      }
    } catch (err) {
      await showAlert?.({
        title: uiText("Güncelleme Hatası", "Update Error"),
        message: err.message || "Güncelleme sırasında beklenmeyen bir hata oluştu.",
        danger: true,
      });
    } finally {
      setIsApplyingUpdate(false);
    }
  };

  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    try {
      const data = await checkAppUpdate();
      setUpdateInfo(data);
      setUpdateCheckedAt(new Date().toLocaleTimeString("tr-TR"));
      if (data && data.ok) {
        if (data.updateAvailable) {
          showAlert?.({
            title: uiText("Yeni Güncelleme Mevcut!", "New Update Available!"),
            message: uiText(`Yeni bir sürüm yayınlandı (${data.latestVersion}). Şimdi Otomatik Güncelle butonuyla tek tıkla kurabilirsiniz.`, `A new version was released (${data.latestVersion}). You can install it in one click with the Auto Update button.`),
          });
        } else {
          showAlert?.({
            title: uiText("Sisteminiz Güncel", "Your System Is Up to Date"),
            message: uiText(`Harika! En son kararlı sürümü (${data.currentVersion || "v2.0.0"}) kullanıyorsunuz.`, `Great! You are using the latest stable version (${data.currentVersion || "v2.0.0"}).`),
          });
        }
      } else {
        showAlert?.({
          title: uiText("Güncelleme Kontrolü", "Update Check"),
          message: data?.error || "Güncelleme sunucusuna erişilemedi.",
          danger: true,
        });
      }
    } catch (err) {
      showAlert?.({
        title: uiText("Güncelleme Hatası", "Update Error"),
        message: err.message || "Güncelleme denetimi sırasında hata oluştu.",
        danger: true,
      });
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const [pendingTextSettings, setPendingTextSettings] = useState(textSettings || {});

  useEffect(() => {
    if (textSettings) {
      setPendingTextSettings(textSettings);
    }
  }, [textSettings]);

  const EDITABLE_TEXT_KEYS = [
    "systemPrompt", "contextSize", "temperature", "responseTokenMode", 
    "maxTokens", "seed", "performanceProfile", "threads", 
    "gpuLayers", "batchSize", "cacheTypeK", "cacheTypeV", "preferredBackend"
  ];

  const hasPendingChanges = textSettings && pendingTextSettings && EDITABLE_TEXT_KEYS.some(key => {
    return pendingTextSettings[key] !== textSettings[key];
  });

  const handleSaveTextSettings = async () => {
    try {
      setTextSettings(pendingTextSettings);
      if (llmStatus.ready) {
        await stopLlm();
        setLlmStatus((prev) => ({ ...prev, ready: false, running: false }));
        showAlert({
          title: uiText("Ayarlar Kaydedildi ve Uygulandı", "Settings Saved and Applied"),
          message: uiText("Metin ayarları başarıyla kaydedildi. Değişikliklerin uygulanması için çalışan metin modeli bellekten çıkarıldı.", "Text settings saved. The running text model was unloaded so the changes take effect.")
        });
      } else {
        showAlert({
          title: uiText("Ayarlar Kaydedildi", "Settings Saved"),
          message: uiText("Metin ayarları başarıyla kaydedildi.", "Text settings saved.")
        });
      }
    } catch (err) {
      showAlert({
        title: uiText("Kayıt Başarısız", "Save Failed"),
        message: err.message || String(err),
        danger: true
      });
    }
  };

  const [expandedSections, setExpandedSections] = useState(() => {
    return {
      appearance: localStorage.getItem("settings_section_appearance") === "true",
      image: localStorage.getItem("settings_section_image") === "true",
      text: localStorage.getItem("settings_section_text") === "true",
      speech: localStorage.getItem("settings_section_speech") === "true",
      tts: localStorage.getItem("settings_section_tts") === "true",
    };
  });

  const toggleSection = (section) => {
    setExpandedSections((prev) => {
      const nextState = !prev[section];
      localStorage.setItem(`settings_section_${section}`, String(nextState));
      return { ...prev, [section]: nextState };
    });
  };

  useEffect(() => {
    let cancelled = false;
    const fetchLlmStatus = async () => {
      try {
        const status = await getLlmStatus();
        if (!cancelled) setLlmStatus(status);
      } catch (_) {}
      try {
        const [backends, stats] = await Promise.all([getLlmBackends(), getLlmStats()]);
        if (!cancelled) {
          setLlmBackends(backends);
          setLlmStats(stats);
        }
      } catch (_) {}
    };
    fetchLlmStatus();
    const interval = setInterval(fetchLlmStatus, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const isSD15OrCustom = activeModel ? isSD15OrCustomModel(activeModel) : false;
  const isOpenVinoNpu = constraints.backendType === "openvino-npu";
  const supportsThinking = Boolean(llmStatus.ready && llmStatus.settings?.supportsThinking);
  const availableBackends = backendOptions?.options?.length
    ? backendOptions.options
    : [{ id: "cpu", label: "CPU", available: true }];
  const unavailableBackends = Array.isArray(backendOptions?.unavailable)
    ? backendOptions.unavailable.filter((backend) => !availableBackends.some((available) => available.id === backend.id))
    : [];
  const visibleBackends = [...availableBackends, ...unavailableBackends.map((backend) => ({ ...backend, available: false }))];

  const refreshBackendOptions = useCallback(async () => {
    if (typeof setBackendOptions !== "function") return;
    const nextOptions = await getBackendOptions();
    setBackendOptions(nextOptions);
  }, [setBackendOptions]);

  useEffect(() => {
    refreshBackendOptions().catch(() => {});
    const handleFocus = () => refreshBackendOptions().catch(() => {});
    const handleVisibility = () => {
      if (document.visibilityState === "visible") handleFocus();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshBackendOptions]);

  useEffect(() => {
    if (!backendDownload.active) return undefined;
    let cancelled = false;

    const poll = async () => {
      try {
        const progress = await getDownloadProgress();
        if (cancelled) return;
        setBackendDownload((prev) => ({
          ...prev,
          active: Boolean(progress.active),
          progress: Number(progress.progress ?? prev.progress ?? 0),
          speed: progress.speed || prev.speed || "",
          error: progress.error || null,
        }));

        if (!progress.active && !progress.error) {
          await refreshBackendOptions();
        }
      } catch (err) {
        if (!cancelled) {
          setBackendDownload((prev) => ({
            ...prev,
            active: false,
            error: err.message || "Download failed",
          }));
        }
      }
    };

    poll();
    const interval = setInterval(poll, 700);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [backendDownload.active, refreshBackendOptions]);

  const updateConstraint = (key, value) => {
    setConstraints((prev) => ({
      ...prev,
      [key]: value,
      ...(key === "steps"
        ? isOpenVinoNpu
          ? { npuSteps: value }
          : { standardSteps: value }
        : {}),
    }));
  };

  const updateTextSetting = (key, value) => {
    setPendingTextSettings((prev) => {
      const updated = { ...prev, [key]: value };
      
      // If the user selected a preset performance profile, apply its hardware parameters
      if (key === "performanceProfile") {
        const physCores = specs?.cpu_cores_physical || 8;
        const fallbackPresets = {
          low: {
            contextSize: 2048,
            threads: Math.max(2, Math.floor(physCores / 3)),
            gpuLayers: 16,
            cacheTypeK: "q4_0",
            cacheTypeV: "q4_0",
            flashAttn: false,
            mlock: false,
            mmap: true,
            cachePrompt: true,
            batchSize: 256,
            ubatchSize: 128,
          },
          mid: {
            contextSize: 4096,
            threads: Math.max(4, Math.floor(physCores / 2)),
            gpuLayers: 35,
            cacheTypeK: "q8_0",
            cacheTypeV: "q8_0",
            flashAttn: true,
            mlock: false,
            mmap: true,
            cachePrompt: true,
            batchSize: 512,
            ubatchSize: 256,
          },
          high: {
            contextSize: 8192,
            threads: Math.max(4, physCores),
            gpuLayers: -1,
            cacheTypeK: "f16",
            cacheTypeV: "f16",
            flashAttn: true,
            mlock: true,
            mmap: true,
            cachePrompt: true,
            batchSize: 1024,
            ubatchSize: 512,
          },
        };
        const presets = specs?.recommended_text_settings || {};
        let preset = null;
        if (value === "potato") preset = presets.low || fallbackPresets.low;
        else if (value === "balanced") preset = presets.mid || fallbackPresets.mid;
        else if (value === "high") preset = presets.high || fallbackPresets.high;
        
        if (preset) {
          Object.assign(updated, {
            contextSize: preset.contextSize,
            threads: preset.threads,
            gpuLayers: preset.gpuLayers,
            cacheTypeK: preset.cacheTypeK,
            cacheTypeV: preset.cacheTypeV,
            flashAttn: preset.flashAttn,
            mlock: preset.mlock,
            mmap: preset.mmap,
            cachePrompt: preset.cachePrompt,
            batchSize: preset.batchSize,
            ubatchSize: preset.ubatchSize,
          });
        }
      } else {
        // If the user manually overrides any performance-related ayar, auto-switch profile to "custom"
        const isPerformanceKey = [
          "contextSize", "threads", "gpuLayers", "cacheTypeK", "cacheTypeV",
          "flashAttn", "mlock", "mmap", "cachePrompt", "batchSize", "ubatchSize"
        ].includes(key);
        
        if (isPerformanceKey) {
          updated.performanceProfile = "custom";
        }
      }

      if (!llmStatus.ready) {
        setTextSettings?.(updated);
      }
      
      return updated;
    });
  };

  const updateSpeechSetting = (key, value) => {
    setSpeechSettings((prev) => ({
      ...prev,
      [key]: value
    }));
  };

  const updateTtsSetting = (key, value) => {
    setTtsSettings((prev) => ({
      ...prev,
      [key]: value
    }));
  };

  const buildTextStartOptions = (settings) => ({
    threads: settings?.threads || specs?.cpu_cores_physical || 4,
    contextSize: settings?.contextSize ?? 0,
    gpuLayers: settings?.gpuLayers ?? -1,
    enableThinking: settings?.enableThinking === true,
    flashAttn: settings?.flashAttn,
    cacheTypeK: settings?.cacheTypeK,
    cacheTypeV: settings?.cacheTypeV,
    mlock: settings?.mlock,
    mmap: settings?.mmap,
    cachePrompt: settings?.cachePrompt,
    defragThold: settings?.defragThold,
    batchSize: settings?.batchSize,
    ubatchSize: settings?.ubatchSize,
    performanceProfile: settings?.performanceProfile,
    preferredBackend: settings?.preferredBackend,
  });

  const handleBenchmarkTextBackend = async () => {
    const model = llmStatus.settings?.model;
    if (!model) {
      showAlert({ title: uiText("Metin Modeli Yüklü Değil", "No Text Model Loaded"), message: uiText("Kıyaslama yapmadan önce bir GGUF metin modeli yükleyin.", "Load a GGUF text model before running the benchmark."), danger: true });
      return;
    }
    setBenchmarkBusy(true);
    try {
      const result = await benchmarkLlm(model, {
        contextSize: Math.min(2048, Number(pendingTextSettings?.contextSize) || 2048),
        gpuLayers: pendingTextSettings?.gpuLayers ?? -1,
        includeCpu: true,
      });
      const winner = result.winner;
      showAlert({
        title: winner ? uiText("Kıyaslama Tamamlandı", "Benchmark Complete") : uiText("Kıyaslama Bitti", "Benchmark Finished"),
        message: winner
          ? uiText(`En hızlı arka uç: ${winner.backendMode}, ${Number(winner.predicted_per_second || 0).toFixed(1)} token/sn.`, `Fastest backend: ${winner.backendMode}, ${Number(winner.predicted_per_second || 0).toFixed(1)} tokens/s.`)
          : uiText("Kıyaslama bitti ancak hiçbir arka uç kullanılabilir zaman verisi döndürmedi.", "The benchmark finished but no backend returned usable timing data."),
      });
      const [status, backends, stats] = await Promise.all([getLlmStatus(), getLlmBackends(true), getLlmStats()]);
      setLlmStatus(status);
      setLlmBackends(backends);
      setLlmStats(stats);
    } catch (err) {
      showAlert({ title: uiText("Kıyaslama Başarısız", "Benchmark Failed"), message: err.message || String(err), danger: true });
    } finally {
      setBenchmarkBusy(false);
    }
  };

  const handleThinkingToggle = async (enabled) => {
    const nextSettings = { ...pendingTextSettings, enableThinking: enabled };

    let status = null;
    try {
      status = await getLlmStatus();
    } catch (_) {}
    if (!status?.ready || !status?.settings?.model) {
      setPendingTextSettings(nextSettings);
      setTextSettings(nextSettings);
      return;
    }

    const reload = await showConfirm({
      title: enabled ? uiText("DeepThink ile Yeniden Yüklensin mi?", "Reload With DeepThink?") : uiText("DeepThink Olmadan Yeniden Yüklensin mi?", "Reload Without DeepThink?"),
      message: uiText("DeepThink ayarının yeni yanıtlara yansıması için metin modelinin yeniden yüklenmesi gerekir. Şimdi yeniden yüklensin mi, yoksa atlayıp şu an yüklü model olduğu gibi mi kalsın?", "Changing DeepThink requires reloading the text model before it affects new replies. Reload now, or skip and keep the currently loaded model as-is?"),
      confirmLabel: uiText("Yeniden Yükle", "Reload"),
      cancelLabel: uiText("Atla", "Skip"),
    });
    if (!reload) return;

    try {
      setPendingTextSettings(nextSettings);
      setTextSettings(nextSettings);
      await stopLlm();
      await startLlm(status.settings.model, buildTextStartOptions(nextSettings));
    } catch (err) {
      await showAlert({
        title: uiText("Yeniden Yükleme Başarısız", "Reload Failed"),
        message: err.message || String(err),
        danger: true,
      });
    }
  };

  const handleAspectRatioChange = (ratio, sizeType) => {
    if (isOpenVinoNpu && ratio !== "1:1") return;
    const isSDXL = sizeType === "sdxl" && !isSD15OrCustom;
    const selected = ASPECT_RATIOS.find((r) => r.id === ratio);
    if (selected) {
      let w = isSDXL ? selected.sdxl_width : selected.width;
      let h = isSDXL ? selected.sdxl_height : selected.height;
      if (isOpenVinoNpu) {
        const size = constraints.width >= 1024 ? 1024 : 512;
        w = size;
        h = size;
      } else if (isSD15OrCustom) {
        if (w > h) {
          h = Math.round((h * 512) / w);
          w = 512;
        } else {
          w = Math.round((w * 512) / h);
          h = 512;
        }
        w = Math.round(w / 64) * 64;
        h = Math.round(h / 64) * 64;
      }
      updateConstraint("width", w);
      updateConstraint("height", h);
    }
  };

  const handleBackendChange = async (backendType) => {
    const currentBackend = constraints.backendType || "cpu";
    if (backendType === currentBackend) return;

    const switchesAccelerator =
      (currentBackend === "openvino-npu" && backendType !== "openvino-npu") ||
      (currentBackend !== "openvino-npu" && backendType === "openvino-npu");

    if (serverRunning && switchesAccelerator) {
      const leavingNpu = currentBackend === "openvino-npu";
      const confirmed = await showConfirm({
        title: leavingNpu ? uiText("NPU Modeli Bellekten Çıkarılsın mı?", "Unload NPU Model?") : uiText("Model Bellekten Çıkarılsın mı?", "Unload Model?"),
        message: leavingNpu
          ? uiText("OpenVINO NPU modeli, standart arka uca geçmeden önce bellekten çıkarılmalıdır.", "The OpenVINO NPU model must be unloaded before switching to a standard backend.")
          : uiText("OpenVINO NPU arka ucuna geçmeden önce etkin model bellekten çıkarılmalıdır.", "The active model must be unloaded before switching to the OpenVINO NPU backend."),
        confirmLabel: uiText("Çıkar", "Unload"),
        cancelLabel: uiText("İptal", "Cancel"),
        danger: true,
      });
      if (!confirmed) return;

      try {
        await stopServer();
        setServerRunning(false);
        setActiveModel(null);
      } catch (err) {
        await showAlert({
          title: uiText("Bellekten Çıkarma Başarısız", "Unload Failed"),
          message: err.message || String(err),
          danger: true,
        });
        return;
      }
    }

    setConstraints((prev) => ({
      ...prev,
      backendType,
      useGpu: backendType !== "cpu",
      steps: backendType === "openvino-npu"
        ? Math.max(1, Math.min(8, prev.npuSteps || 4))
        : Math.max(1, Math.min(60, prev.standardSteps || 20)),
      ...(backendType === "openvino-npu"
        ? {
            width: prev.width >= 1024 ? 1024 : 512,
            height: prev.width >= 1024 ? 1024 : 512,
          }
        : {}),
    }));
  };

  const handleBackendDownload = async (backend) => {
    if (!backend?.id || backendDownload.active) return;
    try {
      setBackendDownload({
        active: true,
        backendId: backend.id,
        progress: 0,
        speed: "Starting",
        error: null,
      });
      await downloadBackend(backend.id);
    } catch (err) {
      setBackendDownload({
        active: false,
        backendId: backend.id,
        progress: 0,
        speed: "",
        error: err.message || "Download failed",
      });
      await showAlert({
        title: uiText("Arka Uç İndirme Başarısız", "Backend Download Failed"),
        message: err.message || uiText("Arka uç indirmesi başlatılamadı.", "Backend download could not be started."),
        danger: true,
      });
    }
  };

  // --- Gorsel Ayarlar ---
  const renderImageSettings = () => (
    <>
      <SectionHeader 
        icon={Image} 
        title="Görsel Üretim Ayarları (Image Generation)" 
        count={5}
        color="#3b82f6"
        isExpanded={expandedSections.image}
        onToggle={() => toggleSection("image")}
      />
      
      {expandedSections.image && (
        <div className="settings-expanded-content">
          <div className="settings-two-column">
        {/* Sol Sutun */}
        <div className="settings-column">
          {/* Boyut ve Sekli */}
          <div className="settings-subsection">
            <div className="settings-subsection-title">
              <Crop size={16} />
              Çözünürlük ve Boyutlandırma (Resolution & Canvas)
            </div>
            <div className="m3-field-group">
              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">Model Mimarisi Çözünürlüğü (Base Resolution)</span>
                  <span className="settings-value-badge">
                    {constraints.width >= 1024 ? "SDXL (1024px)" : "SD 1.5 (512px)"}
                  </span>
                </div>
                <div className="m3-segmented-button">
                  {["sd15", "sdxl"].map((mode) => (
                    <button
                      key={mode}
                      className={`m3-segment-item ${(constraints.width >= 1024 ? "sdxl" : "sd15") === mode ? "active" : ""}`}
                      onClick={() => {
                        const ratio = ASPECT_RATIOS.find(r => {
                          const rw = constraints.width >= 1024 ? r.sdxl_width : r.width;
                          const rh = constraints.height >= 1024 ? r.sdxl_height : r.height;
                          return Math.abs(rw - constraints.width) < 10 && Math.abs(rh - constraints.height) < 10;
                        })?.id || "1:1";
                        handleAspectRatioChange(ratio, mode);
                      }}
                      disabled={isSD15OrCustom && mode === "sdxl"}
                    >
                      {mode === "sd15" ? "512px (SD 1.5)" : "1024px (SDXL)"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">En-Boy Oranı (Aspect Ratio)</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
                  {ASPECT_RATIOS.map((ratio) => {
                    const isSDXL = constraints.width >= 1024 && !isSD15OrCustom;
                    const rw = isSDXL ? ratio.sdxl_width : ratio.width;
                    const rh = isSDXL ? ratio.sdxl_height : ratio.height;
                    const isActive = Math.abs(constraints.width - rw) < 10 && Math.abs(constraints.height - rh) < 10;
                    return (
                      <button
                        key={ratio.id}
                        className={`m3-btn ${isActive ? "m3-btn-filled" : "m3-btn-outlined"}`}
                        onClick={() => handleAspectRatioChange(ratio.id, isSDXL ? "sdxl" : "sd15")}
                        disabled={isOpenVinoNpu && ratio.id !== "1:1"}
                        style={{ fontSize: "0.8rem", padding: "10px 4px", height: "auto" }}
                      >
                        <div style={{ fontWeight: 700 }}>{ratio.id}</div>
                        <div style={{ fontSize: "0.7rem", opacity: 0.8, marginTop: "2px" }}>
                          {rw}x{rh}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div className="m3-text-field">
                  <label className="m3-text-field-label">Genişlik (Width - px)</label>
                  <input
                    type="number"
                    className="m3-input"
                    value={constraints.width}
                    onChange={(e) => updateConstraint("width", Math.round(parseInt(e.target.value) / 64) * 64)}
                    min="64"
                    max="2048"
                    step="64"
                  />
                </div>
                <div className="m3-text-field">
                  <label className="m3-text-field-label">Yükseklik (Height - px)</label>
                  <input
                    type="number"
                    className="m3-input"
                    value={constraints.height}
                    onChange={(e) => updateConstraint("height", Math.round(parseInt(e.target.value) / 64) * 64)}
                    min="64"
                    max="2048"
                    step="64"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Kalite, Adım ve Örnekleme */}
          <div className="settings-subsection">
            <div className="settings-subsection-title">
              <Sliders size={16} />
              Örnekleme ve Kalite (Sampling & Quality)
            </div>
            <div className="m3-field-group">
              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">Detay Adımı (Steps)</span>
                  <span className="settings-value-badge">{constraints.steps}</span>
                </div>
                <input
                  type="range"
                  className="m3-slider"
                  value={constraints.steps}
                  onChange={(e) => updateConstraint("steps", parseInt(e.target.value))}
                  min="1"
                  max={isOpenVinoNpu ? "8" : "60"}
                  style={getSliderStyle(constraints.steps, 1, isOpenVinoNpu ? 8 : 60)}
                />
                <span className="settings-option-desc">
                  {isOpenVinoNpu
                    ? "LCM OpenVINO: 1-8 hızlı adım"
                    : "Flux/Lightning için 4-8 adım; standart modeller için 20-30 adım önerilir."}
                </span>
              </div>

              {/* İstem Uyumu (CFG Scale) */}
              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">İstem Uyumu (CFG Scale)</span>
                  <span className="settings-value-badge">{(constraints.cfgScale || 1.0).toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  className="m3-slider"
                  value={constraints.cfgScale || 1.0}
                  onChange={(e) => updateConstraint("cfgScale", parseFloat(e.target.value))}
                  min="1"
                  max="20"
                  step="0.5"
                  style={getSliderStyle(constraints.cfgScale || 1.0, 1, 20)}
                />
                <span className="settings-option-desc">
                  Yapay zekanın isteminize ne kadar sıkı bağlı kalacağını belirler. Flux/Lightning için 1.0 - 2.0; standart SDXL ve SD 1.5 için 5.0 - 7.5 önerilir.
                </span>
              </div>

              {/* Örnekleyici Algoritma (Sampler) */}
              <div className="m3-text-field">
                <label className="m3-text-field-label">Örnekleyici Algoritma (Sampler)</label>
                <select
                  className="m3-input"
                  value={normalizeSdSampler(constraints.sampler)}
                  onChange={(e) => updateConstraint("sampler", e.target.value)}
                  style={{ width: "100%", cursor: "pointer" }}
                >
                  <option value="euler_a">Euler Ancestral (euler_a) - Hızlı, Canlı & Çeşitli</option>
                  <option value="euler">Euler (euler) - Dengeli & Kararlı</option>
                  <option value="dpm++2m">DPM++ 2M (dpm++2m) - Yüksek Detay & Netlik</option>
                  <option value="dpm++2mv2">DPM++ 2M v2 (dpm++2mv2) - Net Kontrast</option>
                  <option value="dpm++2s_a">DPM++ 2S Ancestral (dpm++2s_a) - Fotogerçekçi Portre & Doğa</option>
                  <option value="er_sde">ER-SDE (er_sde) - Üst Düzey Stüdyo Fotogerçekçilik</option>
                  <option value="heun">Heun (heun) - Hassas Dokular</option>
                  <option value="ddim_trailing">DDIM Trailing (ddim_trailing) - Klasik & Tutarlı</option>
                  <option value="lcm">LCM (lcm) - 4-8 Adım Ultra Hızlı</option>
                </select>
              </div>

              {/* Zamanlayıcı (Scheduler) */}
              <div className="m3-text-field">
                <label className="m3-text-field-label">Zamanlayıcı (Scheduler)</label>
                <select
                  className="m3-input"
                  value={normalizeSdScheduler(constraints.scheduler)}
                  onChange={(e) => updateConstraint("scheduler", e.target.value)}
                  style={{ width: "100%", cursor: "pointer" }}
                >
                  <option value="">Otomatik (model varsayılanı)</option>
                  <option value="sgm_uniform">SGM Uniform - Lightning / Turbo modeller için</option>
                  <option value="karras">Karras - DPM++ 2M ile önerilir</option>
                  <option value="discrete">Discrete - Klasik</option>
                  <option value="exponential">Exponential</option>
                  <option value="simple">Simple</option>
                  <option value="ays">Align Your Steps (AYS)</option>
                </select>
              </div>

              <div className="m3-text-field">
                <label className="m3-text-field-label">Rastgele Tohum (Seed)</label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="number"
                    className="m3-input"
                    value={constraints.seed}
                    onChange={(e) => updateConstraint("seed", parseInt(e.target.value) || -1)}
                    placeholder="-1 rastgele için"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="m3-btn m3-btn-tonal"
                    onClick={() => updateConstraint("seed", -1)}
                  >
                    Rastgele (-1)
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sag Sutun */}
        <div className="settings-column">
          {/* Bellek Optimizasyonlari */}
          <div className="settings-subsection">
            <div className="settings-subsection-title">
              <SlidersHorizontal size={16} />
              Bellek ve GPU Optimizasyonları (VRAM & Performance)
            </div>
            <div className="m3-field-group">
              <PremiumToggle
                checked={constraints.vaeTiling}
                onChange={(v) => updateConstraint("vaeTiling", v)}
                label="Bellek Döşemesi (VAE Tiling)"
                description="VRAM tasarrufu sağlamak için yüksek çözünürlüklü görselleri döşemelere bölerek çözer"
              />
              <PremiumToggle
                checked={constraints.vaeOnCpu}
                onChange={(v) => updateConstraint("vaeOnCpu", v)}
                label="CPU Bellek Taşması (VAE CPU Offload)"
                description="Ekran kartı belleği yetersiz kaldığında (OOM) VAE kod çözücüyü sistem RAM'ine yönlendirir"
              />
              <PremiumToggle
                checked={constraints.useFlashAttn}
                onChange={(v) => updateConstraint("useFlashAttn", v)}
                label="Hızlı Dikkat Mekanizması (Flash Attention)"
                description="Bellek ayak izini küçülterek üretim hızını katlayan optimize dikkat hesaplaması"
              />
            </div>
          </div>

          {/* Arka Uc ve Hizlandirma */}
          <div className="settings-subsection">
            <div className="settings-subsection-title">
              <Monitor size={16} />
              Arka Uc ve Hizlandirma
            </div>
            <div className="m3-field-group">
              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">Hizlandirici</span>
                </div>
                <div className="m3-segmented-button" style={{ flexWrap: "wrap" }}>
                  {visibleBackends.map((b) => {
                    const isAvailable = b.available !== false;
                    const isDownloading = backendDownload.active && backendDownload.backendId === b.id;
                    return (
                    <button
                      key={b.id}
                      className={`m3-segment-item ${constraints.backendType === b.id ? "active" : ""} ${!isAvailable ? "disabled" : ""}`}
                      onClick={() => isAvailable && handleBackendChange(b.id)}
                      disabled={!isAvailable}
                      title={!isAvailable ? b.reason : undefined}
                      style={{ flex: "1 1 auto", minWidth: "80px" }}
                    >
                      {isDownloading ? `${Math.max(0, Math.min(100, Math.round(backendDownload.progress)))}%` : b.label}
                    </button>
                    );
                  })}
                </div>
                {unavailableBackends.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "10px" }}>
                    {unavailableBackends.map((backend) => {
                      const isDownloading = backendDownload.active && backendDownload.backendId === backend.id;
                      const progress = Math.max(0, Math.min(100, Math.round(backendDownload.progress || 0)));
                      return (
                        <div
                          key={`download-${backend.id}`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "10px",
                            padding: "10px",
                            border: "1px solid var(--md-sys-color-outline-variant)",
                            borderRadius: "8px",
                            background: "var(--md-sys-color-surface-container-low)",
                          }}
                        >
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontWeight: 700, color: "var(--md-sys-color-on-surface)" }}>
                              {backend.label}
                            </div>
                            <div className="settings-option-desc" title={backendDownload.error || backend.reason}>
                              {isDownloading
                                ? `${progress}% ${backendDownload.speed ? `- ${backendDownload.speed}` : ""}`
                                : backendDownload.error && backendDownload.backendId === backend.id
                                  ? backendDownload.error
                                  : backend.reason}
                            </div>
                            {isDownloading && (
                              <div className="model-progress-bar" style={{ marginTop: "6px" }}>
                                <div
                                  className="model-progress-fill"
                                  style={{
                                    width: `${progress}%`,
                                    transition: "width 0.2s ease",
                                  }}
                                />
                              </div>
                            )}
                          </div>
                          <button
                            className="m3-btn m3-btn-tonal"
                            onClick={() => handleBackendDownload(backend)}
                            disabled={backendDownload.active}
                            style={{ flexShrink: 0 }}
                          >
                            {isDownloading ? <RefreshCw className="progress-spinner" size={14} /> : <DownloadCloud size={14} />}
                            <span>{isDownloading ? "Indiriliyor" : "Indir"}</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
          </div>
        </div>
      )}
    </>
  );

  // --- Metin Ayarlar ---
  const renderTextSettings = () => (
    <>
      <SectionHeader 
        icon={Type} 
        title="Metin Uretim" 
        count={5}
        color="#8b5cf6"
        isExpanded={expandedSections.text}
        onToggle={() => toggleSection("text")}
      />
      
      {expandedSections.text && (
        <div className="settings-expanded-content">
          <div className="settings-two-column">
        {/* Sol Sutun */}
        <div className="settings-column">
          {/* Model ve Baglam */}
          <div className="settings-subsection">
            <div className="settings-subsection-title">
              <MessageSquare size={16} />
              Model ve Bağlam (Model & Context)
            </div>
            <div className="m3-field-group">
              <div className="m3-text-field">
                <label className="m3-text-field-label">Sistem Yönergesi (System Prompt)</label>
                <textarea
                   className="m3-input"
                   value={pendingTextSettings.systemPrompt || ""}
                   onChange={(e) => updateTextSetting("systemPrompt", e.target.value)}
                   placeholder="Yapay zekâya rol ve talimat tanımlayın..."
                   rows={3}
                   style={{ resize: "vertical", minHeight: "60px" }}
                />
                <span className="settings-option-desc" style={{ marginTop: "4px", display: "block" }}>
                  Asistanın kişiliğini ve çalışma kurallarını belirler.
                </span>
              </div>

              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">Bağlam Penceresi (Context Size)</span>
                  <span className="settings-value-badge">{pendingTextSettings.contextSize || 0}</span>
                </div>
                <input
                  type="range"
                  className="m3-slider"
                  value={pendingTextSettings.contextSize || 0}
                  onChange={(e) => updateTextSetting("contextSize", parseInt(e.target.value))}
                  min="0"
                  max="32768"
                  step="512"
                  style={getSliderStyle(pendingTextSettings.contextSize || 0, 0, 32768)}
                />
                <span className="settings-option-desc">
                  Modelin hatırlayabileceği azami token miktarı. 0 seçilirse modelin kendi varsayılanı kullanılır (Önerilen: 0).
                </span>
              </div>
            </div>
          </div>

          {/* Uretim Parametreleri */}
          <div className="settings-subsection">
            <div className="settings-subsection-title">
              <Settings2 size={16} />
              Üretim Parametreleri (Inference Settings)
            </div>
            <div className="m3-field-group">
              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">Yaratıcılık Sıcaklığı (Temperature)</span>
                  <span className="settings-value-badge">{pendingTextSettings.temperature}</span>
                </div>
                <input
                  type="range"
                  className="m3-slider"
                  value={pendingTextSettings.temperature}
                  onChange={(e) => updateTextSetting("temperature", parseFloat(e.target.value))}
                  min="0"
                  max="2"
                  step="0.1"
                  style={getSliderStyle(pendingTextSettings.temperature, 0, 2)}
                />
                <span className="settings-option-desc">
                  Yaratıcılığı kontrol eder. Düşük = tutarlı ve odaklı, Yüksek = yaratıcı ve çeşitli (Önerilen: 0.7).
                </span>
              </div>

              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">Azami Yanıt Uzunluğu (Max Tokens)</span>
                  <span className="settings-value-badge">
                    {(pendingTextSettings.responseTokenMode || "auto") === "auto" ? "Otomatik" : (pendingTextSettings.maxTokens || 1024)}
                  </span>
                </div>
                <div className="m3-segmented-button" style={{ marginBottom: "10px" }}>
                  {[
                    { id: "auto", label: "Otomatik" },
                    { id: "manual", label: "Manuel" },
                  ].map((mode) => (
                    <button
                      key={mode.id}
                      className={`m3-segment-item ${(pendingTextSettings.responseTokenMode || "auto") === mode.id ? "active" : ""}`}
                      onClick={() => updateTextSetting("responseTokenMode", mode.id)}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
                {(pendingTextSettings.responseTokenMode || "auto") === "manual" ? (
                  <>
                    <input
                      type="range"
                      className="m3-slider"
                      value={pendingTextSettings.maxTokens || 1024}
                      onChange={(e) => updateTextSetting("maxTokens", parseInt(e.target.value))}
                      min="64"
                      max="4096"
                      step="64"
                      style={getSliderStyle(pendingTextSettings.maxTokens || 1024, 64, 4096)}
                    />
                    <span className="settings-option-desc">
                      Manuel mod seçilen azami yanıt uzunluğunu uygular.
                    </span>
                  </>
                ) : (
                  <span className="settings-option-desc">
                    Otomatik mod yanıt uzunluğunu bağlam penceresine göre dinamik ayarlar (Önerilen).
                  </span>
                )}
              </div>

              <div className="m3-text-field">
                <label className="m3-text-field-label">Rastgele Tohum (Seed)</label>
                <input
                  type="number"
                  className="m3-input"
                  value={pendingTextSettings.seed}
                  onChange={(e) => updateTextSetting("seed", parseInt(e.target.value) || -1)}
                  placeholder="-1"
                />
                <span className="settings-option-desc" style={{ marginTop: "4px", display: "block" }}>
                  Tekrarlanabilirlik kontrolü. Rastgele cevaplar için -1, deterministik cevaplar için pozitif tamsayı girin.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Sag Sutun */}
        <div className="settings-column">
          {/* Performans Profili */}
          <div className="settings-subsection">
            <div className="settings-subsection-title">
              <Gauge size={16} />
              Performans Profili
            </div>
            <div className="m3-field-group">
              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">Profil</span>
                </div>
                <div className="m3-segmented-button">
                  {["potato", "balanced", "high", "custom"].map((profile) => (
                    <button
                      key={profile}
                      className={`m3-segment-item ${(pendingTextSettings.performanceProfile || "balanced") === profile ? "active" : ""}`}
                      onClick={() => updateTextSetting("performanceProfile", profile)}
                    >
                      {profile === "potato" ? "Düşük (Tasarruf)" : profile === "balanced" ? "Dengeli" : profile === "high" ? "Yüksek" : "Özel"}
                    </button>
                  ))}
                </div>
                <span className="settings-option-desc" style={{ marginTop: "6px", display: "block" }}>
                  {(pendingTextSettings.performanceProfile || "balanced") === "potato"
                    ? "Düşük (Tasarruf): 2048 Bağlam, 16 GPU Katmanı, 256 Batch ve Q4_0 KV Önbellek ile minimum VRAM ve güç tüketimi sağlar."
                    : (pendingTextSettings.performanceProfile || "balanced") === "balanced"
                    ? "Dengeli: 4096 Bağlam, 35 GPU Katmanı, 512 Batch ve Q8_0 KV Önbellek ile hız ve bellek dengesini korur."
                    : (pendingTextSettings.performanceProfile || "balanced") === "high"
                    ? "Yüksek Performans: 8192 Bağlam, Tüm Katmanlar GPU'da (-1), 1024 Batch ve F16 Kayıpsız KV Önbellek ile maksimum hız ve kalite sunar."
                    : "Özel Profil: Bağlam, iş parçacığı, GPU katmanı veya KV önbellek değerlerini manuel olarak özelleştirdiniz."}
                </span>
              </div>



              {llmBackends.available?.length > 1 && (
                <div className="m3-slider-group">
                  <div className="m3-slider-header">
                    <span className="m3-slider-label">Metin Çıkarım Motoru (LLM Backend)</span>
                  </div>
                  <div className="m3-segmented-button">
                    {llmBackends.available.map((backend) => (
                      <button
                        key={backend.key}
                        className={`m3-segment-item ${(pendingTextSettings.preferredBackend || "auto") === backend.key ? "active" : ""}`}
                        onClick={() => updateTextSetting("preferredBackend", backend.key)}
                      >
                        {backend.key === "cpu" ? "Sadece CPU" : backend.key.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">İşlemci İş Parçacığı (CPU Threads)</span>
                  <span className="settings-value-badge">{pendingTextSettings.threads || 4}</span>
                </div>
                <input
                  type="range"
                  className="m3-slider"
                  value={pendingTextSettings.threads || 4}
                  onChange={(e) => updateTextSetting("threads", parseInt(e.target.value))}
                  min="1"
                  max={specs?.cpu_cores_logical || 16}
                  style={getSliderStyle(pendingTextSettings.threads || 4, 1, specs?.cpu_cores_logical || 16)}
                />
              </div>

              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">GPU Bellek Katmanı (GPU Layers - Offload)</span>
                  <span className="settings-value-badge">{pendingTextSettings.gpuLayers === -1 ? "Otomatik" : pendingTextSettings.gpuLayers}</span>
                </div>
                <input
                  type="range"
                  className="m3-slider"
                  value={pendingTextSettings.gpuLayers === -1 ? 50 : pendingTextSettings.gpuLayers}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    updateTextSetting("gpuLayers", val >= 50 ? -1 : val);
                  }}
                  min="0"
                  max="50"
                  style={getSliderStyle(pendingTextSettings.gpuLayers === -1 ? 50 : pendingTextSettings.gpuLayers, 0, 50)}
                />
                <span className="settings-option-desc">
                  Modelin kaç katmanının GPU VRAM'ine aktarılacağını belirler. Otomatik (önerilen): llama.cpp, VRAM'e sığan en fazla katmanı kendisi seçer. Elle verilen değer VRAM'i aşarsa Windows modeli sistem belleğine taşır ve yanıtlar çok yavaşlar veya zaman aşımına uğrar.
                </span>
              </div>

              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">Toplu İşlem Boyutu (Batch Size)</span>
                  <span className="settings-value-badge">{pendingTextSettings.batchSize || 512}</span>
                </div>
                <input
                  type="range"
                  className="m3-slider"
                  value={pendingTextSettings.batchSize || 512}
                  onChange={(e) => updateTextSetting("batchSize", parseInt(e.target.value))}
                  min="64"
                  max="2048"
                  step="64"
                  style={getSliderStyle(pendingTextSettings.batchSize || 512, 64, 2048)}
                />
              </div>

              <div className="m3-slider-group">
                <div className="m3-slider-header">
                  <span className="m3-slider-label">KV Onbellek</span>
                </div>
                <div className="m3-segmented-button">
                  {["q4_0", "q8_0", "f16"].map((type) => (
                    <button
                      key={type}
                      className={`m3-segment-item ${(pendingTextSettings.cacheTypeK || "q8_0") === type ? "active" : ""}`}
                      onClick={() => {
                        updateTextSetting("cacheTypeK", type);
                        updateTextSetting("cacheTypeV", type);
                      }}
                    >
                      {type.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {hasPendingChanges && (
                <div className="settings-save-bar" style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "16px 20px",
                  background: "color-mix(in srgb, var(--md-sys-color-primary) 10%, var(--bg-card))",
                  border: "1px solid color-mix(in srgb, var(--md-sys-color-primary) 30%, transparent)",
                  borderRadius: "14px",
                  marginTop: "20px",
                  gap: "16px",
                  flexWrap: "wrap",
                  animation: "fadeIn 0.2s ease",
                  width: "100%",
                  boxSizing: "border-box"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <Brain size={18} style={{ color: "var(--md-sys-color-primary)" }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>Kaydedilmemis Metin Uretim Ayarlari</div>
                      <div style={{ fontSize: "0.85rem", opacity: 0.8, marginTop: "2px" }}>
                        {llmStatus.ready
                          ? "Kaydetme, degisiklikleri uygulamak icin aktif metin modelini bellekten cikarir."
                          : "Degisiklikler bir sonraki model yuklemesinde uygulanir."}
                      </div>
                    </div>
                  </div>
                  <button
                    className="m3-btn m3-btn-filled"
                    onClick={handleSaveTextSettings}
                    style={{
                      background: "var(--md-sys-color-primary)",
                      color: "var(--md-sys-color-on-primary)",
                      border: "none",
                      borderRadius: "10px",
                      padding: "10px 18px",
                      fontWeight: 600,
                      fontSize: "0.85rem",
                      cursor: "pointer",
                      boxShadow: "0 2px 8px color-mix(in srgb, var(--md-sys-color-primary) 30%, transparent)",
                    }}
                  >
                    Kaydet ve Uygula
                  </button>
                </div>
              )}
            </div>
          </div>


        </div>
          </div>
        </div>
      )}
    </>
  );

  // --- Konusma Ayarlar ---
  const renderSpeechSettings = () => {
    const SPEECH_LANGUAGES = [
      { value: "auto", label: "Otomatik algila" },
      { value: "en", label: "Ingilizce" },
      { value: "es", label: "Ispanyolca" },
      { value: "fr", label: "Fransizca" },
      { value: "de", label: "Almanca" },
      { value: "it", label: "Italyanca" },
      { value: "pt", label: "Portekizce" },
      { value: "hi", label: "Hintce" },
      { value: "ja", label: "Japonca" },
      { value: "ko", label: "Korece" },
      { value: "zh", label: "Cince" },
    ];

    return (
      <>
        <SectionHeader 
          icon={Volume2} 
          title="Konusma Yazima Cevirme" 
          count={4}
          color="#10b981"
          isExpanded={expandedSections.speech}
          onToggle={() => toggleSection("speech")}
        />
        
        {expandedSections.speech && (
          <div className="settings-expanded-content">
            <div className="settings-two-column">
              {/* Sol Sutun */}
              <div className="settings-column">
                {/* Konusma Parametreleri */}
                <div className="settings-subsection">
                  <div className="settings-subsection-title">
                    <Volume2 size={16} />
                    Yazima Cevirme Ayarlari
                  </div>
                  <div className="m3-field-group">
                    <div className="m3-text-field">
                      <label className="m3-text-field-label">Varsayilan Arka uc</label>
                      <select
                        className="m3-input"
                        value={speechSettings.backendPreference || "auto"}
                        onChange={(e) => updateSpeechSetting("backendPreference", e.target.value)}
                      >
                        <option value="auto">Otomatik - GPU kuruluysa</option>
                        <option value="vulkan">Vulkan GPU</option>
                        <option value="metal">Metal GPU</option>
                        <option value="cpu">CPU</option>
                      </select>
                      <span className="settings-option-desc" style={{ marginTop: "4px", display: "block" }}>
                        Otomatik, GPU whisper.cpp arka ucunu ikilisi (binary) mevcut oldugunda kullanir, aksi halde CPU'ya duser.
                      </span>
                    </div>

                    <div className="m3-text-field">
                      <label className="m3-text-field-label">Varsayilan Dil</label>
                      <select 
                        className="m3-input" 
                        value={speechSettings.language || "auto"} 
                        onChange={(e) => updateSpeechSetting("language", e.target.value)}
                      >
                        {SPEECH_LANGUAGES.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      <span className="settings-option-desc" style={{ marginTop: "4px", display: "block" }}>
                        Sesi yaziya cevirmek icin varsayilan dil. (Onerilen: Otomatik algila)
                      </span>
                    </div>

                    <div className="m3-slider-group">
                      <div className="m3-slider-header">
                        <span className="m3-slider-label">CPU Is parcacigi</span>
                        <span className="settings-value-badge">{speechSettings.threads || 4}</span>
                      </div>
                      <input
                        type="range"
                        className="m3-slider"
                        value={speechSettings.threads || 4}
                        onChange={(e) => updateSpeechSetting("threads", parseInt(e.target.value))}
                        min="1"
                        max={specs?.cpu_cores_logical || 16}
                        style={getSliderStyle(speechSettings.threads || 4, 1, specs?.cpu_cores_logical || 16)}
                      />
                      <span className="settings-option-desc">
                        Yazima cevirme icin ayirilacak is parcacigi sayisi. (Onerilen: 4)
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Sag Sutun */}
              <div className="settings-column">
                {/* Ceviri secenekleri */}
                <div className="settings-subsection">
                  <div className="settings-subsection-title">
                    <Sparkles size={16} />
                    Ceviri Ayarlari
                  </div>
                  <div className="m3-field-group">
                    <PremiumToggle
                      checked={speechSettings.translate === true}
                      onChange={(val) => updateSpeechSetting("translate", val)}
                      label="Ingilizce'ye Cevir"
                      description="Yazima cevirme sirasinda yabanci dilleri otomatik olarak Ingilizce'ye cevir"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    );
  };

  // --- Appearance Ayarlar ---
  const renderTtsSettings = () => {
    const TTS_VOICES = [
      { value: "af_heart", label: "Heart - Female, US English" },
      { value: "af_bella", label: "Bella - Female, US English" },
      { value: "af_nicole", label: "Nicole - Female, US English" },
      { value: "af_sarah", label: "Sarah - Female, US English" },
      { value: "am_michael", label: "Michael - Male, US English" },
      { value: "am_fenrir", label: "Fenrir - Male, US English" },
      { value: "bf_emma", label: "Emma - Female, UK English" },
      { value: "bm_george", label: "George - Male, UK English" },
    ];

    return (
      <>
        <SectionHeader
          icon={Volume2}
          title="Metinden Sese"
          count={2}
          color="#8b5cf6"
          isExpanded={expandedSections.tts}
          onToggle={() => toggleSection("tts")}
        />

        {expandedSections.tts && (
          <div className="settings-expanded-content">
            <div className="settings-two-column">
              <div className="settings-column">
                <div className="settings-subsection">
                  <div className="settings-subsection-title">
                    <Volume2 size={16} />
                    Ses Varsayilanlari
                  </div>
                  <div className="m3-field-group">
                    <div className="m3-text-field">
                      <label className="m3-text-field-label">Default Ses</label>
                      <select
                        className="m3-input"
                        value={ttsSettings?.voice || "af_heart"}
                        onChange={(e) => updateTtsSetting("voice", e.target.value)}
                      >
                        {TTS_VOICES.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      <span className="settings-option-desc" style={{ marginTop: "4px", display: "block" }}>
                        Uretilen WAV dosyalari icin varsayilan Kokoro sesi.
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="settings-column">
                <div className="settings-subsection">
                  <div className="settings-subsection-title">
                    <Gauge size={16} />
                    Konusma Zamanlamasi
                  </div>
                  <div className="m3-slider-group">
                    <div className="m3-slider-header">
                      <span className="m3-slider-label">Hiz</span>
                      <span className="settings-value-badge">{(ttsSettings?.speed || 1).toFixed(2)}x</span>
                    </div>
                    <input
                      type="range"
                      className="m3-slider"
                      value={ttsSettings?.speed || 1}
                      onChange={(e) => updateTtsSetting("speed", parseFloat(e.target.value))}
                      min="0.5"
                      max="2"
                      step="0.05"
                      style={getSliderStyle(ttsSettings?.speed || 1, 0.5, 2)}
                    />
                    <span className="settings-option-desc">
                      1.00x dogal hizdir. Dusuk degerler daha yavas, yuksek degerler daha hizlidir.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    );
  };

  const renderAppearanceSettings = () => (
    <>
      <SectionHeader 
        icon={Palette} 
        title="Gorunum ve Temalar" 
        count={2}
        color="var(--md-sys-color-primary)"
        isExpanded={expandedSections.appearance}
        onToggle={() => toggleSection("appearance")}
      />
      
      {expandedSections.appearance && (
        <div className="settings-expanded-content">
          <div className="settings-subsection">
            {/* Uygulama Dili Alt Bolumu */}
            {setUiLanguage && (
              <>
                <div className="settings-subsection-title">
                  <Globe size={16} />
                  Uygulama Dili (Application Language)
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px", marginTop: "14px", maxWidth: "480px" }}>
                  {[
                    { id: "tr", label: "Türkçe (Ana Dil)", desc: "Varsayılan Tam Türkçe Arayüz" },
                    { id: "en", label: "English (İngilizce)", desc: "Secondary English Interface" },
                  ].map((langOpt) => (
                    <button
                      key={langOpt.id}
                      type="button"
                      className={`m3-btn ${(uiLanguage || "tr") === langOpt.id ? "m3-btn-filled" : "m3-btn-outlined"}`}
                      onClick={() => setUiLanguage(langOpt.id)}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "3px",
                        padding: "10px 8px",
                        height: "auto",
                        borderRadius: "12px",
                      }}
                    >
                      <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>{langOpt.label}</span>
                      <span style={{ fontSize: "0.72rem", opacity: 0.75 }}>{langOpt.desc}</span>
                    </button>
                  ))}
                </div>
                <div style={{ height: "1px", background: "var(--border-color)", margin: "24px 0" }} />
              </>
            )}

            {/* Renk Temalari Alt Bolumu */}
            <div className="settings-subsection-title">
              <Palette size={16} />
              Renk Temalari
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              gap: "14px",
              marginTop: "14px"
            }}>
              {THEMES.map((t) => {
                const isActive = theme === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    className={`theme-card-btn ${isActive ? "active" : ""}`}
                    style={{
                      background: t.bg,
                      color: t.type === "dark" ? "#f4f4f5" : "#0f172a",
                      border: isActive ? "2px solid var(--md-sys-color-primary)" : "1px solid var(--border-color)",
                      borderRadius: "14px",
                      padding: "18px",
                      textAlign: "left",
                      cursor: "pointer",
                      position: "relative",
                      display: "flex",
                      flexDirection: "column",
                      gap: "14px",
                      boxShadow: isActive ? "0 4px 16px color-mix(in srgb, var(--md-sys-color-primary) 25%, transparent)" : "none",
                      transition: "all 0.25s ease",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                      <span style={{ fontWeight: 700, fontSize: "0.88rem", letterSpacing: "-0.01em" }}>{t.name}</span>
                      {isActive && (
                        <div style={{
                          background: "linear-gradient(135deg, var(--md-sys-color-primary), var(--md-sys-color-secondary))",
                          color: "var(--md-sys-color-on-primary)",
                          borderRadius: "50%",
                          width: "22px",
                          height: "22px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          boxShadow: "0 2px 6px color-mix(in srgb, var(--md-sys-color-primary) 40%, transparent)"
                        }}>
                          <Check size={13} strokeWidth={3} />
                        </div>
                      )}
                    </div>
                    
                    {/* Birincil ve ikincil renkler icin onizleme daireleri */}
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: t.primary, border: "2px solid rgba(255,255,255,0.25)", boxShadow: "0 2px 6px rgba(0,0,0,0.15)" }} title="Birincil" />
                      <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: t.secondary, border: "2px solid rgba(255,255,255,0.25)", boxShadow: "0 2px 6px rgba(0,0,0,0.15)" }} title="Ikincil" />
                      <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: t.bg, border: "1.5px solid rgba(0,0,0,0.12)", boxShadow: "inset 0 2px 4px rgba(0,0,0,0.06)" }} title="Arka Plan" />
                      <span style={{ marginLeft: "auto", fontSize: "0.7rem", opacity: 0.6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        {t.type === "dark" ? "Koyu" : "Acik"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Kart icindeki alt bolumleri ayiran ayrac */}
            <div style={{
              height: "1px",
              background: "var(--border-color)",
              margin: "24px 0"
            }} />

            {/* Metin ve Arayuz Boyutu Alt Bolumu */}
            <div className="settings-subsection-title">
              <Type size={16} />
              Metin ve Arayüz Büyüklüğü (UI Scale)
            </div>
            
            {/* Hızlı Seçim Butonları: Küçük, Orta, Büyük */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginTop: "14px", maxWidth: "480px" }}>
              {[
                { label: "Küçük", size: 14, desc: "14px • Kompakt" },
                { label: "Orta", size: 16, desc: "16px • Standart" },
                { label: "Büyük", size: 18, desc: "18.5px • Okunaklı" },
              ].map((preset) => (
                <button
                  key={preset.size}
                  type="button"
                  className={`m3-btn ${(fontSize || 16) === preset.size ? "m3-btn-filled" : "m3-btn-outlined"}`}
                  onClick={() => setFontSize(preset.size)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "3px",
                    padding: "10px 8px",
                    height: "auto",
                    borderRadius: "12px",
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>{preset.label}</span>
                  <span style={{ fontSize: "0.72rem", opacity: 0.75 }}>{preset.desc}</span>
                </button>
              ))}
            </div>

            <div className="m3-slider-group" style={{ maxWidth: "480px", marginTop: "16px" }}>
              <div className="m3-slider-header">
                <span className="m3-slider-label">Hassas Boyut Ayarı</span>
                <span className="settings-value-badge">{fontSize || 16}px</span>
              </div>
              <input
                type="range"
                className="m3-slider"
                value={fontSize || 16}
                onChange={(e) => setFontSize(parseInt(e.target.value))}
                min="12"
                max="24"
                step="1"
                style={getSliderStyle(fontSize || 16, 12, 24)}
              />
              <span className="settings-option-desc">
                Arayüzün ve yazıların genel büyüklüğünü belirler. Standart değer 16px'dir.
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );

  const renderUpdateSettings = () => (
    <CollapsibleCard
      icon={DownloadCloud}
      title="Sürüm ve Güncellemeler (App Updates & Releases)"
      subtitle="Mevcut stüdyo sürümünüzü denetleyin ve en son GitHub güncellemelerini kontrol edin."
      defaultExpanded={true}
      id="app_updates"
      badge={updateInfo?.updateAvailable ? "Yeni Sürüm!" : "v2.0.0"}
      badgeColor={updateInfo?.updateAvailable ? "#ef4444" : "#10b981"}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
        {/* Sürüm Kartları */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
          <div style={{
            background: "var(--md-sys-color-surface-container-high)",
            border: "1px solid var(--md-sys-color-outline-variant)",
            borderRadius: "12px",
            padding: "14px 16px"
          }}>
            <div style={{ fontSize: "0.75rem", opacity: 0.7, fontWeight: 600 }}>KURULU SÜRÜM</div>
            <div style={{ fontSize: "1.2rem", fontWeight: 800, marginTop: "4px", color: "var(--md-sys-color-primary)" }}>
              v2.0.0
            </div>
            <div style={{ fontSize: "0.75rem", opacity: 0.8, marginTop: "2px" }}>
              Derine Dalıyoruz: Yapay Zeka Özel Sürümü
            </div>
          </div>

          <div style={{
            background: "var(--md-sys-color-surface-container-high)",
            border: "1px solid var(--md-sys-color-outline-variant)",
            borderRadius: "12px",
            padding: "14px 16px"
          }}>
            <div style={{ fontSize: "0.75rem", opacity: 0.7, fontWeight: 600 }}>DAĞITIM KANALI</div>
            <div style={{ fontSize: "1.2rem", fontWeight: 800, marginTop: "4px", color: "#10b981" }}>
              Kararlı (Stable)
            </div>
            <div style={{ fontSize: "0.75rem", opacity: 0.8, marginTop: "2px" }}>
              Yerel Taşınabilir Ortam (Local Portable)
            </div>
          </div>

          <div style={{
            background: "var(--md-sys-color-surface-container-high)",
            border: "1px solid var(--md-sys-color-outline-variant)",
            borderRadius: "12px",
            padding: "14px 16px"
          }}>
            <div style={{ fontSize: "0.75rem", opacity: 0.7, fontWeight: 600 }}>SON DENETLEME</div>
            <div style={{ fontSize: "1.2rem", fontWeight: 800, marginTop: "4px" }}>
              {updateCheckedAt || "Henüz yapılmadı"}
            </div>
            <div style={{ fontSize: "0.75rem", opacity: 0.8, marginTop: "2px" }}>
              {updateInfo ? (!updateInfo.ok ? "Denetlenemedi" : updateInfo.updateAvailable ? "Yeni güncelleme var!" : "Sistem güncel") : "Denetlemek için butona basın"}
            </div>
          </div>
        </div>

        {/* Güncelleme Durum Kutusu */}
        {updateInfo?.ok && (
          <div style={{
            padding: "14px 16px",
            borderRadius: "12px",
            border: updateInfo.updateAvailable ? "1px solid #ef4444" : "1px solid #10b981",
            background: updateInfo.updateAvailable ? "rgba(239, 68, 68, 0.08)" : "rgba(16, 185, 129, 0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "14px",
            flexWrap: "wrap"
          }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: "0.95rem", color: updateInfo.updateAvailable ? "#ef4444" : "#10b981" }}>
                {updateInfo.updateAvailable
                  ? `Yeni Bir Güncelleme Mevcut (${updateInfo.latestVersion})`
                  : `Tebrikler! En güncel sürümü (${updateInfo.currentVersion || "v2.0.0"}) kullanıyorsunuz.`}
              </div>
              <div style={{ fontSize: "0.8rem", opacity: 0.85, marginTop: "4px" }}>
                {updateInfo.updateAvailable
                  ? "Yeni özellikleri, model entegrasyonlarını ve performans iyileştirmelerini modellerinizi silmeden tek tıkla indirebilirsiniz."
                  : "Tüm stüdyo modülleri, yerel motorlar ve arayüz bileşenleri en son sürümle tam uyumludur."}
              </div>
            </div>

            {updateInfo.updateAvailable && (
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => handleApplyUpdate(false)}
                  disabled={isApplyingUpdate}
                  className="m3-btn m3-btn-filled"
                  style={{
                    height: "38px",
                    padding: "0 18px",
                    borderRadius: "10px",
                    fontWeight: 700,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    background: "linear-gradient(135deg, #2563eb, #7c3aed)",
                    color: "#fff",
                    border: "none",
                    cursor: isApplyingUpdate ? "wait" : "pointer",
                  }}
                >
                  <DownloadCloud size={15} className={isApplyingUpdate ? "progress-spinner" : ""} />
                  <span>{isApplyingUpdate ? "Güncelleniyor..." : "Şimdi Otomatik Güncelle (İndir ve Kur)"}</span>
                </button>
                <a
                  href="https://github.com/DDYapayZeka/SansursuzLokalAIStudyosu-V2"
                  target="_blank"
                  rel="noreferrer"
                  className="m3-btn m3-btn-outlined"
                  style={{
                    height: "38px",
                    padding: "0 14px",
                    borderRadius: "10px",
                    fontWeight: 700,
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <span>GitHub Sayfası</span>
                  <ExternalLink size={14} />
                </a>
              </div>
            )}
          </div>
        )}

        {/* Aksiyon Alanı - Güncelleme Butonu */}
        <div style={{ display: "flex", alignItems: "center", gap: "14px", marginTop: "4px", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn-beam"
            onClick={handleCheckUpdate}
            disabled={isCheckingUpdate}
            style={{ height: "46px", minWidth: "240px" }}
          >
            <div className="btn-content" style={{ padding: "0 24px", gap: "10px" }}>
              <RefreshCw size={18} className={isCheckingUpdate ? "progress-spinner" : ""} />
              <span>{isCheckingUpdate ? "Denetleniyor..." : "Güncellemeleri Denetle"}</span>
            </div>
          </button>

          <a
            href="https://github.com/DDYapayZeka/SansursuzLokalAIStudyosu-V2/releases"
            target="_blank"
            rel="noreferrer"
            style={{
              fontSize: "0.82rem",
              color: "var(--md-sys-color-primary)",
              textDecoration: "none",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <span>Sürüm Notlarını ve GitHub Sayfasını Aç</span>
            <ExternalLink size={14} />
          </a>
        </div>
      </div>
    </CollapsibleCard>
  );

  return (
    <div className="workspace-area">
      {/* Sayfa Basligi */}
      <div className="workspace-title-section">
        <h2 className="workspace-title">Ayarlar ve Parametreler</h2>
          <p className="workspace-subtitle">
            Yapay zeka modellerinizi en iyi performans icin yapilandirin.
          </p>
      </div>

      {/* Sürüm ve Güncellemeler Bölümü */}
      {renderUpdateSettings()}

      {/* Gorunum ve Temalar Bolumu */}
      {renderAppearanceSettings()}

      {/* Gorsel Ayarlari Bolumu */}
      {renderImageSettings()}

      {/* Metin Ayarlari Bolumu */}
      {renderTextSettings()}

      {/* Konusma Ayarlari Bolumu */}
      {renderSpeechSettings()}

      {/* Metinden Sese Ayarlari Bolumu */}
      {renderTtsSettings()}
    </div>
  );
}

export default memo(Settings);
