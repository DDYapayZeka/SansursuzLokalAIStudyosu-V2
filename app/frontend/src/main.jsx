import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("React ErrorBoundary caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: "36px",
          maxWidth: "640px",
          margin: "80px auto",
          background: "#0e1117",
          color: "#f4f4f5",
          borderRadius: "16px",
          border: "1px solid rgba(239, 68, 68, 0.4)",
          boxShadow: "0 20px 50px rgba(0,0,0,0.6)",
          fontFamily: "'Inter', sans-serif"
        }}>
          <h2 style={{ color: "#ef4444", margin: "0 0 12px 0", fontSize: "1.25rem", fontWeight: 700 }}>
            Arayüz Yüklenirken Bir Sorun Oluştu
          </h2>
          <p style={{ color: "#a1a1aa", fontSize: "0.92rem", lineHeight: 1.6, margin: "0 0 20px 0" }}>
            {this.state.error?.message || String(this.state.error)}
          </p>
          <div style={{ display: "flex", gap: "12px" }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: "10px 18px",
                background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                color: "#fff",
                border: "none",
                borderRadius: "10px",
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              Sayfayı Yenile
            </button>
            <button
              onClick={() => { localStorage.clear(); window.location.reload(); }}
              style={{
                padding: "10px 18px",
                background: "rgba(255, 255, 255, 0.08)",
                color: "#e4e4e7",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                borderRadius: "10px",
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              Önbelleği Sıfırla ve Yenile
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
