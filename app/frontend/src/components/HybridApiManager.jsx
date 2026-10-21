import React, { useState, useEffect, useCallback } from "react";
import { uiText } from "../i18n";
import {
  Key,
  Globe,
  Sparkles,
  Bot,
  Volume2,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  Eye,
  EyeOff,
  Trash2,
  Zap,
} from "lucide-react";

const PROVIDERS = [
  {
    id: "openrouter",
    name: "OpenRouter (Önerilen)",
    category: "all",
    badge: "300+ Model Tek Anahtarla",
    badgeColor: "#8b5cf6",
    desc: "Tek bir API anahtarıyla Claude, GPT-5, Gemini, DeepSeek, Llama ve yüzlerce modele erişin. Sohbet ve (Nano Banana / GPT-5 Image ile) görsel üretiminde kullanılır.",
    docsUrl: "https://openrouter.ai/keys",
    keyPrefix: "sk-or-",
    placeholder: "sk-or-v1-...",
    models: [
      "minimax/minimax-m3.1-flash:free",
      "google/gemma-4-31b-it:free",
      "deepseek/deepseek-v4-flash",
      "deepseek/deepseek-r1-0528",
      "anthropic/claude-sonnet-5.5",
      "openai/gpt-5.5",
      "google/gemini-2.5-flash",
      "meta-llama/llama-3.3-70b-instruct",
      "minimax/minimax-m2.7"
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    category: "chat",
    badge: "Zirve Mantık & Kod",
    badgeColor: "#d97706",
    desc: "Claude Opus 5.5, Sonnet 5.5 ve Haiku 5.5 modelleri için doğrudan Anthropic bağlantısı.",
    docsUrl: "https://console.anthropic.com/settings/keys",
    keyPrefix: "sk-ant-",
    placeholder: "sk-ant-api03-...",
    models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    category: "audio",
    badge: "Stüdyo Kalite Ses",
    badgeColor: "#2563eb",
    desc: "Bulut seslendirme servisi. Ses & Müzik Stüdyosu'nda eleven_multilingual_v2 modeli (Türkçe destekli) kullanılır.",
    docsUrl: "https://elevenlabs.io/app/settings/api-keys",
    keyPrefix: "sk_",
    placeholder: "sk_...",
    models: ["eleven_multilingual_v2"],
  },
  {
    id: "openai",
    name: "OpenAI",
    category: "chat",
    badge: "GPT-5 & GPT Image",
    badgeColor: "#10b981",
    desc: "GPT-5.5 / GPT-5.4 Mini sohbet, gpt-image-2 görsel ve tts-1-hd seslendirme için doğrudan OpenAI bağlantısı. (DALL-E 2/3 Mayıs 2026'da kapatıldı.)",
    docsUrl: "https://platform.openai.com/api-keys",
    keyPrefix: "sk-",
    placeholder: "sk-proj-...",
    models: ["gpt-5.5", "gpt-5.4-mini", "gpt-image-2", "tts-1-hd"],
  },
  {
    id: "gemini",
    name: "Google Gemini",
    category: "chat",
    badge: "Hızlı & Geniş Bağlam",
    badgeColor: "#3b82f6",
    desc: "Gemini 2.5 Flash / Pro sohbet ve Gemini 2.5 Flash Image (\"Nano Banana\") görsel üretimi için Google AI Studio bağlantısı. (Imagen modelleri Haziran 2026'da kapatıldı.)",
    docsUrl: "https://aistudio.google.com/app/apikey",
    keyPrefix: "AIza",
    placeholder: "AIzaSy...",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-image"],
  },
  {
    id: "minimax",
    name: "MiniMax (Hailuo AI)",
    category: "all",
    badge: "Video & Ses & Görsel",
    badgeColor: "#ec4899",
    desc: "MiniMax Hailuo 02 / 2.3 (metinden video), speech-2.8-hd (seslendirme) ve image-01 (görsel) için resmi MiniMax API (api.minimax.io).",
    docsUrl: "https://platform.minimax.io",
    keyPrefix: "",
    placeholder: "MiniMax API anahtarınız...",
    models: ["MiniMax-Hailuo-02", "MiniMax-Hailuo-2.3", "speech-2.8-hd", "image-01"],
  },
];

export default function HybridApiManager({ showAlert, showConfirm }) {
  const [selectedProviderId, setSelectedProviderId] = useState("openrouter");
  const [apiKeys, setApiKeys] = useState({});
  const [customModels, setCustomModels] = useState({});
  const [newCustomModelInput, setNewCustomModelInput] = useState("");
  const [currentInputKey, setCurrentInputKey] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [testingStatus, setTestingStatus] = useState({});
  const [isLoading, setIsLoading] = useState(true);

  const selectedProvider = PROVIDERS.find((p) => p.id === selectedProviderId) || PROVIDERS[0];

  // API Anahtarlarını yerel backend'den yükle
  const loadConfig = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/providers/config");
      if (res.ok) {
        const data = await res.json();
        // The server only returns masked keys (e.g. "sk-or-••••abcd"); real keys never reach the browser.
        setApiKeys(data.keys || {});
        setCustomModels(data.customModels || {});
      }
    } catch (_) {
    } finally {
      // Remove keys stored in plain text by older versions.
      try { localStorage.removeItem("ddyz_hybrid_api_keys"); } catch (_) {}
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    setCurrentInputKey(apiKeys[selectedProviderId] || "");
    setShowPassword(false);
  }, [selectedProviderId, apiKeys]);

  // Anahtarı kaydet
  const handleSaveKey = async () => {
    const updated = { ...apiKeys };
    const trimmed = currentInputKey.trim();
    if (trimmed) {
      updated[selectedProviderId] = trimmed;
    } else {
      delete updated[selectedProviderId];
    }
    try {
      const res = await fetch("/api/providers/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: updated }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      setApiKeys(data.keys || {});
      showAlert?.({
        title: "Kaydedildi",
        message: uiText(`${selectedProvider.name} API anahtarı bu bilgisayardaki app/config/api-providers.json dosyasına kaydedildi.`, `${selectedProvider.name} API key was saved to app/config/api-providers.json on this computer.`),
      });
    } catch (err) {
      showAlert?.({ title: "Kaydedilemedi", message: err.message || String(err), danger: true });
    }
  };

  // Anahtarı sil
  const handleDeleteKey = async (providerId) => {
    const confirm = await showConfirm?.({
      title: uiText("API Anahtarını Sil", "Delete API Key"),
      message: uiText(`${providerId.toUpperCase()} API anahtarını yerel depolamadan kaldırmak istiyor musunuz?`, `Do you want to remove the ${providerId.toUpperCase()} API key from local storage?`),
      confirmLabel: "Sil",
      danger: true,
    });
    if (!confirm) return;

    const updated = { ...apiKeys };
    delete updated[providerId];
    setApiKeys(updated);

    if (selectedProviderId === providerId) {
      setCurrentInputKey("");
    }

    try {
      await fetch("/api/providers/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: updated }),
      });
    } catch (_) {}
  };

  // Bağlantıyı test et
  const handleTestConnection = async () => {
    const key = currentInputKey.trim();
    if (!key) {
      showAlert?.({ title: uiText("Uyarı", "Warning"), message: uiText("Lütfen önce bir API anahtarı girin.", "Please enter an API key first.") });
      return;
    }

    setTestingStatus((prev) => ({ ...prev, [selectedProviderId]: "testing" }));
    try {
      const res = await fetch("/api/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: selectedProviderId, apiKey: key }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setTestingStatus((prev) => ({ ...prev, [selectedProviderId]: "success" }));
        showAlert?.({
          title: uiText("Bağlantı Başarılı! ", "Connection Successful!"),
          message: uiText(`${selectedProvider.name} API servisine başarıyla bağlanıldı. İlgili modeller arayüzde kullanıma hazır!`, `Connected to the ${selectedProvider.name} API. Its models are ready to use in the app!`),
        });
      } else {
        throw new Error(data.error || "Doğrulama başarısız.");
      }
    } catch (err) {
      setTestingStatus((prev) => ({ ...prev, [selectedProviderId]: "error" }));
      showAlert?.({
        title: uiText("Bağlantı Hatası", "Connection Error"),
        message: uiText(`${selectedProvider.name} API anahtarı doğrulanamadı: ${err.message}`, `The ${selectedProvider.name} API key could not be verified: ${err.message}`),
        danger: true,
      });
    }
  };

  return (
    <div className="api-manager-container" style={{ padding: "24px", maxWidth: "900px", margin: "0 auto" }}>
      {/* Başlık Alanı */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
          <Zap size={24} color="#8b5cf6" />
          <h2 style={{ fontSize: "22px", fontWeight: "700", margin: 0 }}>Hibrit Bulut API & Servis Yöneticisi</h2>
        </div>
        <p style={{ color: "var(--md-sys-color-on-surface-variant)", margin: 0, fontSize: "14px", lineHeight: "1.5" }}>
          Yerel donanımınız yetmediğinde veya Claude, GPT, Gemini, ElevenLabs gibi bulut modellerini kullanmak istediğinizde kendi API anahtarınızı tanımlayın. Anahtarlar yalnızca ilgili servisin kendi API'sine gönderilir; bulut istekleri ücretlendirilebilir ve içerik o servise iletilir.
        </p>
      </div>

      {/* Güvenlik Rozeti */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          background: "rgba(16, 185, 129, 0.1)",
          border: "1px solid rgba(16, 185, 129, 0.3)",
          borderRadius: "10px",
          padding: "12px 16px",
          marginBottom: "24px",
          color: "#10b981",
          fontSize: "13px",
        }}
      >
        <ShieldCheck size={20} />
        <span>
          <strong>Yerel Saklama:</strong> Anahtarlar bu bilgisayarda app/config/api-providers.json dosyasında (şifrelenmeden) tutulur; arayüze yalnızca maskelenmiş hali gönderilir. Bu klasörü paylaşırken anahtarlarınızı silin.
        </span>
      </div>

      {/* Ana Dropdown Seçim Kartı */}
      <div
        className="m3-card"
        style={{
          background: "var(--md-sys-color-surface-container)",
          borderRadius: "16px",
          padding: "24px",
          border: "1px solid var(--md-sys-color-outline-variant)",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.15)",
        }}
      >
        <div style={{ marginBottom: "20px" }}>
          <label style={{ display: "block", fontSize: "14px", fontWeight: "600", marginBottom: "8px" }}>
            Bağlanmak İstediğiniz Yapay Zekâ Servisini Seçin:
          </label>
          <div style={{ position: "relative" }}>
            <select
              value={selectedProviderId}
              onChange={(e) => setSelectedProviderId(e.target.value)}
              style={{
                width: "100%",
                padding: "14px 16px",
                fontSize: "15px",
                fontWeight: "500",
                borderRadius: "10px",
                border: "1px solid var(--md-sys-color-outline)",
                background: "var(--md-sys-color-surface)",
                color: "var(--md-sys-color-on-surface)",
                cursor: "pointer",
                outline: "none",
              }}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — ({p.badge})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Seçilen Sağlayıcı Bilgi Kutusu */}
        <div
          style={{
            background: "var(--md-sys-color-surface)",
            borderRadius: "12px",
            padding: "16px",
            marginBottom: "20px",
            border: "1px solid var(--md-sys-color-outline-variant)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "16px", fontWeight: "700" }}>{selectedProvider.name}</span>
            <span
              style={{
                background: selectedProvider.badgeColor || "var(--md-sys-color-primary)",
                color: "#fff",
                fontSize: "11px",
                padding: "3px 8px",
                borderRadius: "6px",
                fontWeight: "600",
              }}
            >
              {selectedProvider.badge}
            </span>
          </div>
          <p style={{ fontSize: "13px", color: "var(--md-sys-color-on-surface-variant)", margin: "0 0 12px 0" }}>
            {selectedProvider.desc}
          </p>
          <a
            href={selectedProvider.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              color: "var(--md-sys-color-primary)",
              fontSize: "13px",
              textDecoration: "none",
              fontWeight: "600",
            }}
          >
            <span>{selectedProvider.name} API Anahtarı Sayfasına Git</span>
            <ExternalLink size={14} />
          </a>
        </div>

        {/* API Anahtarı Giriş Alanı */}
        <div style={{ marginBottom: "20px" }}>
          <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}>
            API Anahtarı (API Key):
          </label>
          <div style={{ display: "flex", gap: "8px" }}>
            <div style={{ position: "relative", flex: 1 }}>
              <input
                type={showPassword ? "text" : "password"}
                value={currentInputKey}
                onChange={(e) => setCurrentInputKey(e.target.value)}
                placeholder={selectedProvider.placeholder}
                style={{
                  width: "100%",
                  padding: "12px 42px 12px 14px",
                  borderRadius: "10px",
                  border: "1px solid var(--md-sys-color-outline)",
                  background: "var(--md-sys-color-surface)",
                  color: "var(--md-sys-color-on-surface)",
                  fontFamily: "monospace",
                  fontSize: "14px",
                  boxSizing: "border-box",
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: "absolute",
                  right: "12px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  color: "var(--md-sys-color-on-surface-variant)",
                  cursor: "pointer",
                  padding: 0,
                }}
                title={showPassword ? "Gizle" : "Göster"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <button
              onClick={handleSaveKey}
              className="m3-btn m3-btn-filled"
              style={{ padding: "0 20px", height: "46px", borderRadius: "10px", fontWeight: "600" }}
            >
              Kaydet
            </button>
            <button
              onClick={handleTestConnection}
              className="m3-btn m3-btn-outlined"
              disabled={testingStatus[selectedProviderId] === "testing"}
              style={{ padding: "0 18px", height: "46px", borderRadius: "10px", fontWeight: "600" }}
            >
              {testingStatus[selectedProviderId] === "testing" ? (
                <RefreshCw size={16} className="spin" />
              ) : (
                "Bağlantıyı Test Et"
              )}
            </button>
          </div>
        </div>

        {/* Seçili Sağlayıcının Model Listelerinde Görünecek Modelleri ve Özel Model Ekleme */}
        <div style={{ marginTop: "20px", padding: "16px", borderRadius: "12px", background: "var(--md-sys-color-surface)", border: "1px solid var(--md-sys-color-outline-variant)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", flexWrap: "wrap", gap: "8px" }}>
            <span style={{ fontSize: "13px", fontWeight: "700" }}>
              {selectedProvider.name} — Model Seçim Listelerinde Görünecek Modeller:
            </span>
            <span style={{
              fontSize: "11px",
              fontWeight: "700",
              padding: "3px 8px",
              borderRadius: "6px",
              background: apiKeys[selectedProviderId] ? "rgba(16, 185, 129, 0.15)" : "rgba(245, 158, 11, 0.15)",
              color: apiKeys[selectedProviderId] ? "#10b981" : "#f59e0b"
            }}>
              {apiKeys[selectedProviderId] ? "[Aktif — Yapay Zekâ Sohbeti & Stüdyo Listelerinde Seçilebilir]" : "[API Anahtarı Kaydedildiğinde Listelerde Aktif Olur]"}
            </span>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: selectedProvider.category !== "audio" ? "14px" : "0" }}>
            {[...(selectedProvider.models || []), ...(customModels[selectedProviderId] || [])].map((mId) => (
              <span
                key={mId}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "5px 10px",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontFamily: "monospace",
                  background: apiKeys[selectedProviderId] ? "rgba(139, 92, 246, 0.14)" : "rgba(255, 255, 255, 0.05)",
                  border: `1px solid ${apiKeys[selectedProviderId] ? "rgba(139, 92, 246, 0.4)" : "rgba(255, 255, 255, 0.1)"}`,
                  color: "var(--md-sys-color-on-surface)"
                }}
              >
                <span>{mId}</span>
                {(customModels[selectedProviderId] || []).includes(mId) && (
                  <button
                    type="button"
                    onClick={async () => {
                      const nextList = (customModels[selectedProviderId] || []).filter((x) => x !== mId);
                      const nextCustom = { ...customModels, [selectedProviderId]: nextList };
                      setCustomModels(nextCustom);
                      try {
                        await fetch("/api/providers/config", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ keys: apiKeys, customModels: nextCustom }),
                        });
                      } catch (_) {}
                    }}
                    style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", padding: 0, fontSize: "12px", fontWeight: "700" }}
                    title="Özel modeli kaldır"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>

          {selectedProvider.category !== "audio" && (
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <input
                type="text"
                value={newCustomModelInput}
                onChange={(e) => setNewCustomModelInput(e.target.value)}
                placeholder="Özel model kimliği ekle (Örn: minimax/minimax-m2.5 veya qwen/qwen3-235b-a22b)"
                style={{
                  flex: 1,
                  padding: "9px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--md-sys-color-outline)",
                  background: "var(--md-sys-color-surface-container)",
                  color: "var(--md-sys-color-on-surface)",
                  fontSize: "12px",
                  fontFamily: "monospace"
                }}
              />
              <button
                type="button"
                className="m3-btn m3-btn-tonal"
                style={{ height: "36px", padding: "0 14px", fontSize: "12px", fontWeight: "600", borderRadius: "8px" }}
                onClick={async () => {
                  const clean = newCustomModelInput.trim();
                  if (!clean) return;
                  const existing = customModels[selectedProviderId] || [];
                  if (existing.includes(clean) || (selectedProvider.models || []).includes(clean)) {
                    setNewCustomModelInput("");
                    return;
                  }
                  const nextCustom = { ...customModels, [selectedProviderId]: [...existing, clean] };
                  setCustomModels(nextCustom);
                  setNewCustomModelInput("");
                  try {
                    await fetch("/api/providers/config", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ keys: apiKeys, customModels: nextCustom }),
                    });
                    showAlert?.({
                      title: "Model Listeye Eklendi",
                      message: uiText(`"${clean}" modeli Yapay Zekâ Sohbeti (LLM) model listesine eklendi.`, `"${clean}" was added to the AI Chat (LLM) model list.`)
                    });
                  } catch (_) {}
                }}
              >
                Model Listesine Ekle
              </button>
            </div>
          )}
        </div>

        {/* Aktif Tanımlı Servisler Listesi */}
        <div style={{ marginTop: "28px", borderTop: "1px solid var(--md-sys-color-outline-variant)", paddingTop: "20px" }}>
          <h4 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "12px", margin: "0 0 12px 0" }}>
            Mevcut Yapılandırılmış API Servisleriniz:
          </h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            {PROVIDERS.map((p) => {
              const hasKey = Boolean(apiKeys[p.id]);
              return (
                <div
                  key={p.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    background: hasKey ? "rgba(16, 185, 129, 0.12)" : "rgba(255, 255, 255, 0.04)",
                    border: `1px solid ${hasKey ? "rgba(16, 185, 129, 0.3)" : "rgba(255, 255, 255, 0.1)"}`,
                    borderRadius: "8px",
                    padding: "6px 12px",
                    fontSize: "13px",
                  }}
                >
                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: hasKey ? "#10b981" : "#6b7280" }} />
                  <span style={{ fontWeight: "500" }}>{p.name}</span>
                  {hasKey ? (
                    <button
                      onClick={() => handleDeleteKey(p.id)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#ef4444",
                        cursor: "pointer",
                        padding: "2px",
                        display: "flex",
                        alignItems: "center",
                      }}
                      title="Anahtarı Kaldır"
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : (
                    <span style={{ color: "#6b7280", fontSize: "11px" }}>Bağlı Değil</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
