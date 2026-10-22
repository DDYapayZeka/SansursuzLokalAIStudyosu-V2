import React, { memo } from "react";
import {
  Image,
  FolderDown,
  MessageSquare,
  Mic,
  Settings,
  Terminal,
  ChevronDown,
  ChevronUp,
  Trash2,
  Volume2,
  Film,
  Zap,
  Radio,
} from "lucide-react";

function formatSidebarDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const dateStr = date.toLocaleDateString();
  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${dateStr} ${timeStr}`;
}

function Sidebar({
  collapsed = false,
  activeTab,
  setActiveTab,
  specs,
  conversations = [],
  activeConversationId,
  setActiveConversationId,
  showHistory,
  setShowHistory,
  onDeleteConversation,
  speechTranscriptions = [],
  selectedSpeechTranscript,
  setSelectedSpeechTranscript,
  showSpeechHistory,
  setShowSpeechHistory,
  onDeleteSpeechTranscription,
  ttsOutputs = [],
  selectedTtsOutput,
  setSelectedTtsOutput,
  showTtsHistory,
  setShowTtsHistory,
  onDeleteTtsOutput
}) {
  return (
    <div className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div>
        {/* Sidebar Header with DD:YZ Glass Branding */}
        <div className="sidebar-logo" style={{ display: "flex", alignItems: "center", gap: "12px", padding: "16px 16px 20px 16px" }}>
          <div style={{
            position: "relative",
            width: "40px",
            height: "40px",
            borderRadius: "12px",
            padding: "2px",
            background: "linear-gradient(135deg, rgba(255,255,255,0.4), rgba(255,255,255,0.06))",
            boxShadow: "0 4px 16px rgba(139, 92, 246, 0.35), inset 0 1px 1px rgba(255,255,255,0.6)",
            flexShrink: 0
          }}>
            <img className="sidebar-logo-icon" src="/logo.png?v=2" alt="DD:YZ logosu" style={{ width: "100%", height: "100%", borderRadius: "10px", objectFit: "cover" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span className="sidebar-logo-text" style={{ fontWeight: "800", fontSize: "15px", letterSpacing: "-0.4px", whiteSpace: "nowrap" }}>
              DD:YZ Stüdyo
            </span>
            <span style={{ fontSize: "10px", color: "var(--md-sys-color-primary)", fontWeight: "700", letterSpacing: "0.4px", textTransform: "uppercase" }}>
              DD:YZ Glass Edition
            </span>
          </div>
        </div>

        {/* Sidebar Navigation Links */}
        <div className="nav-list">
          {/* 1. Yapay Zekâ Sohbeti */}
          <div className="nav-item-wrapper" style={{ display: "flex", flexDirection: "column" }}>
            <div
              className={`nav-item ${activeTab === "chat" ? "active" : ""}`}
              onClick={() => setActiveTab("chat")}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", boxSizing: "border-box" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <MessageSquare size={20} />
                <span>Yapay Zekâ Sohbeti</span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowHistory(!showHistory);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "inherit",
                  cursor: "pointer",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "50%",
                  transition: "background-color 0.2s"
                }}
                className="history-toggle-arrow"
                title={showHistory ? "Sohbet Geçmişini Gizle" : "Sohbet Geçmişini Göster"}
              >
                {showHistory ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>

            {/* Sidebar Chat History List */}
            {showHistory && (
              <div
                className="sidebar-history-list"
                style={{
                  paddingLeft: "14px",
                  marginTop: "6px",
                  marginBottom: "6px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  maxHeight: "220px",
                  overflowY: "auto",
                  borderLeft: "2px solid var(--border-color)"
                }}
              >
                {conversations.length === 0 ? (
                  <div style={{ padding: "8px 12px", fontSize: "0.78rem", color: "var(--md-sys-color-outline)", opacity: 0.8 }}>
                    Kayıtlı sohbet bulunmuyor
                  </div>
                ) : (
                  conversations.map((conv) => {
                    const isActive = activeConversationId === conv.id;
                    return (
                      <div
                        key={conv.id}
                        onClick={() => {
                          setActiveConversationId(conv.id);
                          setActiveTab("chat");
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "6px 8px 6px 10px",
                          borderRadius: "var(--md-shape-corner-small)",
                          fontSize: "0.78rem",
                          cursor: "pointer",
                          background: isActive ? "var(--md-sys-color-secondary-container)" : "transparent",
                          color: isActive ? "var(--md-sys-color-on-secondary-container)" : "var(--md-sys-color-on-surface-variant)",
                          border: isActive ? "1px solid var(--md-sys-color-outline-variant)" : "1px solid transparent",
                          transition: "background 0.2s"
                        }}
                        className="sidebar-history-item"
                        title={conv.title}
                      >
                        <span style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          flex: 1,
                          fontWeight: isActive ? 600 : 400
                        }}>
                          {conv.title}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteConversation(conv.id, e);
                          }}
                          style={{
                            background: "none",
                            border: "none",
                            color: "var(--md-sys-color-outline)",
                            cursor: "pointer",
                            padding: "2px",
                            marginLeft: "6px",
                            display: "flex",
                            alignItems: "center"
                          }}
                          className="sidebar-history-delete"
                          title="Sohbeti Sil"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* 2. Görsel Stüdyosu */}
          <div
            className={`nav-item ${activeTab === "generator" ? "active" : ""}`}
            onClick={() => setActiveTab("generator")}
          >
            <Image size={20} />
            <span>Görsel Stüdyosu</span>
          </div>

          {/* 3. Ses & Müzik Stüdyosu */}
          <div
            className={`nav-item ${activeTab === "audio" ? "active" : ""}`}
            onClick={() => setActiveTab("audio")}
          >
            <Volume2 size={20} />
            <span>Ses & Müzik Stüdyosu</span>
          </div>

          {/* 4. Video Stüdyosu */}
          <div
            className={`nav-item ${activeTab === "video" ? "active" : ""}`}
            onClick={() => setActiveTab("video")}
          >
            <Film size={20} />
            <span>Video Stüdyosu</span>
          </div>

          {/* 5. Ses Tanıma (Whisper) */}
          <div className="nav-item-wrapper" style={{ display: "flex", flexDirection: "column" }}>
            <div
              className={`nav-item ${activeTab === "speech" ? "active" : ""}`}
              onClick={() => setActiveTab("speech")}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", boxSizing: "border-box" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <Mic size={20} />
                <span>Ses Tanıma (Whisper)</span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSpeechHistory(!showSpeechHistory);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "inherit",
                  cursor: "pointer",
                  padding: "4px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "50%",
                  transition: "background-color 0.2s"
                }}
                className="history-toggle-arrow"
                title={showSpeechHistory ? "Döküm Geçmişini Gizle" : "Döküm Geçmişini Göster"}
              >
                {showSpeechHistory ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>

            {showSpeechHistory && (
              <div
                className="sidebar-history-list"
                style={{
                  paddingLeft: "14px",
                  marginTop: "6px",
                  marginBottom: "6px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  maxHeight: "220px",
                  overflowY: "auto",
                  borderLeft: "2px solid var(--border-color)"
                }}
              >
                {speechTranscriptions.length === 0 ? (
                  <div style={{ padding: "8px 12px", fontSize: "0.78rem", color: "var(--md-sys-color-outline)", opacity: 0.8 }}>
                    Kayıtlı ses dökümü bulunmuyor
                  </div>
                ) : (
                  speechTranscriptions.map((item) => {
                    const itemId = item.filename || item.metadata || item.textFile;
                    const isActive = selectedSpeechTranscript && (selectedSpeechTranscript.filename || selectedSpeechTranscript.metadata || selectedSpeechTranscript.textFile) === itemId;
                    const title = item.displayName || item.sourceFilename || item.textFile || item.filename || "Transcript";
                    const date = formatSidebarDate(item.modifiedAt || item.createdAt);
                    return (
                      <div
                        key={itemId}
                        onClick={() => {
                          setSelectedSpeechTranscript(item);
                          setActiveTab("speech");
                        }}
                        style={{
                          display: "flex",
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "7px 8px 7px 10px",
                          borderRadius: "var(--md-shape-corner-small)",
                          fontSize: "0.78rem",
                          cursor: "pointer",
                          background: isActive ? "var(--md-sys-color-secondary-container)" : "transparent",
                          color: isActive ? "var(--md-sys-color-on-secondary-container)" : "var(--md-sys-color-on-surface-variant)",
                          border: isActive ? "1px solid var(--md-sys-color-outline-variant)" : "1px solid transparent",
                          transition: "background 0.2s"
                        }}
                        className="sidebar-history-item"
                        title={title}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1, minWidth: 0 }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: isActive ? 600 : 400 }}>
                            {title}
                          </span>
                          {date && (
                            <span style={{ fontSize: "0.68rem", opacity: 0.72, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {date}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteSpeechTranscription?.(item, e);
                          }}
                          style={{
                            background: "none",
                            border: "none",
                            color: "var(--md-sys-color-outline)",
                            cursor: "pointer",
                            padding: "2px",
                            marginLeft: "6px",
                            display: "flex",
                            alignItems: "center"
                          }}
                          className="sidebar-history-delete"
                          title="Dökümü Sil"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* 6. Model Merkezi */}
          <div
            className={`nav-item ${activeTab === "models" ? "active" : ""}`}
            onClick={() => setActiveTab("models")}
          >
            <FolderDown size={20} />
            <span>Model Merkezi</span>
          </div>

          {/* 7. Hibrit API & Bulut */}
          <div
            className={`nav-item ${activeTab === "api" ? "active" : ""}`}
            onClick={() => setActiveTab("api")}
          >
            <Zap size={20} />
            <span>Hibrit API & Bulut</span>
          </div>

          {/* 8. Ayarlar & Güncelleme */}
          <div
            className={`nav-item ${activeTab === "settings" ? "active" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            <Settings size={20} />
            <span>Ayarlar & Güncelleme</span>
          </div>
        </div>
      </div>

      {/* Sidebar Footer with Host Telemetry System Specs and DD:YZ YouTube link */}
      <div className="sidebar-footer" style={{ borderTop: "1px solid var(--border-color)", paddingTop: "14px" }}>
        <div
          onClick={() => setActiveTab("settings")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 12px",
            background: "rgba(255, 255, 255, 0.05)",
            backdropFilter: "blur(12px)",
            border: "1px solid var(--border-color)",
            borderRadius: "10px",
            fontSize: "11px",
            fontWeight: 600,
            cursor: "pointer",
            marginBottom: "10px",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.1)",
            transition: "all 0.2s ease",
          }}
          title="Ayarlar & Güncelleme sayfasına git"
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
            <span>Sürüm: v2.0.0</span>
          </div>
          <span style={{ color: "var(--md-sys-color-primary)", fontWeight: 700 }}>DD:YZ Glass</span>
        </div>

        <a
          href="https://www.youtube.com/@derinedaliyoruzyapayzeka"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            padding: "8px 12px",
            background: "rgba(255, 59, 48, 0.12)",
            border: "1px solid rgba(255, 59, 48, 0.25)",
            borderRadius: "10px",
            color: "#ff453a",
            textDecoration: "none",
            fontSize: "12px",
            fontWeight: "600",
            marginBottom: "12px",
            boxShadow: "0 2px 8px rgba(255, 59, 48, 0.15)",
            transition: "all 0.2s ease",
          }}
          className="sidebar-yt-btn"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
          </svg>
          <span>DD:YZ YouTube Kanalı</span>
        </a>

        {/* Apple macOS style hardware badge */}
        <div style={{
          padding: "10px 12px",
          background: "rgba(255, 255, 255, 0.03)",
          backdropFilter: "blur(16px)",
          border: "1px solid var(--border-color)",
          borderRadius: "12px",
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          fontSize: "11px",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 700, color: "var(--md-sys-color-primary)", marginBottom: "2px" }}>
            <Terminal size={12} />
            <span>Yerel Donanım Özeti</span>
          </div>
          {specs.loading ? (
            <div style={{ color: "var(--md-sys-color-on-surface-variant)" }}>Donanım algılanıyor...</div>
          ) : specs.unavailable ? (
            <div style={{ color: "var(--md-sys-color-error, #f87171)" }}>Donanım bilgisi alınamadı</div>
          ) : (
            <>
              <div style={{ color: "var(--md-sys-color-on-surface)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={specs.gpu_name}>
                {specs.gpu_name || "GPU algılanamadı"}
              </div>
              <div style={{ color: "var(--md-sys-color-on-surface-variant)", opacity: 0.85 }}>
                {specs.ram_total_gb ? `${Number(specs.ram_total_gb).toFixed(0)} GB RAM` : "RAM ?"} • {specs.cpu_cores_physical ? `${specs.cpu_cores_physical}C CPU` : "CPU ?"}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(Sidebar);
