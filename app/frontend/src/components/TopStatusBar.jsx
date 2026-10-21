import React, { memo, useState, useRef, useEffect } from "react";
import { uiText } from "../i18n";
import { Square, RefreshCw, Sun, Moon, Palette, Check, PanelLeftClose, PanelLeft, DownloadCloud, AlertTriangle, Globe } from "lucide-react";
import { THEMES } from "../themes";
import { checkAppUpdate, getDownloadProgress } from "../services/api";

const truncateModelName = (name) => {
  if (!name || typeof name !== "string") return "";
  let cleanName = name;
  if (name.includes("--")) {
    const parts = name.split("--");
    cleanName = parts[parts.length - 1];
  }
  if (cleanName.length > 25) {
    return cleanName.substring(0, 22) + "...";
  }
  return cleanName;
};

function TopStatusBar({ 
  telemetry, 
  serverRunning, 
  activeModel, 
  isLlmLoaded = false, 
  onStopServer, 
  isStoppingServer = false, 
  theme, 
  setTheme,
  sidebarVisible,
  uiLanguage = "tr",
  setUiLanguage,
  onToggleSidebar,
  setActiveTab,
  showAlert,
}) {
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState(null);
  const [downloadInfo, setDownloadInfo] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    let isMounted = true;
    const pollDownload = async () => {
      try {
        const data = await getDownloadProgress();
        if (isMounted && data) {
          setDownloadInfo(data);
        }
      } catch (err) {
        // silent fallback
      }
    };

    pollDownload();
    const interval = setInterval(pollDownload, 1000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    try {
      const data = await checkAppUpdate();
      setUpdateStatus(data);
      if (data && data.ok) {
        if (data.updateAvailable) {
          showAlert?.({
            title: uiText("Yeni Güncelleme Mevcut!", "New Update Available!"),
            message: uiText(`Yeni bir sürüm yayınlandı (${data.latestVersion}). Ayarlar & Güncelleme sekmesinden inceleyebilirsiniz.`, `A new version was released (${data.latestVersion}). You can review it in the Settings & Updates tab.`),
          });
          setActiveTab?.("settings");
        } else {
          showAlert?.({
            title: uiText("Sistem Güncel", "System Up to Date"),
            message: uiText(`Harika! En son kararlı sürümü (${data.currentVersion || "v2.0.0"}) kullanıyorsunuz.`, `Great! You are using the latest stable version (${data.currentVersion || "v2.0.0"}).`),
          });
        }
      } else {
        showAlert?.({
          title: uiText("Güncelleme Kontrolü", "Update Check"),
          message: data?.error || "Güncelleme sunucusuna erişilemedi.",
        });
      }
    } catch (err) {
      showAlert?.({
        title: "Hata",
        message: err.message || "Güncelleme denetlenemedi.",
        danger: true,
      });
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setShowThemeMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const formatGb = (value, { allowZero = false } = {}) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return "--";
    if (number === 0 && !allowZero) return "--";
    return number.toFixed(number >= 10 ? 0 : 1);
  };

  const getStatusText = () => {
    if (isLlmLoaded) return "Model Yüklü (Metin)";
    // activeModel is the selected image model; it is only loaded while the image server runs.
    if (activeModel && serverRunning) return "Model Yüklü (Görsel)";
    if (activeModel) return "Model Seçili (Görsel)";
    if (serverRunning) return "Sunucu Çalışıyor";
    return "Yerel Mod";
  };

  const getStatusClass = () => {
    if ((activeModel && serverRunning) || isLlmLoaded) return "status-indicator";
    if (activeModel) return "status-indicator offline";
    if (serverRunning) return "status-indicator busy";
    return "status-indicator offline";
  };

  const isDark = (theme || "dark").startsWith("dark");

  return (
    <div className="top-status-bar">
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <button
          onClick={onToggleSidebar}
          className="sidebar-toggle-btn"
          title={sidebarVisible ? "Yan Menüyü Daralt" : "Yan Menüyü Genişlet"}
        >
          {sidebarVisible ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
        </button>

        <div className="current-model-info">
          <div className={getStatusClass()}></div>
          <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>
            {getStatusText()}
          </span>
          {(activeModel || (typeof isLlmLoaded === "string" && isLlmLoaded)) && (
            <>
              <span style={{ color: "var(--md-sys-color-outline-variant)" }}>|</span>
              <span 
                style={{ color: "var(--md-sys-color-primary)", fontWeight: 700 }}
                title={activeModel || isLlmLoaded}
              >
                {truncateModelName(activeModel || isLlmLoaded)}
              </span>
            </>
          )}
        </div>

        {downloadInfo?.error ? (
          <button
            onClick={() => setActiveTab?.("models")}
            title={`İndirme Hatası: ${downloadInfo.error} - Model Merkezini Aç`}
            className="top-download-island error"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "5px 14px",
              background: "rgba(239, 68, 68, 0.2)",
              border: "1px solid rgba(239, 68, 68, 0.5)",
              borderRadius: "999px",
              color: "#f87171",
              fontSize: "0.82rem",
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 2px 12px rgba(239, 68, 68, 0.2)",
              transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)"
            }}
          >
            <AlertTriangle size={15} style={{ color: "#ef4444", flexShrink: 0 }} />
            <span style={{ zIndex: 1, whiteSpace: "nowrap" }}>
              İndirme Hatası: {truncateModelName(downloadInfo.filename || downloadInfo.error)}
            </span>
            <span style={{ 
              zIndex: 1, 
              background: "rgba(239, 68, 68, 0.35)", 
              border: "1px solid rgba(239, 68, 68, 0.5)",
              padding: "1px 7px", 
              borderRadius: "10px", 
              fontSize: "0.72rem",
              color: "#fecaca",
              fontWeight: 700
            }}>
              İncele
            </span>
          </button>
        ) : (downloadInfo?.active || (downloadInfo?.queue && downloadInfo.queue.length > 0) || downloadInfo?.queueCount > 0 || downloadInfo?.queue_count > 0) && (
          <button
            onClick={() => setActiveTab?.("models")}
            title="Model Merkezini Aç ve İndirme Kuyruğunu Yönet"
            className="top-download-island"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "5px 14px",
              background: "linear-gradient(135deg, rgba(37, 99, 235, 0.18), rgba(124, 58, 237, 0.18))",
              border: "1px solid rgba(59, 130, 246, 0.4)",
              borderRadius: "999px",
              color: "var(--md-sys-color-primary, #60a5fa)",
              fontSize: "0.82rem",
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 2px 12px rgba(37, 99, 235, 0.15)",
              transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
              position: "relative",
              overflow: "hidden"
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                bottom: 0,
                width: `${Math.min(100, Math.max(0, Math.round(downloadInfo.percent ?? downloadInfo.progress ?? 0)))}%`,
                background: "linear-gradient(90deg, rgba(59, 130, 246, 0.25), rgba(168, 85, 247, 0.25))",
                pointerEvents: "none",
                transition: "width 0.3s ease"
              }}
            />
            <DownloadCloud size={15} style={{ animation: "pulse 1.5s infinite", color: "#60a5fa", zIndex: 1, flexShrink: 0 }} />
            <span style={{ zIndex: 1, whiteSpace: "nowrap" }}>
              {downloadInfo.active 
                ? `${truncateModelName(downloadInfo.displayName || downloadInfo.name || downloadInfo.filename || "Model")} %${Math.min(100, Math.max(0, Math.round(downloadInfo.percent ?? downloadInfo.progress ?? 0)))}` 
                : "Kuyruk Bekliyor"}
            </span>
            {(downloadInfo.speed_mb_s > 0 || (typeof downloadInfo.speed === "string" && downloadInfo.speed && !downloadInfo.speed.startsWith("0 "))) && (
              <span style={{ zIndex: 1, opacity: 0.85, fontSize: "0.74rem", fontFamily: "monospace" }}>
                • {downloadInfo.speed_mb_s > 0 ? `${downloadInfo.speed_mb_s} MB/s` : downloadInfo.speed}
              </span>
            )}
            {(downloadInfo.queue_count > 0 || downloadInfo.queueCount > 0 || (downloadInfo.queue && downloadInfo.queue.length > 0)) && (
              <span style={{ 
                zIndex: 1, 
                background: "rgba(168, 85, 247, 0.35)", 
                border: "1px solid rgba(168, 85, 247, 0.5)",
                padding: "1px 7px", 
                borderRadius: "10px", 
                fontSize: "0.72rem",
                color: "#e9d5ff",
                fontWeight: 700
              }}>
                +{downloadInfo.queue_count || downloadInfo.queueCount || downloadInfo.queue?.length} sırada
              </span>
            )}
          </button>
        )}
      </div>

      <div className="telemetry-group" style={{ position: "relative" }}>
        {setUiLanguage && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              background: "var(--md-sys-color-surface-container-high, rgba(255,255,255,0.06))",
              border: "1px solid var(--border-color, rgba(255,255,255,0.12))",
              borderRadius: "999px",
              padding: "2px",
              marginRight: "6px",
              gap: "2px",
            }}
            title="Uygulama Dili: Türkçe (Ana Dil) / English"
          >
            <Globe size={13} style={{ marginLeft: "6px", marginRight: "2px", opacity: 0.7 }} />
            <button
              type="button"
              onClick={() => setUiLanguage("tr")}
              style={{
                border: "none",
                background: uiLanguage !== "en" ? "var(--md-sys-color-primary, #3b82f6)" : "transparent",
                color: uiLanguage !== "en" ? "var(--md-sys-color-on-primary, #fff)" : "var(--text-secondary)",
                borderRadius: "999px",
                padding: "3px 8px",
                fontSize: "0.72rem",
                fontWeight: 700,
                cursor: "pointer",
                transition: "all 0.18s ease",
              }}
              title="Türkçe (Ana Dil / Varsayılan)"
            >
              TR
            </button>
            <button
              type="button"
              onClick={() => setUiLanguage("en")}
              style={{
                border: "none",
                background: uiLanguage === "en" ? "var(--md-sys-color-primary, #3b82f6)" : "transparent",
                color: uiLanguage === "en" ? "var(--md-sys-color-on-primary, #fff)" : "var(--text-secondary)",
                borderRadius: "999px",
                padding: "3px 8px",
                fontSize: "0.72rem",
                fontWeight: 700,
                cursor: "pointer",
                transition: "all 0.18s ease",
              }}
              title="English (İngilizce Dil Desteği)"
            >
              EN
            </button>
          </div>
        )}
        <button
          className="theme-toggle-btn"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          title={`${isDark ? "Açık" : "Koyu"} temaya geç`}
        >
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <div ref={menuRef} style={{ position: "relative", display: "inline-block" }}>
          <button
            className={`theme-toggle-btn ${showThemeMenu ? "active" : ""}`}
            onClick={() => setShowThemeMenu(!showThemeMenu)}
            title="Özel bir renk teması seçin"
            style={{ marginRight: "12px" }}
          >
            <Palette size={18} />
          </button>
          
          {showThemeMenu && (
            <div className="theme-dropdown-menu">
              <div className="theme-dropdown-header">Tema Seçimi</div>
              <div className="theme-dropdown-divider"></div>
              {THEMES.map((t) => {
                const isActive = theme === t.id;
                return (
                  <button
                    key={t.id}
                    className={`theme-dropdown-item ${isActive ? "active" : ""}`}
                    onClick={() => {
                      setTheme(t.id);
                      setShowThemeMenu(false);
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%" }}>
                      <div style={{ display: "flex", gap: "2px" }}>
                        <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: t.primary }} />
                        <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: t.secondary }} />
                      </div>
                      <span className="theme-name-text">{t.name}</span>
                      {isActive && <Check size={12} style={{ marginLeft: "auto", color: "var(--md-sys-color-primary)" }} />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <button
          className={`top-bar-update-btn ${updateStatus?.updateAvailable ? "has-update" : ""}`}
          onClick={handleCheckUpdate}
          disabled={isCheckingUpdate}
          title="Sürüm ve Güncellemeleri Denetle (v2.0.0)"
        >
          <RefreshCw size={13} className={isCheckingUpdate ? "progress-spinner" : ""} />
          <span>{updateStatus?.updateAvailable ? "Güncelleme Var!" : "v2.0.0 Güncelleme"}</span>
        </button>

        {serverRunning && (
          <button
            className="m3-btn m3-btn-error"
            style={{ height: "34px", padding: "0 14px" }}
            onClick={onStopServer}
            disabled={isStoppingServer}
            title="Yerel model sunucusunu durdur"
          >
            {isStoppingServer ? <RefreshCw className="progress-spinner" size={14} /> : <Square size={14} />}
            <span>{isStoppingServer ? "Durduruluyor" : "Sunucuyu Durdur"}</span>
          </button>
        )}

        {/* CPU Telemetry Chip */}
        <div className="telemetry-chip telemetry-chip-cpu" title="İşlemci Kullanımı (CPU Usage)">
          <span className="telemetry-led led-cpu"></span>
          <span className="telemetry-label">CPU</span>
          <span className="telemetry-val">{Number.isFinite(Number(telemetry.cpu_usage)) ? Math.round(Number(telemetry.cpu_usage)) : "--"}%</span>
        </div>

        {/* RAM Telemetry Chip */}
        <div className="telemetry-chip telemetry-chip-ram" title="Sistem Belleği Kullanımı (RAM Usage)">
          <span className="telemetry-led led-ram"></span>
          <span className="telemetry-label">RAM</span>
          <span className="telemetry-val">{formatGb(telemetry.ram_used_gb)}/{formatGb(telemetry.ram_total_gb)} GB</span>
        </div>

        {/* GPU VRAM Telemetry Chip */}
        {telemetry.vram_total_gb > 0 && (
          <div className="telemetry-chip telemetry-chip-vram" title={`${telemetry.gpu_name} Video Belleği (VRAM)`}>
            <span className="telemetry-led led-vram"></span>
            <span className="telemetry-label">VRAM</span>
            <span className="telemetry-val">{formatGb(telemetry.vram_used_gb, { allowZero: true })}/{formatGb(telemetry.vram_total_gb)} GB</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(TopStatusBar);
