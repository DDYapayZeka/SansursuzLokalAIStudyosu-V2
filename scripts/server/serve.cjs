// serve.cjs - portable static file server + backend process manager
// Serves app/dist/, manages sd-vulkan.exe lifecycle with correct CLI flags

// Process-level crash prevention to ensure the server never exits on background network/download glitches
process.on("uncaughtException", (err) => {
  console.error("  [server-uncaughtException]", err && err.stack ? err.stack : err);
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("  [server-unhandledRejection]", reason);
});

const http     = require("http");
const https    = require("https");
const fs       = require("fs");
const net      = require("net");
const os       = require("os");
const path     = require("path");
const { spawn, spawnSync, execSync, exec, execFile } = require("child_process");
const { comprehensiveWebSearch } = require("../search/core");

// HTTP keep-alive agent for llama-server (eliminates TCP handshake per request)
const llmHttpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 1,
  keepAliveMsecs: 30000,
});

const HF_MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const hfModelCache = new Map();
const hfProjectorCache = new Map();

function readPort(value, fallback) {
  const port = parseInt(value, 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

const PORT_FRONTEND = readPort(process.env.PORT || process.env.FRONTEND_PORT, 1420);
const PREFERRED_BACKEND_PORT = readPort(process.env.BACKEND_PORT || process.env.SD_BACKEND_PORT, 8080);
const PREFERRED_LLM_PORT = readPort(process.env.LLM_PORT, 10086);
const PREFERRED_SPEECH_PORT = readPort(process.env.SPEECH_PORT, 10088);
const PREFERRED_TTS_PORT = readPort(process.env.TTS_PORT, 10089);
let PORT_BACKEND = PREFERRED_BACKEND_PORT;
let PORT_LLM = PREFERRED_LLM_PORT;
let PORT_SPEECH = PREFERRED_SPEECH_PORT;
let PORT_TTS = PREFERRED_TTS_PORT;
const MAX_JSON_BODY_BYTES = 64 * 1024 * 1024;
const SERVER_BUILD = "text-image-v1";
const ROOT    = path.join(__dirname, "..", "..");
const DIST    = path.join(ROOT, "app", "dist");
const TOOLS   = path.join(ROOT, "app", "tools");
const osPlatform = process.platform;
const BACKEND_PATHS = {
  cuda: path.join(ROOT, "app", "backend", "win", "cuda", "sd-cuda.exe"),
  vulkan: path.join(ROOT, "app", "backend", "win", "vulkan", "sd-vulkan.exe"),
  cpu: path.join(ROOT, "app", "backend", "win", "cpu", "sd-cpu.exe"),
  mac: path.join(ROOT, "app", "backend", "mac", "sd"),
  linuxCpu: path.join(ROOT, "app", "backend", "linux", "cpu", "sd-server-cpu"),
  linuxVulkan: path.join(ROOT, "app", "backend", "linux", "vulkan", "sd-server-vulkan"),
  linuxRocm: path.join(ROOT, "app", "backend", "linux", "rocm", "sd-server-rocm"),
  linuxCuda: path.join(ROOT, "app", "backend", "linux", "cuda", "sd-server-cuda"),
};
let BACKEND_PATH = "";
const backendSupportsFlags = {};
if (osPlatform === "win32") {
  let hasNvidia = false;
  try {
    execSync("nvidia-smi", { stdio: "ignore" });
    hasNvidia = true;
  } catch (_) {
    const commonPath = "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe";
    if (fs.existsSync(commonPath)) {
      hasNvidia = true;
    }
  }

  if (hasNvidia && fs.existsSync(BACKEND_PATHS.cuda)) {
    BACKEND_PATH = BACKEND_PATHS.cuda;
  } else if (fs.existsSync(BACKEND_PATHS.cpu)) {
    BACKEND_PATH = BACKEND_PATHS.cpu;
  } else {
    BACKEND_PATH = BACKEND_PATHS.vulkan;
  }
} else if (osPlatform === "darwin") {
  BACKEND_PATH = BACKEND_PATHS.mac;
} else {
  // Linux: default to Vulkan if available, otherwise CPU
  if (fs.existsSync(BACKEND_PATHS.linuxVulkan)) {
    BACKEND_PATH = BACKEND_PATHS.linuxVulkan;
  } else if (fs.existsSync(BACKEND_PATHS.linuxCpu)) {
    BACKEND_PATH = BACKEND_PATHS.linuxCpu;
  } else {
    BACKEND_PATH = BACKEND_PATHS.linuxVulkan;
  }
}
const MODELS  = path.join(ROOT, "app", "models");
if (!fs.existsSync(MODELS)) {
  fs.mkdirSync(MODELS, { recursive: true });
}
const LLM_MODELS = path.join(ROOT, "app", "llm-models");
if (!fs.existsSync(LLM_MODELS)) {
  fs.mkdirSync(LLM_MODELS, { recursive: true });
}
const CHAT_HISTORY = path.join(ROOT, "app", "chat-history");
if (!fs.existsSync(CHAT_HISTORY)) {
  fs.mkdirSync(CHAT_HISTORY, { recursive: true });
}
const LLM_BACKEND_PATHS = {
  winCuda: path.join(ROOT, "app", "llm-backend", "win", "cuda", "llama-server.exe"),
  winVulkan: path.join(ROOT, "app", "llm-backend", "win", "vulkan", "llama-server.exe"),
  winSycl: path.join(ROOT, "app", "llm-backend", "win", "sycl", "llama-server.exe"),
  winHip: path.join(ROOT, "app", "llm-backend", "win", "hip", "llama-server.exe"),
  winCpu: path.join(ROOT, "app", "llm-backend", "win", "cpu", "llama-server.exe"),
  linuxCuda: path.join(ROOT, "app", "llm-backend", "linux", "cuda", "llama-server"),
  linuxRocm: path.join(ROOT, "app", "llm-backend", "linux", "rocm", "llama-server"),
  linuxVulkan: path.join(ROOT, "app", "llm-backend", "linux", "vulkan", "llama-server"),
  linuxSycl: path.join(ROOT, "app", "llm-backend", "linux", "sycl", "llama-server"),
  linuxCpu: path.join(ROOT, "app", "llm-backend", "linux", "cpu", "llama-server"),
  macArm64: path.join(ROOT, "app", "llm-backend", "mac", "arm64", "llama-server"),
  macX64: path.join(ROOT, "app", "llm-backend", "mac", "x64", "llama-server"),
};
const LLM_CONFIG_DIR = path.join(ROOT, "app", "config");
const LLM_MODEL_SETTINGS_PATH = path.join(LLM_CONFIG_DIR, "llm-model-settings.json");
const LLM_BENCHMARK_PATH = path.join(LLM_CONFIG_DIR, "llm-benchmarks.json");
if (!fs.existsSync(LLM_CONFIG_DIR)) {
  fs.mkdirSync(LLM_CONFIG_DIR, { recursive: true });
}
const SPEECH_MODELS = path.join(ROOT, "app", "speech-models");
if (!fs.existsSync(SPEECH_MODELS)) {
  fs.mkdirSync(SPEECH_MODELS, { recursive: true });
}
const TRANSCRIPTIONS = path.join(ROOT, "app", "transcriptions");
if (!fs.existsSync(TRANSCRIPTIONS)) {
  fs.mkdirSync(TRANSCRIPTIONS, { recursive: true });
}
const TTS_MODELS = path.join(ROOT, "app", "tts-models");
if (!fs.existsSync(TTS_MODELS)) {
  fs.mkdirSync(TTS_MODELS, { recursive: true });
}
const TTS_OUTPUTS = path.join(ROOT, "app", "tts-outputs");
if (!fs.existsSync(TTS_OUTPUTS)) {
  fs.mkdirSync(TTS_OUTPUTS, { recursive: true });
}
const TTS_CACHE = path.join(ROOT, "app", "tts-cache");
if (!fs.existsSync(TTS_CACHE)) {
  fs.mkdirSync(TTS_CACHE, { recursive: true });
}
const WEB_SEARCH_CACHE = path.join(ROOT, "app", "cache", "search");
if (!fs.existsSync(WEB_SEARCH_CACHE)) {
  fs.mkdirSync(WEB_SEARCH_CACHE, { recursive: true });
}
const VIDEO_MODELS = path.join(ROOT, "app", "video-models");
if (!fs.existsSync(VIDEO_MODELS)) {
  fs.mkdirSync(VIDEO_MODELS, { recursive: true });
}
const VIDEO_OUTPUTS = path.join(ROOT, "app", "video-outputs");
if (!fs.existsSync(VIDEO_OUTPUTS)) {
  fs.mkdirSync(VIDEO_OUTPUTS, { recursive: true });
}
const RVC_MODELS = path.join(ROOT, "app", "rvc-models");
if (!fs.existsSync(RVC_MODELS)) {
  fs.mkdirSync(RVC_MODELS, { recursive: true });
}
const AUDIO_OUTPUTS = path.join(ROOT, "app", "audio-outputs");
if (!fs.existsSync(AUDIO_OUTPUTS)) {
  fs.mkdirSync(AUDIO_OUTPUTS, { recursive: true });
}
const MUSIC_MODELS = path.join(ROOT, "app", "music-models");
if (!fs.existsSync(MUSIC_MODELS)) {
  fs.mkdirSync(MUSIC_MODELS, { recursive: true });
}
const REFERENCE_VOICES = path.join(ROOT, "app", "reference-voices");
if (!fs.existsSync(REFERENCE_VOICES)) {
  fs.mkdirSync(REFERENCE_VOICES, { recursive: true });
}
const TTS_RUNTIME = path.join(ROOT, "app", "tts-runtime");
const TTS_WORKER = path.join(ROOT, "scripts", "workers", "tts-kokoro-worker.mjs");
const TTS_EMA_WORKER = path.join(ROOT, "scripts", "workers", "tts-ema-worker.py");
const TTS_AHENK_WORKER = path.join(ROOT, "scripts", "workers", "tts-ahenk-worker.py");
const TTS_SUPERTONIC_WORKER = path.join(ROOT, "scripts", "workers", "tts-supertonic-worker.py");
const TTS_ANTALIA_WORKER = path.join(ROOT, "scripts", "workers", "tts-antalia-worker.py");
const TTS_OMNIVOICE_WORKER = path.join(ROOT, "scripts", "workers", "tts-omnivoice-worker.py");
const VIDEO_WORKER = path.join(ROOT, "scripts", "workers", "video-generator-worker.py");
const SPEECH_DUYU_WORKER = path.join(ROOT, "scripts", "workers", "speech-duyu-worker.py");
const SPEECH_SEDA_WORKER = path.join(ROOT, "scripts", "workers", "speech-seda-worker.py");

// -- Python runtime discovery ---------------------------------------------------
// The TTS / music / video / Duyu workers are Python scripts. Instead of hard-coding
// one machine's interpreter paths, every candidate interpreter is probed once for the
// modules a worker needs, and the first match is cached.
const PYTHON_REQUIREMENTS = {
  "tts-antalia": ["antalia_mini", "soundfile"],
  "tts-ema": ["ema_lightning", "torch"],
  "tts-ahenk": ["ema_lightning", "trnorm", "torch", "soundfile", "huggingface_hub"],
  "tts-supertonic": ["supertonic"],
  "tts-omnivoice": ["omnivoice", "torch", "soundfile"],
  "speech-duyu": ["onnxruntime", "sentencepiece", "numpy"],
  "speech-seda": ["sedalib", "sherpa_onnx", "onnxruntime", "tokenizers", "numpy"],
  "music": ["torch", "transformers", "soundfile"],
  "sfx": ["torch", "diffusers", "transformers", "soundfile"],
  "stable-audio": ["stable_audio_3", "einops_exts", "torch", "transformers", "soundfile"],
  "video": ["torch", "diffusers", "transformers"],
};
const PYTHON_INSTALL_HINTS = {
  "tts-antalia": "pip install antalia-mini",
  "tts-ema": "pip install ema-lightning",
  "tts-ahenk": "pip install torch ema-lightning==1.1.2 git+https://github.com/ozguradmin/ahenk-turkish-tts",
  "tts-supertonic": "pip install supertonic",
  "tts-omnivoice": "pip install omnivoice (önce CUDA'lı PyTorch kurulumu önerilir)",
  "speech-duyu": "pip install numpy onnxruntime sentencepiece",
  "speech-seda": "pip install numpy onnxruntime tokenizers sherpa-onnx && pip install --no-deps sedalib==1.0.0",
  "music": "pip install torch transformers soundfile",
  "sfx": "pip install torch diffusers transformers soundfile",
  "stable-audio": "pip install torch transformers soundfile einops einops-exts safetensors && pip install --no-deps https://github.com/Stability-AI/stable-audio-3/archive/77e0398c26f7d22d801ec1bb036307e8b231f741.zip",
  "video": "pip install torch diffusers transformers accelerate imageio-ffmpeg (CUDA'lı PyTorch gerekir)",
};
const pythonResolveCache = new Map();

function readPythonPathConfig() {
  const cfg = readJsonFile(path.join(ROOT, "app", "config", "python-paths.json"), {});
  return cfg && typeof cfg === "object" ? cfg : {};
}

function listPythonCandidates(feature) {
  const cfg = readPythonPathConfig();
  const home = os.homedir();
  const exe = osPlatform === "win32" ? "python.exe" : path.join("bin", "python");
  const envRoots = [];
  const condaRoots = osPlatform === "win32"
    ? [path.join(home, ".conda"), path.join(home, "miniconda3"), path.join(home, "anaconda3"), "C:\\ProgramData\\miniconda3", "C:\\ProgramData\\anaconda3"]
    : [path.join(home, ".conda"), path.join(home, "miniconda3"), path.join(home, "anaconda3"), "/opt/conda"];
  for (const root of condaRoots) {
    envRoots.push(root);
    const envsDir = path.join(root, "envs");
    try {
      for (const name of fs.readdirSync(envsDir)) envRoots.push(path.join(envsDir, name));
    } catch (_) {}
  }
  const featureEnv = feature === "video" || feature === "music" || feature === "sfx" ? process.env.VIDEO_PYTHON_BIN : process.env.TTS_PYTHON_BIN;
  const candidates = [
    cfg[feature],
    cfg.default,
    featureEnv,
    process.env.PYTHON_BIN,
    // Private environment created by scripts/setup/setup-python.ps1 (preferred over any system Python).
    path.join(ROOT, "app", "tools", "python-env", osPlatform === "win32" ? path.join("Scripts", "python.exe") : path.join("bin", "python")),
    path.join(ROOT, "app", "tools", osPlatform === "win32" ? "python-win" : "python", exe),
    ...envRoots.map((root) => path.join(root, exe)),
    osPlatform === "win32" ? "python" : "python3",
  ].filter(Boolean);
  return [...new Set(candidates)];
}

// Really import the modules: find_spec() alone accepts broken installs (e.g. huggingface_hub without httpx).
function pythonImportProbe(feature) {
  const modules = PYTHON_REQUIREMENTS[feature] || [];
  return `import importlib, sys\ntry:\n    [importlib.import_module(x) for x in ${JSON.stringify(modules)}]\nexcept Exception:\n    sys.exit(3)`;
}

function rememberPythonFor(feature, candidate) {
  if (!pythonResolveCache.has(feature)) {
    pythonResolveCache.set(feature, candidate);
    console.log(`  [python] ${feature} -> ${candidate}`);
  }
  return pythonResolveCache.get(feature);
}

function resolvePythonFor(feature) {
  if (pythonResolveCache.has(feature)) return pythonResolveCache.get(feature);
  const probe = pythonImportProbe(feature);
  for (const candidate of listPythonCandidates(feature)) {
    if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue;
    try {
      const result = spawnSync(candidate, ["-c", probe], { timeout: 120000, windowsHide: true, stdio: "ignore" });
      if (result.status === 0) return rememberPythonFor(feature, candidate);
    } catch (_) {}
  }
  return null;
}

// Resolves every feature in the background at startup so the first generation request
// does not block the event loop while heavy packages (torch, diffusers) are imported.
async function warmPythonResolver() {
  const probeAsync = (candidate, probe) => new Promise((resolve) => {
    try {
      const proc = spawn(candidate, ["-c", probe], { windowsHide: true, stdio: "ignore" });
      const timer = setTimeout(() => { try { proc.kill(); } catch (_) {} resolve(false); }, 120000);
      proc.on("error", () => { clearTimeout(timer); resolve(false); });
      proc.on("exit", (code) => { clearTimeout(timer); resolve(code === 0); });
    } catch (_) {
      resolve(false);
    }
  });
  for (const feature of Object.keys(PYTHON_REQUIREMENTS)) {
    if (pythonResolveCache.has(feature)) continue;
    const probe = pythonImportProbe(feature);
    for (const candidate of listPythonCandidates(feature)) {
      if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue;
      if (pythonResolveCache.has(feature)) break;
      if (await probeAsync(candidate, probe)) {
        rememberPythonFor(feature, candidate);
        break;
      }
    }
  }
}

function requirePythonFor(feature, label) {
  const python = resolvePythonFor(feature);
  if (python) return python;
  const modules = (PYTHON_REQUIREMENTS[feature] || []).join(", ");
  const setupHint = osPlatform === "win32"
    ? "Uygulamayı kapatıp scripts\\setup\\setup-python.ps1 betiğini çalıştırın (sağ tık > PowerShell ile Çalıştır) ya da windows.bat'ı yeniden başlatın"
    : `Kurulum: ${PYTHON_INSTALL_HINTS[feature] || "pip install " + modules}`;
  const err = new Error(`${label} için gerekli Python paketleri (${modules}) bu bilgisayarda bulunamadı. ${setupHint}. Belirli bir Python yorumlayıcısı kullanmak için app/config/python-paths.json dosyasına {"${feature}": "C:\\\\yol\\\\python.exe"} ekleyebilirsiniz.`);
  err.statusCode = 503;
  err.code = "PYTHON_RUNTIME_MISSING";
  throw err;
}

// Python libraries (huggingface_hub, ema_lightning, ...) print status lines to stdout,
// so a worker's JSON result is read from its last JSON line instead of the whole stream.
function parseWorkerJson(stdout) {
  const lines = String(stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith("{")) continue;
    try { return JSON.parse(lines[i]); } catch (_) {}
  }
  if (!lines.length) return {};
  throw new Error(`Worker geçerli bir JSON sonucu döndürmedi: ${lines.slice(-3).join(" | ").slice(0, 400)}`);
}

// Child processes of running generation jobs, so "cancel" can actually stop them.
const activeJobProcesses = new Set();
function trackJobProcess(proc) {
  activeJobProcesses.add(proc);
  proc.once("exit", () => activeJobProcesses.delete(proc));
  proc.once("error", () => activeJobProcesses.delete(proc));
  return proc;
}

function ttsPythonOrReset(feature, label) {
  try {
    return requirePythonFor(feature, label);
  } catch (err) {
    ttsGenerationState = { active: false, phase: "Failed", progress: 0, model: "", voice: "", output: "" };
    audioGenerationProgress.active = false;
    audioGenerationProgress.progress = 0;
    ttsError = err.message;
    throw err;
  }
}

function killProcessTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (osPlatform === "win32" && proc.pid) {
    try { spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); return; } catch (_) {}
  }
  try { proc.kill("SIGKILL"); } catch (_) {}
}
const SPEECH_BACKEND_ROOT = path.join(ROOT, "app", "speech-backend");
const SPEECH_BACKEND_PATHS = {
  winCudaCli: path.join(SPEECH_BACKEND_ROOT, "win", "cuda", "whisper-cli.exe"),
  winCudaServer: path.join(SPEECH_BACKEND_ROOT, "win", "cuda", "whisper-server.exe"),
  winVulkanCli: path.join(SPEECH_BACKEND_ROOT, "win", "vulkan", "whisper-cli.exe"),
  winVulkanServer: path.join(SPEECH_BACKEND_ROOT, "win", "vulkan", "whisper-server.exe"),
  winCpuCli: path.join(SPEECH_BACKEND_ROOT, "win", "cpu", "whisper-cli.exe"),
  winCpuServer: path.join(SPEECH_BACKEND_ROOT, "win", "cpu", "whisper-server.exe"),
  winCli: path.join(ROOT, "app", "speech-backend", "win", "whisper-cli.exe"),
  winServer: path.join(ROOT, "app", "speech-backend", "win", "whisper-server.exe"),
  linuxVulkanCli: path.join(SPEECH_BACKEND_ROOT, "linux", "vulkan", "whisper-cli"),
  linuxVulkanServer: path.join(SPEECH_BACKEND_ROOT, "linux", "vulkan", "whisper-server"),
  linuxCpuCli: path.join(SPEECH_BACKEND_ROOT, "linux", "cpu", "whisper-cli"),
  linuxCpuServer: path.join(SPEECH_BACKEND_ROOT, "linux", "cpu", "whisper-server"),
  linuxCli: path.join(ROOT, "app", "speech-backend", "linux", "whisper-cli"),
  linuxServer: path.join(ROOT, "app", "speech-backend", "linux", "whisper-server"),
  macMetalCli: path.join(SPEECH_BACKEND_ROOT, "mac", "metal", "whisper-cli"),
  macMetalServer: path.join(SPEECH_BACKEND_ROOT, "mac", "metal", "whisper-server"),
  macCpuCli: path.join(SPEECH_BACKEND_ROOT, "mac", "cpu", "whisper-cli"),
  macCpuServer: path.join(SPEECH_BACKEND_ROOT, "mac", "cpu", "whisper-server"),
  macCli: path.join(ROOT, "app", "speech-backend", "mac", "whisper-cli"),
  macServer: path.join(ROOT, "app", "speech-backend", "mac", "whisper-server"),
};
const SPEECH_MODEL_CATALOG = [
  {
    id: "duyu-small",
    name: "Duyu-small Türkçe + İngilizce (56 MB ONNX Conformer)",
    filename: "duyu-small",
    size: "56 MB",
    tier: "Low",
    tierLabel: "Düşük: Saf CPU / Sıfır VRAM",
    language: "Türkçe + İngilizce (Karma)",
    recommended: true,
    engine: "duyu",
    notes: "19.3M aktif parametreli (49.3M depolanan) Conformer, int8 ONNX (56 MB). FLEURS-tr testinde %7.87 WER (Whisper Base: %24.19). CPU'da gerçek zamandan ~14 kat hızlı. Kısa / canlı konuşma için tasarlandı; çok uzun kayıtlarda Whisper önerilir.",
    url: "https://huggingface.co/KaanAydinli/Duyu-small",
    pageUrl: "https://huggingface.co/KaanAydinli/Duyu-small",
  },
  {
    id: "seda-v0.2",
    name: "Seda-v0.2 Türkçe (Zipformer, noktalama + büyük harf + rakam)",
    filename: "seda-v0.2",
    size: "197 MB",
    tier: "Low",
    tierLabel: "Düşük: Saf CPU / Sıfır VRAM",
    language: "Yalnızca Türkçe",
    recommended: true,
    engine: "seda",
    notes: "Ahmet Atasoğlu'nun 66M parametreli Zipformer2 modeli (int8 ONNX, CC BY-SA 4.0). FLEURS-tr testinde %6.38 WER (Whisper Medium: %6.62). Noktalama, büyük harf, kesme işareti ve rakamları kendi biçimlendiricisiyle yazar; gürültülü ve telefon kayıtlarında da sağlamdır. Konuşma aralarından bölündüğü için altyazı zamanları gerçektir.",
    url: "https://huggingface.co/atasoglu/seda-v0.2",
    pageUrl: "https://huggingface.co/atasoglu/seda-v0.2",
  },
  {
    id: "tiny",
    name: "Whisper Tiny Çok Dilli (Ultra Hafif)",
    filename: "ggml-tiny.bin",
    size: "75 MB",
    tier: "Low",
    tierLabel: "Düşük: Saf CPU / Her Donanım",
    language: "Çok Dilli (Türkçe)",
    recommended: false,
    notes: "39M parametreli en küçük Whisper modeli (75 MB). En hızlısıdır ancak Türkçe doğruluğu düşüktür."
  },
  {
    id: "base-q5_1",
    name: "Whisper Base Q5 Çok Dilli (Hızlı & Dengeli)",
    filename: "ggml-base-q5_1.bin",
    size: "57 MB",
    tier: "Low",
    tierLabel: "Düşük: Saf CPU / 2GB+ RAM",
    language: "Çok Dilli (Türkçe)",
    recommended: true,
    notes: "Whisper Base'in 5-bit kuantize sürümü (57 MB). Base'e çok yakın doğrulukla daha az bellek kullanır."
  },
  {
    id: "base",
    name: "Whisper Base Çok Dilli (Standart)",
    filename: "ggml-base.bin",
    size: "142 MB",
    tier: "Low",
    tierLabel: "Düşük: Saf CPU / 4GB+ RAM",
    language: "Çok Dilli (Türkçe)",
    recommended: true,
    notes: "74M parametreli Whisper Base (142 MB). Hızlıdır; Türkçe için Small veya Large v3 Turbo daha doğrudur."
  },
  {
    id: "small",
    name: "Whisper Small Çok Dilli (Yüksek Doğruluk & Türkçe Uzmanı)",
    filename: "ggml-small.bin",
    size: "466 MB",
    tier: "Mid",
    tierLabel: "Orta: CPU veya GPU / 4GB+ RAM",
    language: "Çok Dilli (Türkçe)",
    recommended: true,
    notes: "244M parametreli Whisper Small (466 MB). Türkçe için hız / doğruluk dengesi iyi olan çok dilli model."
  },
  {
    id: "large-v3-turbo",
    name: "Whisper Large v3 Turbo (OpenAI Amiral Gemisi)",
    filename: "ggml-large-v3-turbo.bin",
    size: "1.6 GB",
    tier: "High",
    tierLabel: "Üst: GPU Önerilir (Stüdyo Transkripsiyon)",
    language: "Çok Dilli (Türkçe)",
    recommended: true,
    notes: "OpenAI Whisper Large v3'ün 4 katmanlı kod çözücülü hızlandırılmış sürümü (809M parametre, 1.6 GB). Bu listedeki en yüksek doğruluk; GPU önerilir. Çeviri (İngilizceye çevirme) için eğitilmemiştir, yalnızca yazıya döker."
  },
];
// Speech engines that run as Python workers on a model folder instead of whisper.cpp on a .bin file.
const PYTHON_SPEECH_ENGINES = {
  duyu: { folder: "duyu-small", marker: ["int8", "decoder.onnx"], worker: SPEECH_DUYU_WORKER, feature: "speech-duyu", label: "Duyu-small Türkçe ses tanıma", backend: "duyu-onnx", runtime: "onnxruntime" },
  seda: { folder: "seda-v0.2", marker: ["final", "encoder.int8.onnx"], worker: SPEECH_SEDA_WORKER, feature: "speech-seda", label: "Seda-v0.2 Türkçe ses tanıma", backend: "seda-sherpa-onnx", runtime: "sherpa-onnx" },
};
const TTS_MODEL_CATALOG = [
  {
    id: "antalia-mini",
    name: "Antalia-2 Mini Türkçe (48 kHz, tek erkek sesi)",
    filename: "antalia-mini.json",
    modelId: "cloud0day3/antalia-mini",
    dtype: "safetensors",
    size: "31 MB",
    format: "Flow-Matching / PyTorch (7.62M)",
    tier: "Low",
    recommended: true,
    resolution: "48 kHz",
    pythonPackage: "antalia-mini",
    notes: "7.62M parametre (akustik 3.69M + vokoder 3.93M), 48 kHz, tek sentetik erkek sesi. Sayı, tarih, tutar ve kısaltmaları kendi normalleştiricisiyle okur. Freya-TR-Eval WER %1.02. Apache-2.0. Uygulamadaki 'profiller' yalnızca konuşma hızını değiştirir.",
    pageUrl: "https://huggingface.co/cloud0day3/antalia-mini",
  },
  {
    id: "ema-lightning",
    name: "EMA Lightning Türkçe (48 kHz, tek ses)",
    filename: "ema-lightning.json",
    modelId: "canberkkkkkk/ema-lightning",
    dtype: "pt",
    size: "34 MB",
    format: "Flow-Matching DiT / PyTorch (8.6M)",
    tier: "Low",
    recommended: true,
    resolution: "48 kHz",
    pythonPackage: "ema-lightning",
    notes: "5.6M parametreli DiT akustik model + 3M vokoder (toplam 8.6M, 34 MB), 4 adımda 48 kHz ses. Freya-TR-Eval'de %0.92 WER (ölçülen sistemler arasında en düşük). Tek ses; ses klonlama ve duygu kontrolü yok. Apache-2.0.",
    pageUrl: "https://huggingface.co/canberkkkkkk/ema-lightning",
  },
  {
    id: "ahenk-cep",
    name: "Ahenk Cep Türkçe (48 kHz, tek kadın sesi, 7 üslup)",
    filename: "ahenk-cep.json",
    modelId: "ozgurguler/ahenk-cep-tr",
    dtype: "pt",
    size: "34 MB",
    format: "Flow-Matching DiT / PyTorch (8.6M)",
    tier: "Low",
    recommended: true,
    resolution: "48 kHz",
    pythonPackage: "ema-lightning + ahenk-turkish-tts",
    notes: "EMA Lightning mimarisinden damıtılmış 8.6M parametreli model (34 MB), tek tasarlanmış kadın sesi (f022), 48 kHz. 7 üslup: nötr, neşeli, sakin, empatik, hüzünlü, şaşkın, öfkeli (üslup farkları hafiftir). trnorm normalleştirmesi. Ağırlıklar CC-BY-4.0 (atıf gerekir).",
    pageUrl: "https://huggingface.co/ozgurguler/ahenk-cep-tr",
  },
  {
    id: "kokoro-onnx-q8",
    name: "Kokoro 82M ONNX Q8 (İngilizce)",
    filename: "kokoro-onnx-q8.json",
    modelId: "onnx-community/Kokoro-82M-v1.0-ONNX",
    dtype: "q8",
    size: "92 MB",
    format: "Kokoro ONNX",
    tier: "Low",
    recommended: false,
    notes: "82M parametreli Kokoro v1.0, 8-bit ONNX (92 MB), 24 kHz. kokoro-js ile Amerikan ve İngiliz İngilizcesi sesleri sunar; Türkçe sesi yoktur (Türkçe metinler deneysel fonetik dönüşümle okunur, doğal değildir).",
  },
  {
    id: "supertonic-3",
    name: "Supertone Supertonic-3 (31 dil, 44.1 kHz, 10 hazır ses)",
    filename: "supertonic-3.json",
    modelId: "Supertone/supertonic-3",
    dtype: "onnx",
    size: "~395 MB",
    format: "Supertone ONNX (~99M)",
    tier: "Low",
    recommended: true,
    resolution: "44.1 kHz",
    pythonPackage: "supertonic",
    notes: "~99M parametreli ONNX motoru, Türkçe dahil 31 dil, 44.1 kHz. 10 hazır ses stili (M1-M5, F1-F5) ve <laugh>, <breath>, <sigh> ifade etiketleri. OpenRAIL lisansı.",
  },
  {
    id: "omnivoice",
    name: "OmniVoice Zero-Shot Ses Klonlama (600+ dil)",
    filename: "omnivoice.json",
    modelId: "k2-fsa/OmniVoice",
    dtype: "safetensors",
    size: "3.3 GB",
    format: "OmniVoice (Qwen3-0.6B tabanlı difüzyon-dil modeli)",
    tier: "Mid",
    recommended: true,
    resolution: "24 kHz",
    pythonPackage: "omnivoice",
    notes: "k2-fsa (Next-gen Kaldi) ekibinin çok dilli zero-shot TTS modeli: Türkçe dahil 600+ dil, kısa bir referans sesle ses klonlama ve metinle ses tasarımı. GPU önerilir.",
    pageUrl: "https://huggingface.co/k2-fsa/OmniVoice",
  },
  {
    id: "chatterbox-multilingual",
    name: "Chatterbox Multilingual (Resemble AI) - entegre değil",
    filename: "chatterbox-multilingual-v3.json",
    modelId: "ResembleAI/chatterbox",
    dtype: "fp16",
    size: "-",
    format: "PyTorch",
    tier: "Mid",
    recommended: false,
    supported: false,
    notes: "0.5B parametreli, Türkçe dahil 23 dilli ses klonlamalı TTS. Bu sürümde uygulamaya entegre edilmedi.",
  },
  {
    id: "xtts-v2",
    name: "Coqui XTTS-v2 - entegre değil",
    filename: "xtts-v2.json",
    modelId: "coqui/XTTS-v2",
    dtype: "pth",
    size: "-",
    format: "PyTorch",
    tier: "Mid",
    recommended: false,
    supported: false,
    notes: "Türkçe dahil 17 dilde ~6 saniyelik referansla ses klonlama (CPML lisansı, ticari olmayan). Bu sürümde uygulamaya entegre edilmedi.",
  },
  {
    id: "piper-tr-dfki",
    name: "Piper TTS Türkçe DFKI (medium) - elle kurulum",
    filename: "piper-tr-dfki.json",
    modelId: "rhasspy/piper-voices/tr/tr_TR/dfki/medium",
    dtype: "onnx",
    size: "63 MB",
    format: "Piper ONNX",
    tier: "Low",
    recommended: false,
    supported: false,
    notes: "Tek konuşmacılı, 22.05 kHz, CPU'da çok hızlı Türkçe ses. Uygulama piper ikilisini otomatik indirmez: piper.exe'yi app/tools/piper, modeli app/tts-models/piper klasörüne koyduğunuzda Ses Stüdyosu'nda çalışır.",
  },
  {
    id: "cosyvoice-2",
    name: "CosyVoice 2 0.5B (Alibaba) - entegre değil",
    filename: "cosyvoice-2.json",
    modelId: "FunAudioLLM/CosyVoice2-0.5B",
    dtype: "safetensors",
    size: "-",
    format: "PyTorch / FunAudioLLM",
    recommended: false,
    supported: false,
    notes: "Çince, İngilizce, Japonca, Korece odaklı 0.5B ses modeli; Türkçe resmi olarak desteklenmez. Bu sürümde uygulamaya entegre edilmedi.",
  },
  {
    id: "kokoro-onnx-fp32",
    name: "Kokoro 82M ONNX FP32 (İngilizce)",
    filename: "kokoro-onnx-fp32.json",
    modelId: "onnx-community/Kokoro-82M-v1.0-ONNX",
    dtype: "fp32",
    size: "326 MB",
    format: "Kokoro ONNX",
    recommended: false,
    notes: "Kokoro v1.0'ın tam hassasiyetli (fp32) ONNX sürümü. Yalnızca İngilizce sesler.",
  },
];
const TTS_VOICES = [
  { id: "af_heart", name: "Heart", language: "en-us", gender: "Female", recommended: true },
  { id: "af_bella", name: "Bella", language: "en-us", gender: "Female", recommended: false },
  { id: "af_nicole", name: "Nicole", language: "en-us", gender: "Female", recommended: false },
  { id: "af_sarah", name: "Sarah", language: "en-us", gender: "Female", recommended: false },
  { id: "am_michael", name: "Michael", language: "en-us", gender: "Male", recommended: false },
  { id: "am_fenrir", name: "Fenrir", language: "en-us", gender: "Male", recommended: false },
  { id: "bf_emma", name: "Emma", language: "en-gb", gender: "Female", recommended: false },
  { id: "bm_george", name: "George", language: "en-gb", gender: "Male", recommended: false },
];
const OPENVINO_MODELS = path.join(ROOT, "app", "openvino-models");
if (!fs.existsSync(OPENVINO_MODELS)) {
  fs.mkdirSync(OPENVINO_MODELS, { recursive: true });
}
const OUTPUTS = path.join(ROOT, "app", "outputs");
if (!fs.existsSync(OUTPUTS)) {
  fs.mkdirSync(OUTPUTS, { recursive: true });
}

const OPENVINO_NPU_MODELS = [
  {
    id: "lcm-dreamshaper-v7-fp16",
    name: "LCM DreamShaper v7 FP16",
    repo: "OpenVINO/LCM_Dreamshaper_v7-fp16-ov",
    folder: "LCM_Dreamshaper_v7-fp16-ov",
    approxSize: "2.0 GB",
    resolution: "512x512",
    notes: "OpenVINO LCM image model. Kullans CPU text encoder, NPU UNet, and GPU or CPU VAE decoder.",
  },
];

// -- Backend process state -----------------------------------------------------
let backendProc  = null;
let backendProcSeq = 0;
let backendReady = false;
let backendError = null;
let openvinoProc = null;
let openvinoReady = false;
let openvinoError = null;
let openvinoPort = null;
let openvinoModel = null;
let openvinoWidth = null;
let openvinoHeight = null;
let llmProc = null;
let llmProcSeq = 0;
let llmReady = false;
let llmError = null;
let llmOperationQueue = Promise.resolve();
let speechReady = false;
let speechError = null;
let speechOperationQueue = Promise.resolve();
let speechSettings = {
  model: null,
  language: "auto",
  threads: Math.max(1, Math.min(8, os.cpus().length || 4)),
  backendPreference: "auto",
  backendBinary: "",
  backendMode: "",
};
let speechTranscriptionState = {
  active: false,
  phase: "",
  progress: 0,
  model: "",
  filename: "",
};
let ttsReady = false;
let ttsError = null;
let ttsOperationQueue = Promise.resolve();
let ttsSettings = {
  model: null,
  voice: "af_heart",
  speed: 1,
  dtype: "q8",
  backendMode: "Kokoro ONNX",
};
let ttsGenerationState = {
  active: false,
  phase: "",
  progress: 0,
  model: "",
  voice: "",
  output: "",
};

let isLlmGenerating = false;
let isVideoGenerating = false;
let isAudioGenerating = false;
let audioGenerationProgress = {
  active: false,
  mode: "audio", // "tts" | "music" | "sfx"
  phase: "",
  progress: 0,
  step: 0,
  totalSteps: 0,
  model: "",
  startedAt: 0,
};

let videoGenerationState = {
  active: false,
  id: null,
  prompt: "",
  progress: 0,
  step: 0,
  totalSteps: 20,
  status: "idle",
  timer: null,
};

function modelName(value) {
  return path.basename(String(value || ""));
}

function getActiveHeavyRuntime() {
  if ((backendReady || backendProc || openvinoReady || openvinoProc) && currentSettings.model) {
    return { type: "image", label: "Image", model: modelName(currentSettings.model) };
  }
  if ((llmReady || llmProc) && llmSettings.model) {
    return { type: "text", label: "Text", model: modelName(llmSettings.model) };
  }
  return null;
}

function getActiveGenerationJob() {
  if (typeof generationState !== "undefined" && generationState.active) {
    const percent = (generationState.step && generationState.steps)
      ? Math.round((generationState.step / generationState.steps) * 100)
      : 0;
    return {
      type: "image",
      label: "Görsel Üretimi",
      details: generationState.step ? `${generationState.step}/${generationState.steps} adım` : "Görsel işleniyor...",
      percent
    };
  }
  if (isLlmGenerating) {
    return {
      type: "chat",
      label: "Sohbet / Metin",
      details: "Yapay zekâ yanıtı yazıyor...",
      percent: 0
    };
  }
  if (isVideoGenerating || videoGenerationState.active) {
    return {
      type: "video",
      label: "Video Üretimi (Video Generation)",
      details: videoGenerationState.progress > 0 
        ? `%${videoGenerationState.progress} (Adım ${videoGenerationState.step}/${videoGenerationState.totalSteps})` 
        : "Video kareleri hesaplanıyor...",
      percent: videoGenerationState.progress || 0
    };
  }
  if (isAudioGenerating || audioGenerationProgress.active || ttsGenerationState.active) {
    const isSfx = audioGenerationProgress.mode === "sfx";
    const isTts = audioGenerationProgress.mode === "tts" || ttsGenerationState.active;
    const label = isSfx ? "Ses Efekti (SFX)" : isTts ? "Seslendirme (TTS)" : "Müzik Üretimi";
    const pct = audioGenerationProgress.progress || (ttsGenerationState.progress > 0 ? ttsGenerationState.progress : 0);
    const details = audioGenerationProgress.phase || ttsGenerationState.phase || "Ses dalgaları işleniyor...";
    return {
      type: "audio",
      label,
      details: pct > 0 ? `%${pct} - ${details}` : details,
      percent: pct
    };
  }
  return null;
}

function assertNoOtherActiveRuntime(targetType, targetModel, options = {}) {
  // 1. Check if a generation is actively running across ANY modality
  const activeJob = getActiveGenerationJob();
  if (activeJob && activeJob.type !== targetType && !options.cancelActive) {
    const err = new Error(`Şu anda ${activeJob.label} üretimi devam ediyor (${activeJob.details}). Yeni model yüklenmeden önce mevcut işlemi tamamlayın veya iptal edin.`);
    err.statusCode = 409;
    err.code = "GENERATION_IN_PROGRESS";
    err.activeJob = activeJob;
    throw err;
  }

  if (targetType !== "image" && targetType !== "text") return;

  const runtime = getActiveHeavyRuntime();
  const targetName = modelName(targetModel);
  if (!runtime || (runtime.type === targetType && runtime.model === targetName)) return;

  // Auto-swap is permitted: Log seamless switch
  console.log(`  [auto-swap] Model otomatik değiştiriliyor: ${runtime.label} (${runtime.model}) -> ${targetType} (${targetName}). Önceki model serbest bırakılıyor.`);
}

function jsonErrorStatus(err) {
  return Number(err?.statusCode) || (err?.code === "MODEL_ALREADY_ACTIVE" || err?.code === "GENERATION_IN_PROGRESS" ? 409 : 500);
}
let llmSettings = {
  model: null,
  threads: Math.max(1, Math.min(16, os.cpus().length || 4)),
  contextSize: 4096,
  gpuLayers: -1,
  backendMode: "",
  backendBinary: "",
  supportsVision: false,
  visionMode: "none",
  visionStatus: "Projector not loaded",
  flashAttn: true,
  cacheTypeK: "q8_0",
  cacheTypeV: "q8_0",
  mlock: false,
  mmap: true,
  cachePrompt: true,
  defragThold: 0.1,
  batchSize: 512,
  ubatchSize: 512,
  performanceProfile: "balanced",
};

function runExclusiveLlmOperation(operation) {
  const run = llmOperationQueue.catch(() => {}).then(operation);
  llmOperationQueue = run.catch(() => {});
  return run;
}
let backendLoadState = {
  active: false,
  phase: "",
  progress: 0,
  current: 0,
  total: 0,
  speed: "",
  model: "",
  backendMode: "",
  backendBinary: "",
  device: "",
};
let backendUnloadState = {
  active: false,
  phase: "",
  progress: 0,
};
let currentSettings = {
  model:    null,
  steps:    20,
  cfgScale: 7.0,
  sampler:  "euler_a",
  threads:  8,
  useGpu:   true,
  backendType: "auto",
  vaeTiling: true,
  vaeOnCpu:  false,
  flashAttn: true,
  width: 512,
  height: 512,
};

const VALID_SD_SAMPLERS = new Set([
  "euler", "euler_a", "heun", "dpm2", "dpm++2s_a", "dpm++2m",
  "dpm++2mv2", "ipndm", "ipndm_v", "lcm", "ddim_trailing", "tcd",
  "res_multistep", "res_2s", "er_sde", "euler_cfg_pp", "euler_a_cfg_pp"
]);

function normalizeSdSampler(sampler) {
  const raw = String(sampler || "euler_a").trim().toLowerCase();
  const aliases = {
    "dpm++_2m": "dpm++2m",
    "dpm++_2m_karras": "dpm++2m",
    "dpm++_sde": "dpm++2s_a",
    "dpm++_sde_karras": "dpm++2s_a",
    "ddim": "ddim_trailing",
  };
  const mapped = aliases[raw] || raw;
  return VALID_SD_SAMPLERS.has(mapped) ? mapped : "euler_a";
}

const BACKEND_RESTART_SETTING_KEYS = [
  "model",
  "steps",
  "cfgScale",
  "sampler",
  "threads",
  "useGpu",
  "backendType",
  "vaeTiling",
  "vaeOnCpu",
  "flashAttn",
];

function normalizeBackendSettingValue(key, value) {
  if (value === undefined || value === null) return value;
  if (key === "model") return path.resolve(String(value));
  if (key === "sampler") return normalizeSdSampler(value);
  if (["steps", "threads", "width", "height"].includes(key)) return parseInt(value);
  if (key === "cfgScale") return Math.round(parseFloat(value) * 1000) / 1000;
  if (["useGpu", "vaeTiling", "vaeOnCpu", "flashAttn"].includes(key)) return Boolean(value);
  return String(value);
}

function backendSettingsMatch(current, requested) {
  const baseMatch = BACKEND_RESTART_SETTING_KEYS.every((key) => (
    normalizeBackendSettingValue(key, current[key]) === normalizeBackendSettingValue(key, requested[key])
  ));
  if (!baseMatch) return false;
  if (requested.backendType === "openvino-npu" || requested.backendType === "apple-npu") {
    return normalizeBackendSettingValue("width", current.width) === normalizeBackendSettingValue("width", requested.width) &&
      normalizeBackendSettingValue("height", current.height) === normalizeBackendSettingValue("height", requested.height);
  }
  return true;
}

function appleNpuRuntimeMatches(current, requested) {
  return normalizeBackendSettingValue("model", current.model) === normalizeBackendSettingValue("model", requested.model) &&
    current.backendType === "apple-npu" &&
    requested.backendType === "apple-npu" &&
    normalizeBackendSettingValue("useGpu", current.useGpu) === normalizeBackendSettingValue("useGpu", requested.useGpu) &&
    normalizeBackendSettingValue("width", current.width || 512) === normalizeBackendSettingValue("width", requested.width || 512) &&
    normalizeBackendSettingValue("height", current.height || 512) === normalizeBackendSettingValue("height", requested.height || 512);
}

function setBackendLoadStage(phase, progress, extra = {}) {
  if (backendReady) return;
  backendLoadState = {
    ...backendLoadState,
    active: true,
    phase,
    progress: Math.max(backendLoadState.progress || 0, Math.min(99, progress)),
    ...extra,
  };
}

function updateCoreMLLoadProgress(output) {
  if (currentSettings.backendType !== "apple-npu" || backendReady) return;
  const cleanOutput = stripAnsi(output);

  if (cleanOutput.includes("Loading PyTorch reference configuration")) {
    setBackendLoadStage("Loading PyTorch reference configuration...", 8);
  }

  const pipelineMatch = cleanOutput.match(/Loading pipeline components.*?(\d+)%/);
  if (pipelineMatch) {
    const componentProgress = Math.max(0, Math.min(100, Number(pipelineMatch[1]) || 0));
    setBackendLoadStage("Loading pipeline components...", 10 + Math.round(componentProgress * 0.25));
  }

  if (cleanOutput.includes("Loading Core ML models from")) {
    setBackendLoadStage("Loading Core ML model bundle...", 40);
  }
  if (cleanOutput.includes("Loading text_encoder")) {
    setBackendLoadStage("Loading text encoder...", 48);
  }
  if (cleanOutput.includes("Loading unet")) {
    setBackendLoadStage("Loading UNet neural engine model...", 62);
  }
  if (cleanOutput.includes("Loading vae_decoder")) {
    setBackendLoadStage("Loading VAE decoder...", 78);
  }
  if (cleanOutput.includes("Loading safety_checker")) {
    setBackendLoadStage("Loading safety checker...", 88);
  }
  if (cleanOutput.includes("Initializing Core ML pipe")) {
    setBackendLoadStage("Initializing Core ML pipeline...", 94);
  }
  if (cleanOutput.includes("Stable Diffusion configured")) {
    setBackendLoadStage("Configuring image resolution...", 97);
  }
  if (cleanOutput.includes("Core ML models loaded successfully")) {
    setBackendLoadStage("Core ML models loaded successfully.", 99);
  }
}

let lastCpuSample = null;
let cachedGpuInfo = null;
let cachedBackendOptions = null;
let cachedVramInfo = null;

function roundGb(bytes) {
  return Math.round((bytes / (1024 ** 3)) * 100) / 100;
}

// Detect physical CPU cores (not logical/hyperthreaded cores)
// llama.cpp docs: "Do NOT set threads too high - major cause of oversaturation"
function getPhysicalCores() {
  const cpus = os.cpus();
  const logicalCores = cpus.length;
  
  if (logicalCores <= 1) return 1;
  
  // Check if hyperthreading is likely: compare unique core IDs vs total
  // On Windows/Linux, os.cpus() lists each logical core separately
  // Physical cores typically have the same model but different speeds can indicate HT
  const uniqueModels = new Set(cpus.map(c => c.model)).size;
  
  // If we have very few unique models relative to core count, likely HT
  // Also check: if logical cores is exactly 2x a common physical core count
  const commonPhysicalCounts = [2, 4, 6, 8, 10, 12, 16, 20, 24, 32];
  const isLikelyHT = commonPhysicalCounts.some(physical => logicalCores === physical * 2);
  
  if (isLikelyHT || uniqueModels < logicalCores / 2) {
    return Math.max(1, Math.floor(logicalCores / 2));
  }
  
  return logicalCores;
}

// Get optimal thread count for llama.cpp
// GPU mode: fewer threads to avoid CPU-GPU contention (physical/2)
// CPU mode: use physical cores directly
function getOptimalThreads(isGpuMode) {
  const physicalCores = getPhysicalCores();
  if (isGpuMode) {
    // llama.cpp benchmark: 4 threads on 7-core CPU + GPU = 9.1 t/s (optimal)
    // vs 7 threads = 8.7 t/s (oversaturated)
    return Math.max(1, Math.floor(physicalCores / 2));
  }
  return Math.max(1, physicalCores);
}

function getCpuSample() {
  return os.cpus().reduce((acc, cpu) => {
    const times = cpu.times;
    acc.idle += times.idle;
    acc.total += times.user + times.nice + times.sys + times.idle + times.irq;
    return acc;
  }, { idle: 0, total: 0 });
}

function getCpuUsagePercent() {
  const current = getCpuSample();
  if (!lastCpuSample) {
    lastCpuSample = current;
    return 0;
  }

  const idleDelta = current.idle - lastCpuSample.idle;
  const totalDelta = current.total - lastCpuSample.total;
  lastCpuSample = current;

  if (totalDelta <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 100)));
}

function hasVulkanRuntime() {
  if (osPlatform !== "win32") return true;
  try {
    const sysPaths = [
      path.join(process.env.SystemRoot || "C:\\Windows", "System32", "vulkan-1.dll"),
      path.join(process.env.SystemRoot || "C:\\Windows", "SysWOW64", "vulkan-1.dll"),
    ];
    for (const dllPath of sysPaths) {
      if (fs.existsSync(dllPath)) return true;
    }
    try {
      execSync("where vulkan-1.dll", { stdio: "ignore" });
      return true;
    } catch (_) {}
  } catch (_) {}
  return false;
}

function detectLinuxGpuFromSysfs() {
  try {
    const pciDir = "/sys/bus/pci/devices";
    if (!fs.existsSync(pciDir)) return null;
    const entries = fs.readdirSync(pciDir);
    for (const entry of entries) {
      const vendorFile = path.join(pciDir, entry, "vendor");
      const deviceFile = path.join(pciDir, entry, "device");
      if (!fs.existsSync(vendorFile)) continue;
      const vendor = fs.readFileSync(vendorFile, "utf8").trim();
      let device = "";
      try { device = fs.readFileSync(deviceFile, "utf8").trim(); } catch (_) {}
      if (vendor === "0x10de") {
        return { name: `NVIDIA GPU (${device || entry})` };
      }
      if (vendor === "0x1002") {
        return { name: `AMD GPU (${device || entry})` };
      }
      if (vendor === "0x8086") {
        return { name: `Intel GPU (${device || entry})` };
      }
    }
  } catch (_) {}
  return null;
}

function isVirtualOrSoftwareGpu(name) {
  const lowercase = String(name || "").toLowerCase();
  return lowercase.includes("virtual desktop") ||
         lowercase.includes("remote display") ||
         lowercase.includes("microsoft basic render") ||
         lowercase.includes("citrix") ||
         lowercase.includes("software rasterizer") ||
         lowercase.includes("virtualbox") ||
         lowercase.includes("vmware");
}

let cachedPreferredVulkanBackend = null;
let cachedPreferredVulkanBackendChecked = false;
function getPreferredVulkanBackendName() {
  const explicit = String(process.env.SD_VULKAN_DEVICE || process.env.UAIS_VULKAN_DEVICE || "").trim();
  if (/^vulkan\d+$/i.test(explicit)) return explicit.toLowerCase();
  if (/^\d+$/.test(explicit)) return `vulkan${explicit}`;

  if (cachedPreferredVulkanBackendChecked) return cachedPreferredVulkanBackend || "vulkan0";
  cachedPreferredVulkanBackendChecked = true;
  cachedPreferredVulkanBackend = "vulkan0";

  // vulkaninfo ships with the GPU drivers on Windows too; without this check an integrated GPU
  // listed first (e.g. AMD Radeon iGPU next to an RTX card) would be used instead of the discrete one.
  if (osPlatform === "darwin") return cachedPreferredVulkanBackend;
  try {
    const result = spawnSync("vulkaninfo", ["--summary"], {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    const devices = [];
    let current = null;
    for (const line of output.split(/\r?\n/)) {
      const gpuMatch = line.match(/^\s*GPU(\d+)\s*:/i);
      if (gpuMatch) {
        current = { index: Number(gpuMatch[1]), name: "", type: "" };
        devices.push(current);
        continue;
      }
      if (!current) continue;
      const nameMatch = line.match(/deviceName\s*=\s*(.+)$/i);
      if (nameMatch) current.name = nameMatch[1].trim();
      const typeMatch = line.match(/deviceType\s*=\s*(.+)$/i);
      if (typeMatch) current.type = typeMatch[1].trim();
    }
    const usable = devices.filter((device) => Number.isInteger(device.index) && !isVirtualOrSoftwareGpu(device.name));
    const discrete = usable.find((device) => /discrete/i.test(device.type));
    const amd = usable.find((device) => /amd|radeon/i.test(device.name));
    const selected = discrete || amd || usable[0];
    if (selected) cachedPreferredVulkanBackend = `vulkan${selected.index}`;
  } catch (_) {}

  return cachedPreferredVulkanBackend;
}

let cachedLlamaCudaGpu = null;
let cachedLlamaCudaGpuChecked = false;
function detectLlamaCudaGpu() {
  if (cachedLlamaCudaGpuChecked) return cachedLlamaCudaGpu;
  cachedLlamaCudaGpuChecked = true;

  const backendPath = osPlatform === "win32"
    ? LLM_BACKEND_PATHS.winCuda
    : osPlatform === "linux"
      ? LLM_BACKEND_PATHS.linuxCuda
      : "";
  if (!backendPath || !fs.existsSync(backendPath)) return null;

  try {
    const result = spawnSync(backendPath, ["--list-devices"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    const devices = [];
    const devicePattern = /CUDA\d+\s*:\s*(.+?)\s+\(([\d.]+)\s+MiB(?:,\s*([\d.]+)\s+MiB free)?\)/gi;
    let match;
    while ((match = devicePattern.exec(output)) !== null) {
      devices.push({
        name: match[1].trim(),
        vram_gb: Math.round((Number(match[2]) / 1024) * 100) / 100,
        free_vram_gb: match[3] ? Math.round((Number(match[3]) / 1024) * 100) / 100 : null,
      });
    }
    let activeDevices = devices.filter(d => !isVirtualOrSoftwareGpu(d.name));
    if (activeDevices.length === 0) {
      activeDevices = devices;
    }
    cachedLlamaCudaGpu = activeDevices.sort((a, b) => b.vram_gb - a.vram_gb)[0] || null;
  } catch (_) {
    cachedLlamaCudaGpu = null;
  }
  return cachedLlamaCudaGpu;
}

let cachedLlamaVulkanGpu = null;
let cachedLlamaVulkanGpuChecked = false;
function detectLlamaVulkanGpu() {
  if (cachedLlamaVulkanGpuChecked) return cachedLlamaVulkanGpu;
  cachedLlamaVulkanGpuChecked = true;

  const backendPath = osPlatform === "win32"
    ? LLM_BACKEND_PATHS.winVulkan
    : osPlatform === "linux"
      ? LLM_BACKEND_PATHS.linuxVulkan
      : "";
  if (!backendPath || !fs.existsSync(backendPath)) return null;

  try {
    const result = spawnSync(backendPath, ["--list-devices"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    const devices = [];
    const devicePattern = /Vulkan\d+\s*:\s*(.+?)\s+\(([\d.]+)\s+MiB(?:,\s*([\d.]+)\s+MiB free)?\)/gi;
    let match;
    while ((match = devicePattern.exec(output)) !== null) {
      devices.push({
        name: match[1].trim(),
        vram_gb: Math.round((Number(match[2]) / 1024) * 100) / 100,
        free_vram_gb: match[3] ? Math.round((Number(match[3]) / 1024) * 100) / 100 : null,
      });
    }
    let activeDevices = devices.filter(d => !isVirtualOrSoftwareGpu(d.name));
    if (activeDevices.length === 0) {
      activeDevices = devices;
    }
    cachedLlamaVulkanGpu = activeDevices.sort((a, b) => b.vram_gb - a.vram_gb)[0] || null;
  } catch (_) {
    cachedLlamaVulkanGpu = null;
  }
  return cachedLlamaVulkanGpu;
}

let cachedLlamaSyclGpu = null;
let cachedLlamaSyclGpuChecked = false;
function detectLlamaSyclGpu() {
  if (cachedLlamaSyclGpuChecked) return cachedLlamaSyclGpu;
  cachedLlamaSyclGpuChecked = true;

  const backendPath = osPlatform === "win32"
    ? LLM_BACKEND_PATHS.winSycl
    : osPlatform === "linux"
      ? LLM_BACKEND_PATHS.linuxSycl
      : "";
  if (!backendPath || !fs.existsSync(backendPath)) return null;

  try {
    const result = spawnSync(backendPath, ["--list-devices"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    const devices = [];
    const devicePattern = /SYCL\d+\s*:\s*(.+?)\s+\(([\d.]+)\s+MiB(?:,\s*([\d.]+)\s+MiB free)?\)/gi;
    let match;
    while ((match = devicePattern.exec(output)) !== null) {
      devices.push({
        name: match[1].trim(),
        vram_gb: Math.round((Number(match[2]) / 1024) * 100) / 100,
        free_vram_gb: match[3] ? Math.round((Number(match[3]) / 1024) * 100) / 100 : null,
      });
    }
    cachedLlamaSyclGpu = devices.sort((a, b) => b.vram_gb - a.vram_gb)[0] || null;
  } catch (_) {
    cachedLlamaSyclGpu = null;
  }
  return cachedLlamaSyclGpu;
}

function getGpuInfo() {
  if (cachedGpuInfo) return cachedGpuInfo;

  if (osPlatform === "win32" || osPlatform === "linux") {
    const llamaCudaGpu = detectLlamaCudaGpu();
    if (llamaCudaGpu) {
      cachedGpuInfo = llamaCudaGpu;
      return cachedGpuInfo;
    }

    const llamaVulkanGpu = detectLlamaVulkanGpu();
    if (llamaVulkanGpu) {
      cachedGpuInfo = llamaVulkanGpu;
      return cachedGpuInfo;
    }

    try {
      const stdout = execSync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | ForEach-Object { [PSCustomObject]@{ Name = $_.Name; VRAM = [math]::Round($_.AdapterRAM / 1GB, 2) } } | ConvertTo-Json"',
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
      ).trim();
      if (stdout) {
        let gpus = [];
        try {
          const parsed = JSON.parse(stdout);
          if (Array.isArray(parsed)) {
            gpus = parsed;
          } else if (parsed && typeof parsed === "object") {
            gpus = [parsed];
          }
        } catch (_) {}

        if (gpus.length > 0) {
          const discreteKeywords = ["nvidia", "amd", "arc", "geforce", "radeon", "rtx", "gtx"];
          let activeGpus = gpus.filter(gpu => !isVirtualOrSoftwareGpu(gpu.Name));
          if (activeGpus.length === 0) {
            activeGpus = gpus;
          }
          let selectedGpu = activeGpus.find(gpu => {
            const name = String(gpu.Name || "").toLowerCase();
            return discreteKeywords.some(kw => name.includes(kw));
          });
          if (!selectedGpu) {
            selectedGpu = activeGpus[0];
          }
          cachedGpuInfo = {
            name: selectedGpu.Name || "Unknown GPU",
            vram_gb: typeof selectedGpu.VRAM === "number" ? selectedGpu.VRAM : 0
          };
          return cachedGpuInfo;
        }
      }
    } catch (_) {}
    // Fallback if Powershell fails or returns empty
    try {
      const output = execSync(
        "powershell -NoProfile -Command \"Get-CimInstance Win32_VideoController | Select-Object -First 1 -ExpandProperty Name\"",
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      if (output) {
        cachedGpuInfo = { name: output, vram_gb: 0 };
        return cachedGpuInfo;
      }
    } catch (_) {}
  }

  if (osPlatform === "darwin") {
    try {
      const output = execSync("system_profiler SPDisplaysDataType", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const lines = output.split("\n");
      let currentGpu = null;
      const gpus = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("Chipset Model:")) {
          if (currentGpu) {
            gpus.push(currentGpu);
          }
          currentGpu = {
            name: trimmed.substring("Chipset Model:".length).trim(),
            vram_gb: 0,
          };
        } else if (currentGpu && (trimmed.startsWith("VRAM (Total):") || trimmed.startsWith("VRAM (Dynamic, Max):"))) {
          const valStr = trimmed.split(":")[1].trim(); // e.g. "2 GB" or "1536 MB"
          let bytesVal = 0;
          const numMatch = valStr.match(/^([\d\.]+)\s*(GB|MB)/i);
          if (numMatch) {
            const val = parseFloat(numMatch[1]);
            const unit = numMatch[2].toUpperCase();
            if (unit === "GB") {
              bytesVal = val;
            } else if (unit === "MB") {
              bytesVal = val / 1024;
            }
          }
          currentGpu.vram_gb = Math.round(bytesVal * 100) / 100;
        }
      }
      if (currentGpu) {
        gpus.push(currentGpu);
      }

      if (gpus.length > 0) {
        const isAppleSilicon = gpus.some(g => {
          const name = g.name.toLowerCase();
          return name.includes("apple") || name.includes("m1") || name.includes("m2") || name.includes("m3") || name.includes("m4");
        }) || (os.arch() === "arm64");

        if (isAppleSilicon) {
          const totalRamGb = Math.round((os.totalmem() / (1024 ** 3)) * 100) / 100;
          let selected = gpus.find(g => g.name.toLowerCase().includes("apple")) || gpus[0];
          cachedGpuInfo = {
            name: selected.name,
            vram_gb: totalRamGb
          };
          return cachedGpuInfo;
        } else {
          const discreteKeywords = ["nvidia", "amd", "radeon", "geforce"];
          let selected = gpus.find(gpu => {
            const name = gpu.name.toLowerCase();
            return discreteKeywords.some(kw => name.includes(kw));
          });
          if (!selected) {
            selected = gpus[0];
          }
          cachedGpuInfo = {
            name: selected.name,
            vram_gb: selected.vram_gb
          };
          return cachedGpuInfo;
        }
      }
    } catch (_) {}
    // Fallback if system_profiler command fails
    const totalRamGb = Math.round((os.totalmem() / (1024 ** 3)) * 100) / 100;
    cachedGpuInfo = { name: "Apple Metal GPU", vram_gb: totalRamGb };
    return cachedGpuInfo;
  }

  if (osPlatform === "linux") {
    // AMD cards: Scan /sys/class/drm/card*/device/vendor and mem_info_vram_total
    try {
      if (fs.existsSync("/sys/class/drm")) {
        const cards = fs.readdirSync("/sys/class/drm").filter(name => name.startsWith("card"));
        for (const card of cards) {
          const vendorPath = `/sys/class/drm/${card}/device/vendor`;
          const vramPath = `/sys/class/drm/${card}/device/mem_info_vram_total`;
          if (fs.existsSync(vendorPath) && fs.existsSync(vramPath)) {
            const vendor = fs.readFileSync(vendorPath, "utf8").trim();
            if (vendor === "0x1002") {
              const vramBytesStr = fs.readFileSync(vramPath, "utf8").trim();
              const vramBytes = parseFloat(vramBytesStr);
              if (!isNaN(vramBytes)) {
                cachedGpuInfo = {
                  name: "AMD Radeon GPU",
                  vram_gb: Math.round((vramBytes / (1024 ** 3)) * 100) / 100
                };
                return cachedGpuInfo;
              }
            }
          }
        }
      }
    } catch (_) {}

    // NVIDIA cards: read /proc/driver/nvidia/gpus/*/information or run nvidia-smi
    try {
      if (fs.existsSync("/proc/driver/nvidia/gpus")) {
        const gpuDirs = fs.readdirSync("/proc/driver/nvidia/gpus");
        for (const gpuDir of gpuDirs) {
          const infoPath = `/proc/driver/nvidia/gpus/${gpuDir}/information`;
          if (fs.existsSync(infoPath)) {
            const info = fs.readFileSync(infoPath, "utf8");
            const modelMatch = info.match(/Model:\s+(.*)/);
            if (modelMatch) {
              const modelName = modelMatch[1].trim();
              let vram_gb = 0;
              try {
                const smiOut = execSync("nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits", {
                  encoding: "utf8",
                  stdio: ["ignore", "pipe", "ignore"]
                }).trim();
                const parsedVal = parseFloat(smiOut);
                if (!isNaN(parsedVal)) {
                  vram_gb = Math.round((parsedVal / 1024) * 100) / 100;
                }
              } catch (_) {}
              cachedGpuInfo = {
                name: modelName,
                vram_gb: vram_gb || 8.0
              };
              return cachedGpuInfo;
            }
          }
        }
      }
    } catch (_) {}

    try {
      const smiOut = execSync("nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
      if (smiOut) {
        const lines = smiOut.split("\n");
        if (lines[0]) {
          const [name, totalMb] = lines[0].split(",").map(p => p.trim());
          const parsedVal = parseFloat(totalMb);
          cachedGpuInfo = {
            name: name || "NVIDIA GPU",
            vram_gb: !isNaN(parsedVal) ? Math.round((parsedVal / 1024) * 100) / 100 : 8.0
          };
          return cachedGpuInfo;
        }
      }
    } catch (_) {}

    const linuxGpu = detectLinuxGpuFromSysfs();
    if (linuxGpu) {
      cachedGpuInfo = {
        name: linuxGpu.name,
        vram_gb: 0
      };
      return cachedGpuInfo;
    }
  }

  cachedGpuInfo = { name: "Unavailable", vram_gb: 0 };
  return cachedGpuInfo;
}

// -- NPU Detection -------------------------------------------------------------
let cachedNpuInfo = null;
let cachedHasNpuHardware = null;

function hasNpuHardware() {
  if (cachedHasNpuHardware !== null) return cachedHasNpuHardware;

  if (osPlatform !== "win32" && osPlatform !== "linux") {
    cachedHasNpuHardware = false;
    return cachedHasNpuHardware;
  }

  try {
    if (osPlatform === "win32") {
      const deviceResult = spawnSync("wmic", [
        "path", "win32_pnpentity", "where", "Name like '%NPU%' or Name like '%Intel%AI%' or Name like '%VPU%'", "get", "Name", "/value"
      ], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] });
      if (deviceResult.status === 0 && deviceResult.stdout && /NPU|AI Boost|VPU/i.test(deviceResult.stdout)) {
        cachedHasNpuHardware = true;
        return cachedHasNpuHardware;
      }

      const cpuResult = spawnSync("wmic", ["cpu", "get", "Name", "/value"], {
        encoding: "utf8",
        timeout: 10000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (cpuResult.status === 0 && cpuResult.stdout) {
        const cpuName = cpuResult.stdout.toLowerCase();
        if (cpuName.includes("ultra") && (cpuName.match(/ultra\s*\d/) || cpuName.includes("core(tm) ultra"))) {
          cachedHasNpuHardware = true;
          return cachedHasNpuHardware;
        }
      }
    } else if (osPlatform === "linux") {
      const lspciResult = spawnSync("lspci", [], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] });
      if (lspciResult.status === 0 && lspciResult.stdout && lspciResult.stdout.toLowerCase().includes("npu")) {
        cachedHasNpuHardware = true;
        return cachedHasNpuHardware;
      }

      try {
        const sysPci = fs.readdirSync("/sys/bus/pci/devices");
        for (const dev of sysPci) {
          const vendorPath = `/sys/bus/pci/devices/${dev}/vendor`;
          const classPath = `/sys/bus/pci/devices/${dev}/class`;
          if (!fs.existsSync(vendorPath) || !fs.existsSync(classPath)) continue;
          const vendor = fs.readFileSync(vendorPath, "utf8").trim();
          const devClass = fs.readFileSync(classPath, "utf8").trim();
          if (vendor === "0x8086" && (devClass.includes("1180") || devClass.includes("acce"))) {
            cachedHasNpuHardware = true;
            return cachedHasNpuHardware;
          }
        }
      } catch (_) {}

      try {
        const cpuInfo = fs.readFileSync("/proc/cpuinfo", "utf8").toLowerCase();
        if (cpuInfo.includes("ultra") && cpuInfo.includes("intel")) {
          cachedHasNpuHardware = true;
          return cachedHasNpuHardware;
        }
      } catch (_) {}
    }
  } catch (_) {}

  cachedHasNpuHardware = false;
  return cachedHasNpuHardware;
}

function detectNpu() {
  if (cachedNpuInfo !== null) return cachedNpuInfo;
  cachedNpuInfo = { detected: false, vendor: null, name: null };
  
  if (osPlatform === "win32") {
    try {
      const output = execSync(
        'powershell -NoProfile -Command "Get-PnpDevice | Where-Object { $_.FriendlyName -match \'Intel.*NPU\' -or $_.FriendlyName -match \'Neural\' } | Select-Object -First 1 FriendlyName"',
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }
      ).trim();
      if (output && output.includes("NPU")) {
        cachedNpuInfo = { detected: true, vendor: "intel", name: output.trim() };
      }
    } catch (_) {}
  } else if (osPlatform === "linux") {
    try {
      const output = execSync("lspci | grep -i 'neural\|npu' || true", {
        encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000
      }).trim();
      if (output) {
        const isIntel = output.toLowerCase().includes("intel");
        cachedNpuInfo = { 
          detected: true, 
          vendor: isIntel ? "intel" : "unknown", 
          name: output.split("\n")[0].trim() 
        };
      }
    } catch (_) {}
  }
  // macOS: Apple Silicon Neural Engine is part of the SoC, not a separate NPU device
  return cachedNpuInfo;
}

// -- GPU Layer Auto-Tuning -----------------------------------------------------
// Calculate optimal GPU layer count from free VRAM to prevent OOM
function chooseAutoLayers(modelFilename, freeVramBytes, cacheTypeK = "q8_0", cacheTypeV = "q8_0") {
  let modelSizeGb = 4;
  let layerCount = 32;
  
  try {
    const modelPath = path.join(LLM_MODELS, modelFilename);
    if (fs.existsSync(modelPath)) {
      const stats = fs.statSync(modelPath);
      modelSizeGb = stats.size / (1024 * 1024 * 1024);
    }
  } catch (_) {}
  
  // Estimate layer count from model size (rough heuristic based on common architectures)
  if (modelSizeGb < 2) layerCount = 24;      // Small models (1-2B)
  else if (modelSizeGb < 4) layerCount = 32;   // Medium (3-4B)
  else if (modelSizeGb < 8) layerCount = 40;   // Large (7-8B)
  else if (modelSizeGb < 20) layerCount = 80;    // Very large (13-20B)
  else if (modelSizeGb < 40) layerCount = 100;   // Huge (30-40B)
  else layerCount = 120;                        // Massive (70B+)
  
  // Calculate approximate layer size
  const layerSizeGb = modelSizeGb / layerCount;
  
  // Account for KV cache memory with quantization
  // q8_0 = 0.5x, q4_0 = 0.25x of f16
  const kvCacheMultiplier = (cacheTypeK === "q4_0" || cacheTypeV === "q4_0") ? 0.25 :
                            (cacheTypeK === "q8_0" || cacheTypeV === "q8_0") ? 0.5 : 1.0;
  
  // Leave 15% VRAM headroom for KV cache + overhead + OS
  const usableVram = freeVramBytes * 0.85;
  const maxLayers = Math.floor(usableVram / (layerSizeGb * 1024 * 1024 * 1024));
  
  // Cap at total layers, return -1 if fits fully
  if (maxLayers >= layerCount) return -1;  // All layers fit
  return Math.max(0, maxLayers);
}

function getGgufModelSizeGb(modelFilename) {
  try {
    const modelPath = path.join(LLM_MODELS, modelFilename);
    if (fs.existsSync(modelPath)) {
      return fs.statSync(modelPath).size / (1024 * 1024 * 1024);
    }
  } catch (_) {}
  return 4;
}

function getStableSyclGpuLayers(modelFilename, requestedLayers) {
  if (process.env.LOCALAI_LLM_ALLOW_FULL_SYCL === "1") return requestedLayers;
  if (requestedLayers !== -1) return requestedLayers;

  const syclGpu = detectLlamaSyclGpu();
  const vramGb = syclGpu?.free_vram_gb || syclGpu?.vram_gb || 0;
  const modelSizeGb = getGgufModelSizeGb(modelFilename);
  if (vramGb > 0 && vramGb <= 8.5 && modelSizeGb >= 2.5) {
    return 0;
  }
  if (vramGb > 0 && vramGb <= 12 && modelSizeGb >= 5) {
    return 0;
  }
  return requestedLayers;
}

let nvidiaSmiCmd = "nvidia-smi";
let hasNvidiaSmi = null;

if (osPlatform === "win32") {
  const commonPath = "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe";
  if (fs.existsSync(commonPath)) {
    nvidiaSmiCmd = `"${commonPath}"`;
  }
}

let isPollingVram = false;
let lastVramPollTime = 0;

function pollNvidiaVram(force = false) {
  if (isPollingVram) return;
  if (hasNvidiaSmi === false) return;

  const now = Date.now();
  // If not forced, skip if backend is running (driver queries conflict & cause display lag),
  // or if it has been polled too recently
  if (!force) {
    if (backendProc !== null) {
      return;
    }
    if (now - lastVramPollTime < 4500) {
      return;
    }
  }

  isPollingVram = true;
  lastVramPollTime = now;
  const cmd = `${nvidiaSmiCmd} --query-gpu=name,memory.used,memory.total --format=csv,noheader,nounits`;
  exec(
    cmd,
    { stdio: ["ignore", "pipe", "ignore"] },
    (error, stdout) => {
      isPollingVram = false;
      if (error) {
        // Only permanently disable if we are not currently running a backend workload
        if (backendProc === null) {
          hasNvidiaSmi = false;
        }
        cachedVramInfo = null;
        return;
      }
      hasNvidiaSmi = true;
      const output = (stdout || "").trim();
      const firstLine = output.split(/\r?\n/)[0];
      if (!firstLine) {
        cachedVramInfo = null;
        return;
      }

      const [name, usedMb, totalMb] = firstLine.split(",").map(part => part.trim());
      cachedVramInfo = {
        gpu_name: name || getGpuInfo().name,
        vram_used_gb: Math.round((parseFloat(usedMb) / 1024) * 100) / 100,
        vram_total_gb: Math.round((parseFloat(totalMb) / 1024) * 100) / 100,
      };
    }
  );
}

// Start background VRAM polling (runs every 5 seconds, only active when backend is idle)
setInterval(() => pollNvidiaVram(false), 5000);
pollNvidiaVram(true);

function getNvidiaVram() {
  return cachedVramInfo;
}

let cachedLlamaVramInfo = null;
let isPollingLlamaVram = false;
let lastLlamaVramPollTime = 0;

function parseLlamaDeviceMemory(output) {
  const devices = [];
  const devicePattern = /(CUDA|Vulkan|SYCL)\d+\s*:\s*(.+?)\s+\(([\d.]+)\s+MiB(?:,\s*([\d.]+)\s+MiB free)?\)/gi;
  let match;
  while ((match = devicePattern.exec(output || "")) !== null) {
    const totalMiB = Number(match[3]);
    const freeMiB = match[4] ? Number(match[4]) : NaN;
    if (!Number.isFinite(totalMiB) || totalMiB <= 0) continue;

    const usedMiB = Number.isFinite(freeMiB) ? Math.max(0, totalMiB - freeMiB) : 0;
    devices.push({
      gpu_name: match[2].trim(),
      vram_used_gb: Math.round((usedMiB / 1024) * 100) / 100,
      vram_total_gb: Math.round((totalMiB / 1024) * 100) / 100,
    });
  }
  return devices.sort((a, b) => b.vram_total_gb - a.vram_total_gb)[0] || null;
}

function getLlamaTelemetryBackendPath() {
  if (osPlatform === "win32") {
    if (fs.existsSync(LLM_BACKEND_PATHS.winVulkan)) return LLM_BACKEND_PATHS.winVulkan;
    if (fs.existsSync(LLM_BACKEND_PATHS.winSycl)) return LLM_BACKEND_PATHS.winSycl;
    if (fs.existsSync(LLM_BACKEND_PATHS.winHip)) return LLM_BACKEND_PATHS.winHip;
    if (fs.existsSync(LLM_BACKEND_PATHS.winCuda)) return LLM_BACKEND_PATHS.winCuda;
  } else if (osPlatform === "linux") {
    if (fs.existsSync(LLM_BACKEND_PATHS.linuxVulkan)) return LLM_BACKEND_PATHS.linuxVulkan;
    if (fs.existsSync(LLM_BACKEND_PATHS.linuxSycl)) return LLM_BACKEND_PATHS.linuxSycl;
    if (fs.existsSync(LLM_BACKEND_PATHS.linuxRocm)) return LLM_BACKEND_PATHS.linuxRocm;
    if (fs.existsSync(LLM_BACKEND_PATHS.linuxCuda)) return LLM_BACKEND_PATHS.linuxCuda;
  }
  return null;
}

function pollLlamaVram(force = false) {
  if (isPollingLlamaVram) return;

  const now = Date.now();
  if (!force && now - lastLlamaVramPollTime < 4500) {
    return;
  }

  const backendPath = getLlamaTelemetryBackendPath();
  if (!backendPath) return;

  isPollingLlamaVram = true;
  lastLlamaVramPollTime = now;
  execFile(
    backendPath,
    ["--list-devices"],
    { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 },
    (error, stdout, stderr) => {
      isPollingLlamaVram = false;
      if (error) {
        cachedLlamaVramInfo = null;
        return;
      }
      cachedLlamaVramInfo = parseLlamaDeviceMemory(`${stdout || ""}\n${stderr || ""}`);
    }
  );
}

setInterval(() => pollLlamaVram(false), 5000);
pollLlamaVram(true);

function getLlamaVram() {
  return cachedLlamaVramInfo;
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function getPersistedLlmModelSettings() {
  return readJsonFile(LLM_MODEL_SETTINGS_PATH, { models: {} });
}

function savePersistedLlmModelSettings(settings) {
  writeJsonFile(LLM_MODEL_SETTINGS_PATH, settings && typeof settings === "object" ? settings : { models: {} });
}

function getLlmModelSettings(filename) {
  const safeFilename = path.basename(String(filename || ""));
  if (!safeFilename) return {};
  const settings = getPersistedLlmModelSettings();
  return settings.models?.[safeFilename] || {};
}

function updateLlmModelSettings(filename, patch) {
  const safeFilename = path.basename(String(filename || ""));
  if (!safeFilename) return {};
  const allSettings = getPersistedLlmModelSettings();
  if (!allSettings.models || typeof allSettings.models !== "object") allSettings.models = {};
  const previous = allSettings.models[safeFilename] || {};
  const next = {
    ...previous,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  allSettings.models[safeFilename] = next;
  savePersistedLlmModelSettings(allSettings);
  return next;
}

function getPersistedLlmBenchmarks() {
  return readJsonFile(LLM_BENCHMARK_PATH, { results: [] });
}

function savePersistedLlmBenchmarks(benchmarks) {
  writeJsonFile(LLM_BENCHMARK_PATH, benchmarks && typeof benchmarks === "object" ? benchmarks : { results: [] });
}

function recordLlmBenchmark(result) {
  const benchmarks = getPersistedLlmBenchmarks();
  const results = Array.isArray(benchmarks.results) ? benchmarks.results : [];
  results.unshift({
    ...result,
    createdAt: new Date().toISOString(),
  });
  benchmarks.results = results.slice(0, 100);
  savePersistedLlmBenchmarks(benchmarks);
  return benchmarks.results[0];
}

function parseLlamaDeviceList(output) {
  const devices = [];
  const devicePattern = /(CUDA|Vulkan|SYCL|HIP|ROCm)\d*\s*:\s*(.+?)\s+\(([\d.]+)\s+MiB(?:,\s*([\d.]+)\s+MiB free)?\)/gi;
  let match;
  while ((match = devicePattern.exec(output || "")) !== null) {
    const totalMiB = Number(match[3]);
    const freeMiB = match[4] ? Number(match[4]) : NaN;
    if (!Number.isFinite(totalMiB) || totalMiB <= 0) continue;
    devices.push({
      type: match[1],
      name: match[2].trim(),
      vram_gb: Math.round((totalMiB / 1024) * 100) / 100,
      free_vram_gb: Number.isFinite(freeMiB) ? Math.round((freeMiB / 1024) * 100) / 100 : null,
    });
  }
  return devices.sort((a, b) => b.vram_gb - a.vram_gb);
}

let cachedMacRamUsedGb = null;
function pollMacRam() {
  if (osPlatform !== "darwin") return;
  exec("vm_stat", (err, stdout) => {
    if (err) return;
    try {
      const vmStat = stdout.toString();
      const pageSizeMatch = vmStat.match(/page size of (\d+) bytes/);
      const pageSize = pageSizeMatch ? parseInt(pageSizeMatch[1], 10) : 4096;

      const getVal = (key) => {
        const match = vmStat.match(new RegExp(key + ":\\s+(\\d+)\\."));
        return match ? parseInt(match[1], 10) : 0;
      };

      const freePages = getVal("Pages free");
      const inactivePages = getVal("Pages inactive");
      const speculativePages = getVal("Pages speculative");
      
      const totalFreeBytes = (freePages + inactivePages + speculativePages) * pageSize;
      cachedMacRamUsedGb = roundGb(os.totalmem() - totalFreeBytes);
    } catch (e) {
      // Ignore parsing errors
    }
  });
}

if (osPlatform === "darwin") {
  pollMacRam();
  setInterval(pollMacRam, 5000);
}

function getHardwareSpecs() {
  const cpus = os.cpus();
  const gpu = getGpuInfo();
  const ramTotalGb = roundGb(os.totalmem());
  const gpuVramGb = gpu.vram_gb || 0;
  const physicalCores = getPhysicalCores();
  const logicalCores = cpus.length;
  const npuInfo = detectNpu();

  // Tiering logic
  let tier = "low";
  let tierReason = "";

  const isAppleSilicon = osPlatform === "darwin" && (os.arch() === "arm64" || String(cpus[0]?.model || "").toLowerCase().includes("apple"));

  if (isAppleSilicon) {
    if (ramTotalGb >= 16) {
      tier = "high";
      tierReason = `Apple Silicon Mac with ${ramTotalGb} GB unified memory.`;
    } else if (ramTotalGb >= 8) {
      tier = "mid";
      tierReason = `Apple Silicon Mac with ${ramTotalGb} GB unified memory.`;
    } else {
      tier = "low";
      tierReason = `Apple Silicon Mac with ${ramTotalGb} GB unified memory.`;
    }
  } else {
    if (gpuVramGb >= 12) {
      tier = "high";
      tierReason = `Discrete GPU with ${gpuVramGb} GB VRAM.`;
    } else if (gpuVramGb >= 6) {
      tier = "mid";
      tierReason = `GPU with ${gpuVramGb} GB VRAM.`;
    } else {
      tier = "low";
      tierReason = `GPU with ${gpuVramGb} GB VRAM and ${ramTotalGb} GB RAM.`;
    }
  }

  // Recommended text settings per tier
  const recommendedTextSettings = {
    low: {
      contextSize: 2048,
      threads: Math.max(2, Math.floor(physicalCores / 3)),
      gpuLayers: 16,
      cacheTypeK: "q4_0",
      cacheTypeV: "q4_0",
      flashAttn: false,
      mlock: false,
      mmap: true,
      cachePrompt: true,
      batchSize: 256,
      ubatchSize: 128,
      performanceProfile: "potato",
    },
    mid: {
      contextSize: 4096,
      threads: Math.max(4, Math.floor(physicalCores / 2)),
      gpuLayers: 35,
      cacheTypeK: "q8_0",
      cacheTypeV: "q8_0",
      flashAttn: true,
      mlock: false,
      mmap: true,
      cachePrompt: true,
      batchSize: 512,
      ubatchSize: 256,
      performanceProfile: "balanced",
    },
    high: {
      contextSize: 8192,
      threads: Math.max(4, physicalCores),
      gpuLayers: -1,
      cacheTypeK: "f16",
      cacheTypeV: "f16",
      flashAttn: true,
      mlock: true,
      mmap: true,
      cachePrompt: true,
      batchSize: 1024,
      ubatchSize: 512,
      performanceProfile: "high",
    },
  };

  // Recommended models catalog matching contract exactly
  let recommended_models = [];
  if (tier === "high") {
    recommended_models = [
      {
        name: "Llama 3.1 8B Instruct (Q8_0)",
        filename: "Meta-Llama-3.1-8B-Instruct-Q8_0.gguf",
        approxSize: "8.5 GB",
        url: "https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q8_0.gguf",
        notes: "Near-lossless precision for high quality responses.",
        reason: tierReason
      },
      {
        name: "Mistral 7B Instruct v0.3 (Q8_0)",
        filename: "Mistral-7B-Instruct-v0.3-Q8_0.gguf",
        approxSize: "7.7 GB",
        url: "https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3-Q8_0.gguf",
        notes: "Strong instruction following with a 32K context window.",
        reason: tierReason
      }
    ];
  } else if (tier === "mid") {
    recommended_models = [
      {
        name: "Llama 3.1 8B Instruct (Q4_K_M)",
        filename: "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
        approxSize: "4.9 GB",
        url: "https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
        notes: "Great balance of speed and performance.",
        reason: tierReason
      },
      {
        name: "Phi-3 Mini Instruct (Q4_K_M)",
        filename: "Phi-3-mini-4k-instruct-q4.gguf",
        approxSize: "2.4 GB",
        url: "https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf/resolve/main/Phi-3-mini-4k-instruct-q4.gguf",
        notes: "Lightweight and fast, optimized by Microsoft.",
        reason: tierReason
      }
    ];
  } else {
    recommended_models = [
      {
        name: "Qwen 2.5 Coder 0.5B Instruct (Q4_K_M)",
        filename: "qwen2.5-coder-0.5b-instruct-q4_k_m.gguf",
        approxSize: "491 MB",
        url: "https://huggingface.co/Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-0.5b-instruct-q4_k_m.gguf",
        notes: "Extremely fast, lightweight assistant, perfect for low RAM/VRAM machines.",
        reason: tierReason
      },
      {
        name: "SmolLM2 1.7B Instruct (Q4_K_M)",
        filename: "smollm2-1.7b-instruct-q4_k_m.gguf",
        approxSize: "1.1 GB",
        url: "https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct-GGUF/resolve/main/smollm2-1.7b-instruct-q4_k_m.gguf",
        notes: "Excellent lightweight assistant with strong logic, reasoning, and prompt expansion capabilities.",
        reason: tierReason
      }
    ];
  }

  return {
    os_name: `${os.type()} ${os.release()}`,
    cpu_name: cpus[0]?.model || "Unavailable",
    cpu_cores_physical: physicalCores,
    cpu_cores_logical: logicalCores,
    ram_total_gb: ramTotalGb,
    gpu_name: gpu.name,
    gpu_vram_gb: gpuVramGb,
    npu: npuInfo,
    tier,
    recommended_models,
    recommended_text_settings: {
      ...(recommendedTextSettings[tier] || recommendedTextSettings.mid),
      low: recommendedTextSettings.low,
      mid: recommendedTextSettings.mid,
      high: recommendedTextSettings.high,
    },
  };
}

function getTelemetry() {
  const vram = getNvidiaVram();
  const llamaVram = vram || getLlamaVram();
  let ram_used_gb = roundGb(os.totalmem() - os.freemem());
  if (osPlatform === "darwin" && cachedMacRamUsedGb !== null) {
    ram_used_gb = cachedMacRamUsedGb;
  }
  const gpu = getGpuInfo();
  return {
    cpu_usage: getCpuUsagePercent(),
    ram_used_gb,
    ram_total_gb: roundGb(os.totalmem()),
    gpu_name: llamaVram?.gpu_name || gpu.name,
    vram_used_gb: Number.isFinite(Number(llamaVram?.vram_used_gb)) ? llamaVram.vram_used_gb : 0,
    vram_total_gb: llamaVram?.vram_total_gb || gpu.vram_gb || 0,
  };
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1000)));
  return `${(value / (1000 ** idx)).toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function getPathInfo(label, targetPath, type = "file") {
  const exists = fs.existsSync(targetPath);
  return {
    label,
    path: targetPath,
    type,
    exists,
    ok: exists,
  };
}

function isDirWritable(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    const testFile = path.join(dirPath, `.uncensored-ai-studio-write-test-${Date.now()}.tmp`);
    fs.writeFileSync(testFile, "ok", "utf8");
    fs.unlinkSync(testFile);
    return true;
  } catch (_) {
    return false;
  }
}

function getDirInfo(label, targetPath) {
  const exists = fs.existsSync(targetPath);
  const writable = exists ? isDirWritable(targetPath) : false;
  return {
    label,
    path: targetPath,
    type: "directory",
    exists,
    writable,
    ok: exists && writable,
  };
}

function getPathSize(targetPath) {
  try {
    if (!fs.existsSync(targetPath)) return 0;
    const stat = fs.statSync(targetPath);
    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory()) return 0;
    return fs.readdirSync(targetPath).reduce((sum, name) => sum + getPathSize(path.join(targetPath, name)), 0);
  } catch (_) {
    return 0;
  }
}

function getOpenVinoPythonCandidates() {
  const candidates = [];
  if (process.env.OPENVINO_PYTHON) candidates.push(process.env.OPENVINO_PYTHON);
  if (osPlatform === "win32") {
    candidates.push(path.join(ROOT, "app", "tools", "python-win", "python.exe"));
  } else {
    candidates.push(path.join(ROOT, "app", "tools", "openvino-venv-linux", "bin", "python"));
    candidates.push(path.join(ROOT, "app", "tools", "openvino-venv", "bin", "python")); // legacy fallback
  }
  return [...new Set(candidates)];
}

function getOpenVinoPython() {
  for (const candidate of getOpenVinoPythonCandidates()) {
    try {
      const result = spawnSync(candidate, [
        "-c",
        "import openvino, openvino_genai, PIL; print(openvino.__version__)",
      ], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] });
      if (result.status === 0) return candidate;
    } catch (_) {}
  }
  return null;
}

let cachedOpenVinoNpuInfo = null;

function getOpenVinoNpuInfo() {
  if (cachedOpenVinoNpuInfo) return cachedOpenVinoNpuInfo;

  if (osPlatform !== "win32" && osPlatform !== "linux") {
    cachedOpenVinoNpuInfo = { supported: false, reason: "OpenVINO NPU backend is supported on Windows and Linux Intel Core Ultra systems." };
    return cachedOpenVinoNpuInfo;
  }
  const python = getOpenVinoPython();
  if (!python) {
    const setupScript = osPlatform === "win32"
      ? "scripts/setup/setup-openvino-npu.ps1"
      : "bash scripts/setup/setup-openvino-npu.sh";
    cachedOpenVinoNpuInfo = {
      supported: false,
      reason: `OpenVINO GenAI runtime is not installed. Run ${setupScript} first.`,
    };
    return cachedOpenVinoNpuInfo;
  }
  try {
    const script = [
      "import json, openvino as ov",
      "core=ov.Core()",
      "devices=core.available_devices",
      "info={'devices':devices,'npu':None}",
      "if 'NPU' in devices:",
      "    info['npu']={'name':core.get_property('NPU','FULL_DEVICE_NAME'),'capabilities':core.get_property('NPU','OPTIMIZATION_CAPABILITIES')}",
      "print(json.dumps(info))",
    ].join("\n");
    const result = spawnSync(python, ["-c", script], { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"] });
    if (result.status !== 0) {
      cachedOpenVinoNpuInfo = { supported: false, python, reason: result.stderr.trim() || "OpenVINO NPU probe failed." };
      return cachedOpenVinoNpuInfo;
    }
    const info = JSON.parse(result.stdout.trim());
    if (!info.devices.includes("NPU")) {
      cachedOpenVinoNpuInfo = { supported: false, python, reason: `OpenVINO is installed, but NPU is not available. Devices: ${info.devices.join(", ")}` };
      return cachedOpenVinoNpuInfo;
    }
    cachedOpenVinoNpuInfo = { supported: true, platform: osPlatform, python, devices: info.devices, npu: info.npu };
    return cachedOpenVinoNpuInfo;
  } catch (err) {
    cachedOpenVinoNpuInfo = { supported: false, python, reason: err.message || String(err) };
    return cachedOpenVinoNpuInfo;
  }
}

function getOpenVinoModelInfo() {
  return OPENVINO_NPU_MODELS.map((model) => {
    const modelPath = path.join(OPENVINO_MODELS, model.folder);
    const requiredFiles = [
      path.join(modelPath, "model_index.json"),
      path.join(modelPath, "text_encoder", "openvino_model.xml"),
      path.join(modelPath, "unet", "openvino_model.xml"),
      path.join(modelPath, "vae_decoder", "openvino_model.xml"),
    ];
    const installed = requiredFiles.every((file) => fs.existsSync(file));
    return {
      ...model,
      filename: model.id,
      path: modelPath,
      installed,
      sizeBytes: getPathSize(modelPath),
      size: formatBytes(getPathSize(modelPath)),
      format: "OpenVINO",
    };
  });
}

function findOpenVinoModel(modelId) {
  return getOpenVinoModelInfo().find((model) => model.id === modelId || model.folder === modelId || model.name === modelId);
}

function pathInside(childPath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function checkPort(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once("error", () => resolve({ port, available: false, inUse: true }))
      .once("listening", () => {
        tester.close(() => resolve({ port, available: true, inUse: false }));
      })
      .listen(port, "127.0.0.1");
  });
}

async function waitForPortAvailable(port, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const status = await checkPort(port);
    if (status.available) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

async function findAvailableBackendPort() {
  const preferred = await checkPort(PREFERRED_BACKEND_PORT);
  if (preferred.available) return PREFERRED_BACKEND_PORT;

  for (let port = 28088; port <= 28120; port += 1) {
    const candidate = await checkPort(port);
    if (candidate.available) {
      console.log(`  [backend] Preferred port ${PREFERRED_BACKEND_PORT} mesgul; su kullaniliyor ${port} yerine.`);
      return port;
    }
  }

  throw new Error(`No free backend port found. Tried ${PREFERRED_BACKEND_PORT} and 28088-28120.`);
}

async function findAvailableLlmPort() {
  const preferred = await checkPort(PREFERRED_LLM_PORT);
  if (preferred.available) return PREFERRED_LLM_PORT;

  for (let port = 28121; port <= 28160; port += 1) {
    const candidate = await checkPort(port);
    if (candidate.available) {
      console.log(`  [llm] Preferred port ${PREFERRED_LLM_PORT} mesgul; su kullaniliyor ${port} yerine.`);
      return port;
    }
  }

  throw new Error(`No free LLM port found. Tried ${PREFERRED_LLM_PORT} and 28121-28160.`);
}

async function findAvailableSpeechPort() {
  const preferred = await checkPort(PREFERRED_SPEECH_PORT);
  if (preferred.available) return PREFERRED_SPEECH_PORT;

  for (let port = 28161; port <= 28190; port += 1) {
    const candidate = await checkPort(port);
    if (candidate.available) {
      console.log(`  [speech] Preferred port ${PREFERRED_SPEECH_PORT} mesgul; su kullaniliyor ${port} yerine.`);
      return port;
    }
  }

  throw new Error(`No free speech port found. Tried ${PREFERRED_SPEECH_PORT} and 28161-28190.`);
}

function getLlmBackend() {
  return getLlmBackendCandidates()[0] || null;
}

let cachedLlmBackendProbe = null;
let cachedLlmBackendProbeAt = 0;

function resolveSystemLlamaServer() {
  const configured = process.env.LOCALAI_LLM_SYSTEM_SERVER || process.env.LLAMA_SERVER_PATH || "";
  if (configured && fs.existsSync(configured)) return configured;
  return "";
}

function probeLlmBackend(backend) {
  if (!backend?.path || !fs.existsSync(backend.path)) {
    return {
      ...backend,
      installed: false,
      detected: false,
      devices: [],
      error: "Backend binary not installed.",
    };
  }

  try {
    const result = spawnSync(backend.path, ["--list-devices"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    const devices = parseLlamaDeviceList(output);
    const detected = backend.key === "cpu" || backend.key === "metal" || backend.key === "system" || devices.length > 0;
    return {
      ...backend,
      installed: true,
      detected,
      devices,
      device: devices[0] || null,
      error: result.status && !detected ? output.trim().slice(-600) : "",
    };
  } catch (err) {
    return {
      ...backend,
      installed: true,
      detected: backend.key === "cpu",
      devices: [],
      device: null,
      error: err.message || String(err),
    };
  }
}

function getAllLlmBackendCandidates() {
  const systemPath = resolveSystemLlamaServer();
  const candidates = [];
  const add = (key, backendPath, mode, portable = true) => {
    if (!backendPath) return;
    if (candidates.some((item) => item.path === backendPath)) return;
    candidates.push({ key, path: backendPath, mode, portable });
  };

  if (systemPath) add("system", systemPath, "System llama.cpp", false);
  if (osPlatform === "win32") {
    add("cuda", LLM_BACKEND_PATHS.winCuda, "Auto (CUDA/CPU)");
    add("hip", LLM_BACKEND_PATHS.winHip, "Auto (HIP/CPU)");
    add("vulkan", LLM_BACKEND_PATHS.winVulkan, "Auto (Vulkan/CPU)");
    add("sycl", LLM_BACKEND_PATHS.winSycl, "Auto (SYCL/CPU)");
    add("cpu", LLM_BACKEND_PATHS.winCpu, "CPU");
  } else if (osPlatform === "darwin") {
    add("metal", process.arch === "arm64" ? LLM_BACKEND_PATHS.macArm64 : LLM_BACKEND_PATHS.macX64, process.arch === "arm64" ? "Metal GPU" : "CPU");
  } else {
    add("cuda", LLM_BACKEND_PATHS.linuxCuda, "Auto (CUDA/CPU)");
    add("rocm", LLM_BACKEND_PATHS.linuxRocm, "Auto (ROCm/CPU)");
    add("sycl", LLM_BACKEND_PATHS.linuxSycl, "Auto (SYCL/CPU)");
    add("vulkan", LLM_BACKEND_PATHS.linuxVulkan, "Auto (Vulkan/CPU)");
    add("cpu", LLM_BACKEND_PATHS.linuxCpu, "CPU");
  }
  return candidates;
}

function getLlmBackendProbe(force = false) {
  const now = Date.now();
  if (!force && cachedLlmBackendProbe && now - cachedLlmBackendProbeAt < 60000) return cachedLlmBackendProbe;

  const probed = getAllLlmBackendCandidates().map(probeLlmBackend);
  const priority = osPlatform === "win32"
    ? { system: -1, cuda: 0, hip: 1, vulkan: 2, sycl: 3, metal: 4, cpu: 9 }
    : osPlatform === "darwin"
      ? { system: -1, metal: 0, cpu: 9 }
      : { system: -1, cuda: 0, rocm: 1, sycl: 2, cpu: 3, vulkan: 4 };

  const available = probed
    .filter((item) => item.installed && item.detected)
    .sort((a, b) => {
      if (osPlatform !== "linux") {
        if (a.key === "cpu" && b.key !== "cpu") return 1;
        if (b.key === "cpu" && a.key !== "cpu") return -1;
      }
      return (priority[a.key] ?? 8) - (priority[b.key] ?? 8);
    });

  cachedLlmBackendProbe = {
    generatedAt: new Date().toISOString(),
    candidates: probed,
    available,
    selected: available[0] || null,
  };
  cachedLlmBackendProbeAt = now;
  return cachedLlmBackendProbe;
}

function getLlmBackendCandidates() {
  const includeUndetectedGpu = process.env.LOCALAI_LLM_TRY_UNDETECTED_GPU === "1";
  const probe = getLlmBackendProbe();
  if (includeUndetectedGpu) {
    return probe.candidates.filter((item) => item.installed);
  }
  return probe.available;
}

function getCloudLlmModels() {
  try {
    const cfg = getProvidersConfig();
    const keys = cfg?.keys || {};
    const customModels = cfg?.customModels || {};
    const cloudList = [];

    const addCloudModel = (provider, modelId, displayName) => {
      const fullId = `cloud:${provider}:${modelId}`;
      if (cloudList.some((m) => m.filename === fullId)) return;
      cloudList.push({
        filename: fullId,
        name: displayName,
        displayName: displayName,
        sizeBytes: 0,
        size: "Bulut API",
        format: "Cloud API",
        isProjector: false,
        isCloud: true,
        provider,
        cloudModelId: modelId,
        installed: true,
      });
    };

    if (keys.openrouter && String(keys.openrouter).trim()) {
      addCloudModel("openrouter", "minimax/minimax-m3.1-flash:free", "MiniMax M3.1 Flash [OpenRouter API - Hazır]");
      addCloudModel("openrouter", "minimax/minimax-m2.7", "MiniMax M2.7 [OpenRouter API - Hazır]");
      addCloudModel("openrouter", "minimax/minimax-m2.5", "MiniMax M2.5 [OpenRouter API - Hazır]");
      addCloudModel("openrouter", "minimax/minimax-m1", "MiniMax M1 Reasoning [OpenRouter API - Hazır]");
      addCloudModel("openrouter", "minimax/minimax-01", "MiniMax-01 456B [OpenRouter API - Hazır]");
      addCloudModel("openrouter", "google/gemma-4-31b-it:free", "Google Gemma 4 31B Instruct [OpenRouter API - Hazır]");
      addCloudModel("openrouter", "deepseek/deepseek-v4-flash", "DeepSeek V4 Flash [OpenRouter API - Hazır]");
      addCloudModel("openrouter", "deepseek/deepseek-r1-0528", "DeepSeek R1 (0528) Reasoning [OpenRouter API - Hazır]");
      addCloudModel("openrouter", "anthropic/claude-sonnet-5.5", "Claude Sonnet 5.5 [OpenRouter API - Hazır]");
      addCloudModel("openrouter", "openai/gpt-5.5", "OpenAI GPT-5.5 [OpenRouter API - Hazır]");
      addCloudModel("openrouter", "google/gemini-2.5-flash", "Google Gemini 2.5 Flash [OpenRouter API - Hazır]");
      addCloudModel("openrouter", "meta-llama/llama-3.3-70b-instruct", "Llama 3.3 70B Instruct [OpenRouter API - Hazır]");
      const customOr = Array.isArray(customModels.openrouter) ? customModels.openrouter : [];
      for (const cm of customOr) {
        if (cm && String(cm).trim()) {
          const cleanId = String(cm).trim();
          addCloudModel("openrouter", cleanId, `${cleanId} [OpenRouter API - Hazır]`);
        }
      }
    }

    if (keys.openai && String(keys.openai).trim()) {
      addCloudModel("openai", "gpt-5.5", "OpenAI GPT-5.5 [OpenAI API - Hazır]");
      addCloudModel("openai", "gpt-5.4-mini", "OpenAI GPT-5.4 Mini [OpenAI API - Hazır]");
      const customOa = Array.isArray(customModels.openai) ? customModels.openai : [];
      for (const cm of customOa) {
        if (cm && String(cm).trim()) {
          const cleanId = String(cm).trim();
          addCloudModel("openai", cleanId, `${cleanId} [OpenAI API - Hazır]`);
        }
      }
    }

    if (keys.anthropic && String(keys.anthropic).trim()) {
      addCloudModel("anthropic", "claude-opus-5-5", "Claude Opus 5.5 [Anthropic API - Hazır]");
      addCloudModel("anthropic", "claude-sonnet-5-5", "Claude Sonnet 5.5 [Anthropic API - Hazır]");
      addCloudModel("anthropic", "claude-haiku-5-5", "Claude Haiku 5.5 [Anthropic API - Hazır]");
      const customAn = Array.isArray(customModels.anthropic) ? customModels.anthropic : [];
      for (const cm of customAn) {
        if (cm && String(cm).trim()) {
          const cleanId = String(cm).trim();
          addCloudModel("anthropic", cleanId, `${cleanId} [Anthropic API - Hazır]`);
        }
      }
    }

    if (keys.gemini && String(keys.gemini).trim()) {
      addCloudModel("gemini", "gemini-2.5-flash", "Google Gemini 2.5 Flash [Gemini API - Hazır]");
      addCloudModel("gemini", "gemini-2.5-pro", "Google Gemini 2.5 Pro [Gemini API - Hazır]");
      const customGe = Array.isArray(customModels.gemini) ? customModels.gemini : [];
      for (const cm of customGe) {
        if (cm && String(cm).trim()) {
          const cleanId = String(cm).trim();
          addCloudModel("gemini", cleanId, `${cleanId} [Gemini API - Hazır]`);
        }
      }
    }

    return cloudList;
  } catch (_) {
    return [];
  }
}

function getLlmModels() {
  const cloudModels = getCloudLlmModels();
  let localModels = [];
  try {
    localModels = fs.readdirSync(LLM_MODELS)
      .filter((filename) => filename.toLowerCase().endsWith(".gguf"))
      .map((filename) => {
        const stats = fs.statSync(path.join(LLM_MODELS, filename));
        const lower = filename.toLowerCase();
        return {
          filename,
          name: filename,
          displayName: `${filename} [Yerel GGUF]`,
          sizeBytes: stats.size,
          size: formatBytes(stats.size),
          format: "GGUF",
          isProjector: lower.includes("mmproj"),
          isCloud: false,
          installed: true,
        };
      });
  } catch (_) {
    localModels = [];
  }
  return [...cloudModels, ...localModels];
}

function findExistingFile(candidates) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || "";
}

function getSpeechBackendCandidates() {
  if (osPlatform === "win32") {
    return [
      {
        // Official whisper.cpp cuBLAS build (whisper-cublas-12.4.0-bin-x64.zip); NVIDIA GPUs only.
        key: "cuda",
        label: "CUDA GPU (NVIDIA)",
        mode: "whisper.cpp CUDA GPU",
        cli: findExistingFile([SPEECH_BACKEND_PATHS.winCudaCli]),
        server: findExistingFile([SPEECH_BACKEND_PATHS.winCudaServer]),
        pathHint: path.join(SPEECH_BACKEND_ROOT, "win", "cuda"),
      },
      {
        key: "vulkan",
        label: "Vulkan GPU",
        mode: "whisper.cpp Vulkan GPU",
        cli: findExistingFile([SPEECH_BACKEND_PATHS.winVulkanCli, path.join(SPEECH_BACKEND_ROOT, "win", "vulkan", "main.exe")]),
        server: findExistingFile([SPEECH_BACKEND_PATHS.winVulkanServer, path.join(SPEECH_BACKEND_ROOT, "win", "vulkan", "server.exe")]),
        pathHint: path.join(SPEECH_BACKEND_ROOT, "win", "vulkan"),
      },
      {
        key: "cpu",
        label: "CPU",
        mode: "whisper.cpp CPU",
        cli: findExistingFile([SPEECH_BACKEND_PATHS.winCpuCli, SPEECH_BACKEND_PATHS.winCli, path.join(SPEECH_BACKEND_ROOT, "win", "cpu", "main.exe"), path.join(SPEECH_BACKEND_ROOT, "win", "main.exe")]),
        server: findExistingFile([SPEECH_BACKEND_PATHS.winCpuServer, SPEECH_BACKEND_PATHS.winServer, path.join(SPEECH_BACKEND_ROOT, "win", "cpu", "server.exe"), path.join(SPEECH_BACKEND_ROOT, "win", "server.exe")]),
        pathHint: path.join(SPEECH_BACKEND_ROOT, "win", "cpu"),
      },
    ];
  }
  if (osPlatform === "darwin") {
    return [
      {
        key: "metal",
        label: "Metal GPU",
        mode: "whisper.cpp Metal GPU",
        cli: findExistingFile([SPEECH_BACKEND_PATHS.macMetalCli, path.join(SPEECH_BACKEND_ROOT, "mac", "metal", "main")]),
        server: findExistingFile([SPEECH_BACKEND_PATHS.macMetalServer, path.join(SPEECH_BACKEND_ROOT, "mac", "metal", "server")]),
        pathHint: path.join(SPEECH_BACKEND_ROOT, "mac", "metal"),
      },
      {
        key: "cpu",
        label: "CPU",
        mode: "whisper.cpp CPU",
        cli: findExistingFile([SPEECH_BACKEND_PATHS.macCpuCli, SPEECH_BACKEND_PATHS.macCli, path.join(SPEECH_BACKEND_ROOT, "mac", "cpu", "main"), path.join(SPEECH_BACKEND_ROOT, "mac", "main")]),
        server: findExistingFile([SPEECH_BACKEND_PATHS.macCpuServer, SPEECH_BACKEND_PATHS.macServer, path.join(SPEECH_BACKEND_ROOT, "mac", "cpu", "server"), path.join(SPEECH_BACKEND_ROOT, "mac", "server")]),
        pathHint: path.join(SPEECH_BACKEND_ROOT, "mac", "cpu"),
      },
    ];
  }
  return [
    {
      key: "vulkan",
      label: "Vulkan GPU",
      mode: "whisper.cpp Vulkan GPU",
      cli: findExistingFile([SPEECH_BACKEND_PATHS.linuxVulkanCli, path.join(SPEECH_BACKEND_ROOT, "linux", "vulkan", "main")]),
      server: findExistingFile([SPEECH_BACKEND_PATHS.linuxVulkanServer, path.join(SPEECH_BACKEND_ROOT, "linux", "vulkan", "server")]),
      pathHint: path.join(SPEECH_BACKEND_ROOT, "linux", "vulkan"),
    },
    {
      key: "cpu",
      label: "CPU",
      mode: "whisper.cpp CPU",
      cli: findExistingFile([SPEECH_BACKEND_PATHS.linuxCpuCli, SPEECH_BACKEND_PATHS.linuxCli, path.join(SPEECH_BACKEND_ROOT, "linux", "cpu", "main"), path.join(SPEECH_BACKEND_ROOT, "linux", "main")]),
      server: findExistingFile([SPEECH_BACKEND_PATHS.linuxCpuServer, SPEECH_BACKEND_PATHS.linuxServer, path.join(SPEECH_BACKEND_ROOT, "linux", "cpu", "server"), path.join(SPEECH_BACKEND_ROOT, "linux", "server")]),
      pathHint: path.join(SPEECH_BACKEND_ROOT, "linux", "cpu"),
    },
  ];
}

function normalizeSpeechBackendPreference(value) {
  const raw = String(value || "auto").trim().toLowerCase();
  if (["auto", "cpu", "cuda", "vulkan", "metal"].includes(raw)) return raw;
  return "auto";
}

function getSpeechBackend(preference = speechSettings.backendPreference) {
  const candidates = getSpeechBackendCandidates().map((candidate) => ({
    ...candidate,
    installed: Boolean(candidate.cli),
  }));
  const preferred = normalizeSpeechBackendPreference(preference);
  // "auto" only picks the CUDA build when an NVIDIA GPU is actually present.
  const usable = (candidate) => candidate.installed && (candidate.key !== "cuda" || hasNvidiaGpu());
  const selected = preferred === "auto"
    ? candidates.find(usable) || candidates[candidates.length - 1]
    : candidates.find((candidate) => candidate.key === preferred) || candidates.find((candidate) => candidate.installed) || candidates[candidates.length - 1];
  return {
    ...(selected || { key: "cpu", label: "CPU", mode: "whisper.cpp CPU", cli: "", server: "" }),
    preference: preferred,
    candidates,
  };
}

function getSpeechModels() {
  const catalog = SPEECH_MODEL_CATALOG.map((model) => {
    let installed = false;
    let sizeBytes = 0;
    const pyEngine = PYTHON_SPEECH_ENGINES[model.engine];
    if (pyEngine) {
      const engineDir = path.join(SPEECH_MODELS, pyEngine.folder);
      installed = fs.existsSync(path.join(engineDir, ...pyEngine.marker));
      sizeBytes = installed ? getPathSize(engineDir) : 0;
    } else {
      const modelPath = path.join(SPEECH_MODELS, model.filename);
      installed = fs.existsSync(modelPath);
      sizeBytes = installed ? getPathSize(modelPath) : 0;
    }
    return {
      ...model,
      installed,
      sizeBytes,
      localSize: installed ? formatBytes(sizeBytes) : "",
      url: model.url || `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${model.filename}`,
    };
  });

  const known = new Set(catalog.map((model) => model.filename.toLowerCase()));
  let custom = [];
  try {
    custom = fs.readdirSync(SPEECH_MODELS)
      .filter((filename) => filename.toLowerCase().endsWith(".bin") && !known.has(filename.toLowerCase()))
      .map((filename) => {
        const sizeBytes = getPathSize(path.join(SPEECH_MODELS, filename));
        return {
          id: filename,
          name: filename,
          filename,
          size: formatBytes(sizeBytes),
          localSize: formatBytes(sizeBytes),
          sizeBytes,
          language: "Custom",
          installed: true,
          recommended: false,
          custom: true,
        };
      });
  } catch (_) {}
  return [...catalog, ...custom];
}

function resolveSpeechModel(value) {
  const raw = String(value || "").trim();
  const model = getSpeechModels().find((item) => item.id === raw || item.filename === raw) ||
    getSpeechModels().find((item) => item.installed);
  if (!model) throw new Error("Download or import a Whisper, Duyu or Seda model first.");
  const pyEngine = PYTHON_SPEECH_ENGINES[model.engine];
  const modelPath = pyEngine
    ? path.join(SPEECH_MODELS, pyEngine.folder)
    : path.join(SPEECH_MODELS, path.basename(model.filename));
  if (!pathInside(modelPath, SPEECH_MODELS) || !fs.existsSync(modelPath)) {
    throw new Error(`Speech model is not installed: ${model.filename}`);
  }
  return { ...model, path: modelPath };
}

function getTtsManifestPath(filename) {
  const manifestPath = path.join(TTS_MODELS, path.basename(String(filename || "")));
  return pathInside(manifestPath, TTS_MODELS) ? manifestPath : "";
}

function readTtsManifest(filename) {
  const manifestPath = getTtsManifestPath(filename);
  if (!manifestPath || !fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (_) {
    return null;
  }
}

// Locates the OmniVoice weights in the Hugging Face cache regardless of snapshot revision.
function findOmniVoiceWeights() {
  const localWeights = path.join(TTS_MODELS, "omnivoice", "model.safetensors");
  if (fs.existsSync(path.join(TTS_MODELS, "omnivoice", ".download-complete")) && fs.existsSync(localWeights)) {
    return { path: localWeights, size: fs.statSync(localWeights).size, installed: true };
  }
  const snapRoot = path.join(os.homedir(), ".cache", "huggingface", "hub", "models--k2-fsa--OmniVoice", "snapshots");
  let best = { path: "", size: 0 };
  try {
    for (const snap of fs.readdirSync(snapRoot)) {
      const candidate = path.join(snapRoot, snap, "model.safetensors");
      if (fs.existsSync(candidate)) {
        const size = fs.statSync(candidate).size;
        if (size > best.size) best = { path: candidate, size };
      }
    }
  } catch (_) {}
  return { ...best, installed: best.size >= 2_000_000_000 };
}

function installTtsCatalogModel(modelIdOrFilename) {
  const raw = String(modelIdOrFilename || "").trim();
  const catalogModel = TTS_MODEL_CATALOG.find((model) => model.id === raw || model.filename === raw);
  if (!catalogModel) throw new Error(`Bilinmeyen TTS modeli: ${raw || "(boş)"}`);
  if (catalogModel.supported === false) {
    throw new Error(`${catalogModel.name} bu sürümde entegre değil.`);
  }
  const manifestPath = getTtsManifestPath(catalogModel.filename);
  const manifest = {
    ...catalogModel,
    installed: true,
    createdAt: new Date().toISOString(),
    notes: catalogModel.notes || "Model files and configurations are initialized for speech synthesis.",
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

function getTtsModels() {
  const catalog = TTS_MODEL_CATALOG.map((model) => {
    const manifest = readTtsManifest(model.filename);
    const installed = Boolean(manifest) && model.supported !== false;
    const manifestPath = getTtsManifestPath(model.filename);
    const sizeBytes = installed ? getPathSize(manifestPath) : 0;
    return {
      ...(manifest || {}),
      ...model,
      installed,
      sizeBytes,
      localSize: installed ? formatBytes(sizeBytes) : "",
      url: `kokoro://install/${model.id}`,
    };
  });

  const known = new Set(catalog.map((model) => model.filename.toLowerCase()));
  let custom = [];
  try {
    custom = fs.readdirSync(TTS_MODELS)
      .filter((filename) => filename.toLowerCase().endsWith(".json") && !known.has(filename.toLowerCase()))
      .map((filename) => {
        const manifest = readTtsManifest(filename) || {};
        const isInstalled = true;
        return {
          id: manifest.id || filename,
          name: manifest.name || filename,
          filename,
          modelId: manifest.modelId || "onnx-community/Kokoro-82M-v1.0-ONNX",
          dtype: manifest.dtype || "q8",
          format: manifest.format || "Kokoro ONNX",
          size: formatBytes(sizeBytes),
          localSize: formatBytes(sizeBytes),
          sizeBytes,
          installed: isInstalled,
          recommended: false,
          custom: true,
        };
      });
  } catch (_) {}
  return [...catalog, ...custom];
}

function resolveTtsModel(value) {
  const raw = String(value || "").trim();
  let model = getTtsModels().find((item) => (item.id === raw || item.filename === raw) && item.supported !== false) ||
    getTtsModels().find((item) => item.installed);
  if (!model) {
    try {
      installDefaultTtsManifest();
      model = getTtsModels().find((item) => item.installed);
    } catch (_) {}
  }
  if (!model) throw new Error("Download or import a Kokoro TTS model from Model Yoneticisi first.");
  const manifestPath = getTtsManifestPath(model.filename);
  if (!manifestPath || !fs.existsSync(manifestPath)) {
    throw new Error(`TTS model is not installed: ${model.filename}`);
  }
  return { ...model, path: manifestPath };
}

function getTtsRuntimeStatus() {
  const nodeModules = path.join(TTS_RUNTIME, "node_modules");
  const installed = fs.existsSync(path.join(nodeModules, "kokoro-js"));
  return {
    installed: installed && fs.existsSync(TTS_WORKER),
    worker: TTS_WORKER,
    runtime: TTS_RUNTIME,
    cache: TTS_CACHE,
    backendMode: "Kokoro ONNX",
  };
}

function runExclusiveTtsOperation(operation, timeoutMs = 300000) {
  const run = ttsOperationQueue.catch(() => {}).then(() => {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Ses sentezleme işlemi zaman aşımına uğradı (300 saniye).")), timeoutMs);
    });
    return Promise.race([
      Promise.resolve().then(operation),
      timeoutPromise
    ]).finally(() => {
      clearTimeout(timer);
    });
  });
  ttsOperationQueue = run.catch(() => {});
  return run;
}

async function startTts(settings = {}) {
  const runtime = getTtsRuntimeStatus();
  if (!runtime.installed) {
    throw new Error("Kokoro TTS runtime is not installed. Run scripts/setup/setup-tts for this platform.");
  }
  const model = resolveTtsModel(settings.model || ttsSettings.model);
  PORT_TTS = PREFERRED_TTS_PORT;
  ttsError = null;
  ttsReady = true;
  ttsSettings = {
    ...ttsSettings,
    model: model.filename,
    voice: settings.voice || ttsSettings.voice || "af_heart",
    speed: Math.max(0.5, Math.min(2, Number(settings.speed) || ttsSettings.speed || 1)),
    dtype: model.dtype || settings.dtype || ttsSettings.dtype || "q8",
    backendMode: runtime.backendMode,
  };
}

async function stopTts() {
  ttsReady = false;
  ttsError = null;
  ttsGenerationState = { active: false, phase: "", progress: 0, model: "", voice: "", output: "" };
}

function convertFloatWavToPcm16(buffer) {
  if (!isWaveBuffer(buffer)) return buffer;

  let offset = 12;
  let fmt = null;
  let data = null;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > buffer.length) break;

    if (id === "fmt ") {
      fmt = {
        audioFormat: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        bitsPerSample: buffer.readUInt16LE(start + 14),
      };
    } else if (id === "data") {
      data = { start, size };
    }

    offset = end + (size % 2);
  }

  if (!fmt || !data || fmt.audioFormat !== 3 || fmt.bitsPerSample !== 32 || fmt.channels < 1) {
    return buffer;
  }

  const samples = Math.floor(data.size / 4);
  const pcmDataSize = samples * 2;
  const output = Buffer.alloc(44 + pcmDataSize);
  output.write("RIFF", 0, "ascii");
  output.writeUInt32LE(36 + pcmDataSize, 4);
  output.write("WAVE", 8, "ascii");
  output.write("fmt ", 12, "ascii");
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(fmt.channels, 22);
  output.writeUInt32LE(fmt.sampleRate, 24);
  output.writeUInt32LE(fmt.sampleRate * fmt.channels * 2, 28);
  output.writeUInt16LE(fmt.channels * 2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36, "ascii");
  output.writeUInt32LE(pcmDataSize, 40);

  for (let i = 0; i < samples; i += 1) {
    const floatValue = buffer.readFloatLE(data.start + i * 4);
    const clamped = Math.max(-1, Math.min(1, Number.isFinite(floatValue) ? floatValue : 0));
    const intValue = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
    output.writeInt16LE(intValue, 44 + i * 2);
  }

  return output;
}

function ensureBrowserCompatibleTtsWav(filePath) {
  try {
    const original = fs.readFileSync(filePath);
    const converted = convertFloatWavToPcm16(original);
    if (converted !== original) {
      fs.writeFileSync(filePath, converted);
    }
  } catch (_) {}
}

function saveTtsOutput(result) {
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[:.]/g, "-");
  const base = `tts-${stamp}-${safeOutputName(result.voice || "voice")}`;
  const wavFilename = `${base}.wav`;
  const jsonFilename = `${base}.json`;
  const wavPath = path.join(TTS_OUTPUTS, wavFilename);
  const wavBuffer = convertFloatWavToPcm16(fs.readFileSync(result.wavPath));
  fs.writeFileSync(wavPath, wavBuffer);
  const metadata = {
    text: result.text || "",
    model: result.model,
    modelName: result.modelName,
    voice: result.voice,
    voiceName: result.voiceName,
    speed: result.speed,
    durationMs: result.durationMs,
    sampleRate: result.sampleRate || 24000,
    createdAt,
    audioFile: wavFilename,
    metadata: jsonFilename,
    displayName: result.displayName || `${result.voiceName || result.voice} - ${createdAt}`,
  };
  fs.writeFileSync(path.join(TTS_OUTPUTS, jsonFilename), JSON.stringify(metadata, null, 2), "utf8");
  return {
    ...metadata,
    filename: jsonFilename,
    url: `/tts-outputs/${encodeURIComponent(wavFilename)}`,
  };
}

function listTtsOutputs() {
  try {
    return fs.readdirSync(TTS_OUTPUTS)
      .filter((file) => file.toLowerCase().endsWith(".json"))
      .map((file) => {
        const filePath = path.join(TTS_OUTPUTS, file);
        try {
          const metadata = JSON.parse(fs.readFileSync(filePath, "utf8"));
          const stat = fs.statSync(filePath);
          if (metadata.audioFile) {
            const audioPath = path.join(TTS_OUTPUTS, path.basename(String(metadata.audioFile)));
            if (pathInside(audioPath, TTS_OUTPUTS) && fs.existsSync(audioPath)) {
              ensureBrowserCompatibleTtsWav(audioPath);
            }
          }
          return {
            ...metadata,
            filename: file,
            displayName: metadata.displayName || metadata.text?.slice(0, 48) || metadata.audioFile || file,
            sizeBytes: stat.size,
            size: formatBytes(stat.size),
            modifiedAt: stat.mtime.toISOString(),
            createdAt: metadata.createdAt || stat.mtime.toISOString(),
            url: metadata.audioFile ? `/tts-outputs/${encodeURIComponent(metadata.audioFile)}` : "",
          };
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  } catch (_) {
    return [];
  }
}

function synthesizeTts(text, options = {}) {
  return new Promise((resolve, reject) => {
    const cleanedText = String(text || "").trim();
    if (!cleanedText) {
      reject(new Error("Enter text to synthesize."));
      return;
    }
    if (cleanedText.length > 5000) {
      reject(new Error("TTS text is too long. Limit is 5000 characters for V1."));
      return;
    }

    // An explicit engine always wins; the previously loaded model only decides when no engine is given.
    const modelCandidate = options.engine ? "" : (options.model || ttsSettings.model);
    const isEma =options.engine === "ema-lightning" || options.engine === "ema" ||
      modelCandidate === "ema-lightning" || modelCandidate === "ema-lightning.json" ||
      (options.model && String(options.model).toLowerCase().includes("ema"));

    if (isEma) {
      const requestedEmaVoice = String(options.voice || ttsSettings.voice || "");
      // EMA Lightning has a single (female) voice; the "male" option is produced by Antalia-2 Mini,
      // which may live in a different Python environment, so hand it over to the Antalia branch.
      if (requestedEmaVoice === "ema_erkek") {
        synthesizeTts(cleanedText, { ...options, engine: "antalia", model: undefined, voice: "antalia_erkek" }).then(resolve, reject);
        return;
      }
      const speed = Math.max(0.5, Math.min(2, Number(options.speed) || ttsSettings.speed || 1));
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const tempWav = path.join(TTS_OUTPUTS, `.tts-${stamp}.wav`);
      const voice = /^ema_/.test(requestedEmaVoice) ? requestedEmaVoice : "ema_kadin";
      const voiceLabel = voice === "ema_erkek" ? "Erkek ses (Antalia-2 Mini ile)" : voice === "ema_genc" ? "EMA sesi (1.06x hız)" : voice === "ema_sakin" ? "EMA sesi (0.92x hız)" : voice === "ema_haber" ? "EMA sesi (1.08x hız)" : "EMA sesi (standart hız)";
      const payload = {
        text: cleanedText,
        speed,
        voice,
        output: tempWav,
      };

      ttsGenerationState = {
        active: true,
        phase: `EMA Lightning (${voiceLabel}) Türkçe konuşma üretiliyor...`,
        progress: -1,
        model: "ema-lightning.json",
        voice,
        output: "",
      };

      const startedAt = Date.now();
      const pythonBin = ttsPythonOrReset("tts-ema", "EMA Lightning");
      const proc = trackJobProcess(spawn(pythonBin, [TTS_EMA_WORKER], {
        cwd: ROOT,
        stdio: "pipe",
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
        },
      }));

      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (data) => { stdout += data.toString(); });
      proc.stderr.on("data", (data) => {
        stderr += data.toString();
        process.stderr.write("  [ema-tts] " + data.toString());
      });
      proc.on("error", (err) => {
        ttsGenerationState = { active: false, phase: "Failed", progress: 0, model: "ema-lightning.json", voice, output: "" };
        reject(err);
      });
      proc.on("exit", (code) => {
        ttsGenerationState = { active: false, phase: code === 0 ? "Complete" : "Failed", progress: code === 0 ? 100 : 0, model: "ema-lightning.json", voice, output: "" };
        if (code !== 0) {
          try { fs.unlinkSync(tempWav); } catch (_) {}
          const message = (stderr || stdout || `EMA Lightning çıkış kodu ${code}`).trim().slice(-1400);
          ttsError = message;
          reject(new Error(message));
          return;
        }
        try {
          const workerResult = parseWorkerJson(stdout);
          if (!workerResult.ok || !fs.existsSync(tempWav)) {
            throw new Error(workerResult.error || "EMA Lightning WAV dosyası üretemedi.");
          }
          const saved = saveTtsOutput({
            text: cleanedText,
            model: "ema-lightning.json",
            modelName: voice === "ema_erkek" ? "Antalia-2 Mini (EMA erkek seçeneği)" : "EMA Lightning Türkçe (8.6M, 48 kHz)",
            voice,
            voiceName: voiceLabel,
            speed,
            durationMs: Date.now() - startedAt,
            sampleRate: workerResult.sampleRate || 48000,
            wavPath: tempWav,
            displayName: `EMA Lightning (${voiceLabel}) - ${cleanedText.slice(0, 40)}`,
          });
          try { fs.unlinkSync(tempWav); } catch (_) {}
          ttsError = null;
          resolve(saved);
        } catch (err) {
          try { fs.unlinkSync(tempWav); } catch (_) {}
          ttsError = err.message || String(err);
          reject(err);
        }
      });
      proc.stdin.end(Buffer.from(JSON.stringify(payload), "utf-8"));
      return;
    }

    const isAhenk = options.engine === "ahenk" || options.engine === "ahenk-cep" ||
      modelCandidate === "ahenk-cep" || modelCandidate === "ahenk-cep.json" ||
      (options.model && String(options.model).toLowerCase().includes("ahenk"));

    if (isAhenk) {
      const speed = Math.max(0.5, Math.min(2, Number(options.speed) || ttsSettings.speed || 1));
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const tempWav = path.join(TTS_OUTPUTS, `.tts-ahenk-${stamp}.wav`);
      const rawStyle = options.style || options.voice || "neutral";
      const styleAliases = {
        "neutral": "neutral", "dogal": "neutral", "notr": "neutral",
        "cheerful": "cheerful", "neseli": "cheerful", "canli": "cheerful",
        "calm": "calm", "sakin": "calm", "dingin": "calm",
        "empathetic": "empathetic", "empatik": "empathetic", "sefkatli": "empathetic",
        "sad": "sad", "huzunlu": "sad", "duygusal": "sad",
        "surprised": "surprised", "saskin": "surprised", "heyecanli": "surprised",
        "angry": "angry", "ofkeli": "angry", "sert": "angry",
      };
      const cleanKey = String(rawStyle).toLowerCase().replace(/^ahenk_/, "");
      const style = styleAliases[cleanKey] || "neutral";
      const ahenkVoiceLabels = {
        neutral: "Doğal / Nötr Ton (48kHz)",
        cheerful: "Neşeli ve Canlı Ton (48kHz)",
        calm: "Sakin ve Dingin Ton (48kHz)",
        empathetic: "Empatik ve Şefkatli Ton (48kHz)",
        sad: "Hüzünlü ve Duygusal Ton (48kHz)",
        surprised: "Şaşkın ve Heyecanlı Ton (48kHz)",
        angry: "Öfkeli ve Sert Ton (48kHz)",
      };
      const voiceLabel = ahenkVoiceLabels[style] || `Ahenk ${style}`;
      const payload = {
        text: cleanedText,
        speed,
        style,
        voice: `ahenk_${style}`,
        output: tempWav,
        steps: Number(options.steps) || 16,
        cfg: Number(options.cfg) || 2.0,
      };

      ttsGenerationState = {
        active: true,
        phase: `Ahenk Cep (${voiceLabel}) Türkçe ses üretiliyor...`,
        progress: -1,
        model: "ahenk-cep.json",
        voice: `ahenk_${style}`,
        output: "",
      };

      const startedAt = Date.now();
      const pythonBin = ttsPythonOrReset("tts-ahenk", "Ahenk Cep");
      const proc = trackJobProcess(spawn(pythonBin, [TTS_AHENK_WORKER], {
        cwd: ROOT,
        stdio: "pipe",
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
        },
      }));

      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (data) => { stdout += data.toString(); });
      proc.stderr.on("data", (data) => {
        stderr += data.toString();
        process.stderr.write("  [ahenk-tts] " + data.toString());
      });
      proc.on("error", (err) => {
        ttsGenerationState = { active: false, phase: "Failed", progress: 0, model: "ahenk-cep.json", voice: `ahenk_${style}`, output: "" };
        reject(err);
      });
      proc.on("exit", (code) => {
        ttsGenerationState = { active: false, phase: code === 0 ? "Complete" : "Failed", progress: code === 0 ? 100 : 0, model: "ahenk-cep.json", voice: `ahenk_${style}`, output: "" };
        if (code !== 0) {
          try { fs.unlinkSync(tempWav); } catch (_) {}
          const message = (stderr || stdout || `Ahenk Cep çıkış kodu ${code}`).trim().slice(-1400);
          ttsError = message;
          reject(new Error(message));
          return;
        }
        try {
          const workerResult = parseWorkerJson(stdout);
          if (!workerResult.ok || !fs.existsSync(tempWav)) {
            throw new Error(workerResult.error || "Ahenk Cep WAV dosyası üretemedi.");
          }
          const saved = saveTtsOutput({
            text: cleanedText,
            model: "ahenk-cep.json",
            modelName: "Ahenk Cep Türkçe (8.6M, 48 kHz, 7 üslup)",
            voice: `ahenk_${style}`,
            voiceName: voiceLabel,
            speed,
            durationMs: Date.now() - startedAt,
            sampleRate: workerResult.sampleRate || 48000,
            wavPath: tempWav,
            displayName: `Ahenk Cep (${voiceLabel}) - ${cleanedText.slice(0, 40)}`,
          });
          try { fs.unlinkSync(tempWav); } catch (_) {}
          ttsError = null;
          resolve(saved);
        } catch (err) {
          try { fs.unlinkSync(tempWav); } catch (_) {}
          ttsError = err.message || String(err);
          reject(err);
        }
      });
      proc.stdin.end(Buffer.from(JSON.stringify(payload), "utf-8"));
      return;
    }

    const isSupertonic = options.engine === "supertonic" ||
      modelCandidate === "supertonic" || modelCandidate === "supertonic-3" ||
      (options.model && String(options.model).toLowerCase().includes("supertonic"));

    if (isSupertonic) {
      const speed = Math.max(0.5, Math.min(2, Number(options.speed) || ttsSettings.speed || 1.05));
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const tempWav = path.join(TTS_OUTPUTS, `.tts-supertonic-${stamp}.wav`);
      const voiceLabels = {
        "M1": "M1 (Tok Erkek)", "M2": "M2 (Doğal Erkek)", "M3": "M3 (Akıcı Erkek)", "M4": "M4 (Genç Erkek)", "M5": "M5 (Anlatıcı Erkek)",
        "F1": "F1 (Doğal Kadın)", "F2": "F2 (Berrak Kadın)", "F3": "F3 (Canlı Kadın)", "F4": "F4 (Akıcı Kadın)", "F5": "F5 (Sıcak Kadın)"
      };
      const requestedSupertonicVoice = String(options.voice || ttsSettings.voice || "").toUpperCase();
      const voice = voiceLabels[requestedSupertonicVoice] ? requestedSupertonicVoice : "M1";
      const voiceLabel = voiceLabels[voice];
      const payload = {
        text: cleanedText,
        speed,
        voice,
        output: tempWav,
        lang: "tr"
      };

      ttsGenerationState = {
        active: true,
        phase: `Supertone Supertonic-3 (${voiceLabel}) Türkçe ses üretiliyor...`,
        progress: -1,
        model: "supertonic-3",
        voice,
        output: "",
      };

      const startedAt = Date.now();
      const pythonBin = ttsPythonOrReset("tts-supertonic", "Supertonic-3");
      const proc = trackJobProcess(spawn(pythonBin, [TTS_SUPERTONIC_WORKER], {
        cwd: ROOT,
        stdio: "pipe",
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
        },
      }));

      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (data) => { stdout += data.toString(); });
      proc.stderr.on("data", (data) => {
        stderr += data.toString();
        process.stderr.write("  [supertonic-tts] " + data.toString());
      });
      proc.on("error", (err) => {
        ttsGenerationState = { active: false, phase: "Failed", progress: 0, model: "supertonic-3", voice, output: "" };
        reject(err);
      });
      proc.on("exit", (code) => {
        ttsGenerationState = { active: false, phase: code === 0 ? "Complete" : "Failed", progress: code === 0 ? 100 : 0, model: "supertonic-3", voice, output: "" };
        if (code !== 0) {
          try { fs.unlinkSync(tempWav); } catch (_) {}
          const message = (stderr || stdout || `Supertonic-3 çıkış kodu ${code}`).trim().slice(-1400);
          ttsError = message;
          reject(new Error(message));
          return;
        }
        try {
          const workerResult = parseWorkerJson(stdout);
          if (!workerResult.ok || !fs.existsSync(tempWav)) {
            throw new Error(workerResult.error || "Supertonic-3 WAV dosyası üretemedi.");
          }
          const saved = saveTtsOutput({
            text: cleanedText,
            model: "supertonic-3",
            modelName: "Supertone Supertonic-3 (~99M ONNX, 44.1 kHz)",
            voice,
            voiceName: voiceLabel,
            speed,
            durationMs: Date.now() - startedAt,
            sampleRate: workerResult.sampleRate || 44100,
            wavPath: tempWav,
            displayName: `Supertonic-3 (${voiceLabel}) - ${cleanedText.slice(0, 40)}`,
          });
          try { fs.unlinkSync(tempWav); } catch (_) {}
          ttsError = null;
          resolve(saved);
        } catch (err) {
          try { fs.unlinkSync(tempWav); } catch (_) {}
          ttsError = err.message || String(err);
          reject(err);
        }
      });
      proc.stdin.end(Buffer.from(JSON.stringify(payload), "utf-8"));
      return;
    }

    const isAntalia = options.engine === "antalia" || options.engine === "antalia-mini" ||
      modelCandidate === "antalia-mini" || modelCandidate === "antalia-mini.json" ||
      (options.model && String(options.model).toLowerCase().includes("antalia"));

    if (isAntalia) {
      const speed = Math.max(0.5, Math.min(2, Number(options.speed) || ttsSettings.speed || 1.0));
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const tempWav = path.join(TTS_OUTPUTS, `.tts-antalia-${stamp}.wav`);
      // Antalia-2 Mini has a single voice; the profiles only change speaking speed.
      const antaliaVoiceLabels = {
        antalia_dogal: "Antalia erkek sesi (standart hız)",
        antalia_erkek: "Antalia erkek sesi (standart hız)",
        antalia_tok: "Antalia erkek sesi (yavaş, 0.94x)",
        antalia_akici: "Antalia erkek sesi (hızlı, 1.08x)",
        antalia_sicak: "Antalia erkek sesi (biraz yavaş, 0.96x)",
        antalia_genc: "Antalia erkek sesi (biraz hızlı, 1.05x)",
      };
      const requestedAntaliaVoice = options.voice || ttsSettings.voice;
      const voice = antaliaVoiceLabels[requestedAntaliaVoice] ? requestedAntaliaVoice : "antalia_erkek";
      const voiceLabel = antaliaVoiceLabels[voice];
      const payload = {
        text: cleanedText,
        speed,
        voice,
        output: tempWav,
        lang: "tr"
      };

      ttsGenerationState = {
        active: true,
        phase: `Antalia-2 Mini (${voiceLabel}) Türkçe ses üretiliyor...`,
        progress: -1,
        model: "antalia-mini.json",
        voice,
        output: "",
      };

      const startedAt = Date.now();
      const pythonBin = ttsPythonOrReset("tts-antalia", "Antalia-2 Mini");
      const proc = trackJobProcess(spawn(pythonBin, [TTS_ANTALIA_WORKER], {
        cwd: ROOT,
        stdio: "pipe",
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
        },
      }));

      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (data) => { stdout += data.toString(); });
      proc.stderr.on("data", (data) => {
        stderr += data.toString();
        process.stderr.write("  [antalia-tts] " + data.toString());
      });
      proc.on("error", (err) => {
        ttsGenerationState = { active: false, phase: "Failed", progress: 0, model: "antalia-mini.json", voice, output: "" };
        reject(err);
      });
      proc.on("exit", (code) => {
        ttsGenerationState = { active: false, phase: code === 0 ? "Complete" : "Failed", progress: code === 0 ? 100 : 0, model: "antalia-mini.json", voice, output: "" };
        if (code !== 0) {
          try { fs.unlinkSync(tempWav); } catch (_) {}
          const message = (stderr || stdout || `Antalia-2 Mini çıkış kodu ${code}`).trim().slice(-1400);
          ttsError = message;
          reject(new Error(message));
          return;
        }
        try {
          const workerResult = parseWorkerJson(stdout);
          if (!workerResult.ok || !fs.existsSync(tempWav)) {
            throw new Error(workerResult.error || "Antalia-2 Mini WAV dosyası üretemedi.");
          }
          const finalVoiceLabel = workerResult.voiceName || voiceLabel;
          const saved = saveTtsOutput({
            text: cleanedText,
            model: "antalia-mini.json",
            modelName: "Antalia-2 Mini Türkçe (7.62M, 48 kHz)",
            voice,
            voiceName: finalVoiceLabel,
            speed,
            durationMs: Date.now() - startedAt,
            sampleRate: workerResult.sampleRate || 48000,
            wavPath: tempWav,
            displayName: `Antalia-2 Mini (${finalVoiceLabel}) - ${cleanedText.slice(0, 40)}`,
          });
          try { fs.unlinkSync(tempWav); } catch (_) {}
          ttsError = null;
          resolve(saved);
        } catch (err) {
          try { fs.unlinkSync(tempWav); } catch (_) {}
          ttsError = err.message || String(err);
          reject(err);
        }
      });
      proc.stdin.end(Buffer.from(JSON.stringify(payload), "utf-8"));
      return;
    }

    const isOmniVoice = options.engine === "omnivoice" ||
      modelCandidate === "omnivoice" || modelCandidate === "omnivoice.json" ||
      (options.model && String(options.model).toLowerCase().includes("omnivoice"));

    if (isOmniVoice) {
      // The weights are fetched by the omnivoice package on first use (≈2.4 GB) into the HF cache.
      const omni = findOmniVoiceWeights();
      if (!omni.installed) {
        const msg = omni.size > 0
          ? `OmniVoice model dosyası eksik/yarım (${Math.round(omni.size / (1024 * 1024))} MB). Model Merkezi > TTS'ten OmniVoice'u indirin.`
          : "OmniVoice model ağırlıkları (≈2.4 GB) henüz indirilmemiş. Model Merkezi > TTS'ten OmniVoice'u indirin.";
        ttsError = msg;
        reject(new Error(msg));
        return;
      }

      const speed = Math.max(0.5, Math.min(2, Number(options.speed) || ttsSettings.speed || 1.0));
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const tempWav = path.join(TTS_OUTPUTS, `.tts-omnivoice-${stamp}.wav`);
      // Reference clips may only come from app/reference-voices (listed or uploaded there).
      const requestedRef = options.ref_audio || options.refAudio || null;
      const refAudio = requestedRef ? path.join(REFERENCE_VOICES, path.basename(String(requestedRef))) : null;
      if (refAudio && !fs.existsSync(refAudio)) {
        reject(new Error(`Referans ses bulunamadı: ${path.basename(String(requestedRef))} (app/reference-voices klasöründe olmalı).`));
        return;
      }
      const refText = options.ref_text || options.refText || null;
      const instruct = options.instruct || null;
      const modeLabel = refAudio ? "Zero-Shot Ses Klonlama" : (instruct ? "Ses Tasarımı" : "Otomatik Ses");
      const payload = {
        text: cleanedText,
        speed,
        output: tempWav,
        ref_audio: refAudio,
        ref_text: refText,
        instruct: instruct,
        lang: options.lang || "tr",
        num_step: Number(options.num_step) || 32
      };

      ttsGenerationState = {
        active: true,
        phase: `OmniVoice (${modeLabel}) Türkçe ses üretiliyor...`,
        progress: 10,
        model: "omnivoice.json",
        voice: refAudio ? "cloned_voice" : "omnivoice_auto",
        output: "",
      };
      audioGenerationProgress = {
        active: true,
        mode: "tts",
        phase: `OmniVoice (${modeLabel}) Türkçe ses üretiliyor...`,
        progress: 10,
        step: 0,
        totalSteps: 100,
        model: "omnivoice",
        startedAt: Date.now()
      };

      const startedAt = Date.now();
      const pythonBin = ttsPythonOrReset("tts-omnivoice", "OmniVoice");
      const proc = trackJobProcess(spawn(pythonBin, [TTS_OMNIVOICE_WORKER], {
        cwd: ROOT,
        stdio: "pipe",
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
        },
      }));

      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (data) => { stdout += data.toString(); });
      proc.stderr.on("data", (data) => {
        const text = data.toString();
        stderr += text;
        process.stderr.write("  [omnivoice-tts] " + text);
        const lines = text.split("\n");
        for (const line of lines) {
          if (line.includes("@@PROGRESS")) {
            try {
              const jsonStr = line.split("@@PROGRESS")[1].trim();
              const p = JSON.parse(jsonStr);
              if (p.phase) ttsGenerationState.phase = p.phase;
              if (typeof p.progress === "number") {
                ttsGenerationState.progress = p.progress;
                audioGenerationProgress.progress = p.progress;
              }
              audioGenerationProgress.phase = ttsGenerationState.phase;
            } catch (_) {}
          }
        }
      });
      proc.on("error", (err) => {
        audioGenerationProgress.active = false;
        audioGenerationProgress.progress = 0;
        ttsGenerationState = { active: false, phase: "Failed", progress: 0, model: "omnivoice.json", voice: "cloned_voice", output: "" };
        reject(err);
      });
      proc.on("exit", (code) => {
        audioGenerationProgress.active = false;
        audioGenerationProgress.progress = 0;
        ttsGenerationState = { active: false, phase: code === 0 ? "Complete" : "Failed", progress: code === 0 ? 100 : 0, model: "omnivoice.json", voice: "cloned_voice", output: "" };
        if (code !== 0) {
          try { fs.unlinkSync(tempWav); } catch (_) {}
          const message = (stderr || stdout || `OmniVoice çıkış kodu ${code}`).trim().slice(-1400);
          ttsError = message;
          reject(new Error(message));
          return;
        }
        try {
          const workerResult = parseWorkerJson(stdout);
          if (!workerResult.ok || !fs.existsSync(tempWav)) {
            throw new Error(workerResult.error || "OmniVoice WAV dosyası üretemedi.");
          }
          const saved = saveTtsOutput({
            text: cleanedText,
            model: "omnivoice.json",
            modelName: "OmniVoice Zero-Shot (600+ dil)",
            voice: refAudio ? "cloned_voice" : "omnivoice_auto",
            voiceName: modeLabel,
            speed,
            durationMs: Date.now() - startedAt,
            sampleRate: workerResult.sampleRate || 24000,
            wavPath: tempWav,
            displayName: `OmniVoice (${modeLabel}) - ${cleanedText.slice(0, 40)}`,
          });
          try { fs.unlinkSync(tempWav); } catch (_) {}
          ttsError = null;
          resolve(saved);
        } catch (err) {
          try { fs.unlinkSync(tempWav); } catch (_) {}
          ttsError = err.message || String(err);
          reject(err);
        }
      });
      proc.stdin.end(Buffer.from(JSON.stringify(payload), "utf-8"));
      return;
    }

    const runtime = getTtsRuntimeStatus();
    if (!runtime.installed) {
      reject(new Error("Kokoro TTS runtime is not installed."));
      return;
    }
    const model = resolveTtsModel(options.model || ttsSettings.model);
    const validVoices = [
      "af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore", "af_nicole", "af_nova",
      "af_river", "af_sarah", "af_sky", "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam",
      "am_michael", "am_onyx", "am_puck", "am_santa", "bf_emma", "bf_isabella", "bm_george",
      "bm_lewis", "bf_alice", "bf_lily", "bm_daniel", "bm_fable"
    ];
    let rawVoice = String(options.voice || ttsSettings.voice || "af_heart");
    const voice = validVoices.includes(rawVoice) ? rawVoice : "af_heart";
    const voiceInfo = TTS_VOICES.find((item) => item.id === voice) || { id: voice, name: voice };
    const speed = Math.max(0.5, Math.min(2, Number(options.speed) || ttsSettings.speed || 1));
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const tempWav = path.join(TTS_OUTPUTS, `.tts-${stamp}.wav`);
    const payload = {
      text: cleanedText,
      modelId: model.modelId || "onnx-community/Kokoro-82M-v1.0-ONNX",
      dtype: model.dtype || "q8",
      voice,
      speed,
      lang: options.lang || "",
      output: tempWav,
      cacheDir: TTS_CACHE,
    };

    ttsGenerationState = {
      active: true,
      phase: "Generating speech...",
      progress: -1,
      model: model.filename,
      voice,
      output: "",
    };

    const startedAt = Date.now();
    const proc = trackJobProcess(spawn(process.execPath, [TTS_WORKER], {
      cwd: ROOT,
      stdio: "pipe",
      windowsHide: true,
      env: {
        ...process.env,
        NODE_PATH: path.join(TTS_RUNTIME, "node_modules"),
        TTS_RUNTIME,
      },
    }));
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
      process.stderr.write("  [tts] " + data.toString());
    });
    proc.on("error", (err) => {
      ttsGenerationState = { active: false, phase: "Failed", progress: 0, model: model.filename, voice, output: "" };
      reject(err);
    });
    proc.on("exit", (code) => {
      ttsGenerationState = { active: false, phase: code === 0 ? "Complete" : "Failed", progress: code === 0 ? 100 : 0, model: model.filename, voice, output: "" };
      if (code !== 0) {
        try { fs.unlinkSync(tempWav); } catch (_) {}
        const message = (stderr || stdout || `Kokoro TTS ile cikti kodu ${code}`).trim().slice(-1400);
        ttsError = message;
        reject(new Error(message));
        return;
      }
      try {
        const workerResult = parseWorkerJson(stdout);
        if (!workerResult.ok || !fs.existsSync(tempWav)) {
          throw new Error(workerResult.error || "Kokoro TTS did not produce a WAV file.");
        }
        const saved = saveTtsOutput({
          text: cleanedText,
          model: model.filename,
          modelName: model.name,
          voice,
          voiceName: voiceInfo.name,
          speed,
          durationMs: Date.now() - startedAt,
          sampleRate: workerResult.sampleRate || 24000,
          wavPath: tempWav,
          displayName: `${voiceInfo.name || voice} - ${cleanedText.slice(0, 40)}`,
        });
        try { fs.unlinkSync(tempWav); } catch (_) {}
        ttsError = null;
        resolve(saved);
      } catch (err) {
        try { fs.unlinkSync(tempWav); } catch (_) {}
        ttsError = err.message || String(err);
        reject(err);
      }
    });
    proc.stdin.end(JSON.stringify(payload));
  });
}

function runExclusiveSpeechOperation(operation) {
  const run = speechOperationQueue.catch(() => {}).then(operation);
  speechOperationQueue = run.catch(() => {});
  return run;
}

async function startSpeech(settings = {}) {
  const model = resolveSpeechModel(settings.model);
  const backendPreference = normalizeSpeechBackendPreference(settings.backendPreference || speechSettings.backendPreference);
  const backend = getSpeechBackend(backendPreference);
  const pyEngine = PYTHON_SPEECH_ENGINES[model.engine];
  if (!pyEngine && !backend.cli) {
    throw new Error(`${backend.label || "Selected"} whisper.cpp backend is not installed. Run setup or copy a compatible binary to ${backend.pathHint || "app/speech-backend"}.`);
  }
  PORT_SPEECH = await findAvailableSpeechPort();
  speechError = null;
  speechReady = true;
  speechSettings = {
    ...speechSettings,
    model: model.filename,
    language: settings.language || speechSettings.language || "auto",
    threads: Math.max(1, Math.min(32, Number(settings.threads) || speechSettings.threads || 4)),
    backendPreference,
    backendBinary: pyEngine ? `python-${pyEngine.runtime}` : path.basename(backend.cli || "whisper-cli.exe"),
    backendMode: pyEngine ? pyEngine.runtime : backend.mode,
  };
}

async function stopSpeech() {
  speechReady = false;
  speechError = null;
  speechTranscriptionState = { active: false, phase: "", progress: 0, model: "", filename: "" };
}

function readBinaryBody(req, limitBytes = 250 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > limitBytes) {
        reject(new Error(`Audio file is too large. Limit is ${Math.round(limitBytes / (1024 * 1024))} MB.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function isWaveBuffer(buffer) {
  return buffer?.length > 44 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WAVE";
}

function saveTranscript(result) {
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[:.]/g, "-");
  const base = `transcript-${stamp}-${safeOutputName(result.sourceFilename || "audio")}`;
  const textFilename = `${base}.txt`;
  const jsonFilename = `${base}.json`;
  fs.writeFileSync(path.join(TRANSCRIPTIONS, textFilename), result.text || "", "utf8");
  const metadata = {
    ...result,
    createdAt,
    textFile: textFilename,
    metadata: jsonFilename,
  };
  fs.writeFileSync(path.join(TRANSCRIPTIONS, jsonFilename), JSON.stringify(metadata, null, 2), "utf8");
  return metadata;
}

function listTranscriptions() {
  try {
    return fs.readdirSync(TRANSCRIPTIONS)
      .filter((file) => file.toLowerCase().endsWith(".json"))
      .map((file) => {
        const filePath = path.join(TRANSCRIPTIONS, file);
        try {
          const metadata = JSON.parse(fs.readFileSync(filePath, "utf8"));
          const stat = fs.statSync(filePath);
          return {
            ...metadata,
            filename: file,
            displayName: metadata.sourceFilename || metadata.textFile || file,
            sizeBytes: stat.size,
            size: formatBytes(stat.size),
            modifiedAt: stat.mtime.toISOString(),
            createdAt: metadata.createdAt || stat.mtime.toISOString(),
            url: `/transcriptions/${encodeURIComponent(file)}`,
            textUrl: metadata.textFile ? `/transcriptions/${encodeURIComponent(metadata.textFile)}` : "",
          };
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  } catch (_) {
    return [];
  }
}

function transcribeWavBuffer(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    if (!isWaveBuffer(buffer)) {
      reject(new Error("Speech transcription currently accepts WAV audio only."));
      return;
    }
    const model = resolveSpeechModel(options.model || speechSettings.model);
    const language = String(options.language || speechSettings.language || "auto");
    const sourceFilename = safeOutputName(options.filename || "recording.wav") || "recording.wav";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const tempBase = path.join(TRANSCRIPTIONS, `.speech-${stamp}-${sourceFilename.replace(/\.[^.]+$/, "")}`);
    const wavPath = `${tempBase}.wav`;
    fs.writeFileSync(wavPath, buffer);

    speechTranscriptionState = {
      active: true,
      phase: "Transcribing audio...",
      progress: -1,
      model: model.filename,
      filename: sourceFilename,
    };

    const pyEngine = PYTHON_SPEECH_ENGINES[model.engine];
    if (pyEngine) {
      let pyBin;
      try {
        pyBin = requirePythonFor(pyEngine.feature, pyEngine.label);
      } catch (err) {
        try { fs.unlinkSync(wavPath); } catch (_) {}
        speechTranscriptionState = { active: false, phase: "Failed", progress: 0, model: model.filename, filename: sourceFilename };
        reject(err);
        return;
      }
      const startedAt = Date.now();
      const payload = JSON.stringify({
        wavPath,
        modelDir: model.path,
        language: language === "auto" ? "tr" : language,
        quant: "int8",
        threads: Math.max(1, Math.min(32, Number(options.threads) || speechSettings.threads || 4))
      });
      console.log(`  [speech] ${model.name} ile transkripsiyon baslatiliyor:`, wavPath);
      const proc = trackJobProcess(spawn(pyBin, [pyEngine.worker], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      }));
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d) => { stdout += d.toString(); });
      proc.stderr.on("data", (d) => { stderr += d.toString(); });
      proc.on("error", (err) => {
        try { fs.unlinkSync(wavPath); } catch (_) {}
        speechTranscriptionState = { active: false, phase: "Failed", progress: 0, model: model.filename, filename: sourceFilename };
        speechError = err.message;
        reject(err);
      });
      proc.on("exit", (code) => {
        try { fs.unlinkSync(wavPath); } catch (_) {}
        speechTranscriptionState = { active: false, phase: code === 0 ? "Complete" : "Failed", progress: code === 0 ? 100 : 0, model: model.filename, filename: sourceFilename };
        if (code !== 0) {
          const message = (stderr || stdout || `${model.name} worker error with exit code ${code}`).trim().slice(-1200);
          speechError = message;
          reject(new Error(message));
          return;
        }
        try {
          const parsed = parseWorkerJson(stdout);
          if (!parsed.ok) {
            reject(new Error(parsed.error || `${model.name} transcription failed`));
            return;
          }
          const saved = saveTranscript({
            text: parsed.text,
            model: model.filename,
            modelName: model.name,
            language: parsed.lang,
            backend: pyEngine.backend,
            backendMode: pyEngine.runtime,
            sourceFilename,
            durationMs: parsed.durationMs || (Date.now() - startedAt),
            raw: parsed.raw,
          });
          speechError = null;
          // Same shape as the whisper.cpp path so history/sidebar code works for both engines.
          resolve(saved);
        } catch (err) {
          reject(new Error(`Failed to parse ${model.name} output: ${err.message}`));
        }
      });
      proc.stdin.write(payload);
      proc.stdin.end();
      return;
    }

    const backendPreference = normalizeSpeechBackendPreference(options.backendPreference || speechSettings.backendPreference);
    const backend = getSpeechBackend(backendPreference);
    if (!backend.cli) {
      reject(new Error(`${backend.label || "Selected"} whisper.cpp CLI backend is not installed.`));
      return;
    }

    const outBase = `${tempBase}-out`;
    const args = [
      "-m", model.path,
      "-f", wavPath,
      "-otxt",
      "-oj",
      "-of", outBase,
      "-t", String(Math.max(1, Math.min(32, Number(options.threads) || speechSettings.threads || 4))),
    ];
    if (language && language !== "auto") {
      args.push("-l", language);
    } else {
      args.push("-l", "auto");
    }
    if (options.translate) {
      args.push("-tr");
    }

    const startedAt = Date.now();
    console.log("  [speech] Baslatiliyor:", backend.cli, args.join(" "));
    const proc = spawn(backend.cli, args, {
      stdio: "pipe",
      windowsHide: true,
      env: {
        ...process.env,
        ...(osPlatform === "win32" ? { PATH: path.dirname(backend.cli) + (process.env.PATH ? `;${process.env.PATH}` : "") } : {}),
        ...(osPlatform === "linux" ? { LD_LIBRARY_PATH: path.dirname(backend.cli) + (process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : "") } : {}),
        ...(osPlatform === "darwin" ? { DYLD_LIBRARY_PATH: path.dirname(backend.cli) + (process.env.DYLD_LIBRARY_PATH ? `:${process.env.DYLD_LIBRARY_PATH}` : "") } : {}),
      },
    });
    trackJobProcess(proc);
    proc.on("error", (err) => {
      try { fs.unlinkSync(wavPath); } catch (_) {}
      speechTranscriptionState = { active: false, phase: "Failed", progress: 0, model: model.filename, filename: sourceFilename };
      speechError = err.message;
      reject(err);
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data) => {
      stdout += data.toString();
      process.stdout.write("  [speech] " + data.toString());
    });
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
      process.stderr.write("  [speech-err] " + data.toString());
    });
    proc.on("exit", (code) => {
      try { fs.unlinkSync(wavPath); } catch (_) {}
      speechTranscriptionState = { active: false, phase: code === 0 ? "Complete" : "Failed", progress: code === 0 ? 100 : 0, model: model.filename, filename: sourceFilename };
      if (code !== 0) {
        const message = (stderr || stdout || `whisper.cpp ile cikti kodu ${code}`).trim().slice(-1200);
        speechError = message;
        reject(new Error(message));
        return;
      }
      const txtPath = `${outBase}.txt`;
      const jsonPath = `${outBase}.json`;
      const text = fs.existsSync(txtPath) ? fs.readFileSync(txtPath, "utf8").trim() : stdout.trim();
      let raw = null;
      try {
        raw = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, "utf8")) : null;
      } catch (_) {}
      try { fs.unlinkSync(txtPath); } catch (_) {}
      try { fs.unlinkSync(jsonPath); } catch (_) {}
      const saved = saveTranscript({
        text,
        model: model.filename,
        modelName: model.name,
        language,
        backend: backend.key,
        backendMode: backend.mode,
        sourceFilename,
        durationMs: Date.now() - startedAt,
        raw,
      });
      speechError = null;
      resolve(saved);
    });
  });
}

function pingLlmReady(expectedModel = "") {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT_LLM}/v1/models`, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 500) {
          resolve(false);
          return;
        }
        if (!expectedModel) {
          resolve(true);
          return;
        }
        try {
          const parsed = JSON.parse(body || "{}");
          const servedIds = Array.isArray(parsed.data)
            ? parsed.data.map((item) => String(item.id || item.model || ""))
            : [];
          const expectedBase = path.basename(expectedModel).toLowerCase();
          resolve(servedIds.some((id) => {
            const lower = id.toLowerCase();
            return lower === expectedBase || lower.includes(expectedBase);
          }));
        } catch (_) {
          resolve(false);
        }
      });
    });
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

async function waitForLlmReady(maxAttempts = 240, expectedProc = llmProc, expectedModel = "") {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (!expectedProc || llmProc !== expectedProc) throw new Error(llmError || "llama.cpp exited during startup.");
    if (await pingLlmReady(expectedModel)) {
      llmReady = true;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`llama.cpp did not become ready within ${Math.round(maxAttempts / 120)} minutes.`);
}

function waitForChildExit(proc, timeoutMs) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) {
      resolve(true);
      return;
    }
    let done = false;
    const finish = (exited) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      proc.off("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    proc.once("exit", onExit);
  });
}

async function killLlm() {
  llmReady = false;
  llmSettings.isCloud = false;
  llmSettings.provider = "";
  llmSettings.cloudModelId = "";
  llmSettings.displayName = "";
  llmSettings.supportsVision = false;
  llmSettings.visionMode = "none";
  llmSettings.visionStatus = "Projector not loaded";
  llmSettings.mmproj = null;
  if (!llmProc) {
    await waitForPortAvailable(PORT_LLM, 1500);
    return;
  }

  const proc = llmProc;
  const procPort = PORT_LLM;
  llmProc = null;

  try { proc.kill("SIGTERM"); } catch (_) {}
  const exitedAfterTerm = await waitForChildExit(proc, 2500);
  if (!exitedAfterTerm) {
    try { proc.kill("SIGKILL"); } catch (_) {}
    await waitForChildExit(proc, 2500);
  }

  const released = await waitForPortAvailable(procPort, 5000);
  if (!released) {
    console.warn(`  [llm] Port ${procPort} is still busy after stopping llama.cpp.`);
  }
}

function getSetupPaths() {
  const appDir = path.join(ROOT, "app");
  if (osPlatform === "win32") {
    return {
      node: path.join(appDir, "tools", "node-win", "node.exe"),
      npm: path.join(appDir, "tools", "node-win", "npm.cmd"),
      distIndex: path.join(DIST, "index.html"),
      cudaBackend: BACKEND_PATHS.cuda,
      vulkanBackend: BACKEND_PATHS.vulkan,
      cpuBackend: BACKEND_PATHS.cpu,
      models: MODELS,
      outputs: OUTPUTS,
      chatHistory: CHAT_HISTORY,
      transcriptions: TRANSCRIPTIONS,
      ttsOutputs: TTS_OUTPUTS,
    };
  } else if (osPlatform === "darwin") {
    return {
      node: path.join(appDir, "tools", "node-mac", "bin", "node"),
      npm: path.join(appDir, "tools", "node-mac", "bin", "npm"),
      distIndex: path.join(DIST, "index.html"),
      macBackend: BACKEND_PATHS.mac,
      models: MODELS,
      outputs: OUTPUTS,
      chatHistory: CHAT_HISTORY,
      transcriptions: TRANSCRIPTIONS,
      ttsOutputs: TTS_OUTPUTS,
    };
  } else {
    // Linux / WSL
    return {
      node: path.join(appDir, "tools", "node-linux", "bin", "node"),
      npm: path.join(appDir, "tools", "node-linux", "bin", "npm"),
      distIndex: path.join(DIST, "index.html"),
      linuxCpuBackend: BACKEND_PATHS.linuxCpu,
      linuxVulkanBackend: BACKEND_PATHS.linuxVulkan,
      linuxRocmBackend: BACKEND_PATHS.linuxRocm,
      models: MODELS,
      outputs: OUTPUTS,
      chatHistory: CHAT_HISTORY,
      transcriptions: TRANSCRIPTIONS,
      ttsOutputs: TTS_OUTPUTS,
    };
  }
}

async function getHealth() {
  const paths = getSetupPaths();
  const checks = [
    getPathInfo("Portable Node.js", paths.node),
    getPathInfo("Portable npm", paths.npm),
    getPathInfo("Frontend build", paths.distIndex),
    getDirInfo("Models folder", paths.models),
    getDirInfo("Outputs folder", paths.outputs),
    getDirInfo("Chat history folder", paths.chatHistory),
    getDirInfo("Transcriptions folder", paths.transcriptions),
    getDirInfo("TTS outputs folder", paths.ttsOutputs),
  ];

  if (osPlatform === "win32") {
    checks.push(getPathInfo("CUDA backend", paths.cudaBackend));
    checks.push(getPathInfo("Vulkan backend", paths.vulkanBackend));
    checks.push(getPathInfo("CPU backend", paths.cpuBackend));
  } else if (osPlatform === "darwin") {
    checks.push(getPathInfo("Mac backend", paths.macBackend));
  } else {
    checks.push(getPathInfo("Linux CPU backend", paths.linuxCpuBackend));
    checks.push(getPathInfo("Linux Vulkan backend", paths.linuxVulkanBackend));
    checks.push(getPathInfo("Linux ROCm backend", paths.linuxRocmBackend));
  }

  let backendInstalled = false;
  if (osPlatform === "win32") {
    backendInstalled = checks.find((check) => check.label === "CUDA backend")?.exists ||
      checks.find((check) => check.label === "Vulkan backend")?.exists ||
      checks.find((check) => check.label === "CPU backend")?.exists;
  } else if (osPlatform === "darwin") {
    backendInstalled = checks.find((check) => check.label === "Mac backend")?.exists;
  } else {
    backendInstalled =
      checks.find((check) => check.label === "Linux CPU backend")?.exists ||
      checks.find((check) => check.label === "Linux CPU backend")?.exists ||
      checks.find((check) => check.label === "Linux Vulkan backend")?.exists ||
      checks.find((check) => check.label === "Linux ROCm backend")?.exists;
  }

  const criticalOk = checks
    .filter((check) => !["CUDA backend", "Vulkan backend", "CPU backend", "Linux CPU backend", "Linux Vulkan backend", "Linux ROCm backend", "Mac backend"].includes(check.label))
    .every((check) => check.ok) && backendInstalled;

  const ports = {
    frontend: { ...(await checkPort(PORT_FRONTEND)), expectedInUse: true },
    backend: { ...(await checkPort(PORT_BACKEND)), expectedInUse: backendProc !== null || openvinoProc !== null },
  };
  ports.frontend.ok = !ports.frontend.available;
  ports.backend.preferred = PREFERRED_BACKEND_PORT;
  ports.backend.selected = PORT_BACKEND;
  ports.backend.ok = true;

  const issues = checks
    .filter((check) => !check.ok && !["CUDA backend", "Vulkan backend", "CPU backend", "Linux CPU backend", "Linux Vulkan backend", "Linux ROCm backend", "Mac backend"].includes(check.label))
    .map((check) => `${check.label} is missing or not writable.`);
  if (!backendInstalled) {
    issues.push(`No ${osPlatform === "win32" ? "Windows" : osPlatform === "darwin" ? "macOS" : "Linux"} backend binary is installed.`);
  }
  return {
    ok: criticalOk && ports.backend.ok,
    build: SERVER_BUILD,
    root: ROOT,
    platform: osPlatform,
    checks,
    ports,
    backend: {
      ready: backendReady || openvinoReady,
      running: backendProc !== null || openvinoProc !== null,
      error: backendError,
      settings: currentSettings,
      options: getBackendOptions(),
    },
    models: {
      count: fs.existsSync(MODELS) ? fs.readdirSync(MODELS).filter(isModelFile).length : 0,
      totalBytes: getPathSize(MODELS),
      totalSize: formatBytes(getPathSize(MODELS)),
    },
    outputs: {
      count: fs.existsSync(OUTPUTS) ? fs.readdirSync(OUTPUTS).filter((file) => file.toLowerCase().endsWith(".json")).length : 0,
      totalBytes: getPathSize(OUTPUTS),
      totalSize: formatBytes(getPathSize(OUTPUTS)),
    },
    chat: {
      count: fs.existsSync(CHAT_HISTORY) ? fs.readdirSync(CHAT_HISTORY).filter((file) => file.toLowerCase().endsWith(".json")).length : 0,
      totalBytes: getPathSize(CHAT_HISTORY),
      totalSize: formatBytes(getPathSize(CHAT_HISTORY)),
    },
    speech: {
      transcriptions: fs.existsSync(TRANSCRIPTIONS) ? fs.readdirSync(TRANSCRIPTIONS).filter((file) => file.toLowerCase().endsWith(".json")).length : 0,
      totalBytes: getPathSize(TRANSCRIPTIONS),
      totalSize: formatBytes(getPathSize(TRANSCRIPTIONS)),
    },
    tts: {
      models: fs.existsSync(TTS_MODELS) ? fs.readdirSync(TTS_MODELS).filter((file) => file.toLowerCase().endsWith(".json")).length : 0,
      outputs: fs.existsSync(TTS_OUTPUTS) ? fs.readdirSync(TTS_OUTPUTS).filter((file) => file.toLowerCase().endsWith(".json")).length : 0,
      runtimeInstalled: getTtsRuntimeStatus().installed,
      totalBytes: getPathSize(TTS_MODELS) + getPathSize(TTS_OUTPUTS) + getPathSize(TTS_CACHE),
      totalSize: formatBytes(getPathSize(TTS_MODELS) + getPathSize(TTS_OUTPUTS) + getPathSize(TTS_CACHE)),
    },
    issues,
  };
}

function addCleanupCandidate(candidates, id, targetPath, reason, options = {}) {
  if (!fs.existsSync(targetPath)) return;
  if (!options.allowUserData && (
    pathInside(targetPath, MODELS) ||
    pathInside(targetPath, OUTPUTS) ||
    pathInside(targetPath, CHAT_HISTORY) ||
    pathInside(targetPath, TRANSCRIPTIONS) ||
    pathInside(targetPath, TTS_MODELS) ||
    pathInside(targetPath, TTS_OUTPUTS)
  )) return;
  const sizeBytes = getPathSize(targetPath);
  candidates.push({
    id,
    path: targetPath,
    name: path.basename(targetPath),
    reason,
    sizeBytes,
    size: formatBytes(sizeBytes),
  });
}

function cleanupOrphanedPartFiles() {
  const allDirs = [MODELS, LLM_MODELS, SPEECH_MODELS, TTS_MODELS, VIDEO_MODELS, RVC_MODELS, MUSIC_MODELS, TOOLS];
  let cleanedCount = 0;
  let cleanedBytes = 0;
  for (const dir of allDirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    try {
      for (const item of fs.readdirSync(dir)) {
        if (item.toLowerCase().endsWith(".tmp") || /^sd-.+-temp$/i.test(item)) {
          const fullPath = path.join(dir, item);
          try {
            const stat = fs.statSync(fullPath);
            if (stat.isFile()) {
              cleanedBytes += stat.size;
              fs.unlinkSync(fullPath);
              cleanedCount++;
              console.log(`  [cleanup-auto] Yarim/bozuk indirme kalintisi temizlendi: ${item} (${(stat.size / (1024 * 1024)).toFixed(1)} MB)`);
            } else if (stat.isDirectory()) {
              fs.rmSync(fullPath, { recursive: true, force: true });
              cleanedCount++;
              console.log(`  [cleanup-auto] Gecici kalinti klasoru temizlendi: ${item}`);
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
  }
  if (cleanedCount > 0) {
    console.log(`  [cleanup-auto] Baslangicta ${cleanedCount} adet yarim kalan/bozuk dosya temizlendi (${(cleanedBytes / (1024 * 1024)).toFixed(1)} MB alan kurtarildi).`);
  }
}

function getCleanupCandidates() {
  const candidates = [];
  const toolsDir = path.join(ROOT, "app", "tools");
  const frontendDir = path.join(ROOT, "app", "frontend");
  addCleanupCandidate(candidates, "scratch-invalid", path.join(ROOT, "scratch_invalid.txt"), "Scratch/debug file.");
  addCleanupCandidate(candidates, "vite-cache", path.join(frontendDir, "node_modules", ".vite"), "Vite dependency cache; it can be regenerated.");

  if (fs.existsSync(toolsDir)) {
    for (const item of fs.readdirSync(toolsDir)) {
      const itemPath = path.join(toolsDir, item);
      if (item.toLowerCase().endsWith(".zip")) {
        addCleanupCandidate(candidates, `setup-zip-${item}`, itemPath, "Setup download archive.");
      } else if (/^sd-.+-temp$/i.test(item)) {
        addCleanupCandidate(candidates, `setup-temp-${item}`, itemPath, "Temporary backend extraction folder.");
      }
    }
  }

  const allModelDirs = [
    { dir: MODELS, label: "Görsel Modelleri" },
    { dir: LLM_MODELS, label: "Metin Modelleri (LLM)" },
    { dir: SPEECH_MODELS, label: "Ses Tanıma Modelleri (Whisper)" },
    { dir: TTS_MODELS, label: "Ses Üretim Modelleri (TTS)" },
    { dir: VIDEO_MODELS, label: "Video Modelleri" },
    { dir: RVC_MODELS, label: "Ses Klonlama Modelleri (RVC)" },
    { dir: MUSIC_MODELS, label: "Müzik Modelleri" },
  ];

  for (const { dir, label } of allModelDirs) {
    if (dir && fs.existsSync(dir)) {
      try {
        for (const item of fs.readdirSync(dir)) {
          if (item.toLowerCase().endsWith(".part") || item.toLowerCase().endsWith(".tmp")) {
            addCleanupCandidate(candidates, `partial-model-${path.basename(dir)}-${item}`, path.join(dir, item), `Yarım/bozuk indirme kalıntısı (${label}).`, { allowUserData: true });
          }
        }
      } catch (_) {}
    }
  }

  return candidates.sort((a, b) => b.sizeBytes - a.sizeBytes);
}

function cleanupSelected(ids = []) {
  const allowed = new Map(getCleanupCandidates().map((candidate) => [candidate.id, candidate]));
  const deleted = [];
  for (const id of ids) {
    const candidate = allowed.get(id);
    if (!candidate) continue;
    if (!fs.existsSync(candidate.path)) continue;
    const stat = fs.statSync(candidate.path);
    if (stat.isDirectory()) {
      fs.rmSync(candidate.path, { recursive: true, force: true });
    } else {
      fs.unlinkSync(candidate.path);
    }
    deleted.push(candidate);
  }
  return deleted;
}

function hasNvidiaGpu() {
  const info = getGpuInfo().name.toLowerCase();
  if (info.includes("nvidia")) return true;
  try {
    execSync("nvidia-smi", { stdio: "ignore" });
    return true;
  } catch (_) {
    return false;
  }
}

function hasAmdGpu() {
  const info = getGpuInfo().name.toLowerCase();
  return info.includes("amd") || info.includes("advanced micro devices") || info.includes("radeon");
}

// Detect whether we are running inside WSL2 (Windows Subsystem for Linux).
// WSL2's GPU paravirtualization (GPU-PV) only exposes a D3D12/DirectX interface
// to Linux. Vulkan hardware passthrough is only supported for NVIDIA (via CUDA).
// Intel Arc and AMD GPUs in WSL2 fall back to llvmpipe (CPU software rendering).
function isRunningInWSL() {
  if (osPlatform !== "linux") return false;
  try {
    const procVersion = fs.readFileSync("/proc/version", "utf8").toLowerCase();
    return procVersion.includes("microsoft") || procVersion.includes("wsl");
  } catch (_) {
    return false;
  }
}

function getVulkanUnavailableReason() {
  if (osPlatform === "win32" && !hasVulkanRuntime()) {
    return "The Vulkan runtime (vulkan-1.dll) is missing. Install or update your GPU vendor driver with Vulkan support, then run setup again so the Vulkan backend folder is repaired.";
  }
  if (osPlatform === "linux" && isRunningInWSL()) {
    const gpuName = getGpuInfo().name;
    const lowerGpu = gpuName.toLowerCase();
    if (lowerGpu.includes("intel") || lowerGpu.includes("arc")) {
      return `Vulkan GPU is not available in WSL2 for Intel ${gpuName}. WSL2's GPU paravirtualization only exposes a DirectX interface - Intel Arc Vulkan requires running natively on Windows.`;
    }
    return "Vulkan GPU is not available in WSL2. WSL2's GPU paravirtualization does not support hardware Vulkan for this GPU. Run natively on Windows or Linux for GPU acceleration.";
  }
  return "Installed, but this binary did not register a Vulkan backend on this machine.";
}

let cachedCoreMLPythonPath = null;
let cachedCoreMLAvailable = null;

function getCoreMLPythonPath() {
  if (cachedCoreMLAvailable !== null) {
    return cachedCoreMLPythonPath;
  }

  if (osPlatform !== "darwin") {
    cachedCoreMLAvailable = false;
    cachedCoreMLPythonPath = null;
    return null;
  }

  // 1. Check environment variable COREML_PYTHON
  if (process.env.COREML_PYTHON && fs.existsSync(process.env.COREML_PYTHON)) {
    cachedCoreMLPythonPath = process.env.COREML_PYTHON;
    cachedCoreMLAvailable = true;
    return cachedCoreMLPythonPath;
  }

  // 2. Check local/in-project venvs
  const localPaths = [
    path.join(ROOT, "app", "backend", "mac", "coreml_venv", "bin", "python"),
    path.join(ROOT, "app", "backend", "mac", "venv", "bin", "python"),
    path.join(ROOT, "venv", "bin", "python"),
  ];

  for (const p of localPaths) {
    if (fs.existsSync(p)) {
      cachedCoreMLPythonPath = p;
      cachedCoreMLAvailable = true;
      return p;
    }
  }

  // 3. Check dynamically in home directory (as fallback to user's setup)
  const homeDir = os.homedir();
  const homePaths = [
    path.join(homeDir, "workspace", "coreml_conversion", "venv", "bin", "python"),
    path.join(homeDir, "ml-stable-diffusion", "venv", "bin", "python"),
  ];

  for (const p of homePaths) {
    if (fs.existsSync(p)) {
      cachedCoreMLPythonPath = p;
      cachedCoreMLAvailable = true;
      return p;
    }
  }

  // 4. Fallback: Probe system python3 if it has required imports
  try {
    const probeResult = spawnSync("python3", [
      "-c",
      "import python_coreml_stable_diffusion, diffusers, transformers"
    ], { timeout: 2000 });
    
    if (probeResult.status === 0) {
      // Find absolute path of python3
      const whichResult = spawnSync("which", ["python3"], { encoding: "utf8" });
      const python3Path = whichResult.stdout ? whichResult.stdout.trim() : "python3";
      cachedCoreMLPythonPath = python3Path;
      cachedCoreMLAvailable = true;
      return python3Path;
    }
  } catch (err) {
    // python3 not in path or crashed
  }

  cachedCoreMLAvailable = false;
  cachedCoreMLPythonPath = null;
  return null;
}

function getCoreMLNpuInfo() {
  const isAppleSilicon = osPlatform === "darwin" && os.arch() === "arm64";
  if (!isAppleSilicon) {
    return { supported: false, reason: "Apple Silicon ANE (NPU) is only available on Apple Silicon macOS devices." };
  }

  const pythonPath = getCoreMLPythonPath();
  if (!pythonPath) {
    return {
      supported: true,
      ready: false,
      reason: "CoreML Python environment is not set up. Run scripts/setup/setup-coreml-npu.sh first.",
    };
  }

  return {
    supported: true,
    ready: true,
    python: pythonPath,
  };
}

function getBackendOptions() {
  if (cachedBackendOptions) return cachedBackendOptions;

  const cudaInstalled = (osPlatform === "win32" && fs.existsSync(BACKEND_PATHS.cuda)) ||
                        (osPlatform === "linux" && fs.existsSync(BACKEND_PATHS.linuxCuda));
  const cudaAvailable = cudaInstalled && hasNvidiaGpu() && backendAccepts(
    osPlatform === "win32" ? BACKEND_PATHS.cuda : BACKEND_PATHS.linuxCuda,
    "cuda"
  );
  const vulkanInstalled = (osPlatform === "win32" && fs.existsSync(BACKEND_PATHS.vulkan)) ||
                          (osPlatform === "linux" && fs.existsSync(BACKEND_PATHS.linuxVulkan));
  const vulkanRuntimeAvailable = osPlatform !== "win32" || hasVulkanRuntime();
  const vulkanAvailable = vulkanInstalled && vulkanRuntimeAvailable && backendAccepts(
    osPlatform === "win32" ? BACKEND_PATHS.vulkan : BACKEND_PATHS.linuxVulkan,
    "vulkan"
  );
  const rocmInstalled = osPlatform === "linux" && fs.existsSync(BACKEND_PATHS.linuxRocm);
  const rocmAvailable = rocmInstalled && hasAmdGpu() && backendAccepts(BACKEND_PATHS.linuxRocm, "rocm");
  const cpuInstalled = (osPlatform === "linux" && fs.existsSync(BACKEND_PATHS.linuxCpu)) ||
                        (osPlatform === "win32" && fs.existsSync(BACKEND_PATHS.cpu));
  const metalInstalled = osPlatform === "darwin" && fs.existsSync(BACKEND_PATHS.mac);
  const metalAvailable = metalInstalled;
  const coremlNpu = getCoreMLNpuInfo();
  const openvinoNpu = getOpenVinoNpuInfo();
  const openvinoModels = getOpenVinoModelInfo();
  const openvinoNpuAvailable = openvinoNpu.supported && openvinoModels.some((model) => model.installed);

  const options = [];
  if (cpuInstalled) options.push({ id: "cpu", label: "CPU", available: true });
  if (metalAvailable) options.push({ id: "metal", label: "Metal GPU", available: true });
  if (coremlNpu.supported && coremlNpu.ready) options.push({ id: "apple-npu", label: "Apple Neural Engine (NPU)", available: true });
  if (vulkanAvailable) options.push({ id: "vulkan", label: "Vulkan GPU", available: true });
  if (rocmAvailable) options.push({ id: "rocm", label: "ROCm GPU (AMD)", available: true });
  if (cudaAvailable) options.push({ id: "cuda", label: "CUDA GPU", available: true });
  if (openvinoNpuAvailable) options.push({ id: "openvino-npu", label: "NPU (OpenVINO)", available: true });

  const unavailable = [];
  if (vulkanInstalled && !vulkanAvailable) {
    unavailable.push({ id: "vulkan", label: "Vulkan GPU", reason: getVulkanUnavailableReason() });
  }
  if (cudaInstalled && !cudaAvailable) {
    unavailable.push({ id: "cuda", label: "CUDA GPU", reason: "Installed, but CUDA backend validation failed." });
  }
  if (rocmInstalled && !rocmAvailable) {
    unavailable.push({ id: "rocm", label: "ROCm GPU (AMD)", reason: "Installed, but ROCm backend validation failed." });
  }
  if (metalInstalled && !metalAvailable) {
    unavailable.push({ id: "metal", label: "Metal GPU", reason: "Installed, but Metal backend validation failed." });
  }
  if (coremlNpu.supported && !coremlNpu.ready) {
    unavailable.push({ id: "apple-npu", label: "Apple Neural Engine (NPU)", reason: coremlNpu.reason });
  }
  if (!cpuInstalled && (osPlatform === "win32" || osPlatform === "linux")) {
    unavailable.push({
      id: "cpu",
      label: "CPU",
      reason: osPlatform === "win32"
        ? "Windows CPU backend is not installed. Run scripts/setup/setup.ps1 to install app/backend/win/cpu."
        : "Linux CPU backend is not installed. Run setup again to install app/backend/linux/cpu.",
    });
  }
  if (openvinoNpu.supported && !openvinoNpuAvailable) {
    unavailable.push({ id: "openvino-npu", label: "NPU (OpenVINO)", reason: "Runtime is ready, but no OpenVINO NPU model is downloaded." });
  } else if (!openvinoNpu.supported && hasNpuHardware() && (osPlatform === "win32" || osPlatform === "linux")) {
    unavailable.push({ id: "openvino-npu", label: "NPU (OpenVINO)", reason: openvinoNpu.reason });
  }

  let defaultBackend = "cpu";
  if (coremlNpu.supported && coremlNpu.ready) {
    defaultBackend = "apple-npu";
  } else if (metalAvailable) {
    defaultBackend = "metal";
  } else if (cudaAvailable) {
    const gpuName = String(getGpuInfo().name).toLowerCase();
    const isGtxCard = gpuName.includes("gtx");
    if (isGtxCard && vulkanAvailable) {
      defaultBackend = "vulkan"; // Default to Vulkan for GTX cards because of lack of Tensor Cores
    } else {
      defaultBackend = "cuda";
    }
  } else if (rocmAvailable) {
    defaultBackend = "rocm";
  } else if (vulkanAvailable) {
    defaultBackend = "vulkan";
  }

  cachedBackendOptions = {
    options,
    unavailable,
    cudaAvailable,
    vulkanAvailable,
    rocmAvailable,
    metalAvailable,
    openvinoNpuAvailable,
    openvinoNpu,
    openvinoModels,
    coremlNpu,
    defaultBackendType: defaultBackend,
  };
  return cachedBackendOptions;
}

function backendAccepts(binaryPath, backendName) {
  if (!binaryPath || !fs.existsSync(binaryPath)) return false;
  try {
    const cliBackendName = backendName;
    let probeArgs = [
      "--backend", cliBackendName,
      "--params-backend", cliBackendName,
      "--model", path.join(MODELS, "__backend_probe_missing__.safetensors"),
      "--listen-port", "18082",
    ];
    if (cliBackendName === "metal") {
      probeArgs = [
        "--model", path.join(MODELS, "__backend_probe_missing__.safetensors"),
        "--listen-port", "18082",
      ];
    }
    const spawnEnv = { ...process.env };
    if (osPlatform === "linux") {
      const dir = path.dirname(binaryPath);
      const existing = spawnEnv.LD_LIBRARY_PATH || "";
      spawnEnv.LD_LIBRARY_PATH = dir + (existing ? ":" + existing : "");
    } else if (osPlatform === "darwin") {
      const dir = path.dirname(binaryPath);
      const existing = spawnEnv.DYLD_LIBRARY_PATH || "";
      spawnEnv.DYLD_LIBRARY_PATH = dir + (existing ? ":" + existing : "");
    }
    let result = spawnSync(binaryPath, probeArgs, { env: spawnEnv, encoding: "utf8", timeout: 5000 });
    let output = `${result.stdout || ""}\n${result.stderr || ""}`;

    let supportsFlags = true;
    // Some binaries do not support --backend. If we see "unknown argument",
    // retry without backend flags so we can still verify the binary launches.
    if (output.includes("unknown argument") && output.includes("--backend")) {
      supportsFlags = false;
      const fallbackArgs = [
        "--model", path.join(MODELS, "__backend_probe_missing__.safetensors"),
        "--listen-port", "18082",
      ];
      result = spawnSync(binaryPath, fallbackArgs, { env: spawnEnv, encoding: "utf8", timeout: 5000 });
      output = `${result.stdout || ""}\n${result.stderr || ""}`;
    }

    const lower = output.toLowerCase();
    if (lower.includes("backend config failed") || output.includes(`backend '${backendName}' was not found`) || output.includes(`backend '${cliBackendName}' was not found`)) {
      return false;
    }
    // Reject binaries that fail at the dynamic linker / glibc level.
    if (lower.includes("glibc") || lower.includes("libc.so") || lower.includes("libstdc++") || lower.includes("cannot open shared object")) {
      return false;
    }
    // A healthy binary prints project-specific log lines when it tries to load the model.
    const isOk = lower.includes("stable-diffusion.cpp") || lower.includes("loading model");
    if (isOk) {
      backendSupportsFlags[binaryPath] = supportsFlags;
    }
    return isOk;
  } catch (_) {
    return false;
  }
}

function selectBackendPath(useGpu, backendType = "auto", modelPath = "") {
  const resolvedType = resolveBackendType(useGpu, backendType, modelPath);
  if (osPlatform === "win32") {
    if (resolvedType === "cuda" && fs.existsSync(BACKEND_PATHS.cuda)) return BACKEND_PATHS.cuda;
    if (resolvedType === "cpu" && fs.existsSync(BACKEND_PATHS.cpu)) return BACKEND_PATHS.cpu;
    if (resolvedType === "vulkan" && fs.existsSync(BACKEND_PATHS.vulkan)) return BACKEND_PATHS.vulkan;
    if (fs.existsSync(BACKEND_PATHS.cuda)) return BACKEND_PATHS.cuda;
    if (fs.existsSync(BACKEND_PATHS.cpu)) return BACKEND_PATHS.cpu;
    if (fs.existsSync(BACKEND_PATHS.vulkan)) return BACKEND_PATHS.vulkan;
    return BACKEND_PATH;
  }
  if (osPlatform === "linux") {
    let finalType = resolvedType;
    if (finalType === "cuda") {
      if (fs.existsSync(BACKEND_PATHS.linuxCuda)) {
        return BACKEND_PATHS.linuxCuda;
      }
      finalType = "vulkan";
    }
    if (finalType === "rocm" && fs.existsSync(BACKEND_PATHS.linuxRocm)) return BACKEND_PATHS.linuxRocm;
    if (resolvedType === "vulkan" && fs.existsSync(BACKEND_PATHS.linuxVulkan)) return BACKEND_PATHS.linuxVulkan;
    if (resolvedType === "cpu" && fs.existsSync(BACKEND_PATHS.linuxCpu)) return BACKEND_PATHS.linuxCpu;
    if (fs.existsSync(BACKEND_PATHS.linuxVulkan)) return BACKEND_PATHS.linuxVulkan;
    if (fs.existsSync(BACKEND_PATHS.linuxCpu)) return BACKEND_PATHS.linuxCpu;
    return BACKEND_PATH;
  }
  if (osPlatform === "darwin") {
    if (resolvedType === "apple-npu") return getCoreMLPythonPath();
    if (fs.existsSync(BACKEND_PATHS.mac)) return BACKEND_PATHS.mac;
    return BACKEND_PATH;
  }
  // generic fallback
  if (fs.existsSync(BACKEND_PATHS.mac)) return BACKEND_PATHS.mac;
  return BACKEND_PATH;
}

function resolveBackendType(useGpu, backendType = "auto", modelPath = "") {
  const options = getBackendOptions();
  let requestedType = useGpu === false ? "cpu" : backendType === "auto" ? options.defaultBackendType : backendType;

  if (modelPath && osPlatform === "darwin") {
    const lower = modelPath.toLowerCase();
    const isDir = fs.existsSync(modelPath) && fs.statSync(modelPath).isDirectory();
    if (lower.endsWith(".safetensors") || lower.endsWith(".gguf")) {
      if (requestedType === "apple-npu") requestedType = "metal";
    } else if (lower.endsWith(".coreml") || lower.endsWith(".mlpackage") || lower.endsWith(".mlmodelc") || isDir) {
      if (requestedType === "metal") requestedType = "apple-npu";
    }
  }

  const available = new Set(options.options.map(option => option.id));
  return available.has(requestedType) ? requestedType : options.defaultBackendType;
}

function getBackendMode(backendPath, useGpu, backendType = "auto") {
  if (useGpu === false || backendType === "cpu") return "CPU";
  const name = path.basename(backendPath || "").toLowerCase();
  if (name.includes("cuda")) return "CUDA GPU";
  if (name.includes("rocm")) return "ROCm GPU";
  if (name.includes("vulkan")) return "Vulkan GPU";
  if (backendType === "apple-npu") return "Apple NPU";
  if (osPlatform === "darwin" || backendType === "metal") return "Metal GPU";
  return "GPU";
}

function stripAnsi(value) {
  return String(value || "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1b\[[A-Z]/g, "");
}

function markBackendReady() {
  if (backendReady) return;
  backendReady = true;
  backendLoadState = {
    ...backendLoadState,
    active: false,
    phase: "Model ready",
    progress: 100,
  };
  console.log("  [backend] PORT uzerinde HAZIR", PORT_BACKEND);

  // Force a single VRAM poll after the model settles in memory
  setTimeout(() => pollNvidiaVram(true), 1500);
}

function pingBackendReady() {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${PORT_BACKEND}/v1/models`, res => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

function requestJson(url, payload = null, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data = payload ? Buffer.from(JSON.stringify(payload), "utf8") : null;
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: data ? "POST" : "GET",
      headers: data ? {
        "Content-Type": "application/json",
        "Content-Length": data.length,
      } : {},
      timeout: timeoutMs,
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          const jsonBody = JSON.parse(body || "{}");
          if (res.statusCode < 200 || res.statusCode >= 300 || jsonBody.ok === false) {
            reject(new Error(jsonBody.error || `HTTP ${res.statusCode}`));
            return;
          }
          resolve(jsonBody);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    if (data) req.write(data);
    req.end();
  });
}

function proxyImageBackendRequest(req, res) {
  const headers = { ...req.headers };
  delete headers.host;
  headers.host = `127.0.0.1:${PORT_BACKEND}`;

  const proxyReq = http.request({
    hostname: "127.0.0.1",
    port: PORT_BACKEND,
    path: req.url,
    method: req.method,
    headers,
    // CPU generation and VAE decoding can legitimately take well over five
    // minutes on low-memory systems. Let the browser/user control cancellation.
    timeout: 0,
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, {
      ...proxyRes.headers,
    });
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    json(res, 502, { ok: false, error: `Image backend is not reachable: ${err.message}` });
  });
  proxyReq.on("timeout", () => {
    proxyReq.destroy(new Error("Image backend request timed out"));
  });

  req.pipe(proxyReq);
}

function requestHttpsJson(url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Uncensored-AI-Studio/1.0",
      },
      timeout: timeoutMs,
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body || "null");
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(parsed?.error || `Hugging Face returned HTTP ${res.statusCode}`));
            return;
          }
          resolve(parsed);
        } catch (err) {
          reject(new Error(`Hugging Face returned invalid JSON: ${err.message}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Hugging Face request timed out")));
  });
}

function getModelParameterBillions(value) {
  const text = String(value || "");
  const matches = [...text.matchAll(/(?:^|[-_/ ])(\d+(?:\.\d+)?)\s*b(?:[-_/ ]|$)/gi)];
  if (matches.length === 0) return null;
  return Math.min(...matches.map((match) => Number(match[1])).filter(Number.isFinite));
}

function selectGgufFile(siblings = [], tier = "low") {
  const files = siblings
    .map((item) => typeof item === "string" ? item : item?.rfilename)
    .filter((name) => name && /\.gguf$/i.test(name))
    .filter((name) => !/(?:^|\/)(?:mmproj|mtp)(?:[-_/]|$)|-\d{5}-of-\d{5}\.gguf$/i.test(name));
  const preferences = tier === "high"
    ? [/q6_k\.gguf$/i, /q5_k_m\.gguf$/i, /q4_k_m\.gguf$/i, /q8_0\.gguf$/i]
    : [/q4_k_m\.gguf$/i, /q4_k_s\.gguf$/i, /q4_0\.gguf$/i, /q3_k_m\.gguf$/i, /iq4_xs\.gguf$/i];
  for (const pattern of preferences) {
    const match = files.find((name) => pattern.test(name));
    if (match) return match;
  }
  return files[0] || "";
}

function selectMmprojFile(siblings = [], modelFilename = "") {
  const files = siblings
    .map((item) => typeof item === "string" ? item : item?.rfilename)
    .filter((name) => name && /\.gguf$/i.test(name))
    .filter((name) => /(?:^|[-_/])mmproj(?:[-_.\/]|$)|mmproj/i.test(name));
  if (files.length === 0) return "";

  const modelBase = path.basename(modelFilename).toLowerCase();
  const modelStem = modelBase.replace(/\.gguf$/i, "").replace(/\.(q\d(?:_k_[ms])?|iq\d_[a-z0-9]+|bf16|f16|f32)$/i, "");
  const scored = files.map((name) => {
    const lower = name.toLowerCase();
    let score = 0;
    if (/bf16/i.test(lower)) score += 6;
    if (/f16/i.test(lower)) score += 5;
    if (/mmproj-model-f16/i.test(lower)) score += 4;
    if (modelStem && lower.includes(modelStem)) score += 10;
    return { name, score };
  });
  scored.sort((a, b) => b.score - a.score || a.name.length - b.name.length);
  return scored[0]?.name || "";
}

function parseHuggingFaceResolveUrl(fileUrl) {
  try {
    const parsed = new URL(fileUrl);
    if (!/^(?:www\.)?huggingface\.co$/i.test(parsed.hostname)) return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const resolveIndex = parts.findIndex((part) => part === "resolve" || part === "blob");
    if (resolveIndex < 2 || resolveIndex + 2 >= parts.length) return null;
    const repoId = `${decodeURIComponent(parts[0])}/${decodeURIComponent(parts[1])}`;
    const revision = decodeURIComponent(parts[resolveIndex + 1] || "main");
    const repositoryFilename = parts.slice(resolveIndex + 2).map(decodeURIComponent).join("/");
    return { repoId, revision, repositoryFilename };
  } catch (_) {
    return null;
  }
}

async function resolveHuggingFaceProjector(fileUrl, localModelFilename = "") {
  const parsed = parseHuggingFaceResolveUrl(fileUrl);
  if (!parsed) return null;

  const cacheKey = `${parsed.repoId}|${parsed.revision}|${parsed.repositoryFilename}`;
  const cached = hfProjectorCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < HF_MODEL_CACHE_TTL_MS) return cached.projector;

  try {
    const treeUrl = `https://huggingface.co/api/models/${parsed.repoId}/tree/${encodeURIComponent(parsed.revision)}?recursive=true`;
    const tree = await requestHttpsJson(treeUrl);
    const projectorRepositoryFilename = selectMmprojFile(tree, parsed.repositoryFilename || localModelFilename);
    const projector = projectorRepositoryFilename
      ? {
          url: `https://huggingface.co/${parsed.repoId}/resolve/${encodeURIComponent(parsed.revision)}/${projectorRepositoryFilename.split("/").map(encodeURIComponent).join("/")}`,
          filename: `${parsed.repoId.replace(/\//g, "--")}--${path.basename(projectorRepositoryFilename)}`,
          repositoryFilename: projectorRepositoryFilename,
        }
      : null;
    hfProjectorCache.set(cacheKey, { createdAt: Date.now(), projector });
    return projector;
  } catch (err) {
    console.warn(`  [download] Gorsel projektoru cozumlenemedi ${parsed.repoId}: ${err.message || err}`);
    hfProjectorCache.set(cacheKey, { createdAt: Date.now(), projector: null });
    return null;
  }
}

function classifyHuggingFaceModel(model, filename) {
  const searchable = `${model.id || ""} ${filename || ""} ${(model.tags || []).join(" ")}`.toLowerCase();
  const parameters = getModelParameterBillions(searchable);
  return {
    potato: parameters !== null && parameters <= 3,
    vision: /(?:vision|llava|multimodal|(?:^|[-_/ ])vl(?:[-_/ ]|$)|moondream)/i.test(searchable),
    uncensored: /uncensored|abliterated|heretic/i.test(searchable),
    parameters,
  };
}

function getTextModelFit(sizeBytes, specs = getHardwareSpecs()) {
  if (!sizeBytes) {
    return { recommended: false, mode: "unknown", label: "", reason: "File size is unavailable, so compatibility cannot be estimated." };
  }

  const ramBytes = Math.max(0, Number(specs.ram_total_gb) || 0) * (1024 ** 3);
  const vramBytes = Math.max(0, Number(specs.gpu_vram_gb) || 0) * (1024 ** 3);
  const isAppleSilicon = osPlatform === "darwin" && /apple/i.test(String(specs.cpu_name || ""));
  const systemReserve = Math.max(4 * (1024 ** 3), ramBytes * 0.3);
  const usableRam = Math.max(0, ramBytes - systemReserve);
  const runtimeNeed = (sizeBytes * 1.25) + (1.5 * (1024 ** 3));
  const fastGpuFit = vramBytes >= runtimeNeed;
  const cpuOrOffloadFit = usableRam >= runtimeNeed;
  const unifiedMemoryFit = isAppleSilicon && usableRam >= runtimeNeed;
  const hybridFit = !fastGpuFit && vramBytes > 0 && cpuOrOffloadFit;
  const recommended = fastGpuFit || cpuOrOffloadFit || unifiedMemoryFit;

  if (recommended) {
    const mode = fastGpuFit
      ? "GPU memory"
      : isAppleSilicon
        ? "unified memory"
        : hybridFit
          ? "combined GPU and system memory"
          : "system RAM";
    return {
      recommended: true,
      mode: fastGpuFit ? "gpu" : isAppleSilicon ? "unified" : hybridFit ? "hybrid" : "ram",
      label: fastGpuFit ? "GPU Fit" : isAppleSilicon ? "Fits Unified Memory" : hybridFit ? "GPU + RAM Fit" : "Fits in RAM",
      reason: `${formatBytes(sizeBytes)} weights fit the estimated ${mode} budget with runtime headroom.`,
    };
  }

  return {
    recommended: false,
    mode: "too-large",
    label: "",
    reason: `${formatBytes(sizeBytes)} weights need about ${formatBytes(runtimeNeed)} including runtime headroom; this computer has about ${formatBytes(usableRam)} usable RAM and ${formatBytes(vramBytes)} VRAM.`,
  };
}

async function addHuggingFaceFileSize(model) {
  try {
    const detail = await requestHttpsJson(`https://huggingface.co/api/models/${model.id}?blobs=true`);
    const file = (detail.siblings || []).find((item) => item?.rfilename === model.repositoryFilename);
    const sizeBytes = Number(file?.size || file?.lfs?.size || 0);
    const fit = getTextModelFit(sizeBytes);
    return {
      ...model,
      sizeBytes,
      size: sizeBytes > 0 ? formatBytes(sizeBytes) : "Unknown",
      approxSize: sizeBytes > 0 ? formatBytes(sizeBytes) : model.approxSize,
      recommendedFit: fit.recommended,
      fitMode: fit.mode,
      fitLabel: fit.label,
      fitReason: fit.reason,
    };
  } catch (_) {
    return {
      ...model,
      sizeBytes: 0,
      size: "Unknown",
      recommendedFit: false,
      fitMode: "unknown",
      fitLabel: "",
      fitReason: "File size is unavailable, so compatibility cannot be estimated.",
    };
  }
}

async function searchHuggingFaceModels(query, filters) {
  const specs = getHardwareSpecs();
  const tier = specs.gpu_vram_gb >= 10 || specs.ram_total_gb >= 32
    ? "high"
    : specs.gpu_vram_gb >= 5 || specs.ram_total_gb >= 16 ? "mid" : "low";
  const defaultSearch = tier === "low" ? "1B instruct" : tier === "mid" ? "7B instruct" : "8B instruct";
  let searchTerms = "";
  if (query.trim()) {
    searchTerms = [
      query.trim(),
      filters.includes("vision") ? "vision" : "",
      filters.includes("uncensored") ? "uncensored" : "",
    ].filter(Boolean).join(" ");
  } else {
    if (filters.includes("vision") && filters.includes("uncensored")) {
      searchTerms = "vision uncensored gguf";
    } else if (filters.includes("vision")) {
      searchTerms = "vision gguf";
    } else if (filters.includes("uncensored")) {
      searchTerms = "uncensored gguf";
    } else {
      searchTerms = defaultSearch;
    }
  }
  const cacheKey = `${tier}|${searchTerms}|${filters.sort().join(",")}`;
  const cached = hfModelCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < HF_MODEL_CACHE_TTL_MS) return cached.models;

  const params = new URLSearchParams({
    filter: "gguf",
    search: searchTerms,
    sort: "downloads",
    direction: "-1",
    limit: "50",
    full: "true",
  });
  const results = await requestHttpsJson(`https://huggingface.co/api/models?${params.toString()}`);
  const models = [];

  for (const model of Array.isArray(results) ? results : []) {
    if (model.private || model.gated || model.disabled) continue;
    const filename = selectGgufFile(model.siblings, tier);
    if (!filename) continue;
    const projectorFilename = selectMmprojFile(model.siblings, filename);
    const traits = classifyHuggingFaceModel(model, filename);
    if (filters.includes("vision") && !traits.vision) continue;
    if (filters.includes("uncensored") && !traits.uncensored) continue;

    const isLikelyChatModel = /instruct|chat|assistant|coder|uncensored|abliterated|vision|llava|\bvl\b/i.test(`${model.id} ${filename}`);
    if (!query.trim() && !isLikelyChatModel) continue;
    const normalizedQuery = query.trim().toLowerCase().replace(/[-_/]+/g, " ").replace(/\s+/g, " ");
    const normalizedModelName = `${model.id} ${filename}`.toLowerCase().replace(/[-_/]+/g, " ").replace(/\s+/g, " ");
    const queryWords = normalizedQuery.split(" ").filter(Boolean);
    const exactPhraseMatch = normalizedQuery && normalizedModelName.includes(normalizedQuery);
    const matchedQueryWords = queryWords.filter((word) => normalizedModelName.includes(word)).length;
    const score = Number(model.downloads || 0)
      + (traits.parameters && traits.parameters <= 3 && tier === "low" ? 10000000 : 0)
      + (traits.parameters && tier === "mid" && traits.parameters >= 4 && traits.parameters <= 9 ? 10000000 : 0)
      + (traits.parameters && tier === "high" && traits.parameters >= 7 && traits.parameters <= 14 ? 10000000 : 0)
      + (exactPhraseMatch ? 100000000 : 0)
      + (matchedQueryWords * 5000000);
    models.push({
      id: model.id,
      name: String(model.id || "").split("/").pop().replace(/[-_]+/g, " "),
      filename: `${model.id.replace(/\//g, "--")}--${path.basename(filename)}`,
      repositoryFilename: filename,
      format: "GGUF",
      approxSize: traits.parameters ? `~${traits.parameters}B parameters` : "Size shown before download",
      resolution: "N/A",
      notes: `Community GGUF from ${String(model.id || "").split("/")[0]}. ${Number(model.downloads || 0).toLocaleString()} Hugging Face downloads.`,
      url: `https://huggingface.co/${model.id}/resolve/main/${filename.split("/").map(encodeURIComponent).join("/")}`,
      projectorUrl: projectorFilename ? `https://huggingface.co/${model.id}/resolve/main/${projectorFilename.split("/").map(encodeURIComponent).join("/")}` : "",
      projectorFilename: projectorFilename ? `${model.id.replace(/\//g, "--")}--${path.basename(projectorFilename)}` : "",
      pageUrl: `https://huggingface.co/${model.id}`,
      downloads: Number(model.downloads || 0),
      likes: Number(model.likes || 0),
      tags: Object.entries(traits).filter(([key, value]) => key !== "parameters" && value).map(([key]) => key),
      score,
    });
  }

  const ranked = models.sort((a, b) => b.score - a.score);
  hfModelCache.set(cacheKey, { createdAt: Date.now(), models: ranked });
  return ranked;
}

async function killOpenVinoWorker() {
  if (!openvinoProc) {
    openvinoReady = false;
    return;
  }
  console.log("  [openvino-npu] Isci durduruluyor...");
  try { openvinoProc.kill("SIGTERM"); } catch (_) {}
  await new Promise((resolve) => setTimeout(resolve, 800));
  try { openvinoProc.kill("SIGKILL"); } catch (_) {}
  openvinoProc = null;
  openvinoReady = false;
}

function getOpenVinoResolution(settings = {}) {
  const width = Number(settings.width) || 512;
  const height = Number(settings.height) || 512;
  const supported = (width === 512 && height === 512) || (width === 1024 && height === 1024);
  if (!supported) {
    throw new Error("OpenVINO NPU supports 512x512 generation or 1024x1024 HD upscale.");
  }
  return { width, height };
}

async function startOpenVinoWorker(settings = {}) {
  const npuInfo = getOpenVinoNpuInfo();
  if (!npuInfo.supported) throw new Error(npuInfo.reason || "OpenVINO NPU is not available.");
  const requestedModel = settings.model ? findOpenVinoModel(settings.model) : null;
  if (settings.model && !requestedModel) {
    throw new Error("OpenVINO NPU requires a downloaded OpenVINO model. Standard .safetensors/.ckpt weights must use Vulkan, CUDA, or CPU.");
  }
  const model = requestedModel || getOpenVinoModelInfo().find((item) => item.installed);
  if (!model || !model.installed) {
    throw new Error("OpenVINO NPU model is not downloaded. Download an OpenVINO NPU model from Model Yoneticisi first.");
  }
  const { width, height } = getOpenVinoResolution(settings);
  if (openvinoProc &&
      openvinoReady &&
      openvinoModel === model.id) {
    currentSettings = { ...currentSettings, ...settings, model: model.id, width, height };
    return;
  }

  await killBackend();
  await killOpenVinoWorker();
  openvinoError = null;
  openvinoReady = false;
  openvinoModel = model.id;
  openvinoWidth = 512;
  openvinoHeight = 512;
  openvinoPort = await findAvailableBackendPort();
  PORT_BACKEND = openvinoPort;

  currentSettings = { ...currentSettings, ...settings };
  currentSettings.backendType = "openvino-npu";
  currentSettings.useGpu = true;
  currentSettings.backendMode = "NPU (OpenVINO)";
  currentSettings.backendBinary = "openvino_npu_worker.py";
  currentSettings.backendDevice = npuInfo.npu?.name || "Intel AI Boost";
  currentSettings.model = model.id;
  currentSettings.width = width;
  currentSettings.height = height;

  backendError = null;
  backendLoadState = {
    active: true,
    phase: "Compiling OpenVINO NPU pipeline (512x512)...",
    progress: 5,
    current: 0,
    total: 0,
    speed: "",
    model: model.name,
    backendMode: "NPU (OpenVINO)",
    backendBinary: "openvino_npu_worker.py",
    device: currentSettings.backendDevice,
  };

  const workerPath = path.join(ROOT, "scripts", "workers", "openvino_npu_worker.py");
  const cacheDir = path.join(ROOT, "app", "tools", "openvino-cache", "512x512");
  console.log(`  [openvino-npu] 512x512 isci port uzerinde baslatiliyor ${openvinoPort}`);
  openvinoProc = spawn(npuInfo.python, [
    workerPath,
    "--model-dir", model.path,
    "--port", String(openvinoPort),
    "--width", "512",
    "--height", "512",
    "--cache-dir", cacheDir,
  ], { stdio: "pipe" });

  let openvinoStdoutBuffer = "";
  openvinoProc.stdout.on("data", (data) => {
    const text = data.toString();
    process.stdout.write("  " + text);
    openvinoStdoutBuffer += text;
    const lines = openvinoStdoutBuffer.split(/\r?\n/);
    openvinoStdoutBuffer = lines.pop() || "";
    for (const line of lines) {
      if (line.includes("READY")) {
        openvinoReady = true;
        backendReady = true;
        backendLoadState = { ...backendLoadState, active: false, phase: "OpenVINO NPU model ready", progress: 100 };
      }
      const progressMatch = line.match(/PROGRESS\s+(\d+)\/(\d+)\s+(.+)$/);
      if (progressMatch) {
        generationState.active = true;
        generationState.step = Number(progressMatch[1]);
        generationState.steps = Number(progressMatch[2]);
        generationState.speed = progressMatch[3].trim();
        generationState.decoding = false;
      } else if (line.includes("DECODING") && generationState.active) {
        generationState.step = generationState.steps;
        generationState.decoding = true;
        generationState.speed = "";
      }
    }
  });
  openvinoProc.stderr.on("data", (data) => {
    const text = data.toString();
    process.stderr.write("  " + text);
    const cleanText = stripAnsi(text).trim();
    if (cleanText && (cleanText.includes("ERROR") || cleanText.includes("Traceback") || cleanText.includes("Exception"))) {
      openvinoError = cleanText;
      backendError = openvinoError;
    }
  });
  openvinoProc.on("exit", (code) => {
    console.log("  [openvino-npu] isci cikti kodu ile cikti", code);
    openvinoProc = null;
    openvinoReady = false;
    backendReady = false;
    if (code !== 0 && code !== null && !backendError) backendError = `OpenVINO NPU isci cikti kodu ile cikti ${code}`;
    backendLoadState.active = false;
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < 360000) {
    if (openvinoReady) return;
    if (backendError) throw new Error(backendError);
    if (!openvinoProc) throw new Error("OpenVINO NPU worker exited during startup.");
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    backendLoadState.progress = Math.min(95, 5 + Math.round(elapsed / 2));
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await killOpenVinoWorker();
  throw new Error("OpenVINO NPU 512x512 compile timed out after 6 minutes.");
}

async function generateWithOpenVino(body) {
  if (!openvinoReady || !openvinoPort) throw new Error("OpenVINO NPU worker is not ready. Load an OpenVINO NPU model first.");
  const steps = Math.max(1, Math.min(8, Number(body.steps) || 4));
  generationState = { active: true, step: 0, steps, speed: "", decoding: false };
  try {
    const result = await requestJson(`http://127.0.0.1:${openvinoPort}/generate`, {
      prompt: body.prompt,
      negative_prompt: body.negative_prompt || "",
      width: Number(body.width) || currentSettings.width || 512,
      height: Number(body.height) || currentSettings.height || 512,
      steps,
      cfg_scale: Number(body.cfg_scale) || 1.0,
      seed: body.seed,
    }, 300000);
    resetGenerationState();
    return result;
  } catch (err) {
    resetGenerationState();
    throw err;
  }
}

function startBackendReadyPoll() {
  let attempts = 0;
  const isNpu = currentSettings.backendType === "apple-npu" || currentSettings.backendType === "openvino-npu";
  const maxAttempts = isNpu ? 1200 : 240;
  const interval = setInterval(async () => {
    attempts += 1;
    if (!backendProc || backendReady || attempts > maxAttempts) {
      clearInterval(interval);
      return;
    }
    if (await pingBackendReady()) {
      markBackendReady();
      clearInterval(interval);
    }
  }, 500);
}

function startCoreMLLoadHeartbeat(proc) {
  if (currentSettings.backendType !== "apple-npu") return null;
  const startedAt = Date.now();
  const interval = setInterval(() => {
    if (backendProc !== proc || backendReady || !backendLoadState.active) {
      clearInterval(interval);
      return;
    }
    const elapsedSec = (Date.now() - startedAt) / 1000;
    const targetProgress = Math.min(96, Math.round(8 + 88 * (1 - Math.exp(-elapsedSec / 55))));
    if (targetProgress > (backendLoadState.progress || 0)) {
      backendLoadState = {
        ...backendLoadState,
        active: true,
        phase: backendLoadState.phase || "Loading Core ML model...",
        progress: targetProgress,
      };
    }
  }, 1000);
  return interval;
}

function getDefaultModel() {
  try {
    const files = fs.readdirSync(MODELS).filter(isModelFile);
    return files.length ? path.join(MODELS, files[0]) : null;
  } catch (_) { return null; }
}

function killBackend() {
  return new Promise(resolve => {
    resetGenerationState();
    const proc = backendProc;
    if (!proc) {
      backendUnloadState = { active: false, phase: "", progress: 0 };
      resolve();
      return;
    }
    backendUnloadState = { active: true, phase: "Stopping backend process...", progress: 10 };
    backendReady = false;
    try { proc.kill("SIGTERM"); } catch (_) {}
    backendUnloadState = { active: true, phase: "Waiting for process exit...", progress: 50 };
    setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch (_) {}
      if (backendProc === proc) backendProc = null;
      backendUnloadState = { active: false, phase: "Backend unloaded", progress: 100 };
      resolve();
    }, 2000);
  });
}

function chooseAutoContext(modelFilename, isGpu) {
  let modelSizeGb = 4;
  try {
    const modelPath = path.join(LLM_MODELS, modelFilename);
    if (fs.existsSync(modelPath)) {
      const stats = fs.statSync(modelPath);
      modelSizeGb = stats.size / (1024 * 1024 * 1024);
    }
  } catch (_) {}

  const lowerFilename = String(modelFilename || "").toLowerCase();
  const isVisionModel = isVisionModelFilename(lowerFilename);
  let projectorSizeGb = 0;
  if (isVisionModel) {
    try {
      const files = fs.readdirSync(LLM_MODELS);
      const projector = files.find((file) => {
        const lower = file.toLowerCase();
        return lower.endsWith(".gguf") && lower.includes("mmproj");
      });
      if (projector) {
        projectorSizeGb = fs.statSync(path.join(LLM_MODELS, projector)).size / (1024 * 1024 * 1024);
      }
    } catch (_) {}
  }

  const systemRamGb = os.totalmem() / (1024 * 1024 * 1024);
  let vramGb = 0;
  try {
    const gpu = getGpuInfo();
    if (gpu && gpu.vram_gb) {
      vramGb = gpu.vram_gb;
    }
  } catch (_) {}

  let availableGb = 0;
  let bufferGb = 2.0;

  if (isGpu && vramGb > 0) {
    availableGb = vramGb;
    bufferGb = 1.5;
  } else {
    availableGb = systemRamGb;
    bufferGb = 2.5;
  }

  if (isGpu && vramGb > 0) {
    const gpuBudgetGb = Math.max(0.5, vramGb - modelSizeGb - projectorSizeGb - bufferGb);
    const maxFastContext = vramGb < 10 ? 8192 : vramGb < 16 ? 16384 : 32768;
    if (isVisionModel) {
      return Math.min(maxFastContext, gpuBudgetGb >= 2.5 ? 8192 : 4096);
    }
    if (gpuBudgetGb < 1.5) return 4096;
    if (gpuBudgetGb < 3.0) return Math.min(maxFastContext, 8192);
    return Math.min(maxFastContext, 16384);
  }

  const usableGb = Math.max(0.5, availableGb - modelSizeGb - projectorSizeGb - bufferGb);

  let kvPer4096Gb = 0.55;
  if (modelSizeGb >= 5.5) {
    kvPer4096Gb = 1.05;
  } else if (modelSizeGb >= 4.0) {
    kvPer4096Gb = 0.85;
  }

  const estimatedMaxCtx = (usableGb / kvPer4096Gb) * 4096;
  const contextLadder = [32768, 24576, 16384, 12288, 8192, 4096, 2048];
  
  for (const limit of contextLadder) {
    if (limit <= estimatedMaxCtx) {
      return limit;
    }
  }
  return 2048;
}

function isVisionModelFilename(filename = "") {
  const lower = String(filename || "").toLowerCase();
  return lower.includes("llava") ||
    lower.includes("vision") ||
    lower.includes("qwen2vl") ||
    lower.includes("qwen2-vl") ||
    lower.includes("qwen3.5-4b-vision") ||
    lower.includes("gemma-4") ||
    lower.includes("gemma4") ||
    lower.includes("-e2b-") ||
    lower.includes("e2b-it") ||
    lower.includes("paligemma") ||
    lower.includes("minicpm-v") ||
    lower.includes("internvl") ||
    lower.includes("phi-3-vision") ||
    lower.includes("phi3-vision") ||
    lower.includes("smolvlm") ||
    lower.includes("moondream") ||
    lower === "ggml-model-q4_k.gguf";
}

function buildLlmLoadProfiles(settings = {}, backend = {}) {
  const requestedContext = Number(settings.contextSize);
  const safeContext = requestedContext && requestedContext > 0
    ? Math.max(512, Math.min(4096, requestedContext))
    : 4096;
  const isCpu = backend.key === "cpu" || backend.mode === "CPU";
  const profiles = [
    { name: "requested", gpuLayers: isCpu ? 0 : undefined },
    {
      name: "safe",
      contextSize: safeContext,
      gpuLayers: isCpu ? 0 : 0,
      flashAttn: false,
      cacheTypeK: "q4_0",
      cacheTypeV: "q4_0",
      batchSize: 256,
      ubatchSize: 256,
      enableThinking: false,
    },
  ];
  return profiles;
}

async function startLlm(settings = {}) {
  const rawModel = String(settings.model || "").trim();
  if (rawModel.startsWith("cloud:")) {
    const parts = rawModel.split(":");
    const provider = parts[1] || "openrouter";
    const cloudModelId = parts.slice(2).join(":");
    const cfg = getProvidersConfig();
    const apiKey = cfg?.keys?.[provider];
    if (!apiKey || !String(apiKey).trim()) {
      throw new Error(`${provider.toUpperCase()} API anahtarı bulunamadı. Lütfen Hibrit API & Bulut sekmesinden anahtarınızı kaydedin.`);
    }
    await killLlm();
    const cloudModels = getCloudLlmModels();
    const matched = cloudModels.find((m) => m.filename === rawModel);
    llmReady = true;
    llmError = null;
    llmSettings = {
      ...llmSettings,
      model: rawModel,
      displayName: matched?.displayName || `${cloudModelId} [${provider.toUpperCase()} API]`,
      isCloud: true,
      provider,
      cloudModelId,
      threads: Number(settings.threads) || 4,
      contextSize: 32768,
      gpuLayers: 0,
      backendMode: `Bulut API (${provider.toUpperCase()})`,
      backendBinary: "cloud-api",
      supportsThinking: true,
      supportsVision: true,
      visionMode: "cloud",
      visionStatus: "Bulut Görsel Destekli",
      enableThinking: settings.enableThinking !== false,
    };
    console.log(`  [llm-cloud] Activated Cloud LLM: ${rawModel}`);
    return;
  }
  const filename = path.basename(rawModel);
  const modelPath = path.join(LLM_MODELS, filename);
  if (!filename || !pathInside(modelPath, LLM_MODELS) || !fs.existsSync(modelPath)) {
    throw new Error("Select a downloaded GGUF text model first.");
  }
  if (!filename.toLowerCase().endsWith(".gguf")) {
    throw new Error("Text generation requires a .gguf model.");
  }

  const candidates = getLlmBackendCandidates();
  if (candidates.length === 0) {
    throw new Error("llama.cpp is not installed. Run the platform setup script to install the text backend.");
  }
  const persistedSettings = getLlmModelSettings(filename);
  const preferredBackend = String(settings.preferredBackend || persistedSettings.preferredBackend || "").toLowerCase();
  const sortedCandidates = preferredBackend
    ? [...candidates].sort((a, b) => {
        if (a.key === preferredBackend && b.key !== preferredBackend) return -1;
        if (b.key === preferredBackend && a.key !== preferredBackend) return 1;
        return 0;
      })
    : candidates;

  const failures = [];
  for (const backend of sortedCandidates) {
    for (const profile of buildLlmLoadProfiles(settings, backend)) {
      try {
        await startLlmWithBackend({ ...settings, __loadProfile: profile }, backend);
        llmSettings.backendFallbacks = failures;
        updateLlmModelSettings(filename, {
          preferredBackend: backend.key,
          lastBackendMode: llmSettings.backendMode,
          lastBackendBinary: llmSettings.backendBinary,
          lastSettings: {
            threads: llmSettings.threads,
            contextSize: llmSettings.contextSize,
            gpuLayers: llmSettings.gpuLayers,
            cacheTypeK: llmSettings.cacheTypeK,
            cacheTypeV: llmSettings.cacheTypeV,
            batchSize: llmSettings.batchSize,
            ubatchSize: llmSettings.ubatchSize,
            flashAttn: llmSettings.flashAttn,
          },
        });
        return;
      } catch (err) {
        const message = err.message || String(err);
        failures.push({
          backend: backend.mode,
          binary: path.basename(backend.path),
          profile: profile.name,
          error: message.slice(-1200),
        });
        console.warn(`  [llm] Load failed on ${backend.mode} (${profile.name}): ${message}`);
        await killLlm();
      }
    }
  }

  const last = failures[failures.length - 1];
  llmSettings.backendFallbacks = failures;
  throw new Error(`Text model failed on all available llama.cpp backends. Last failure: ${last?.error || "unknown error"}`);
}

async function startLlmWithBackend(settings = {}, backend) {
  const filename = path.basename(String(settings.model || ""));
  const modelPath = path.join(LLM_MODELS, filename);
  if (!filename || !pathInside(modelPath, LLM_MODELS) || !fs.existsSync(modelPath)) {
    throw new Error("Select a downloaded GGUF text model first.");
  }
  if (!filename.toLowerCase().endsWith(".gguf")) {
    throw new Error("Text generation requires a .gguf model.");
  }

  if (!backend) {
    throw new Error("llama.cpp is not installed. Run the platform setup script to install the text backend.");
  }

  assertNoOtherActiveRuntime("text", filename, settings);
  await killBackend();
  await killOpenVinoWorker();
  await killLlm();
  PORT_LLM = await findAvailableLlmPort();
  llmError = null;

  const loadProfile = settings.__loadProfile || {};
  let contextSize = Number(loadProfile.contextSize ?? settings.contextSize);
  if (!contextSize || contextSize <= 0) {
    const isGpu = backend.mode.includes("GPU") || backend.mode.includes("CUDA") || backend.mode.includes("Vulkan") || backend.mode.includes("Metal") || backend.mode.startsWith("Auto");
    contextSize = chooseAutoContext(filename, isGpu);
    console.log(`  [llm] Auto-selected context size: ${contextSize} tokens based on memory limits.`);
  } else {
    contextSize = Math.max(512, Math.min(32768, contextSize));
  }

  const isSyclBackend = backend.mode.includes("SYCL") || path.basename(path.dirname(backend.path)).toLowerCase() === "sycl";
  const requestedGpuLayers = Number.isFinite(Number(loadProfile.gpuLayers ?? settings.gpuLayers)) ? Number(loadProfile.gpuLayers ?? settings.gpuLayers) : -1;
  const effectiveGpuLayers = isSyclBackend ? getStableSyclGpuLayers(filename, requestedGpuLayers) : requestedGpuLayers;
  const effectiveFlashAttn = isSyclBackend ? false : (loadProfile.flashAttn ?? (settings.flashAttn !== false));
  const effectiveCacheTypeK = isSyclBackend ? "q4_0" : loadProfile.cacheTypeK || settings.cacheTypeK || llmSettings.cacheTypeK || "q8_0";
  const effectiveCacheTypeV = isSyclBackend ? "q4_0" : loadProfile.cacheTypeV || settings.cacheTypeV || llmSettings.cacheTypeV || "q8_0";
  const effectiveBatchSize = isSyclBackend ? Math.min(256, Number(loadProfile.batchSize ?? settings.batchSize) || llmSettings.batchSize || 512) : Number(loadProfile.batchSize ?? settings.batchSize) || llmSettings.batchSize || 512;
  const effectiveUbatchSize = isSyclBackend ? Math.min(256, Number(loadProfile.ubatchSize ?? settings.ubatchSize) || llmSettings.ubatchSize || 512) : Number(loadProfile.ubatchSize ?? settings.ubatchSize) || llmSettings.ubatchSize || 512;
  const effectiveEnableThinking = isSyclBackend && effectiveGpuLayers === 0 ? false : (loadProfile.enableThinking ?? (settings.enableThinking === true));

  llmSettings = {
    ...llmSettings,
    model: filename,
    threads: Math.max(1, Math.min(64, Number(settings.threads) || llmSettings.threads)),
    contextSize: contextSize,
    gpuLayers: effectiveGpuLayers,
    requestedGpuLayers,
    backendMode: backend.mode,
    backendBinary: path.basename(backend.path),
    loadProfile: loadProfile.name || "requested",
    enableThinking: effectiveEnableThinking,
    supportsThinking: /deepseek|qwen3|gemma-4|gemma4|think|r1|e2b|reasoning/i.test(filename),
    // New performance settings
    flashAttn: effectiveFlashAttn,
    cacheTypeK: effectiveCacheTypeK,
    cacheTypeV: effectiveCacheTypeV,
    mlock: settings.mlock || llmSettings.mlock || false,
    mmap: settings.mmap !== false && llmSettings.mmap !== false,
    cachePrompt: settings.cachePrompt !== false && llmSettings.cachePrompt !== false,
    defragThold: Number(settings.defragThold) || llmSettings.defragThold || 0.1,
    batchSize: Math.max(128, Math.min(2048, effectiveBatchSize)),
    ubatchSize: Math.max(128, Math.min(2048, effectiveUbatchSize)),
    performanceProfile: settings.performanceProfile || llmSettings.performanceProfile || "balanced",
  };

  let mmprojPath = null;
  const lowerFilename = filename.toLowerCase();
  const isMultimodal = isVisionModelFilename(lowerFilename);

  if (isMultimodal) {
    if (settings.mmproj) {
      const customProjPath = path.join(LLM_MODELS, path.basename(settings.mmproj));
      if (fs.existsSync(customProjPath)) {
        mmprojPath = customProjPath;
      }
    }
    if (!mmprojPath) {
      try {
        const files = fs.readdirSync(LLM_MODELS);
        let bestMatch = null;
        
        // 1. Match by Hugging Face repository prefix (e.g., "unsloth--gemma-4-E2B-it-qat-GGUF--")
        if (filename.includes("--")) {
          const lastIndex = filename.lastIndexOf("--");
          const repoPrefix = filename.substring(0, lastIndex + 2);
          bestMatch = files.find(file => {
            const lower = file.toLowerCase();
            return file.startsWith(repoPrefix) && lower.includes("mmproj") && lower.endsWith(".gguf");
          });
        }
        
        // 2. Match by model family keyword (e.g. matching model containing "gemma-4" with projector containing "gemma-4")
        if (!bestMatch) {
          const keywords = ["gemma-4", "gemma4", "llava", "qwen2vl", "qwen2-vl", "paligemma", "minicpm", "internvl", "phi-3", "phi3", "smolvlm", "moondream"];
          const matchedKeyword = keywords.find(kw => lowerFilename.includes(kw));
          if (matchedKeyword) {
            bestMatch = files.find(file => {
              const lower = file.toLowerCase();
              return lower.endsWith(".gguf") && lower.includes("mmproj") && lower.includes(matchedKeyword);
            });
          }
        }
        
        // 3. General fallback
        if (!bestMatch) {
          bestMatch = files.find(file => {
            const lower = file.toLowerCase();
            return lower.endsWith(".gguf") && (lower === "mmproj-model-f16.gguf" || lower.includes("mmproj"));
          });
        }
        
        if (bestMatch) {
          mmprojPath = path.join(LLM_MODELS, bestMatch);
        }
      } catch (_) {}
    }
  }

  const args = [
    "--model", modelPath,
    "--host", "127.0.0.1",
    "--port", String(PORT_LLM),
    "-lv", "1",
    "--ctx-size", String(llmSettings.contextSize),
    "--threads", String(llmSettings.threads),
    "--n-gpu-layers", String(llmSettings.gpuLayers),
    "--parallel", "1",
    "--cache-type-k", String(llmSettings.cacheTypeK),   //  KV cache quantization K
    "--cache-type-v", String(llmSettings.cacheTypeV),   //  KV cache quantization V
    "--cache-prompt",                        //  Prompt caching for multi-turn (major UX win)
    "--ctx-checkpoints", "8",                //  Context shifting recovery
    "--poll", "30",                          //  More aggressive polling
    "--metrics",                             //  Metrics endpoint for tuning
    "--batch-size", String(llmSettings.batchSize),       //  Prompt processing batch
    "--ubatch-size", String(llmSettings.ubatchSize),     //  Micro-batch size
  ];
  if (llmSettings.flashAttn) {
    args.push("--flash-attn", "on");
  }
  if (isSyclBackend) {
    args.push("--no-warmup");
  }
  
  // CPU mode: lock memory to prevent OS paging (critical for consistent speed)
  const isGpuMode = backend.mode.includes("GPU") || backend.mode.includes("CUDA") ||
                    backend.mode.includes("HIP") || backend.mode.includes("ROCm") ||
                    backend.mode.includes("Vulkan") || backend.mode.includes("Metal") ||
                    backend.mode.includes("SYCL");
  if (!isGpuMode && llmSettings.mlock) {
    args.push("--mlock");                    //  Prevent OS swapping on CPU
  }
  
  // All modes: memory-mapped loading for faster startup
  if (llmSettings.mmap) {
    args.push("--mmap");                     //  Faster model loading
  }
  
  if (llmSettings.enableThinking === false) {
    args.push("--reasoning", "off");           //  Disable reasoning/thinking completely
  } else if (llmSettings.supportsThinking) {
    args.push("--reasoning", "on");            //  Enable reasoning for supported models
  }
  if (llmSettings.enableThinking === true && llmSettings.supportsThinking) {
    args.push("--reasoning-format", "deepseek"); //  Extract thoughts into reasoning_content
  }
  if (mmprojPath) {
    args.push("--mmproj", mmprojPath);
  }
  llmSettings.supportsVision = Boolean(mmprojPath);
  llmSettings.mmproj = mmprojPath ? path.basename(mmprojPath) : null;
  llmSettings.visionMode = mmprojPath ? "mmproj" : "none";
  llmSettings.visionStatus = mmprojPath
    ? `Using projector ${path.basename(mmprojPath)}`
    : (isMultimodal ? "Matching mmproj projector not found" : "Model is text-only");
  const spawnEnv = { ...process.env };
  const backendDir = path.dirname(backend.path);
  
  // Platform library paths
  if (osPlatform === "linux") {
    spawnEnv.LD_LIBRARY_PATH = backendDir + (spawnEnv.LD_LIBRARY_PATH ? `:${spawnEnv.LD_LIBRARY_PATH}` : "");
  } else if (osPlatform === "darwin") {
    spawnEnv.DYLD_LIBRARY_PATH = backendDir + (spawnEnv.DYLD_LIBRARY_PATH ? `:${spawnEnv.DYLD_LIBRARY_PATH}` : "");
  }
  
  // CUDA-specific optimizations
  if (backend.mode.includes("CUDA")) {
    // Multi-GPU: increase command buffer size (reduces CPU stalls)
    spawnEnv.CUDA_SCALE_LAUNCH_QUEUES = spawnEnv.CUDA_SCALE_LAUNCH_QUEUES || "4x";
    
    // Linux: allow swapping to system RAM when VRAM exhausted
    if (osPlatform === "linux") {
      spawnEnv.GGML_CUDA_ENABLE_UNIFIED_MEMORY = spawnEnv.GGML_CUDA_ENABLE_UNIFIED_MEMORY || "1";
    }
  }
  
  // SYCL-specific optimizations (Intel Arc/Graphics)
  if (backend.mode.includes("SYCL")) {
    spawnEnv.ZES_ENABLE_SYSMAN = "1";
  }

  console.log("  [llm] Baslatiliyor:", backend.path, args.join(" "));
  const proc = spawn(backend.path, args, { stdio: "pipe", env: spawnEnv });
  const procSeq = ++llmProcSeq;
  llmProc = proc;
  proc.stdout.on("data", (data) => {
    if (llmProc !== proc) return;
    process.stdout.write("  [llm] " + data.toString());
  });
  proc.stderr.on("data", (data) => {
    if (llmProc !== proc) return;
    const output = data.toString();
    process.stderr.write("  [llm-err] " + output);
    if (/Vulkan\d+\s*:/i.test(output)) llmSettings.backendMode = "Vulkan GPU";
    else if (/CUDA\d+\s*:/i.test(output)) llmSettings.backendMode = "CUDA GPU";
    else if (/(HIP|ROCm)\d*\s*:/i.test(output)) llmSettings.backendMode = "ROCm GPU";
    else if (/SYCL\d+\s*:/i.test(output)) llmSettings.backendMode = "SYCL GPU";
    else if (/Metal/i.test(output) && /GPU|device/i.test(output)) llmSettings.backendMode = "Metal GPU";
    else if (/\-\s+CPU\s+:/i.test(output) && llmSettings.backendMode.startsWith("Auto")) llmSettings.backendMode = "CPU";
    if (/error|failed/i.test(output) && !/no error/i.test(output)) {
      llmError = output.trim().slice(-1200);
    }
  });
  proc.on("exit", (code) => {
    if (llmProc !== proc) {
      console.log("  [llm] stale process ile cikti kodu", code);
      return;
    }
    llmReady = false;
    llmProc = null;
    if (code !== 0 && code !== null && !llmError) llmError = `llama.cpp ${describeBackendExitCode(code, backend.path)}`;
    console.log("  [llm] ile cikti kodu", code, `(process ${procSeq})`);
  });

  await waitForLlmReady(backend.key === "cpu" ? 720 : 360, proc, filename);
}

async function startBackend(settings = {}) {
  const requestedSettings = { ...currentSettings, ...settings };
  if (!requestedSettings.model) requestedSettings.model = getDefaultModel();
  assertNoOtherActiveRuntime("image", requestedSettings.model, settings);

  await killLlm();
  if (settings.backendType === "openvino-npu") {
    await startOpenVinoWorker(settings);
    return;
  }
  await killOpenVinoWorker();
  backendError = null;
  currentSettings = requestedSettings;
  if (!currentSettings.model) {
    console.log("  [backend] app/models/ icinde model bulunamadi - arka uc baslatilmadi");
    return;
  }

  const modelLoadIssue = getModelLoadIssue(currentSettings.model);
  if (modelLoadIssue) {
    backendError = modelLoadIssue;
    backendLoadState = {
      active: false,
      phase: "Model load blocked",
      progress: 0,
      current: 0,
      total: 0,
      speed: "",
      model: path.basename(currentSettings.model),
      backendMode: "",
      backendBinary: "",
      device: "",
    };
    throw new Error(modelLoadIssue);
  }

  PORT_BACKEND = Number(settings.backendPort) > 0 ? Number(settings.backendPort) : await findAvailableBackendPort();

  const resolvedBackendType = resolveBackendType(currentSettings.useGpu, currentSettings.backendType, currentSettings.model);
  currentSettings.backendType = resolvedBackendType;
  currentSettings.useGpu = resolvedBackendType !== "cpu";
  const backendPath = selectBackendPath(currentSettings.useGpu, currentSettings.backendType, currentSettings.model);
  if (!backendPath) {
    const setupHint = resolvedBackendType === "apple-npu"
      ? "CoreML Python environment is not set up. Run scripts/setup/setup-coreml-npu.sh first."
      : resolvedBackendType === "cpu" && osPlatform === "win32"
        ? "Windows CPU backend is not installed. Run scripts/setup.ps1 again so app/backend/win/cpu is created."
        : "No compatible backend executable was found.";
    throw new Error(setupHint);
  }
  const backendMode = getBackendMode(backendPath, currentSettings.useGpu, currentSettings.backendType);
  currentSettings.backendMode = backendMode;
  currentSettings.backendBinary = path.basename(backendPath);

  backendLoadState = {
    active: true,
    phase: "Starting backend...",
    progress: 0,
    current: 0,
    total: 0,
    speed: "",
    model: path.basename(currentSettings.model),
    backendMode,
    backendBinary: path.basename(backendPath),
    device: "",
  };

  let runThreads = parseInt(currentSettings.threads) || 4;
  if (currentSettings.useGpu) {
    runThreads = Math.min(4, runThreads);
  }

  let args = [];
  const requestedBackend = resolveBackendType(currentSettings.useGpu, currentSettings.backendType, currentSettings.model);
  const selectedVulkanBackend = requestedBackend === "vulkan" ? getPreferredVulkanBackendName() : "";

  const supportsFlags = backendSupportsFlags[backendPath] !== false;

  if (requestedBackend === "apple-npu") {
    args = [
      path.join(ROOT, "scripts", "workers", "coreml_server.py"),
      "--listen-port", String(PORT_BACKEND),
      "--model",       currentSettings.model,
      "--steps",       String(currentSettings.steps),
      "--cfg-scale",   String(currentSettings.cfgScale),
    ];
  } else {
    currentSettings.sampler = normalizeSdSampler(currentSettings.sampler);
    args = [
      "--listen-port", String(PORT_BACKEND),
      "--model",       currentSettings.model,
      "--steps",       String(currentSettings.steps),
      "--cfg-scale",   String(currentSettings.cfgScale),
      "--sampling-method", currentSettings.sampler,
      "--threads",     String(runThreads),
    ];

    if (requestedBackend === "cpu") {
      if (supportsFlags) {
        args.push("--backend", "cpu", "--params-backend", "cpu");
      }
      args.push("--rng", "cpu", "--sampler-rng", "cpu");
  } else if (requestedBackend === "vulkan") {
    if (supportsFlags) {
      args.push("--backend", selectedVulkanBackend, "--params-backend", selectedVulkanBackend);
    }
    args.push("--rng", "cpu", "--sampler-rng", "cpu");
  } else if (requestedBackend === "cuda") {
    if (supportsFlags) {
      args.push("--backend", "cuda0", "--params-backend", "cuda0");
    }
    args.push("--rng", "cuda", "--sampler-rng", "cuda");
  } else if (requestedBackend === "rocm") {
    if (supportsFlags) {
      args.push("--backend", "rocm0", "--params-backend", "rocm0");
    }
    args.push("--rng", "cpu", "--sampler-rng", "cpu");
  } else if (requestedBackend === "metal") {
    args.push("--rng", "cpu", "--sampler-rng", "cpu");
  }

  }

  if (requestedBackend === "vulkan" && selectedVulkanBackend) {
    currentSettings.backendDevice = selectedVulkanBackend;
    backendLoadState.device = selectedVulkanBackend;
  }

  if (requestedBackend !== "apple-npu") {
    if (currentSettings.vaeTiling) {
      args.push("--vae-tiling");
    }
    if (currentSettings.vaeOnCpu) {
      args.push("--vae-on-cpu");
    }
    if (currentSettings.flashAttn) {
      if (requestedBackend === "cuda") {
        args.push("--diffusion-fa");
      } else {
        args.push("--fa");
      }
    }
  }

  // Build environment for Linux backends so bundled .so libraries are found.
  // Official Linux releases ship libstable-diffusion.so next to the executable.
  const spawnEnv = { ...process.env };
  if (osPlatform === "linux") {
    const extraLibs = [];
    if (requestedBackend === "rocm") {
      extraLibs.push(path.dirname(BACKEND_PATHS.linuxRocm));
    } else if (requestedBackend === "vulkan") {
      extraLibs.push(path.dirname(BACKEND_PATHS.linuxVulkan));
    } else if (requestedBackend === "cpu") {
      extraLibs.push(path.dirname(BACKEND_PATHS.linuxCpu));
    } else if (requestedBackend === "cuda") {
      extraLibs.push(path.dirname(BACKEND_PATHS.linuxCuda));
    }
    if (extraLibs.length > 0) {
      const existing = spawnEnv.LD_LIBRARY_PATH || "";
      spawnEnv.LD_LIBRARY_PATH = extraLibs.join(":") + (existing ? ":" + existing : "");
    }
  } else if (osPlatform === "darwin" && requestedBackend !== "apple-npu") {
    const existing = spawnEnv.DYLD_LIBRARY_PATH || "";
    const backendDir = path.dirname(BACKEND_PATHS.mac);
    spawnEnv.DYLD_LIBRARY_PATH = backendDir + (existing ? ":" + existing : "");
  }

  console.log("  [backend] Baslatiliyor:", path.basename(backendPath), args.join(" "));
  backendReady = false;

  const procSeq = ++backendProcSeq;
  const proc = spawn(backendPath, args, { stdio: "pipe", env: spawnEnv });
  backendProc = proc;
  startBackendReadyPoll();
  const coremlLoadHeartbeat = startCoreMLLoadHeartbeat(proc);

  proc.stdout.on("data", d => {
    const output = d.toString();
    process.stdout.write("  [sd] " + output);
    updateCoreMLLoadProgress(output);
    const cleanOutput = stripAnsi(output);
    if (cleanOutput.includes("listening on")) {
      markBackendReady();
    }
    
    const lines = output.split(/[\r\n]+/);
    for (const line of lines) {
      const cleanLine = stripAnsi(line);
      if (!cleanLine.trim()) continue;
      
      if (cleanLine.includes("listening on")) {
        markBackendReady();
      }

      if (cleanLine.includes("loading model from")) {
        backendLoadState.active = true;
        backendLoadState.phase = "Loading model weights...";
        backendLoadState.progress = Math.max(backendLoadState.progress, 1);
      }

      if (cleanLine.includes("model files processing completed")) {
        backendLoadState.active = true;
        backendLoadState.phase = "Initializing model...";
        backendLoadState.progress = Math.max(backendLoadState.progress, 95);
      }

      const loadMatch = cleanLine.match(/\|\s*(\d+)\/(\d+)\s*-\s*([^|]+)$/);
      if (loadMatch && !cleanLine.includes("it/s") && !cleanLine.includes("s/it")) {
        const current = parseInt(loadMatch[1], 10);
        const total = parseInt(loadMatch[2], 10);
        const progress = total > 0 ? Math.round((current / total) * 100) : 0;
        const isCoreML = currentSettings.backendType === "apple-npu" || total <= 10;
        const phaseDesc = isCoreML ? stripAnsi(loadMatch[3]).trim() : "Loading model weights...";
        const speedDesc = isCoreML ? "" : stripAnsi(loadMatch[3]).trim();
        backendLoadState = {
          ...backendLoadState,
          active: !backendReady,
          phase: phaseDesc,
          progress: Math.max(backendLoadState.progress, Math.min(99, progress)),
          current,
          total,
          speed: speedDesc,
        };
      }
      
      if (cleanLine.includes("generate_image") || cleanLine.includes("generating image")) {
        generationState.active = true;
        generationState.step = 0;
        generationState.steps = 0;
        generationState.speed = "";
        generationState.decoding = false;
      }
      
      if (cleanLine.includes("decoding") && generationState.active) {
        generationState.decoding = true;
      }
      
      const match = cleanLine.match(/\|\s*[^|]*\s*\|\s*(\d+)\/(\d+)\s*-\s*([\d.]+\s*(?:it\/s|s\/it))/);
      if (match) {
        generationState.active = true;
        if (!generationState.decoding) {
          generationState.step = parseInt(match[1], 10);
          generationState.steps = parseInt(match[2], 10);
          generationState.speed = match[3].trim();
        }
      }
      
      if (cleanLine.includes("generate_image completed")) {
        generationState.active = false;
        generationState.step = 0;
        generationState.steps = 0;
        generationState.speed = "";
        generationState.decoding = false;
      }
    }
  });

  proc.stderr.on("data", d => {
    const output = d.toString();
    process.stderr.write("  [sd-err] " + output);
    updateCoreMLLoadProgress(output);
    const cleanOutput = stripAnsi(output);
    const runtimeLinkerError = describeLinuxRuntimeLinkerError(cleanOutput);
    if (runtimeLinkerError) {
      backendError = runtimeLinkerError;
      backendLoadState.phase = "Linux runtime is too old for this backend";
    }
    const deviceMatch = cleanOutput.match(/Device\s+\d+:\s*([^,\r\n]+)/);
    if (deviceMatch) {
      backendLoadState.device = deviceMatch[1].trim();
      currentSettings.backendDevice = backendLoadState.device;
    }
    const metalDeviceMatch = cleanOutput.match(/GPU name:\s*([^\r\n]+)/);
    if (metalDeviceMatch) {
      backendLoadState.device = metalDeviceMatch[1].trim();
      currentSettings.backendDevice = backendLoadState.device;
    }
    if (cleanOutput.includes("ggml_cuda_init")) {
      backendLoadState.backendMode = "CUDA GPU";
      currentSettings.backendMode = "CUDA GPU";
    }
    if (cleanOutput.includes("ggml_vulkan")) {
      backendLoadState.backendMode = "Vulkan GPU";
      currentSettings.backendMode = "Vulkan GPU";
    }
    if (cleanOutput.includes("ggml_hip") || cleanOutput.includes("ggml_rocm")) {
      backendLoadState.backendMode = "ROCm GPU";
      currentSettings.backendMode = "ROCm GPU";
    }
    if (cleanOutput.includes("ggml_metal")) {
      backendLoadState.backendMode = "Metal GPU";
      currentSettings.backendMode = "Metal GPU";
    }
    if (cleanOutput.includes("[ERROR]")) {
      const nextError = describeBackendError(cleanOutput.trim(), currentSettings.model);
      const hasSpecificFileError = String(backendError || "").includes("incomplete or corrupted");
      const isGenericContextError = cleanOutput.includes("new_sd_ctx_t failed");
      if (!(hasSpecificFileError && isGenericContextError)) {
        backendError = nextError;
      }
    }
  });
  proc.on("exit", (code, signal) => {
    if (coremlLoadHeartbeat) clearInterval(coremlLoadHeartbeat);
    if (backendProc !== proc) {
      console.log("  [backend] stale process ile cikti kodu", code, signal ? `(signal ${signal})` : "", `(process ${procSeq})`);
      return;
    }
    backendReady = false;
    backendProc  = null;
    console.log("  [backend] ile cikti kodu", code, signal ? `(signal ${signal})` : "", `(process ${procSeq})`);
    if (code !== null && code !== 0) {
      if (!backendError) {
        backendError = describeBackendExitCode(code, currentSettings.backendBinary || BACKEND_PATH);
      }
    }
    backendLoadState.active = false;
    generationState.active = false;
    generationState.step = 0;
    generationState.steps = 0;
    generationState.speed = "";
    generationState.decoding = false;

    // Force a VRAM poll to update free memory space
    setTimeout(() => pollNvidiaVram(true), 1000);
  });
}

// -- Model Downloader ---------------------------------------------------------
let downloadState = {
  active: false,
  filename: "",
  progress: 0,
  speed: "0 MB/s",
  eta: 0,
  totalBytes: 0,
  downloadedBytes: 0,
  error: null
};
let activeDownload = null;
let downloadQueue = [];
let nextQueueTimeout = null;

function scheduleNextQueuedDownload(delayMs = 1200) {
  if (nextQueueTimeout) clearTimeout(nextQueueTimeout);
  nextQueueTimeout = setTimeout(() => {
    nextQueueTimeout = null;
    processNextInQueue();
  }, delayMs);
}

function processNextInQueue() {
  if (downloadState.active) return;
  if (downloadQueue.length === 0) {
    if (defaultModelsQueue) {
      try {
        const tts = installDefaultTtsManifest();
        console.log("  [download-queue] Tum varsayilan modeller ve TTS tamamlandi.", tts?.ok ? "OK" : tts?.error);
      } catch (e) {
        console.error("  [download-queue] TTS manifest failed:", e);
      }
      defaultModelsQueue = null;
    }
    return;
  }

  const next = downloadQueue.shift();
  if (!next) return;

  console.log(`  [download-queue] Kuyruktan siradaki model baslatiliyor: ${next.filename || next.name} (kalan: ${downloadQueue.length})`);

  if (next.type === "backend") {
    startImageBackendDownload(next.backendId);
  } else if (next.type === "snapshot") {
    startSnapshotDownload(next.snapshotId);
  } else if (next.type === "openvino") {
    startOpenVinoModelDownload(next.modelId);
  } else {
    startModelDownload(next.url, next.filename, next.targetDir, next.kind);
  }
}

function enqueueModelDownload(options) {
  const { url, filename, targetDir = MODELS, kind = "image", name, type = "model", backendId, modelId, snapshotId } = options;
  const targetFilename = filename || (url ? path.basename(new URL(url).pathname) : "");

  // Check if this exact file is currently downloading
  if (downloadState.active && (downloadState.filename === targetFilename || (targetFilename && downloadState.filename && downloadState.filename.includes(targetFilename)))) {
    return {
      ok: true,
      active: true,
      queued: false,
      alreadyActive: true,
      filename: targetFilename,
      message: `"${targetFilename || name}" zaten su anda indiriliyor.`
    };
  }

  // Check if already in queue
  const existingIdx = downloadQueue.findIndex(item => 
    (targetFilename && item.filename === targetFilename) ||
    (url && item.url === url) ||
    (backendId && item.backendId === backendId) ||
    (snapshotId && item.snapshotId === snapshotId) ||
    (modelId && item.modelId === modelId)
  );

  if (existingIdx !== -1) {
    return {
      ok: true,
      active: false,
      queued: true,
      alreadyQueued: true,
      position: existingIdx + 1,
      filename: targetFilename,
      message: `"${targetFilename || name}" zaten indirme kuyrugunda (#${existingIdx + 1}. sirada).`
    };
  }

  const queueItem = {
    id: "dl_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
    type,
    url,
    filename: targetFilename,
    targetDir,
    kind,
    name: name || targetFilename,
    backendId,
    modelId,
    snapshotId,
    addedAt: Date.now()
  };

  if (!downloadState.active) {
    // Start immediately
    if (type === "backend") {
      startImageBackendDownload(backendId);
    } else if (type === "snapshot") {
      startSnapshotDownload(snapshotId);
    } else if (type === "openvino") {
      startOpenVinoModelDownload(modelId);
    } else {
      startModelDownload(url, targetFilename, targetDir, kind);
    }
    downloadState.name = name || targetFilename;
    downloadState.displayName = name || targetFilename;
    return {
      ok: true,
      active: true,
      queued: false,
      position: 0,
      filename: targetFilename,
      name: name || targetFilename,
      displayName: name || targetFilename,
      message: `"${targetFilename || name}" indirmesi baslatildi.`
    };
  } else {
    // Add to queue
    downloadQueue.push(queueItem);
    console.log(`  [download-queue] Kuyruga eklendi: ${targetFilename || name} (#${downloadQueue.length}. sira)`);
    return {
      ok: true,
      active: false,
      queued: true,
      position: downloadQueue.length,
      filename: targetFilename,
      message: `"${targetFilename || name}" indirme kuyruguna eklendi (#${downloadQueue.length}. sirada).`
    };
  }
}

function startOpenVinoModelDownload(modelId) {
  if (downloadState.active) return;
  const npuInfo = getOpenVinoNpuInfo();
  if (!npuInfo.supported) throw new Error(npuInfo.reason || "OpenVINO NPU runtime is not available.");
  const model = OPENVINO_NPU_MODELS.find((item) => item.id === modelId);
  if (!model) throw new Error("Unknown OpenVINO model.");

  const destDir = path.join(OPENVINO_MODELS, model.folder);
  fs.mkdirSync(destDir, { recursive: true });
  downloadState = {
    active: true,
    filename: model.name,
    progress: -1,
    speed: "Downloading snapshot",
    eta: 0,
    totalBytes: 0,
    downloadedBytes: 0,
    error: null,
  };

  const script = [
    "from huggingface_hub import snapshot_download",
    `snapshot_download(repo_id=${JSON.stringify(model.repo)}, local_dir=${JSON.stringify(destDir)}, ignore_patterns=['safety_checker/*','feature_extractor/*','*.safetensors'])`,
    "print('DONE')",
  ].join("\n");
  console.log(`  [openvino-download] Downloading ${model.repo} -> ${destDir}`);
  const proc = spawn(npuInfo.python, ["-c", script], { stdio: "pipe" });
  activeDownload = { process: proc, destPath: destDir, openvino: true };
  proc.stdout.on("data", (data) => process.stdout.write("  [openvino-download] " + data.toString()));
  proc.stderr.on("data", (data) => process.stderr.write("  [openvino-download] " + data.toString()));
  proc.on("exit", (code) => {
    activeDownload = null;
    if (String(downloadState.error || "").toLowerCase().includes("cancelled")) {
      return;
    }
    downloadState.active = false;
    if (code === 0) {
      downloadState.progress = 100;
      downloadState.downloadedBytes = getPathSize(destDir);
      downloadState.totalBytes = downloadState.downloadedBytes;
      downloadState.speed = "Complete";
      cachedBackendOptions = null;
    } else {
      downloadState.error = `OpenVINO model download failed with code ${code}`;
    }
    scheduleNextQueuedDownload(1200);
  });
}

const IMAGE_BACKEND_DOWNLOADS = {
  "cpu": {
    id: "cpu",
    label: "CPU",
    url: "https://github.com/leejet/stable-diffusion.cpp/releases/download/master-721-8caa3f9/sd-master-8caa3f9-bin-win-avx2-x64.zip",
    destDir: path.join(ROOT, "app", "backend", "win", "cpu"),
    exeName: "sd-cpu.exe",
    requiredDll: "stable-diffusion.dll",
  },
  "vulkan": {
    id: "vulkan",
    label: "Vulkan GPU",
    url: "https://github.com/leejet/stable-diffusion.cpp/releases/download/master-669-2d40a8b/sd-master-2d40a8b-bin-win-vulkan-x64.zip",
    destDir: path.join(ROOT, "app", "backend", "win", "vulkan"),
    exeName: "sd-vulkan.exe",
    requiredDll: "stable-diffusion.dll",
  },
  "cuda": {
    id: "cuda",
    label: "CUDA GPU",
    url: "https://github.com/leejet/stable-diffusion.cpp/releases/download/master-721-8caa3f9/sd-master-8caa3f9-bin-win-cuda12-x64.zip",
    destDir: path.join(ROOT, "app", "backend", "win", "cuda"),
    exeName: "sd-cuda.exe",
    requiredDll: "stable-diffusion.dll",
  },
};

function listFilesRecursive(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function installImageBackendArchive(zipPath, backend) {
  const tempDir = path.join(TOOLS, `image-backend-${backend.id}-extract-${Date.now()}`);
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(tempDir, { recursive: true });
    fs.mkdirSync(backend.destDir, { recursive: true });

    const tar = spawnSync("tar.exe", ["-xf", zipPath, "-C", tempDir], { encoding: "utf8" });
    if (tar.status !== 0) {
      throw new Error((tar.stderr || tar.stdout || "Could not extract backend archive.").trim());
    }

    const files = listFilesRecursive(tempDir);
    const exeSource = files.find((file) => ["sd-server.exe", "sd.exe"].includes(path.basename(file).toLowerCase()));
    const dllSource = files.find((file) => path.basename(file).toLowerCase() === backend.requiredDll.toLowerCase());
    if (!exeSource || !dllSource) {
      throw new Error("Backend archive did not contain the expected stable-diffusion executable and DLL.");
    }

    fs.copyFileSync(exeSource, path.join(backend.destDir, backend.exeName));
    fs.copyFileSync(dllSource, path.join(backend.destDir, backend.requiredDll));
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (ext !== ".dll" && ext !== ".exe") continue;
      if (file === exeSource) continue;
      fs.copyFileSync(file, path.join(backend.destDir, path.basename(file)));
    }

    if (!fs.existsSync(path.join(backend.destDir, backend.exeName)) || !fs.existsSync(path.join(backend.destDir, backend.requiredDll))) {
      throw new Error(`Backend install did not create ${backend.exeName} and ${backend.requiredDll}.`);
    }
    cachedBackendOptions = null;
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }
}

function startImageBackendDownload(backendId, redirectCount = 0, redirectUrl = "") {
  if (downloadState.active && redirectCount === 0) {
    throw new Error("Baska bir indirme zaten aktif.");
  }
  if (osPlatform !== "win32") {
    throw new Error("In-app backend downloads are currently available for Windows image backends.");
  }
  const backend = IMAGE_BACKEND_DOWNLOADS[String(backendId || "").toLowerCase()];
  if (!backend) {
    throw new Error("This backend cannot be installed from the app yet. Use the platform setup script.");
  }

  fs.mkdirSync(TOOLS, { recursive: true });
  const url = redirectUrl || backend.url;
  const filename = `${backend.id}-backend.zip`;
  const destPath = path.join(TOOLS, filename);
  const tempPath = `${destPath}.part`;
  if (redirectCount === 0) {
    try { fs.unlinkSync(tempPath); } catch (_) {}
    downloadState = {
      active: true,
      filename: backend.label,
      progress: 0,
      speed: "0 MB/s",
      eta: 0,
      totalBytes: 0,
      downloadedBytes: 0,
      error: null,
      kind: "backend",
      backendId: backend.id,
    };
  }

  console.log(`  [backend-download] Downloading ${backend.label} backend from ${url}`);
  let downloadFinalized = false;
  const fileStream = fs.createWriteStream(tempPath);
  const failDownload = (message, err = null) => {
    if (downloadFinalized) return;
    downloadFinalized = true;
    downloadState.active = false;
    downloadState.error = message;
    if (err) console.error("  [backend-download]", message, err);
    else console.error("  [backend-download] Failed:", message);
    try { fileStream.close(); } catch (_) {}
    try { fs.unlinkSync(tempPath); } catch (_) {}
    activeDownload = null;
    scheduleNextQueuedDownload(2000);
  };

  fileStream.on("error", (err) => failDownload(`Could not write ${filename}: ${err.message}`, err));
  const client = url.startsWith("https") ? https : http;
  const request = client.get(url, {
    headers: {
      "User-Agent": "Sansursuz-Lokal-AI-Studyosu-DDYZ/1.0 (+https://www.youtube.com/@derinedaliyoruzyapayzeka)",
      "Accept": "application/zip, application/octet-stream, */*",
    },
  }, (response) => {
    activeDownload = { request, fileStream, destPath, tempPath };
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      const nextUrl = response.headers.location ? new URL(response.headers.location, url).toString() : "";
      if (!nextUrl) return failDownload("Redirect response did not include a Location header.");
      if (redirectCount > 10) return failDownload("Too many redirects.");
      downloadState.speed = "Following redirect";
      request.removeAllListeners("error");
      request.destroy();
      response.resume();
      fileStream.close();
      try { fs.unlinkSync(tempPath); } catch (_) {}
      activeDownload = null;
      startImageBackendDownload(backend.id, redirectCount + 1, nextUrl);
      return;
    }
    if (response.statusCode !== 200) {
      return failDownload(describeDownloadHttpError(response.statusCode, url, response.headers).message);
    }

    const totalBytes = parseInt(response.headers["content-length"], 10) || 0;
    downloadState.totalBytes = totalBytes;
    let downloadedBytes = 0;
    let lastTime = Date.now();
    let lastDownloaded = 0;

    response.on("data", (chunk) => {
      downloadedBytes += chunk.length;
      downloadState.downloadedBytes = downloadedBytes;
      fileStream.write(chunk);
      const now = Date.now();
      const elapsed = (now - lastTime) / 1000;
      if (elapsed >= 0.5) {
        const chunkSpeed = (downloadedBytes - lastDownloaded) / elapsed;
        lastDownloaded = downloadedBytes;
        lastTime = now;
        downloadState.speed = `${(chunkSpeed / (1024 * 1024)).toFixed(1)} MB/s`;
        if (totalBytes > 0) {
          downloadState.progress = Math.round((downloadedBytes / totalBytes) * 100);
          downloadState.eta = Math.round((totalBytes - downloadedBytes) / Math.max(1, chunkSpeed));
        } else {
          downloadState.progress = -1;
          downloadState.eta = -1;
        }
      }
    });

    response.on("aborted", () => failDownload(`Download interrupted before ${backend.label} backend finished.`));
    response.on("error", (err) => failDownload(`Download stream failed before ${backend.label} backend finished.`, err));
    response.on("end", () => {
      if (downloadFinalized) return;
      if (totalBytes > 0 && downloadedBytes !== totalBytes) {
        failDownload(`Download incomplete for ${backend.label}: received ${formatBytes(downloadedBytes)} of ${formatBytes(totalBytes)}.`);
        return;
      }
      fileStream.end(() => {
        try {
          try { fs.unlinkSync(destPath); } catch (_) {}
          fs.renameSync(tempPath, destPath);
          downloadState.speed = "Installing";
          downloadState.progress = 95;
          installImageBackendArchive(destPath, backend);
          try { fs.unlinkSync(destPath); } catch (_) {}
          downloadFinalized = true;
          downloadState.active = false;
          downloadState.progress = 100;
          downloadState.downloadedBytes = downloadedBytes;
          downloadState.error = null;
          downloadState.speed = "Complete";
          activeDownload = null;
          console.log(`  [backend-download] Installed ${backend.label} backend`);
          scheduleNextQueuedDownload(1000);
        } catch (err) {
          failDownload(`Could not install ${backend.label} backend: ${err.message}`, err);
        }
      });
    });
  });

  request.on("error", (err) => failDownload(err.message, err));
  activeDownload = { request, fileStream, destPath, tempPath };
}

// -- Generation State (Real-time progress parser) -----------------------------
let generationState = {
  active: false,
  step: 0,
  steps: 0,
  speed: "",
  decoding: false,
  backendMode: "",
  backendDevice: "",
};

function resetGenerationState() {
  generationState = {
    active: false,
    step: 0,
    steps: 0,
    speed: "",
    decoding: false,
    backendMode: "",
    backendDevice: "",
  };
}

function describeDownloadHttpError(statusCode, url, headers = {}) {
  const host = (() => {
    try { return new URL(url).hostname; } catch (_) { return ""; }
  })();
  const isHuggingFace = host.includes("huggingface.co") || host.includes("hf.co");
  const hfErrorCode = headers["x-error-code"];
  const hfErrorMessage = headers["x-error-message"];

  let repoName = "";
  try {
    const p = new URL(url).pathname.split("/").filter(Boolean);
    if (p.length >= 2) repoName = `${p[0]}/${p[1]}`;
  } catch (_) {}

  const isGated = isHuggingFace && (hfErrorCode === "GatedRepo" || statusCode === 401 || statusCode === 403);

  if (isGated) {
    return {
      message: `HTTP 401: Hugging Face says this model is gated${repoName ? ` (${repoName})` : ""}. Open the model page in your browser, accept access/login, then use a Hugging Face token or download the file manually.`,
      isGated: true,
      repoName: repoName,
      pageUrl: repoName ? `https://huggingface.co/${repoName}` : url
    };
  }
  if (isHuggingFace && hfErrorMessage) {
    return {
      message: `HTTP ${statusCode}: Hugging Face rejected the download request: ${hfErrorMessage}`,
      isGated: false
    };
  }

  if (statusCode === 401 || statusCode === 403) {
    return {
      message: isHuggingFace
        ? `HTTP ${statusCode}: Hugging Face rejected the download request. If this model is public, retry after restarting the app; otherwise open the model page in your browser and accept any license/login requirement.`
        : `HTTP ${statusCode}: This download URL requires authorization or permission. Use a public direct download URL.`,
      isGated: isHuggingFace,
      repoName: repoName,
      pageUrl: repoName ? `https://huggingface.co/${repoName}` : url
    };
  }
  if (statusCode === 404) {
    return {
      message: `HTTP 404: Model file not found. Check that the URL points directly to a .safetensors, .gguf, or .ckpt file.`,
      isGated: false
    };
  }
  return {
    message: `HTTP ${statusCode}`,
    isGated: false
  };
}

function startModelDownload(url, overrideFilename = null, targetDir = MODELS, kind = "image", redirectCount = 0) {
  if (downloadState.active && redirectCount === 0) {
    console.log("  [download] Zaten bir model indiriliyor");
    return;
  }

  // Convert HuggingFace viewer URL (/blob/) to direct download URL (/resolve/)
  if (url.includes("huggingface.co") && url.includes("/blob/")) {
    url = url.replace("/blob/", "/resolve/");
  }

  let filename = overrideFilename;
  if (!filename) {
    filename = "model.gguf";
    try {
      const parsed = new URL(url);
      filename = path.basename(parsed.pathname);
    } catch (e) {
      console.error("Failed to parse URL filename:", e);
    }
  }

  const destPath = path.join(targetDir, filename);
  const tempPath = `${destPath}.part`;
  try { fs.unlinkSync(tempPath); } catch (_) {}
  downloadState = {
    active: true,
    filename: filename,
    name: overrideFilename || filename,
    displayName: overrideFilename || filename,
    progress: 0,
    speed: "0 MB/s",
    eta: 0,
    totalBytes: 0,
    downloadedBytes: 0,
    error: null,
    isGated: false,
    gatedRepo: "",
    gatedPageUrl: "",
    url: url,
    kind,
    defaultModels: Boolean(defaultModelsQueue),
  };

  if (redirectCount > 0) {
    console.log(`  [download] Yonlendirilen indirme surduruluyor ${filename}`);
  } else {
    console.log(`  [download] Indirme baslati ${filename} from ${url}`);
  }

  let downloadFinalized = false;
  const failDownload = (errorInfo, err = null) => {
    if (downloadFinalized) return;
    downloadFinalized = true;
    downloadState.active = false;
    const message = typeof errorInfo === "object" ? errorInfo.message : String(errorInfo);
    downloadState.error = message;
    if (typeof errorInfo === "object" && errorInfo.isGated) {
      downloadState.isGated = true;
      downloadState.gatedRepo = errorInfo.repoName || "";
      downloadState.gatedPageUrl = errorInfo.pageUrl || "";
    } else {
      downloadState.isGated = false;
      downloadState.gatedRepo = "";
      downloadState.gatedPageUrl = "";
    }
    if (err) {
      console.error("  [download]", message, err);
    } else {
      console.error("  [download] Failed:", message);
    }
    try { fileStream.close(); } catch (_) {}
    try { fs.unlinkSync(tempPath); } catch (_) {}
    activeDownload = null;
    scheduleNextQueuedDownload(2000);
  };

  const fileStream = fs.createWriteStream(tempPath);
  fileStream.on("error", (err) => {
    failDownload(`Could not write ${filename}: ${err.message}`, err);
  });
  
  const client = url.startsWith("https") ? https : http;
  let request;
  try {
    const host = (() => {
      try { return new URL(url).hostname.toLowerCase(); } catch (_) { return ""; }
    })();
    const isHfHost = host.includes("huggingface.co") || host.includes("hf.co");
    const hfToken = getHuggingFaceToken();

    const reqHeaders = {
      "User-Agent": "Sansursuz-Lokal-AI-Studyosu-DDYZ/1.0 (+https://www.youtube.com/@derinedaliyoruzyapayzeka)",
      "Accept": "application/octet-stream, application/x-safetensors, */*",
      "Referer": "https://huggingface.co/",
    };
    if (isHfHost && hfToken) {
      reqHeaders["Authorization"] = `Bearer ${hfToken}`;
    }

    request = client.get(url, {
      headers: reqHeaders,
    }, (response) => {
    activeDownload = { request, fileStream, destPath, tempPath };
    // Handle redirects (HuggingFace resolve URLs redirect to Cloudfront/S3)
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      const redirectUrl = response.headers.location ? new URL(response.headers.location, url).toString() : "";
      if (!redirectUrl) {
        failDownload("Redirect response did not include a Location header");
        return;
      }
      if (redirectCount > 10) {
        failDownload("Too many redirects");
        return;
      }
      console.log(`  [download] Yonlendirme izleniyor ${filename}`);
      downloadState.speed = "Following redirect";
      
      // Clean up redirected request to avoid triggering error handlers later
      request.removeAllListeners("error");
      request.destroy();
      response.resume();
      
      fileStream.close();
      try { fs.unlinkSync(tempPath); } catch (_) {}
      activeDownload = null;
      startModelDownload(redirectUrl, filename, targetDir, kind, redirectCount + 1);
      return;
    }

    if (response.statusCode !== 200) {
      failDownload(describeDownloadHttpError(response.statusCode, url, response.headers));
      return;
    }

    const totalBytes = parseInt(response.headers["content-length"], 10) || 0;
    downloadState.totalBytes = totalBytes;
    let downloadedBytes = 0;
    let startTime = Date.now();
    let lastTime = startTime;
    let lastDownloaded = 0;

    response.on("data", (chunk) => {
      downloadedBytes += chunk.length;
      downloadState.downloadedBytes = downloadedBytes;
      fileStream.write(chunk);

      const now = Date.now();
      const elapsed = (now - lastTime) / 1000;
      if (elapsed >= 0.5) {
        const chunkSpeed = (downloadedBytes - lastDownloaded) / elapsed; // bytes/sec
        lastDownloaded = downloadedBytes;
        lastTime = now;

        const speedMb = (chunkSpeed / (1024 * 1024)).toFixed(1);
        downloadState.speed = `${speedMb} MB/s`;

        if (totalBytes > 0) {
          downloadState.progress = Math.round((downloadedBytes / totalBytes) * 100);
          const remainingBytes = totalBytes - downloadedBytes;
          downloadState.eta = Math.round(remainingBytes / chunkSpeed);
        } else {
          downloadState.progress = -1; // Indeterminate
          downloadState.eta = -1;
        }
      }
    });

    response.on("aborted", () => {
      failDownload(`Download interrupted before ${filename} finished. Delete and retry the model download.`);
    });

    response.on("error", (err) => {
      failDownload(`Download stream failed before ${filename} finished. Delete and retry the model download.`, err);
    });

    response.on("end", () => {
      if (downloadFinalized) return;
      if (totalBytes > 0 && downloadedBytes !== totalBytes) {
        failDownload(`Download incomplete for ${filename}: received ${formatBytes(downloadedBytes)} of ${formatBytes(totalBytes)}. Delete and retry the model download.`);
        return;
      }

      fileStream.end(() => {
        try {
          if (totalBytes > 0) {
            const writtenBytes = fs.statSync(tempPath).size;
            if (writtenBytes !== totalBytes) {
              failDownload(`Download incomplete for ${filename}: wrote ${formatBytes(writtenBytes)} of ${formatBytes(totalBytes)}. Delete and retry the model download.`);
              return;
            }
          }
          try { fs.unlinkSync(destPath); } catch (_) {}
          fs.renameSync(tempPath, destPath);

          if (destPath.toLowerCase().endsWith(".zip")) {
            try {
              const destDir = path.dirname(destPath);
              if (osPlatform === "win32") {
                execSync(`tar -xf "${destPath}" -C "${destDir}"`, { stdio: "ignore" });
              } else {
                execSync(`unzip -o "${destPath}" -d "${destDir}"`, { stdio: "ignore" });
              }
              try { fs.unlinkSync(destPath); } catch (_) {}
              console.log(`  [download] ZIP arsivi acildi: ${path.basename(destPath)}`);
            } catch(err) {
              console.error("Failed to unzip", err);
            }
          }

          downloadState.active = false;
          downloadFinalized = true;
          downloadState.progress = 100;
          downloadState.downloadedBytes = downloadedBytes;
          downloadState.error = null;
          activeDownload = null;
          console.log(`  [download] Indirme tamamlandi ${filename}`);
          scheduleNextQueuedDownload(1000);
        } catch (err) {
          failDownload(`Could not finalize ${filename}: ${err.message}`);
        }
      });
    });
  });
  request.on("error", (err) => {
    failDownload(err.message, err);
  });
  activeDownload = { request, fileStream, destPath, tempPath };
} catch (err) {
  failDownload(`Could not initiate download for ${filename}: ${err.message}`, err);
}
}

// -- Multi-file Hugging Face repository download --------------------------------
// Diffusers pipelines (Wan, SVD, AudioLDM) and MusicGen need a whole folder, not one file.
// Files are listed through the HF tree API, filtered, and fetched one by one with real
// byte-level progress into <targetDir>/<folder>/.
const STABLE_AUDIO_FILES = [/^model\.safetensors$/i, /^model_config\.json$/i, /^(LICENSE|LICENSE_GEMMA)\.md$/i, /^NOTICE$/i, /^t5gemma-b-b-ul2\/(?!README\.md$|\.gitattributes$)/i];
const SNAPSHOT_MODELS = {
  "wan21-t2v-1.3b": { repoId: "Wan-AI/Wan2.1-T2V-1.3B-Diffusers", dir: VIDEO_MODELS, folder: "wan21-t2v-1.3b", include: [/\.json$/i, /\.txt$/i, /spiece\.model$/i, /\.safetensors$/i], label: "Wan 2.1 T2V 1.3B (Diffusers)" },
  "svd-xt-1.1": { repoId: "vdo/stable-video-diffusion-img2vid-xt-1-1", dir: VIDEO_MODELS, folder: "svd-xt-1.1", include: [/\.json$/i, /\.fp16\.safetensors$/i], label: "Stable Video Diffusion XT 1.1 (Diffusers fp16)" },
  "musicgen-small": { repoId: "facebook/musicgen-small", dir: MUSIC_MODELS, folder: "musicgen-small-local", include: [/\.json$/i, /spiece\.model$/i, /^model\.safetensors$/i], label: "MusicGen Small" },
  "audioldm2-large": { repoId: "cvssp/audioldm2-large", dir: MUSIC_MODELS, folder: "audioldm2-large", include: [/\.json$/i, /\.txt$/i, /\.model$/i, /\.safetensors$/i], label: "AudioLDM 2 Large" },
  "audioldm2": { repoId: "cvssp/audioldm2", dir: MUSIC_MODELS, folder: "audioldm2", include: [/\.json$/i, /\.txt$/i, /\.model$/i, /\.safetensors$/i], label: "AudioLDM 2" },
  "duyu-small": { repoId: "KaanAydinli/Duyu-small", dir: SPEECH_MODELS, folder: "duyu-small", include: [/^int8\//i, /^duyu_small\/.*\.py$/i, /^(config|engine)\.json$/i, /\.npz$/i, /^spm\.model$/i, /^LICENSE$/i], label: "Duyu-small (int8 ONNX)" },
  // Only the "accurate" preset (0.64 s streaming export + full-context second pass + LM), the formatter and the VAD.
  "seda-v0.2": { repoId: "atasoglu/seda-v0.2", dir: SPEECH_MODELS, folder: "seda-v0.2", include: [/^c32\//i, /^final\//i, /^lm\//i, /^formatter\//i, /^vad\//i, /^tokens\.txt$/i, /^README\.md$/i], label: "Seda-v0.2 (int8 ONNX)" },
  "omnivoice": { repoId: "k2-fsa/OmniVoice", dir: TTS_MODELS, folder: "omnivoice", include: [/\.json$/i, /\.jinja$/i, /\.safetensors$/i], label: "OmniVoice (k2-fsa)" },
  // Stable Audio 3 (gated: accept the license on the model page and add an HF token). The repos
  // bundle their T5Gemma text encoder; the thumbnail and READMEs are skipped.
  "stable-audio-3-small-music": { repoId: "stabilityai/stable-audio-3-small-music", dir: MUSIC_MODELS, folder: "stable-audio-3-small-music", include: STABLE_AUDIO_FILES, label: "Stable Audio 3 Small Music" },
  "stable-audio-3-small-sfx": { repoId: "stabilityai/stable-audio-3-small-sfx", dir: MUSIC_MODELS, folder: "stable-audio-3-small-sfx", include: STABLE_AUDIO_FILES, label: "Stable Audio 3 Small SFX" },
  "stable-audio-3-medium": { repoId: "stabilityai/stable-audio-3-medium", dir: MUSIC_MODELS, folder: "stable-audio-3-medium", include: STABLE_AUDIO_FILES, label: "Stable Audio 3 Medium" },
  "audioldm-small": { repoId: "cvssp/audioldm-s-full-v2", dir: MUSIC_MODELS, folder: "audioldm-s-full-v2", include: [/\.json$/i, /\.txt$/i, /\.safetensors$/i], label: "AudioLDM-S Full v2" },
};

function isSnapshotInstalled(snapshotId) {
  const spec = SNAPSHOT_MODELS[snapshotId];
  if (!spec) return false;
  const base = path.join(spec.dir, spec.folder);
  const marker = path.join(base, ".download-complete");
  if (fs.existsSync(marker)) return true;
  // Folders created by older versions / manual copies: accept a diffusers folder whose components are all present.
  return isDiffusersFolderComplete(base) || (snapshotId === "musicgen-small" && fs.existsSync(path.join(base, "model.safetensors")));
}

// model_index.json alone is not enough: an interrupted snapshot download leaves it behind while
// component folders (e.g. vae/, transformer weights) are missing, and diffusers then fails with
// "no file named config.json". Every listed component must have its config and, for weighted
// modules, all of its safetensors shards.
function isDiffusersFolderComplete(base) {
  let index;
  try { index = JSON.parse(fs.readFileSync(path.join(base, "model_index.json"), "utf8")); } catch (_) { return false; }
  for (const [name, value] of Object.entries(index)) {
    if (name.startsWith("_") || !Array.isArray(value) || value[0] == null) continue;
    const dir = path.join(base, name);
    let files;
    try { files = fs.readdirSync(dir); } catch (_) { return false; }
    if (name === "scheduler") {
      if (!files.includes("scheduler_config.json")) return false;
      continue;
    }
    if (/tokenizer|feature_extractor|processor/i.test(name)) {
      if (files.length === 0) return false;
      continue;
    }
    if (!files.includes("config.json")) return false;
    const shardIndex = files.find((file) => /\.safetensors\.index\.json$/i.test(file));
    if (shardIndex) {
      try {
        const shards = new Set(Object.values(JSON.parse(fs.readFileSync(path.join(dir, shardIndex), "utf8")).weight_map || {}));
        for (const shard of shards) if (!files.includes(shard)) return false;
      } catch (_) { return false; }
    } else if (!files.some((file) => /\.(safetensors|bin)$/i.test(file))) {
      return false;
    }
  }
  return true;
}

async function listHuggingFaceRepoFiles(repoId, include) {
  const headers = { "User-Agent": "Sansursuz-Lokal-AI-Studyosu-DDYZ/2.0" };
  const token = getHuggingFaceToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://huggingface.co/api/models/${repoId}/tree/main?recursive=true`, { headers });
  if (!res.ok) throw new Error(`Hugging Face dosya listesi alınamadı (${repoId}, HTTP ${res.status}).`);
  const tree = await res.json();
  return tree
    .filter((item) => item.type === "file" && include.some((rule) => rule.test(item.path)))
    .map((item) => ({ path: item.path, size: Number(item.lfs?.size || item.size || 0) }));
}

function startSnapshotDownload(snapshotId) {
  const spec = SNAPSHOT_MODELS[snapshotId];
  if (!spec) throw new Error(`Bilinmeyen model paketi: ${snapshotId}`);
  if (downloadState.active) return;
  const baseDir = path.join(spec.dir, spec.folder);
  const controller = new AbortController();
  downloadState = {
    active: true, filename: spec.folder, name: spec.label, displayName: spec.label,
    progress: 0, speed: "Dosya listesi alınıyor", eta: 0, totalBytes: 0, downloadedBytes: 0,
    error: null, isGated: false, gatedRepo: "", gatedPageUrl: "", kind: "snapshot", url: `https://huggingface.co/${spec.repoId}`,
    defaultModels: Boolean(defaultModelsQueue),
  };
  activeDownload = { abortController: controller, destPath: baseDir };

  (async () => {
    const files = await listHuggingFaceRepoFiles(spec.repoId, spec.include);
    if (files.length === 0) throw new Error(`${spec.repoId} deposunda indirilecek dosya bulunamadı.`);
    // model_index.json last, so an interrupted download never looks like an installed pipeline.
    files.sort((a, b) => (a.path === "model_index.json") - (b.path === "model_index.json"));
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    downloadState.totalBytes = totalBytes;
    let doneBytes = 0;
    let windowStart = Date.now();
    let windowBytes = 0;
    const headers = { "User-Agent": "Sansursuz-Lokal-AI-Studyosu-DDYZ/2.0" };
    const token = getHuggingFaceToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    for (const file of files) {
      const dest = path.join(baseDir, ...file.path.split("/"));
      if (!pathInside(dest, baseDir)) continue;
      if (fs.existsSync(dest) && file.size > 0 && fs.statSync(dest).size === file.size) {
        doneBytes += file.size;
        continue;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const url = `https://huggingface.co/${spec.repoId}/resolve/main/${file.path.split("/").map(encodeURIComponent).join("/")}`;
      const res = await fetch(url, { headers, signal: controller.signal });
      if (!res.ok || !res.body) {
        const info = describeDownloadHttpError(res.status, url, Object.fromEntries(res.headers.entries()));
        const err = new Error(info.message);
        err.downloadInfo = info;
        throw err;
      }
      const tmp = `${dest}.part`;
      const out = fs.createWriteStream(tmp);
      try {
        for await (const chunk of res.body) {
          if (!out.write(chunk)) await new Promise((resolve) => out.once("drain", resolve));
          doneBytes += chunk.length;
          windowBytes += chunk.length;
          const now = Date.now();
          if (now - windowStart >= 500) {
            const speed = windowBytes / ((now - windowStart) / 1000);
            downloadState.speed = `${(speed / (1024 * 1024)).toFixed(1)} MB/s`;
            downloadState.eta = Math.round(Math.max(0, totalBytes - doneBytes) / Math.max(1, speed));
            windowStart = now;
            windowBytes = 0;
          }
          downloadState.downloadedBytes = doneBytes;
          downloadState.progress = totalBytes > 0 ? Math.min(99, Math.round((doneBytes / totalBytes) * 100)) : -1;
        }
        await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
      } catch (err) {
        out.destroy();
        try { fs.unlinkSync(tmp); } catch (_) {}
        throw err;
      }
      try { fs.unlinkSync(dest); } catch (_) {}
      fs.renameSync(tmp, dest);
    }
    fs.writeFileSync(path.join(baseDir, ".download-complete"), new Date().toISOString(), "utf8");
  })().then(() => {
    downloadState.active = false;
    downloadState.progress = 100;
    downloadState.speed = "Complete";
    downloadState.error = null;
    activeDownload = null;
    console.log(`  [download] Model paketi tamamlandi: ${spec.repoId} -> ${baseDir}`);
    scheduleNextQueuedDownload(1000);
  }).catch((err) => {
    if (String(downloadState.error || "").toLowerCase().includes("cancel")) return;
    downloadState.active = false;
    downloadState.error = err.name === "AbortError" ? "Download cancelled" : (err.message || String(err));
    if (err.downloadInfo?.isGated) {
      downloadState.isGated = true;
      downloadState.gatedRepo = err.downloadInfo.repoName || spec.repoId;
      downloadState.gatedPageUrl = err.downloadInfo.pageUrl || `https://huggingface.co/${spec.repoId}`;
    }
    activeDownload = null;
    console.error(`  [download] Model paketi indirilemedi (${spec.repoId}):`, downloadState.error);
    scheduleNextQueuedDownload(2000);
  });
}

function cancelModelDownload(cancelAll = false) {
  if (cancelAll) {
    downloadQueue = [];
    defaultModelsQueue = null;
    if (nextQueueTimeout) {
      clearTimeout(nextQueueTimeout);
      nextQueueTimeout = null;
    }
  }
  if (!downloadState.active) {
    return false;
  }
  const filename = downloadState.filename;
  if (activeDownload) {
    if (activeDownload.abortController) {
      try { activeDownload.abortController.abort(); } catch (_) {}
    } else if (activeDownload.process) {
      try { activeDownload.process.kill("SIGTERM"); } catch (_) {}
      setTimeout(() => { try { activeDownload?.process?.kill("SIGKILL"); } catch (_) {} }, 1000);
    } else {
      try { activeDownload.request.destroy(new Error("Download cancelled by user")); } catch (_) {}
      try { activeDownload.fileStream.destroy(); } catch (_) {}
      try { fs.unlinkSync(activeDownload.tempPath || activeDownload.destPath); } catch (_) {}
    }
  } else if (filename) {
    const targetDir = downloadState.kind === "text"
      ? LLM_MODELS
      : downloadState.kind === "speech"
        ? SPEECH_MODELS
        : downloadState.kind === "tts"
          ? TTS_MODELS
          : downloadState.kind === "music"
            ? MUSIC_MODELS
            : downloadState.kind === "video"
              ? VIDEO_MODELS
              : MODELS;
    try { fs.unlinkSync(`${path.join(targetDir, filename)}.part`); } catch (_) {}
  }
  activeDownload = null;
  downloadState = {
    active: false,
    filename,
    progress: 0,
    speed: "0 MB/s",
    eta: 0,
    totalBytes: 0,
    downloadedBytes: 0,
    error: "Download cancelled",
    kind: downloadState.kind || "image",
  };
  console.log(`  [download] Indirme iptal edildi ${filename}`);
  if (!cancelAll && downloadQueue.length > 0) {
    console.log(`  [download] Aktif indirme iptal edildi, sıradaki model başlatılıyor...`);
    scheduleNextQueuedDownload(1500);
  }
  return true;
}

function isHfModelReady(repoFolder) {
  const hfHubCache = path.join(os.homedir(), ".cache", "huggingface", "hub");
  const snapDir = path.join(hfHubCache, repoFolder, "snapshots");
  if (!fs.existsSync(snapDir)) return false;
  try {
    // An interrupted download leaves *.incomplete blobs; loading would then silently re-download GBs.
    const blobsDir = path.join(hfHubCache, repoFolder, "blobs");
    if (fs.existsSync(blobsDir) && fs.readdirSync(blobsDir).some((f) => f.endsWith(".incomplete"))) return false;
    const snaps = fs.readdirSync(snapDir);
    for (const snap of snaps) {
      const snapPath = path.join(snapDir, snap);
      const indexPath = path.join(snapPath, "model_index.json");
      if (fs.existsSync(indexPath)) {
        const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
        const components = Object.keys(index).filter((key) => Array.isArray(index[key]) && index[key][0]);
        const complete = components.every((name) => {
          const dir = path.join(snapPath, name);
          if (!fs.existsSync(dir)) return false;
          const files = fs.readdirSync(dir);
          // Model components (config.json) need weights; tokenizers/schedulers only need their configs.
          return !files.includes("config.json") || files.some((f) => /\.(safetensors|bin)$/i.test(f));
        });
        if (complete) return true;
        continue;
      }
      const unetDir = path.join(snapPath, "unet");
      if (fs.existsSync(unetDir)) {
        const files = fs.readdirSync(unetDir);
        if (files.some(f => f.endsWith(".safetensors") || f.endsWith(".bin"))) {
          return true;
        }
      }
    }
  } catch (_) {}
  return false;
}

// -- Varsayilan model seti (her yetenek icin bir hafif model) -------------------
// Bunlar, gorsel uretimi, yerel metin sohbeti, konusma ve ses sentezi icin
// standart baslangic modelleridir. "Tum Varsayilan Modelleri Indir" ozelligi
// ile sirali olarak kendi klasorlerine indirilir.
// Bilgisayarin donanimina (tier) gore her kategoriden en uygun varsayilan modeli secer.
// tier degeri getHardwareSpecs() tarafindan hesaplanir (low / mid / high).
function getCompatibleModels() {
  const specs = getHardwareSpecs();
  const tier = specs.tier || "low";
  const vram = specs.gpu_vram_gb || 0;
  const ram = specs.ram_total_gb || 0;

  // Görsel: SD 1.5 her donanımda çalışır; 8 GB+ VRAM'de SDXL Lightning daha kalitelidir.
  const image = tier === "high"
    ? {
        kind: "image",
        name: "Juggernaut XL Lightning (SDXL, 4-8 adım)",
        filename: "Juggernaut_RunDiffusionPhoto2_Lightning_4Steps.safetensors",
        url: "https://huggingface.co/RunDiffusion/Juggernaut-XL-Lightning/resolve/main/Juggernaut_RunDiffusionPhoto2_Lightning_4Steps.safetensors",
        dir: MODELS,
        domainLabel: "Görsel Üretimi (Diffusion)",
        approxSize: "7.1 GB",
        reason: `${vram} GB VRAM için fotogerçekçi SDXL Lightning modeli: 1024x1024, 4-8 adım, CFG 1.5-2.`,
        installed: fs.existsSync(path.join(MODELS, "Juggernaut_RunDiffusionPhoto2_Lightning_4Steps.safetensors")),
      }
    : {
        kind: "image",
        name: "Stable Diffusion 1.5 (pruned EMA)",
        filename: "v1-5-pruned-emaonly.safetensors",
        url: "https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5/resolve/main/v1-5-pruned-emaonly.safetensors",
        dir: MODELS,
        domainLabel: "Görsel Üretimi (Diffusion)",
        approxSize: "4.3 GB",
        reason: "Düşük ve orta donanımda en uyumlu 512x512 görsel modeli (4 GB VRAM veya CPU).",
        installed: fs.existsSync(path.join(MODELS, "v1-5-pruned-emaonly.safetensors")),
      };

  const text = (tier === "high" || tier === "mid")
    ? {
        kind: "text",
        name: "Qwen 2.5 7B Instruct (Q4_K_M)",
        filename: "Qwen2.5-7B-Instruct-Q4_K_M.gguf",
        url: "https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf",
        dir: LLM_MODELS,
        domainLabel: "Metin & Sohbet (LLM)",
        approxSize: "4.7 GB",
        reason: `${vram > 0 ? `${vram} GB VRAM` : `${ram} GB RAM`} için 29+ dil destekli (Türkçe de kullanılabilir) 7B sohbet modeli (4-bit, 32K bağlam; YaRN ile 128K).`,
        installed: fs.existsSync(path.join(LLM_MODELS, "Qwen2.5-7B-Instruct-Q4_K_M.gguf")),
      }
    : {
        kind: "text",
        name: "Qwen 2.5 3B Instruct (Q4_K_M)",
        filename: "Qwen2.5-3B-Instruct-Q4_K_M.gguf",
        url: "https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf",
        dir: LLM_MODELS,
        domainLabel: "Metin & Sohbet (LLM)",
        approxSize: "1.9 GB",
        reason: "Düşük donanım için hafif, Türkçe destekli 3B sohbet modeli (4-bit).",
        installed: fs.existsSync(path.join(LLM_MODELS, "Qwen2.5-3B-Instruct-Q4_K_M.gguf")),
      };

  const speech = tier === "high"
    ? {
        kind: "speech",
        name: "Whisper Large v3 Turbo",
        filename: "ggml-large-v3-turbo.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
        dir: SPEECH_MODELS,
        domainLabel: "Ses Tanıma (ASR)",
        approxSize: "1.6 GB",
        reason: "Türkçe dahil çok dilli konuşmada bu listedeki en yüksek doğruluk.",
        installed: fs.existsSync(path.join(SPEECH_MODELS, "ggml-large-v3-turbo.bin")),
      }
    : {
        kind: "speech",
        name: "Whisper Small (çok dilli)",
        filename: "ggml-small.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
        dir: SPEECH_MODELS,
        domainLabel: "Ses Tanıma (ASR)",
        approxSize: "466 MB",
        reason: "CPU'da da makul hızda çalışan, Türkçe için dengeli çok dilli Whisper modeli.",
        installed: fs.existsSync(path.join(SPEECH_MODELS, "ggml-small.bin")),
      };

  // TTS: Antalia-2 Mini yalnızca bir manifest kurar; ağırlıklar (~31 MB) ilk kullanımda pip paketi tarafından indirilir.
  const tts = {
    kind: "tts",
    type: "tts-manifest",
    ttsId: "antalia-mini",
    name: "Antalia-2 Mini Türkçe (48 kHz)",
    filename: "antalia-mini.json",
    dir: TTS_MODELS,
    domainLabel: "Metinden Sese (Türkçe TTS)",
    approxSize: "31 MB",
    reason: "CPU'da gerçek zamandan hızlı, 48 kHz Türkçe ses. Python paketi gerekir: pip install antalia-mini.",
    installed: fs.existsSync(path.join(TTS_MODELS, "antalia-mini.json")),
  };

  const music = {
    kind: "music",
    type: "snapshot",
    snapshotId: "musicgen-small",
    name: "Meta MusicGen Small (300M)",
    filename: "musicgen-small-local",
    dir: MUSIC_MODELS,
    domainLabel: "Müzik Üretimi",
    approxSize: "2.4 GB",
    reason: "Metinden enstrümantal müzik için en hafif MusicGen (32 kHz mono).",
    installed: isSnapshotInstalled("musicgen-small"),
  };

  const foley = (tier === "high")
    ? {
        kind: "foley",
        type: "snapshot",
        snapshotId: "audioldm2-large",
        name: "AudioLDM 2 Large (ses efekti)",
        filename: "audioldm2-large",
        dir: MUSIC_MODELS,
        domainLabel: "Ses Efekti (SFX)",
        approxSize: "6.0 GB",
        reason: "Yüksek donanım için en kaliteli AudioLDM ses efekti modeli (16 kHz).",
        installed: isSnapshotInstalled("audioldm2-large") || isHfModelReady("models--cvssp--audioldm2-large"),
      }
    : {
        kind: "foley",
        type: "snapshot",
        snapshotId: "audioldm-small",
        name: "AudioLDM-S Full v2 (ses efekti)",
        filename: "audioldm-s-full-v2",
        dir: MUSIC_MODELS,
        domainLabel: "Ses Efekti (SFX)",
        approxSize: "1.7 GB",
        reason: "Az bellekle hızlı ses efekti üretimi (16 kHz).",
        installed: isSnapshotInstalled("audioldm-small") || isHfModelReady("models--cvssp--audioldm-s-full-v2"),
      };

  const video = {
    kind: "video",
    name: "AnimateDiff v1.5 v2 hareket modülü",
    filename: "mm_sd_v15_v2.ckpt",
    url: "https://huggingface.co/guoyww/animatediff/resolve/main/mm_sd_v15_v2.ckpt",
    dir: VIDEO_MODELS,
    domainLabel: "Video Üretimi (T2V)",
    approxSize: "1.8 GB",
    reason: "6 GB+ VRAM'li NVIDIA kartlarda kısa (16 kare, 512x512) metinden video. app/models içinde bir SD 1.5 modeli de gerekir.",
    installed: fs.existsSync(path.join(VIDEO_MODELS, "mm_sd_v15_v2.ckpt")),
  };

  return { tier, vram, ram, models: [image, text, speech, tts, music, foley, video] };
}

// Varsayilan TTS bildirimini (buyuk ikili indirme olmadan) kurar.
function installDefaultTtsManifest() {
  try {
    const model = installTtsCatalogModel("kokoro-onnx-q8");
    return { ok: true, model };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

let defaultModelsQueue = null;

function startDefaultModelsDownload(selectedFilenames = null) {
  const compat = getCompatibleModels();
  let candidateModels = compat.models;
  if (Array.isArray(selectedFilenames) && selectedFilenames.length > 0) {
    const selectedSet = new Set(selectedFilenames.map((s) => String(s).toLowerCase().trim()));
    candidateModels = compat.models.filter((item) =>
      selectedSet.has(String(item.filename || "").toLowerCase().trim()) ||
      selectedSet.has(String(item.kind || "").toLowerCase().trim()) ||
      selectedSet.has(String(item.name || "").toLowerCase().trim())
    );
  }

  const items = candidateModels.filter((item) => {
    if (typeof item.installed === "boolean") {
      return !item.installed;
    }
    const destPath = path.join(item.dir, item.filename);
    return !fs.existsSync(destPath);
  });

  if (items.length === 0) {
    const tts = installDefaultTtsManifest();
    downloadState = {
      active: false,
      filename: "",
      progress: 100,
      speed: "Seçilen modeller zaten mevcut",
      eta: 0,
      totalBytes: 0,
      downloadedBytes: 0,
      error: null,
      defaultModels: true,
    };
    return { ok: true, count: 0, message: "Seçilen tüm modeller zaten mevcut." };
  }

  defaultModelsQueue = items.slice();
  let enqueued = 0;
  for (const item of items) {
    if (item.type === "tts-manifest") {
      try { installTtsCatalogModel(item.ttsId); } catch (err) { console.warn("  [default-models] TTS manifest:", err.message); }
      continue;
    }
    if (item.type === "snapshot") {
      enqueueModelDownload({ type: "snapshot", snapshotId: item.snapshotId, name: item.name, kind: item.kind });
    } else {
      enqueueModelDownload({
        url: item.url,
        filename: item.filename,
        targetDir: item.dir,
        kind: item.kind,
        name: item.name
      });
    }
    enqueued++;
  }
  if (enqueued === 0) defaultModelsQueue = null;
  return { ok: true, count: enqueued, message: `${enqueued} model indirme kuyruğuna alındı.` };
}

// Ortak downloadState bitene kadar kontrol edip geri cagirma yapar.
function waitForDownloadCompletion(callback, attempts = 0) {
  if (!downloadState.active) {
    callback();
    return;
  }
  if (attempts > 24000) { // dosya basina ~40 dk guvenlik siniri (buyuk GGUF indirmelere yetecek sure)
    downloadState.error = "Varsayilan model indirme zamana asimi.";
    callback();
    return;
  }
  setTimeout(() => waitForDownloadCompletion(callback, attempts + 1), 100);
}

// -- MIME types ----------------------------------------------------------------
const MIME = {
  ".html": "text/html", ".js": "application/javascript",
  ".css":  "text/css",  ".png": "image/png",
  ".jpg":  "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".ico":  "image/x-icon", ".json": "application/json", ".wav": "audio/wav", ".txt": "text/plain",
  ".woff2":"font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
  ".mp4":  "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".ogg": "audio/ogg",
};

function isModelFile(filename) {
  const lower = String(filename || "").toLowerCase();
  if (lower.endsWith(".safetensors") || lower.endsWith(".gguf") || lower.endsWith(".ckpt") || lower.endsWith(".coreml") || lower.endsWith(".coreml.zip")) {
    return true;
  }
  const fullPath = path.join(MODELS, filename);
  try {
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const files = fs.readdirSync(fullPath).map(f => f.toLowerCase());
      const hasTextEncoder = files.includes("text_encoder.mlpackage") || 
                             files.includes("text_encoder.mlmodelc") ||
                             files.includes("textencoder.mlpackage") || 
                             files.includes("textencoder.mlmodelc");
      
      const hasUnet = files.includes("unet.mlpackage") || 
                      files.includes("unet.mlmodelc");
                      
      if (hasTextEncoder && hasUnet) return true;
      
      const checkSubdirs = ["split_einsum/packages", "split_einsum/compiled", "original/packages", "original/compiled", "split_einsum", "original"];
      for (const subdir of checkSubdirs) {
        const subPath = path.join(fullPath, subdir);
        if (fs.existsSync(subPath)) {
          const subFiles = fs.readdirSync(subPath).map(f => f.toLowerCase());
          const subTextEncoder = subFiles.includes("text_encoder.mlpackage") || 
                                 subFiles.includes("text_encoder.mlmodelc") ||
                                 subFiles.includes("textencoder.mlpackage") || 
                                 subFiles.includes("textencoder.mlmodelc");
          const subUnet = subFiles.includes("unet.mlpackage") || 
                          subFiles.includes("unet.mlmodelc");
          if (subTextEncoder && subUnet) return true;
        }
      }
    }
  } catch (_) {}
  return false;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1000)));
  return `${(value / (1000 ** idx)).toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function getModelLoadIssue(modelPath) {
  const filename = path.basename(modelPath || "");
  const lower = filename.toLowerCase();
  const ext = path.extname(lower);
  if (!modelPath || !fs.existsSync(modelPath)) {
    return `Model file not found: ${filename || "unknown model"}`;
  }

  const size = getPathSize(modelPath);
  if (size < 128 * 1024 * 1024) {
    return `${filename} is too small to be a complete image model (${formatBytes(size)}). Delete it and download/import it again.`;
  }

  if (ext === ".gguf") {
    const knownDiffusionOnlyGguf =
      lower === "stable-diffusion-xl-base-1.0-q4_0.gguf" ||
      lower.includes("stable-diffusion-xl-base-1.0");
    const requiresSeparateComponents =
      knownDiffusionOnlyGguf ||
      lower.includes("z_image") ||
      lower.includes("z-image") ||
      lower.includes("zimage") ||
      lower.includes("qwen") ||
      lower.includes("hidream") ||
      lower.includes("hunyuan") ||
      lower.includes("wan") ||
      lower.includes("flux");

    if (requiresSeparateComponents) {
      if (knownDiffusionOnlyGguf) {
        return `${filename} is not supported as a one-click model in this app. This SDXL GGUF is a diffusion-only component and needs matching VAE/text encoder files instead of being loaded with --model. Use one of the recommended Safetensors SDXL/SD 1.5 checkpoints, or import a complete single-file GGUF checkpoint.`;
      }
      return `${filename} looks like a multi-file diffusion GGUF. This app currently loads single-file SD 1.5/SDXL checkpoints directly. Models like Z-Image, Qwen, Flux, HiDream, Hunyuan, and Wan usually need extra files such as VAE/text encoders and must be launched with --diffusion-model instead of --model.`;
    }
  }

  return null;
}

function describeBackendError(rawError, modelPath) {
  const raw = String(rawError || "").trim();
  const filename = path.basename(modelPath || "");
  const lower = filename.toLowerCase();

  if (raw.includes("read tensor data failed") || raw.includes("load tensors from file failed")) {
    return `${raw}\n\n${filename || "The selected model"} is present but appears incomplete or corrupted. Delete it from Local Models and download/import it again.`;
  }

  if (!raw.includes("new_sd_ctx_t failed")) return raw;

  if (lower.endsWith(".gguf")) {
    if (lower === "stable-diffusion-xl-base-1.0-q4_0.gguf" || lower.includes("stable-diffusion-xl-base-1.0")) {
      return `${raw}\n\n${filename} is not supported as a one-click model in this app. This SDXL GGUF is a diffusion-only component and needs matching VAE/text encoder files instead of being loaded with --model. Use one of the recommended Safetensors SDXL/SD 1.5 checkpoints, or import a complete single-file GGUF checkpoint.`;
    }
    return `${raw}\n\n${filename} could not be loaded as a single checkpoint. Some GGUF files are only the diffusion part of a larger workflow and need separate VAE/text encoder files. Try a recommended SD 1.5/SDXL model, or re-download/import the file if this is meant to be a single-file SD/SDXL GGUF.`;
  }

  return `${raw}\n\nThe backend could not create the model context. Common causes are a corrupt/incomplete model file, unsupported checkpoint type, or not enough free RAM/VRAM. Delete and re-download the model, then try CPU or Vulkan mode at 512x512.`;
}

function describeLinuxRuntimeLinkerError(rawError) {
  const raw = String(rawError || "").trim();
  const lower = raw.toLowerCase();
  if (osPlatform !== "linux") return null;
  if (!lower.includes("glibc") && !lower.includes("libstdc++") && !lower.includes("libc.so.6")) return null;

  const needsGlibc = raw.match(/GLIBC_([0-9.]+)/)?.[1];
  const needsGlibcxx = raw.match(/GLIBCXX_([0-9.]+)/)?.[1];
  const requirements = [];
  if (needsGlibc) requirements.push(`glibc ${needsGlibc}+`);
  if (needsGlibcxx) requirements.push(`GLIBCXX_${needsGlibcxx}+`);
  const requirementText = requirements.length ? requirements.join(" and ") : "newer glibc/libstdc++ runtime libraries";

  return `${raw}\n\nThe selected model is not the problem. The Linux backend binary cannot start because this OS is missing ${requirementText}. The bundled Linux backends are built for Ubuntu 24.04-era systems. Use Ubuntu 24.04+, Fedora 40+, another glibc 2.38+ distro, or build stable-diffusion.cpp from source on this machine.`;
}

const VC_REDIST_HINT = "Most often this is the Microsoft Visual C++ 2015-2022 x64 runtime (VC_redist.x64.exe). Close the app window and start windows.bat again so it is installed automatically, or install it from https://aka.ms/vs/17/release/vc_redist.x64.exe and restart the app.";

function describeBackendExitCode(code, backendPath) {
  const numericCode = Number(code);
  // 0xC0000139 (entry point not found) and 0xC0000005 (access violation in std::mutex) are what an
  // outdated Visual C++ runtime produces with binaries built by VS 2022 17.10+.
  if (osPlatform === "win32" && (numericCode === 3221225785 || numericCode === 3221225477)) {
    const hex = numericCode === 3221225785 ? "0xC0000139" : "0xC0000005";
    return `ile cikti kodu ${code} (${hex}).\n\nIf this happens as soon as the model starts loading, an outdated Visual C++ runtime is a common cause. ${VC_REDIST_HINT}`;
  }
  if (osPlatform === "win32" && numericCode === 3221225781) {
    const backendName = path.basename(backendPath || BACKEND_PATH || "backend");
    const lowerBackend = backendName.toLowerCase();
    const isVulkan = lowerBackend.includes("vulkan");
    const isCuda = lowerBackend.includes("cuda");
    const likelyMissing = isVulkan
      ? "the Vulkan runtime/driver DLL, such as vulkan-1.dll"
      : isCuda
        ? "a CUDA runtime DLL or NVIDIA driver component"
        : "a required backend DLL";
    const driverHint = isVulkan
      ? "Install or update the GPU vendor driver with Vulkan support, then run setup again so the Vulkan backend folder is repaired."
      : isCuda
        ? "Install or update the NVIDIA driver, then run setup again so the CUDA backend folder is repaired."
        : "Update the GPU driver, then run setup again so the backend folder is repaired.";

    return `ile cikti kodu ${code} (0xC0000135: required DLL not found).\n\nWindows could not start ${backendName} because a required DLL is missing or not loadable. ${VC_REDIST_HINT}\n\nIf the Visual C++ runtime is already installed, ${likelyMissing} may be missing. ${driverHint}\n\nIf you are using an AMD/Intel GPU, update the AMD/Intel graphics driver first. If the GPU is too old for the current Vulkan backend, switch the backend to CPU.`;
  }

  return `ile cikti kodu ${code}`;
}

function getModelInfo(filename) {
  const safeFilename = path.basename(filename || "");
  const fullPath = path.join(MODELS, safeFilename);
  const stats = fs.statSync(fullPath);
  
  if (stats.isDirectory()) {
    const dirSize = getPathSize(fullPath);
    return {
      filename: safeFilename,
      sizeBytes: dirSize,
      size: formatBytes(dirSize),
      format: "CoreML",
    };
  }

  return {
    filename: safeFilename,
    sizeBytes: stats.size,
    size: formatBytes(stats.size),
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let bytes = 0;
    req.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > MAX_JSON_BODY_BYTES) {
        reject(new Error(`Request body is too large. Limit is ${Math.round(MAX_JSON_BODY_BYTES / (1024 * 1024))} MB.`));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on("end",  () => { try { resolve(JSON.parse(data || "{}")); } catch(e) { reject(new Error("Invalid JSON request body")); } });
    req.on("error", reject);
  });
}

async function readJsonBody(req, res) {
  try {
    return await readBody(req);
  } catch (err) {
    json(res, err.message.includes("too large") ? 413 : 400, { ok: false, error: err.message });
    return null;
  }
}

function safeOutputName(value) {
  return String(value || "")
    .replace(/[^a-z0-9._-]/gi, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
}

function sanitizeChatMessageForStorage(message) {
  if (!message || typeof message !== "object") return null;
  const role = String(message.role || "").trim();
  if (!["system", "user", "assistant"].includes(role)) return null;
  let content = message.content;
  if (Array.isArray(content)) {
    content = content.map((item) => {
      if (!item || typeof item !== "object") return item;
      if (item.type === "image_url") {
        return { type: "text", text: "[Attached image omitted from saved chat history]" };
      }
      return item;
    });
  } else if (typeof content !== "string") {
    content = content === undefined || content === null ? "" : String(content);
  }
  return {
    ...message,
    role,
    content,
  };
}

function sanitizeChatConversationForStorage(conversation = {}) {
  const now = Date.now();
  const id = safeOutputName(conversation.id || `chat_${now}`) || `chat_${now}`;
  const messages = Array.isArray(conversation.messages)
    ? conversation.messages.map(sanitizeChatMessageForStorage).filter(Boolean)
    : [];
  const timestamp = Number(conversation.timestamp) || now;
  return {
    id,
    title: String(conversation.title || "Chat Session").slice(0, 160),
    model: String(conversation.model || ""),
    messages,
    timestamp,
    createdAt: conversation.createdAt || new Date(timestamp).toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function getChatConversationPath(id) {
  const safeId = safeOutputName(id);
  if (!safeId) throw new Error("A chat id is required.");
  const filePath = path.join(CHAT_HISTORY, `${safeId}.json`);
  if (!pathInside(filePath, CHAT_HISTORY)) {
    throw new Error("Invalid chat id.");
  }
  return filePath;
}

function saveChatConversation(conversation = {}) {
  const saved = sanitizeChatConversationForStorage(conversation);
  const filePath = getChatConversationPath(saved.id);
  fs.writeFileSync(filePath, JSON.stringify(saved, null, 2), "utf8");
  return saved;
}

function listChatConversations() {
  try {
    return fs.readdirSync(CHAT_HISTORY)
      .filter((file) => file.toLowerCase().endsWith(".json"))
      .map((file) => {
        try {
          const filePath = path.join(CHAT_HISTORY, file);
          if (!pathInside(filePath, CHAT_HISTORY)) return null;
          const conversation = JSON.parse(fs.readFileSync(filePath, "utf8"));
          const stat = fs.statSync(filePath);
          return {
            ...conversation,
            filename: file,
            modifiedAt: stat.mtime.toISOString(),
            sizeBytes: stat.size,
            size: formatBytes(stat.size),
          };
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  } catch (_) {
    return [];
  }
}

function deleteChatConversation(id) {
  const filePath = getChatConversationPath(id);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

function saveGeneratedOutput(imageDataUrl, metadata = {}) {
  const match = String(imageDataUrl || "").match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
  if (!match) {
    throw new Error("Expected a real base64 PNG, JPEG, or WebP image data URL");
  }

  const mime = match[1];
  const extByMime = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
  };
  const ext = extByMime[mime] || ".png";
  const imageBuffer = Buffer.from(match[2], "base64");
  const isPng = imageBuffer.length > 8 &&
    imageBuffer[0] === 0x89 &&
    imageBuffer[1] === 0x50 &&
    imageBuffer[2] === 0x4e &&
    imageBuffer[3] === 0x47;
  const isJpeg = imageBuffer.length > 3 &&
    imageBuffer[0] === 0xff &&
    imageBuffer[1] === 0xd8 &&
    imageBuffer[2] === 0xff;
  const isWebp = imageBuffer.length > 12 &&
    imageBuffer.toString("ascii", 0, 4) === "RIFF" &&
    imageBuffer.toString("ascii", 8, 12) === "WEBP";
  if ((mime === "image/png" && !isPng) ||
      ((mime === "image/jpeg" || mime === "image/jpg") && !isJpeg) ||
      (mime === "image/webp" && !isWebp)) {
    throw new Error("Generated image payload did not match its declared image format.");
  }
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[:.]/g, "-");
  const seed = metadata.seed !== undefined && metadata.seed !== null ? `-${safeOutputName(metadata.seed)}` : "";
  const baseName = `output-${stamp}${seed}`;
  const imageFilename = `${baseName}${ext}`;
  const metadataFilename = `${baseName}.json`;
  const imagePath = path.join(OUTPUTS, imageFilename);
  const metadataPath = path.join(OUTPUTS, metadataFilename);

  fs.writeFileSync(imagePath, imageBuffer);
  const savedMetadata = {
    ...metadata,
    createdAt,
    image: imageFilename,
    metadata: metadataFilename,
  };
  fs.writeFileSync(metadataPath, JSON.stringify(savedMetadata, null, 2), "utf8");
  console.log(`  [api] Uretilen cikti kaydedildi: ${imageFilename}`);
  return savedMetadata;
}

function listGeneratedOutputs() {
  try {
    return fs.readdirSync(OUTPUTS)
      .filter(file => file.toLowerCase().endsWith(".json"))
      .map(file => {
        try {
          const metadata = JSON.parse(fs.readFileSync(path.join(OUTPUTS, file), "utf8"));
          // Skip metadata whose image was deleted outside the app (it would only show a broken thumbnail).
          if (!metadata.image || !fs.existsSync(path.join(OUTPUTS, path.basename(metadata.image)))) return null;
          return {
            ...metadata,
            url: `/api/output-file?filename=${encodeURIComponent(metadata.image)}`,
          };
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  } catch (_) {
    return [];
  }
}

function deleteGeneratedOutputs(outputs = []) {
  const deleted = [];
  for (const output of outputs) {
    const imageFilename = path.basename(output?.image || output?.filename || "");
    const metadataFilename = path.basename(output?.metadata || "");
    if (!imageFilename && !metadataFilename) continue;

    const targets = new Set();
    if (imageFilename) targets.add(imageFilename);
    if (metadataFilename) targets.add(metadataFilename);

    if (!metadataFilename && imageFilename) {
      const stem = imageFilename.replace(/\.[^.]+$/, "");
      targets.add(`${stem}.json`);
    }

    for (const filename of targets) {
      const filePath = path.join(OUTPUTS, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        deleted.push(filename);
      }
    }
  }
  return deleted;
}

function revealPathInExplorer(targetPath, fallbackDir, isFile = false) {
  try {
    const isWin = process.platform === "win32";
    const isMac = process.platform === "darwin";

    let pathToOpen = targetPath || fallbackDir;
    let fileMode = Boolean(isFile);

    if (pathToOpen && fs.existsSync(pathToOpen)) {
      const stat = fs.statSync(pathToOpen);
      if (!stat.isFile()) fileMode = false;
    } else if (fallbackDir && fs.existsSync(fallbackDir)) {
      pathToOpen = fallbackDir;
      fileMode = false;
    } else {
      return false;
    }

    if (isWin) {
      const normalizedPath = path.resolve(pathToOpen).replace(/\//g, "\\");
      const folderPath = fileMode ? path.dirname(normalizedPath) : normalizedPath;

      // 1. Direct execution via cmd start
      const directCmd = fileMode
        ? `cmd.exe /c start "" explorer.exe /select,"${normalizedPath}"`
        : `cmd.exe /c start "" explorer.exe "${folderPath}"`;
      exec(directCmd, (err) => {
        if (err) console.error("  [revealPathInExplorer] Windows cmd error:", err && err.message ? err.message : err);
      });

      // 2. Interactive session bridge via schtasks /it
      // Ensures the explorer window appears on the interactive user desktop (WinSta0\\Default)
      // even when node runs under an isolated background session / IDE language server.
      try {
        const batDir = path.join(ROOT, "app", "outputs");
        if (!fs.existsSync(batDir)) fs.mkdirSync(batDir, { recursive: true });
        const openBat = path.join(batDir, ".open_explorer.bat");
        const batContent = fileMode
          ? `@echo off\r\nstart "" explorer.exe /select,"${normalizedPath}"\r\n`
          : `@echo off\r\nstart "" explorer.exe "${folderPath}"\r\n`;
        fs.writeFileSync(openBat, batContent, "utf8");

        const schCmd = `schtasks /create /tn "SansursuzStudioExplorer" /tr "\\"${openBat}\\"" /sc once /st 23:59 /it /f && schtasks /run /tn "SansursuzStudioExplorer"`;
        exec(schCmd, () => {
          setTimeout(() => {
            try { if (fs.existsSync(openBat)) fs.unlinkSync(openBat); } catch (_) {}
            exec(`schtasks /delete /tn "SansursuzStudioExplorer" /f`, () => {});
          }, 4000);
        });
      } catch (bridgeErr) {
        console.error("  [revealPathInExplorer] Bridge error:", bridgeErr && bridgeErr.message ? bridgeErr.message : bridgeErr);
      }

      return true;
    } else if (isMac) {
      if (fileMode) {
        spawn("open", ["-R", pathToOpen], { detached: true, stdio: "ignore" }).unref();
      } else {
        spawn("open", [pathToOpen], { detached: true, stdio: "ignore" }).unref();
      }
      return true;
    } else {
      const dir = fileMode ? path.dirname(pathToOpen) : pathToOpen;
      spawn("xdg-open", [dir], { detached: true, stdio: "ignore" }).unref();
      return true;
    }
  } catch (err) {
    console.error("  [revealPathInExplorer] Error:", err && err.message ? err.message : err);
  }
  return false;
}

// Rejects files whose content does not match their extension (renamed or truncated uploads would
// otherwise only fail later, when the model is loaded). Returns an error message or null.
function validateModelFileHeader(filePath, lowerName, mode) {
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
    const head = Buffer.alloc(16);
    const read = fs.readSync(fd, head, 0, 16, 0);
    const size = fs.fstatSync(fd).size;
    if (lowerName.endsWith(".gguf")) {
      return read >= 4 && head.toString("ascii", 0, 4) === "GGUF" ? null : "Dosya geçerli bir GGUF modeli değil (GGUF imzası bulunamadı).";
    }
    if (lowerName.endsWith(".safetensors")) {
      const headerLen = read >= 8 ? Number(head.readBigUInt64LE(0)) : 0;
      return headerLen > 0 && headerLen < size && head[8] === 0x7b ? null : "Dosya geçerli bir .safetensors modeli değil (başlık okunamadı).";
    }
    if (mode === "speech" && lowerName.endsWith(".bin")) {
      return read >= 4 && head.toString("ascii", 0, 4) === "lmgg" ? null : "Dosya geçerli bir whisper.cpp (GGML) modeli değil.";
    }
    return null;
  } catch (err) {
    return `Dosya doğrulanamadı: ${err.message}`;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {}
  }
}

function streamModelUpload(req, filename, targetDir = MODELS, mode = "image") {
  return new Promise((resolve, reject) => {
    const safeFilename = path.basename(filename || "");
    const lowerName = safeFilename.toLowerCase();
    const valid = mode === "text"
      ? lowerName.endsWith(".gguf")
      : mode === "speech"
        ? lowerName.endsWith(".bin")
        : mode === "tts"
          ? lowerName.endsWith(".json")
          : mode === "video"
            ? (lowerName.endsWith(".safetensors") || lowerName.endsWith(".gguf") || lowerName.endsWith(".ckpt"))
            : mode === "music"
              ? (lowerName.endsWith(".safetensors") || lowerName.endsWith(".pt") || lowerName.endsWith(".bin") || lowerName.endsWith(".pth"))
        : isModelFile(lowerName);
    if (!safeFilename || !valid) {
      reject(new Error(mode === "text"
        ? "Filename must end with .gguf"
        : mode === "speech"
          ? "Filename must end with .bin"
          : mode === "tts"
            ? "Filename must end with .json"
            : mode === "video"
              ? "Filename must end with .safetensors, .gguf, or .ckpt"
              : mode === "music"
                ? "Filename must end with .safetensors, .pt, or .bin"
            : "Filename must end with .gguf, .safetensors, or .ckpt"));
      return;
    }

    const destPath = path.join(targetDir, safeFilename);
    const tempPath = `${destPath}.part`;
    const out = fs.createWriteStream(tempPath);
    let finished = false;

    const cleanupPartial = () => {
      if (finished) return;
      out.destroy();
      try { fs.unlinkSync(tempPath); } catch (_) {}
    };

    req.pipe(out);
    req.on("error", err => {
      cleanupPartial();
      reject(err);
    });
    req.on("aborted", () => {
      cleanupPartial();
      reject(new Error("Import cancelled by user"));
    });
    req.on("close", () => {
      if (!finished && req.aborted) {
        cleanupPartial();
      }
    });
    out.on("error", err => {
      cleanupPartial();
      reject(err);
    });
    out.on("finish", () => {
      try {
        finished = true;
        const headerError = validateModelFileHeader(tempPath, lowerName, mode);
        if (headerError) {
          try { fs.unlinkSync(tempPath); } catch (_) {}
          reject(new Error(headerError));
          return;
        }
        fs.renameSync(tempPath, destPath);
        console.log(`  [api] Model dosyasi ice aktarildi: ${safeFilename}`);
        if (mode === "text" || mode === "speech") {
          const stats = fs.statSync(destPath);
          resolve({ filename: safeFilename, name: safeFilename, sizeBytes: stats.size, size: formatBytes(stats.size), format: mode === "speech" ? "Whisper GGML" : "GGUF" });
        } else {
          resolve(getModelInfo(safeFilename));
        }
      } catch (err) {
        try { fs.unlinkSync(tempPath); } catch (_) {}
        reject(err);
      }
    });
  });
}

function json(res, code, obj) {
  if (res.headersSent) return;
  const body = JSON.stringify(obj);
  // No CORS header on purpose: the UI is served from this same origin, and a wildcard
  // would let any website the user visits read API keys and trigger local actions.
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(body);
}

// Hosts allowed to talk to the management API. Blocks DNS-rebinding style access from
// web pages; LAN access must be opted into explicitly with LISTEN_HOST/ALLOWED_HOSTS.
const LISTEN_HOST = String(process.env.LISTEN_HOST || "127.0.0.1").trim();
const EXTRA_ALLOWED_HOSTS = String(process.env.ALLOWED_HOSTS || "")
  .split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);

function isAllowedHostHeader(hostHeader) {
  const host = String(hostHeader || "").toLowerCase().replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  if (EXTRA_ALLOWED_HOSTS.includes(host)) return true;
  return LISTEN_HOST !== "127.0.0.1" && LISTEN_HOST !== "localhost" && EXTRA_ALLOWED_HOSTS.length === 0;
}

function maskSecret(value) {
  const clean = String(value || "").trim();
  if (!clean) return "";
  if (clean.length <= 10) return "••••";
  return `${clean.slice(0, 6)}••••${clean.slice(-4)}`;
}

function isMaskedSecret(value) {
  return String(value || "").includes("••••");
}

const PROVIDERS_CONFIG_PATH = path.join(LLM_CONFIG_DIR, "api-providers.json");
const HF_TOKEN_FILE = path.join(LLM_CONFIG_DIR, "hf-token.txt");

function getHuggingFaceToken() {
  if (process.env.HF_TOKEN && process.env.HF_TOKEN.trim()) {
    return process.env.HF_TOKEN.trim();
  }
  try {
    if (fs.existsSync(HF_TOKEN_FILE)) {
      const val = fs.readFileSync(HF_TOKEN_FILE, "utf8").trim();
      if (val) return val;
    }
  } catch (_) {}
  const providers = getProvidersConfig();
  if (providers.hfToken && typeof providers.hfToken === "string" && providers.hfToken.trim()) {
    return providers.hfToken.trim();
  }
  return "";
}

function setHuggingFaceToken(token) {
  const clean = String(token || "").trim();
  try {
    if (clean) {
      fs.writeFileSync(HF_TOKEN_FILE, clean, "utf8");
      process.env.HF_TOKEN = clean;
    } else {
      try { fs.unlinkSync(HF_TOKEN_FILE); } catch (_) {}
      delete process.env.HF_TOKEN;
    }
  } catch (_) {}
  const providers = getProvidersConfig();
  providers.hfToken = clean;
  saveProvidersConfig(providers);
  return clean;
}

function getProvidersConfig() {
  try {
    if (fs.existsSync(PROVIDERS_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(PROVIDERS_CONFIG_PATH, "utf8"));
    }
  } catch (_) {}
  return { keys: {} };
}

function saveProvidersConfig(cfg) {
  try {
    fs.writeFileSync(PROVIDERS_CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
    return true;
  } catch (_) {
    return false;
  }
}

// -- HTTP Server ---------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  if (!isAllowedHostHeader(req.headers.host)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden host");
    return;
  }

  // Cross-origin requests are not supported (the UI is same-origin).
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end(); return;
  }

  if ((req.url.startsWith("/v1/") || req.url.startsWith("/sdapi/")) && ["GET", "POST"].includes(req.method)) {
    return proxyImageBackendRequest(req, res);
  }
  // -- Management API --------------------------------------------------------
  // GET /api/health
  if (req.url === "/api/health" && req.method === "GET") {
    return json(res, 200, await getHealth());
  }

  // GET /api/hf-token
  if (req.url === "/api/hf-token" && req.method === "GET") {
    const token = getHuggingFaceToken();
    return json(res, 200, {
      ok: true,
      hasToken: Boolean(token),
      tokenPreview: maskSecret(token),
    });
  }

  // POST /api/hf-token
  if (req.url === "/api/hf-token" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    const token = String(body.token || "").trim();
    if (isMaskedSecret(token)) {
      const current = getHuggingFaceToken();
      return json(res, 200, { ok: true, hasToken: Boolean(current), tokenPreview: maskSecret(current), message: "Hugging Face erişim anahtarı değişmedi." });
    }
    setHuggingFaceToken(token);
    return json(res, 200, {
      ok: true,
      hasToken: Boolean(token),
      tokenPreview: maskSecret(token),
      message: token ? "Hugging Face erişim anahtarı başarıyla kaydedildi." : "Hugging Face erişim anahtarı kaldırıldı."
    });
  }

  // DELETE /api/hf-token
  if (req.url === "/api/hf-token" && req.method === "DELETE") {
    setHuggingFaceToken("");
    return json(res, 200, { ok: true, hasToken: false, message: "Hugging Face erişim anahtarı kaldırıldı." });
  }

  // GET /api/providers/config
  if (req.url === "/api/providers/config" && req.method === "GET") {
    const cfg = getProvidersConfig();
    const maskedKeys = {};
    for (const [provider, key] of Object.entries(cfg.keys || {})) {
      if (key && String(key).trim()) maskedKeys[provider] = maskSecret(key);
    }
    return json(res, 200, { ok: true, keys: maskedKeys, customModels: cfg.customModels || {} });
  }

  // POST /api/providers/config
  if (req.url === "/api/providers/config" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    const current = getProvidersConfig();
    let keys = current.keys || {};
    if (body.keys !== undefined && body.keys && typeof body.keys === "object") {
      keys = {};
      for (const [provider, value] of Object.entries(body.keys)) {
        const clean = String(value || "").trim();
        if (!clean) continue;
        // A masked value means "unchanged": keep the stored secret.
        keys[provider] = isMaskedSecret(clean) ? (current.keys || {})[provider] : clean;
        if (!keys[provider]) delete keys[provider];
      }
    }
    const merged = {
      ...current,
      keys,
      customModels: body.customModels !== undefined ? body.customModels : (current.customModels || {}),
    };
    saveProvidersConfig(merged);
    const maskedKeys = {};
    for (const [provider, key] of Object.entries(merged.keys || {})) maskedKeys[provider] = maskSecret(key);
    return json(res, 200, { ok: true, keys: maskedKeys, customModels: merged.customModels || {} });
  }

  // POST /api/providers/test
  if (req.url === "/api/providers/test" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    const provider = body.provider;
    const apiKey = isMaskedSecret(body.apiKey) ? getProvidersConfig().keys?.[provider] : String(body.apiKey || "").trim();
    if (!apiKey) return json(res, 400, { ok: false, error: "API anahtarı boş olamaz." });

    try {
      if (provider === "openrouter") {
        const check = await fetch("https://openrouter.ai/api/v1/auth/key", {
          headers: { "Authorization": `Bearer ${apiKey}` }
        });
        if (!check.ok) throw new Error(`OpenRouter HTTP ${check.status}`);
      } else if (provider === "elevenlabs") {
        const check = await fetch("https://api.elevenlabs.io/v1/user", {
          headers: { "xi-api-key": apiKey }
        });
        if (!check.ok) throw new Error(`ElevenLabs HTTP ${check.status}`);
      } else if (provider === "anthropic") {
        const check = await fetch("https://api.anthropic.com/v1/models", {
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
        });
        if (!check.ok) throw new Error(`Anthropic HTTP ${check.status}`);
      } else if (provider === "openai") {
        const check = await fetch("https://api.openai.com/v1/models", {
          headers: { "Authorization": `Bearer ${apiKey}` }
        });
        if (!check.ok) throw new Error(`OpenAI HTTP ${check.status}`);
      } else if (provider === "gemini") {
        const check = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (!check.ok) throw new Error(`Google Gemini HTTP ${check.status}`);
      }
      return json(res, 200, { ok: true, message: "Bağlantı başarılı!" });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  // POST /api/audio/tts - Unified Audio Studio TTS (Piper / Kokoro / ElevenLabs / F5)
  if (req.url === "/api/audio/tts" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body || !body.text) return json(res, 400, { ok: false, error: "Lütfen seslendirilecek bir metin girin." });
    const { engine = "kokoro", text, speed = 1.0, voice = "tr_cem" } = body;

    try {
      if (engine === "elevenlabs") {
        const cfg = getProvidersConfig();
        const apiKey = cfg.keys?.elevenlabs;
        if (!apiKey) {
          return json(res, 400, {
            ok: false,
            error: "ElevenLabs API anahtarı ayarlanmamış. Lütfen 'Hibrit API' sekmesinden anahtarınızı kaydedin."
          });
        }
        // ElevenLabs premade voice IDs (Rachel / Adam); a raw voice ID can also be passed.
        const elevenVoiceIds = { eleven_rachel: "21m00Tcm4TlvDq8ikWAM", eleven_adam: "pNInz6obpgDQGcFmaJgB" };
        const voiceId = elevenVoiceIds[voice] || (/^[A-Za-z0-9]{20}$/.test(String(voice || "")) ? voice : "21m00Tcm4TlvDq8ikWAM");
        const elRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            text: text,
            model_id: "eleven_multilingual_v2",
            voice_settings: { stability: 0.5, similarity_boost: 0.75 }
          })
        });
        if (!elRes.ok) {
          const errText = await elRes.text();
          throw new Error(`ElevenLabs hatası (${elRes.status}): ${errText}`);
        }
        const arrayBuf = await elRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        const fileName = `elevenlabs_${Date.now()}.mp3`;
        const filePath = path.join(TTS_OUTPUTS, fileName);
        fs.writeFileSync(filePath, buffer);
        const metaPath = path.join(TTS_OUTPUTS, `${path.parse(fileName).name}.json`);
        fs.writeFileSync(metaPath, JSON.stringify({
          filename: fileName,
          audioFile: fileName,
          text,
          engine: "elevenlabs",
          createdAt: new Date().toISOString()
        }, null, 2), "utf8");
        return json(res, 200, { ok: true, url: `/tts-outputs/${fileName}` });
      }

      if (engine === "openai") {
        const cfg = getProvidersConfig();
        const apiKey = cfg.keys?.openai;
        if (!apiKey) {
          return json(res, 400, {
            ok: false,
            error: "OpenAI API anahtarınız ayarlanmamış. Lütfen 'Hibrit API' sekmesinden OpenAI anahtarınızı kaydedin."
          });
        }
        const oaiRes = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "tts-1-hd",
            input: text,
            voice: voice || "alloy",
            speed: Math.max(0.25, Math.min(4.0, speed || 1.0))
          })
        });
        if (!oaiRes.ok) {
          const errText = await oaiRes.text();
          throw new Error(`OpenAI TTS hatası (${oaiRes.status}): ${errText}`);
        }
        const arrayBuf = await oaiRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        const fileName = `openai_${Date.now()}.mp3`;
        const filePath = path.join(TTS_OUTPUTS, fileName);
        fs.writeFileSync(filePath, buffer);
        const metaPath = path.join(TTS_OUTPUTS, `${path.parse(fileName).name}.json`);
        fs.writeFileSync(metaPath, JSON.stringify({
          filename: fileName,
          audioFile: fileName,
          text,
          engine: "openai",
          voice: voice || "alloy",
          createdAt: new Date().toISOString()
        }, null, 2), "utf8");
        return json(res, 200, { ok: true, url: `/tts-outputs/${fileName}` });
      }

      if (engine === "minimax") {
        const cfg = getProvidersConfig();
        const apiKey = cfg.keys?.minimax;
        if (!apiKey) {
          return json(res, 400, {
            ok: false,
            error: "MiniMax API anahtarınız ayarlanmamış. Lütfen 'Hibrit API' sekmesinden MiniMax anahtarınızı kaydedin."
          });
        }
        const mmVoices = ["English_Graceful_Lady", "English_Insightful_Speaker", "English_Persuasive_Man", "English_expressive_narrator"];
        const mmRes = await fetch("https://api.minimax.io/v1/t2a_v2", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "speech-2.8-hd",
            text: text,
            stream: false,
            language_boost: "Turkish",
            output_format: "hex",
            voice_setting: {
              voice_id: mmVoices.includes(voice) ? voice : "English_Graceful_Lady",
              speed: Math.max(0.5, Math.min(2, Number(speed) || 1.0)),
              vol: 1.0,
              pitch: 0
            },
            audio_setting: {
              sample_rate: 32000,
              bitrate: 128000,
              format: "mp3",
              channel: 1
            }
          })
        });
        if (!mmRes.ok) {
          const errText = await mmRes.text();
          throw new Error(`MiniMax TTS hatası (${mmRes.status}): ${errText}`);
        }
        const mmData = await mmRes.json();
        if (mmData.base_resp && mmData.base_resp.status_code !== 0) {
          throw new Error(`MiniMax TTS hatası: ${mmData.base_resp.status_msg || mmData.base_resp.status_code}`);
        }
        const hexData = mmData.data?.audio;
        if (!hexData) {
          throw new Error("MiniMax ses verisi döndüremedi: " + (mmData.base_resp?.status_msg || JSON.stringify(mmData)));
        }
        const buffer = Buffer.from(hexData, "hex");
        const fileName = `minimax_${Date.now()}.mp3`;
        const filePath = path.join(TTS_OUTPUTS, fileName);
        fs.writeFileSync(filePath, buffer);
        const metaPath = path.join(TTS_OUTPUTS, `${path.parse(fileName).name}.json`);
        fs.writeFileSync(metaPath, JSON.stringify({
          filename: fileName,
          audioFile: fileName,
          text,
          engine: "minimax",
          voice: voice || "English_Graceful_Lady",
          createdAt: new Date().toISOString()
        }, null, 2), "utf8");
        return json(res, 200, { ok: true, url: `/tts-outputs/${fileName}` });
      }

      if (engine === "piper") {
        const piperBin = osPlatform === "win32"
          ? path.join(TOOLS, "piper", "piper.exe")
          : path.join(TOOLS, "piper", "piper");
        const piperModel = path.join(ROOT, "app", "tts-models", "piper", "tr_TR-dfki-medium.onnx");

        if (fs.existsSync(piperBin) && fs.existsSync(piperModel)) {
          const fileName = `piper_${Date.now()}.wav`;
          const filePath = path.join(TTS_OUTPUTS, fileName);
          const child = spawn(piperBin, ["--model", piperModel, "--output_file", filePath], {
            stdio: ["pipe", "ignore", "pipe"]
          });
          child.stdin.write(text);
          child.stdin.end();
          await new Promise((resolve, reject) => {
            child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Piper çıkış kodu: ${code}`)));
            child.on("error", reject);
          });
          const metaPath = path.join(TTS_OUTPUTS, `${path.parse(fileName).name}.json`);
          fs.writeFileSync(metaPath, JSON.stringify({
            filename: fileName,
            audioFile: fileName,
            text,
            engine: "piper",
            createdAt: new Date().toISOString()
          }, null, 2), "utf8");
          return json(res, 200, { ok: true, url: `/tts-outputs/${fileName}` });
        } else {
          return json(res, 501, {
            ok: false,
            error: `Piper TTS kurulu değil. Piper'ı kullanmak için piper ikili dosyasını ${path.join("app", "tools", "piper")} klasörüne, tr_TR-dfki-medium.onnx (+ .onnx.json) modelini ${path.join("app", "tts-models", "piper")} klasörüne yerleştirin (https://github.com/rhasspy/piper).`,
          });
        }
      }

      if (engine === "supertonic") {
        const output = await runExclusiveTtsOperation(() => synthesizeTts(text, { speed, voice, engine: "supertonic" }));
        return json(res, 200, {
          ok: true,
          url: output.url,
          engine: "supertonic",
          message: "Supertone Supertonic-3 (99M ONNX) Türkçe ses motoru ile başarıyla sentezlendi."
        });
      }

      if (engine === "antalia" || engine === "antalia-mini") {
        const output = await runExclusiveTtsOperation(() => synthesizeTts(text, { speed, voice, engine: "antalia" }));
        return json(res, 200, {
          ok: true,
          url: output.url,
          engine: "antalia",
          message: `Antalia-2 Mini (7.6M Flow-Matching 48kHz) Türkçe ses motoru (${output.voiceName || voice}) ile başarıyla sentezlendi.`
        });
      }

      if (engine === "omnivoice") {
        const output = await runExclusiveTtsOperation(() => synthesizeTts(text, {
          speed,
          engine: "omnivoice",
          ref_audio: body.ref_audio || body.refAudio,
          ref_text: body.ref_text || body.refText,
          instruct: body.instruct,
          lang: body.lang || "tr",
          num_step: body.num_step || body.numStep || 32
        }));
        return json(res, 200, {
          ok: true,
          url: output.url,
          engine: "omnivoice",
          message: "OmniVoice Zero-Shot Ses Klonlama motoru ile ses başarıyla sentezlendi."
        });
      }

      if (engine === "chatterbox" || engine === "xtts" || engine === "cosyvoice") {
        // These engines are listed in the catalog for reference only; no worker exists yet.
        // Never substitute another engine's (English) voice and claim success.
        return json(res, 501, {
          ok: false,
          error: `${engine === "xtts" ? "Coqui XTTS-v2" : engine === "chatterbox" ? "Chatterbox Multilingual" : "CosyVoice 2"} bu sürümde henüz entegre edilmedi. Türkçe için Antalia-2 Mini, Ahenk Cep, EMA Lightning, Supertonic-3 veya OmniVoice motorlarını kullanın.`,
        });
      }

      if (engine === "ema-lightning" || engine === "ema") {
        const output = await runExclusiveTtsOperation(() => synthesizeTts(text, { speed, voice, engine: "ema-lightning" }));
        return json(res, 200, {
          ok: true,
          url: output.url,
          engine: "ema-lightning",
          message: voice === "ema_erkek"
            ? "Erkek ses seçeneği Antalia-2 Mini (7.6M, 48kHz) ile sentezlendi."
            : "EMA Lightning (8.6M Flow-Matching DiT 48kHz) Türkçe ses motoru ile başarıyla sentezlendi."
        });
      }

      if (engine === "ahenk" || engine === "ahenk-cep") {
        const output = await runExclusiveTtsOperation(() => synthesizeTts(text, { speed, voice, engine: "ahenk" }));
        return json(res, 200, { ok: true, url: output.url, engine: "ahenk-cep" });
      }

      if (engine !== "kokoro") {
        return json(res, 400, { ok: false, error: `Bilinmeyen ses motoru: ${engine}` });
      }

      // Kokoro (English voices; Turkish text goes through an experimental phonetic mapping)
      // Use the requested Kokoro variant, else the one loaded from Model Merkezi, else the first installed (Q8 first).
      const installedKokoro = getTtsModels().filter((item) => item.installed && /kokoro/i.test(String(item.id || item.filename)));
      const wantedKokoro = [body.model, ttsSettings.model].map((m) => String(m || "").toLowerCase()).find((m) => /kokoro/.test(m));
      const kokoroModel = installedKokoro.find((item) => wantedKokoro && [item.id, item.filename].map((v) => String(v || "").toLowerCase()).some((v) => v === wantedKokoro || `${v}.json` === wantedKokoro))
        || installedKokoro.find((item) => /q8/i.test(String(item.id))) || installedKokoro[0];
      if (!kokoroModel) {
        installTtsCatalogModel("kokoro-onnx-q8");
      }
      if (!ttsReady) {
        await runExclusiveTtsOperation(() => startTts({ model: (kokoroModel || {}).filename || "kokoro-onnx-q8.json" }));
      }
      const output = await runExclusiveTtsOperation(() => synthesizeTts(text, {
        speed,
        voice,
        model: (kokoroModel || {}).filename || "kokoro-onnx-q8.json",
        lang: body.lang,
      }));
      return json(res, 200, { ok: true, url: output.url, engine: "kokoro" });
    } catch (err) {
      console.error("  [audio-api] TTS hatası:", err);
      return json(res, 500, { ok: false, error: err.message || String(err) });
    }
  }

  // GET /api/audio/reference-voices - List voice cloning reference samples
  if (req.url === "/api/audio/reference-voices" && req.method === "GET") {
    try {
      if (!fs.existsSync(REFERENCE_VOICES)) fs.mkdirSync(REFERENCE_VOICES, { recursive: true });
      const files = fs.readdirSync(REFERENCE_VOICES)
        .filter(f => /\.(wav|mp3|ogg|m4a|flac)$/i.test(f))
        .map(f => {
          const p = path.join(REFERENCE_VOICES, f);
          const st = fs.statSync(p);
          let transcript = "";
          const txtCandidates = [p + ".txt", path.join(REFERENCE_VOICES, path.parse(f).name + ".txt")];
          for (const tc of txtCandidates) {
            if (fs.existsSync(tc)) {
              try { transcript = fs.readFileSync(tc, "utf-8").trim(); break; } catch (_) {}
            }
          }
          return {
            filename: f,
            name: path.parse(f).name,
            path: p,
            sizeBytes: st.size,
            url: `/api/audio/reference-voice-file/${encodeURIComponent(f)}`,
            transcript: transcript || null,
            createdAt: st.mtime.toISOString()
          };
        });
      return json(res, 200, { ok: true, voices: files });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // GET /api/audio/reference-voice-file/:filename
  if (req.url.startsWith("/api/audio/reference-voice-file/") && req.method === "GET") {
    const filename = path.basename(decodeURIComponent(req.url.replace(/^\/api\/audio\/reference-voice-file\//, "").split("?")[0] || ""));
    const filePath = path.join(REFERENCE_VOICES, filename);
    if (!filename || !fs.existsSync(filePath)) {
      return json(res, 404, { ok: false, error: "Reference voice not found" });
    }
    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      "Content-Type": filename.endsWith(".mp3") ? "audio/mpeg" : "audio/wav",
      "Content-Length": stat.size
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // POST /api/audio/upload-reference-voice
  if (req.url === "/api/audio/upload-reference-voice" && req.method === "POST") {
    try {
      const body = await readJsonBody(req, res);
      if (!body || !body.data || !body.filename) {
        return json(res, 400, { ok: false, error: "filename and base64 data required" });
      }
      const safeName = path.basename(body.filename).replace(/[^a-zA-Z0-9._-]/g, "_");
      const outPath = path.join(REFERENCE_VOICES, safeName);
      const base64Data = body.data.replace(/^data:audio\/\w+;base64,/, "");
      fs.writeFileSync(outPath, Buffer.from(base64Data, "base64"));
      return json(res, 200, {
        ok: true,
        filename: safeName,
        path: outPath,
        url: `/api/audio/reference-voice-file/${encodeURIComponent(safeName)}`
      });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // GET /api/audio/omnivoice-status - OmniVoice model download status
  if (req.url === "/api/audio/omnivoice-status" && req.method === "GET") {
    try {
      const omni = findOmniVoiceWeights();
      const totalBytes = 2450344112;
      const downloadedBytes = omni.size;
      const installed = omni.installed;
      const pct = Math.min(100, Math.round((downloadedBytes / totalBytes) * 1000) / 10);
      return json(res, 200, {
        ok: true,
        installed,
        downloading: Boolean(downloadState.active && downloadState.kind === "omnivoice"),
        downloadedBytes,
        totalBytes,
        progressPct: pct,
        downloadedMb: Math.round(downloadedBytes / (1024 * 1024)),
        totalMb: Math.round(totalBytes / (1024 * 1024)),
      });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // GET /api/music/models - List music & audio generation models
  if (req.url === "/api/music/models" && req.method === "GET") {
    try {
      const has = (file) => fs.existsSync(path.join(MUSIC_MODELS, file));
      const models = [
        {
          id: "musicgen-small",
          name: "Meta MusicGen Small (300M)",
          filename: "musicgen-small-local",
          snapshotId: "musicgen-small",
          format: "Transformers (klasör)",
          approxSize: "2.4 GB",
          resolution: "32 kHz mono",
          installed: isSnapshotInstalled("musicgen-small"),
          notes: "Metinden enstrümantal müzik üreten 300M parametreli otoregresif model (EnCodec 32 kHz, mono). En hızlı MusicGen. CC-BY-NC 4.0 (ticari olmayan kullanım).",
          url: "https://huggingface.co/facebook/musicgen-small",
          pageUrl: "https://huggingface.co/facebook/musicgen-small",
          recommendedTiers: ["Low", "Mid", "High"],
        },
        {
          id: "musicgen-medium",
          name: "Meta MusicGen Medium (1.5B)",
          filename: "musicgen-medium.safetensors",
          format: "AudioCraft state_dict",
          approxSize: "3.7 GB",
          resolution: "32 kHz mono",
          installed: has("musicgen-medium.safetensors"),
          requires: "musicgen-small",
          notes: "1.5B parametreli MusicGen. AudioCraft ağırlık dosyası (state_dict.bin) indirilir; metin kodlayıcı ve EnCodec için MusicGen Small klasörü de gerekir. CC-BY-NC 4.0.",
          url: "https://huggingface.co/facebook/musicgen-medium/resolve/main/state_dict.bin",
          pageUrl: "https://huggingface.co/facebook/musicgen-medium",
          recommendedTiers: ["Mid", "High"],
        },
        {
          id: "musicgen-large",
          name: "Meta MusicGen Large (3.3B)",
          filename: "musicgen-large.safetensors",
          format: "AudioCraft state_dict",
          approxSize: "6.5 GB",
          resolution: "32 kHz mono",
          installed: has("musicgen-large.safetensors"),
          requires: "musicgen-small",
          notes: "3.3B parametreli en büyük MusicGen. AudioCraft ağırlık dosyası (state_dict.bin) indirilir; MusicGen Small klasörü de gerekir. 12 GB+ VRAM önerilir. CC-BY-NC 4.0.",
          url: "https://huggingface.co/facebook/musicgen-large/resolve/main/state_dict.bin",
          pageUrl: "https://huggingface.co/facebook/musicgen-large",
          recommendedTiers: ["High", "Ultra"],
        },
        {
          id: "audioldm2-large",
          name: "AudioLDM 2 Large (ses efekti)",
          filename: "audioldm2-large",
          snapshotId: "audioldm2-large",
          format: "Diffusers (klasör)",
          approxSize: "6.0 GB",
          resolution: "16 kHz mono",
          installed: isSnapshotInstalled("audioldm2-large") || isHfModelReady("models--cvssp--audioldm2-large"),
          notes: "750M parametreli UNet'e sahip AudioLDM 2 büyük sürüm; metinden ses efekti ve ortam sesi üretir (16 kHz). CC-BY-NC-SA 4.0.",
          url: "https://huggingface.co/cvssp/audioldm2-large",
          pageUrl: "https://huggingface.co/cvssp/audioldm2-large",
          recommendedTiers: ["High", "Ultra"],
        },
        {
          id: "audioldm2",
          name: "AudioLDM 2 (ses efekti)",
          filename: "audioldm2",
          snapshotId: "audioldm2",
          format: "Diffusers (klasör)",
          approxSize: "4.5 GB",
          resolution: "16 kHz mono",
          installed: isSnapshotInstalled("audioldm2") || isHfModelReady("models--cvssp--audioldm2"),
          notes: "350M parametreli UNet'li temel AudioLDM 2 (Flan-T5 + CLAP koşullandırma), 16 kHz. CC-BY-NC-SA 4.0.",
          url: "https://huggingface.co/cvssp/audioldm2",
          pageUrl: "https://huggingface.co/cvssp/audioldm2",
          recommendedTiers: ["Mid", "High"],
        },
        {
          id: "audioldm-small",
          name: "AudioLDM-S Full v2 (hafif ses efekti)",
          filename: "audioldm-s-full-v2",
          snapshotId: "audioldm-small",
          format: "Diffusers (klasör)",
          approxSize: "1.7 GB",
          resolution: "16 kHz mono",
          installed: isSnapshotInstalled("audioldm-small") || isHfModelReady("models--cvssp--audioldm-s-full-v2"),
          notes: "İlk nesil AudioLDM'nin küçük (S) sürümü; en az bellekle hızlı ses efekti üretir (16 kHz). CC-BY-NC-SA 4.0.",
          url: "https://huggingface.co/cvssp/audioldm-s-full-v2",
          pageUrl: "https://huggingface.co/cvssp/audioldm-s-full-v2",
          recommendedTiers: ["Low", "Mid"],
        },
        {
          id: "stable-audio-3-small-music",
          name: "Stable Audio 3 Small Music (433M)",
          filename: "stable-audio-3-small-music",
          snapshotId: "stable-audio-3-small-music",
          format: "Stable Audio 3 (klasör)",
          approxSize: "3.5 GB",
          resolution: "44.1 kHz stereo",
          maxDuration: 120,
          isGated: true,
          installed: isSnapshotInstalled("stable-audio-3-small-music"),
          notes: "Stability AI'ın 2026 müzik modeli: 8 adımda, işlemcide bile hızlı, 44.1 kHz stereo, en fazla 120 sn. İndirmek için Hugging Face'te model sayfasında lisansı kabul edip HF Token eklemeniz gerekir. Stability AI Community License (yıllık geliri 1 milyon $ altı ticari kullanım serbest) + Gemma kullanım şartları.",
          url: "https://huggingface.co/stabilityai/stable-audio-3-small-music",
          pageUrl: "https://huggingface.co/stabilityai/stable-audio-3-small-music",
          recommendedTiers: ["Low", "Mid", "High"],
        },
        {
          id: "stable-audio-3-medium",
          name: "Stable Audio 3 Medium (1.4B)",
          filename: "stable-audio-3-medium",
          snapshotId: "stable-audio-3-medium",
          format: "Stable Audio 3 (klasör)",
          approxSize: "10.4 GB",
          resolution: "44.1 kHz stereo",
          maxDuration: 300,
          isGated: true,
          installed: isSnapshotInstalled("stable-audio-3-medium"),
          notes: "Stable Audio 3'ün en büyük açık modeli: daha uzun ve daha kaliteli parçalar (uygulamada en fazla 300 sn), 44.1 kHz stereo. NVIDIA ekran kartı gerekir (yaklaşık 6-7 GB VRAM). Lisans onayı ve HF Token gerekir. Stability AI Community License + Gemma kullanım şartları.",
          url: "https://huggingface.co/stabilityai/stable-audio-3-medium",
          pageUrl: "https://huggingface.co/stabilityai/stable-audio-3-medium",
          recommendedTiers: ["Mid", "High"],
        },
        {
          id: "stable-audio-3-small-sfx",
          name: "Stable Audio 3 Small SFX (ses efekti, 433M)",
          filename: "stable-audio-3-small-sfx",
          snapshotId: "stable-audio-3-small-sfx",
          format: "Stable Audio 3 (klasör)",
          approxSize: "3.5 GB",
          resolution: "44.1 kHz stereo",
          maxDuration: 120,
          isGated: true,
          installed: isSnapshotInstalled("stable-audio-3-small-sfx"),
          notes: "Stable Audio 3'ün ses efekti modeli: 44.1 kHz stereo foley ve ortam sesleri, işlemcide bile hızlı. Lisans onayı ve HF Token gerekir. Stability AI Community License + Gemma kullanım şartları.",
          url: "https://huggingface.co/stabilityai/stable-audio-3-small-sfx",
          pageUrl: "https://huggingface.co/stabilityai/stable-audio-3-small-sfx",
          recommendedTiers: ["Low", "Mid", "High"],
        },
      ];
      return json(res, 200, { ok: true, models });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  // GET /api/audio/progress - Real-time progress for TTS, Music, and SFX
  if (req.url === "/api/audio/progress" && req.method === "GET") {
    let active = audioGenerationProgress.active || ttsGenerationState.active || isAudioGenerating;
    let progress = audioGenerationProgress.progress;
    let phase = audioGenerationProgress.phase;
    let mode = audioGenerationProgress.mode;

    if (ttsGenerationState.active && (!audioGenerationProgress.active || audioGenerationProgress.mode === "tts")) {
      active = true;
      mode = "tts";
      phase = ttsGenerationState.phase || phase || "Ses sentezleniyor...";
      if (ttsGenerationState.progress > 0) {
        progress = ttsGenerationState.progress;
      }
    }

    return json(res, 200, {
      ok: true,
      active,
      mode: mode || "audio",
      progress: progress || 0,
      phase: phase || "",
      step: audioGenerationProgress.step || 0,
      totalSteps: audioGenerationProgress.totalSteps || 0,
      model: audioGenerationProgress.model || ttsGenerationState.model || "",
      startedAt: audioGenerationProgress.startedAt || 0,
    });
  }

  // POST /api/audio/music - Real PyTorch/MusicGen AI & SFX generation
  if (req.url === "/api/audio/music" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body || !body.prompt) return json(res, 400, { ok: false, error: "Müzik veya ses istemi (prompt) gereklidir." });
    
    isAudioGenerating = true;
    try {
      const stamp = Date.now();
      const wavFilename = `music_${stamp}.wav`;
      const jsonFilename = `music_${stamp}.json`;
      const wavPath = path.join(AUDIO_OUTPUTS, wavFilename);
      const model = String(body.model || "musicgen-small");
      const isStableAudio = Boolean(SNAPSHOT_MODELS[model]) && model.startsWith("stable-audio-3-");
      // Stable Audio 3 Small is trained for up to 120 s; Medium and MusicGen go up to the app's 300 s.
      const maxDuration = isStableAudio && model.includes("small") ? 120 : 300;
      const duration = Math.min(maxDuration, Math.max(2, Number(body.duration) || 10));
      const mode = body.mode || (model.includes("audioldm") || model.includes("sfx") ? "sfx" : "music");
      if (/stable-audio/i.test(model) && !isStableAudio) {
        isAudioGenerating = false;
        return json(res, 400, { ok: false, error: `Bilinmeyen Stable Audio modeli: ${model}` });
      }
      if (isStableAudio && !isSnapshotInstalled(model)) {
        isAudioGenerating = false;
        return json(res, 404, { ok: false, error: `${SNAPSHOT_MODELS[model].label} indirilmemiş. Model Merkezi > Müzik bölümünden indirin (Hugging Face lisans onayı ve HF Token gerekir).` });
      }
      if (mode === "music" && /musicgen-(medium|large)/.test(model)) {
        const ckpt = path.join(MUSIC_MODELS, model.includes("large") ? "musicgen-large.safetensors" : "musicgen-medium.safetensors");
        if (!fs.existsSync(ckpt)) {
          isAudioGenerating = false;
          return json(res, 404, { ok: false, error: `${model} ağırlık dosyası (${path.basename(ckpt)}) bulunamadı. Model Merkezi > Müzik'ten indirin.` });
        }
      }

      audioGenerationProgress = {
        active: true,
        mode: mode,
        phase: isStableAudio
          ? `${SNAPSHOT_MODELS[model].label} hazırlanıyor...`
          : mode === "sfx" ? `${model.includes("large") ? "AudioLDM 2 Large" : (model.includes("2") || model.includes("base")) ? "AudioLDM 2 Base" : "AudioLDM-S"} ses efekti hazirlaniyor...` : `Müzik sentezleniyor (${duration} sn)...`,
        progress: 6,
        step: 0,
        totalSteps: duration,
        model: model,
        startedAt: Date.now()
      };

      const pythonBin = isStableAudio
        ? requirePythonFor("stable-audio", SNAPSHOT_MODELS[model].label)
        : requirePythonFor(mode === "sfx" ? "sfx" : "music", mode === "sfx" ? "AudioLDM ses efekti" : "MusicGen müzik üretimi");
      const workerScript = path.join(ROOT, "scripts", "workers", isStableAudio ? "stable-audio-worker.py" : "music-worker.py");

      const payload = {
        prompt: body.prompt,
        duration: duration,
        model: model,
        mode: mode,
        output: wavPath,
        seed: body.seed || Math.floor(Math.random() * 10000000)
      };

      const proc = trackJobProcess(spawn(pythonBin, [workerScript], {
        cwd: ROOT,
        stdio: "pipe",
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1"
        }
      }));

      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d) => { stdout += d.toString(); });
      proc.stderr.on("data", (d) => {
        const text = d.toString();
        stderr += text;
        process.stderr.write("  [music-ai] " + text);
        const lines = text.split("\n");
        for (const line of lines) {
          if (line.includes("@@PROGRESS")) {
            try {
              const jsonStr = line.split("@@PROGRESS")[1].trim();
              const p = JSON.parse(jsonStr);
              if (p.phase) audioGenerationProgress.phase = p.phase;
              if (typeof p.progress === "number") {
                audioGenerationProgress.progress = p.progress;
              }
              if (p.step) audioGenerationProgress.step = p.step;
              if (p.total) audioGenerationProgress.totalSteps = p.total;
            } catch (_) {}
          }
        }
      });

      proc.stdin.end(Buffer.from(JSON.stringify(payload), "utf-8"));

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          try { proc.kill("SIGKILL"); } catch (_) {}
          reject(new Error("Müzik veya ses efekti üretim işlemi zaman aşımına uğradı (600 saniye)."));
        }, 600000);

        proc.on("close", (code) => {
          clearTimeout(timeout);
          if (code === 0) return resolve();
          // Prefer the worker's own JSON error over raw stderr (which is full of progress lines).
          let workerError = "";
          try { workerError = parseWorkerJson(stdout).error || ""; } catch (_) {}
          const stderrTail = stderr.split(/\r?\n/).filter((line) => line.trim() && !line.includes("@@PROGRESS")).slice(-6).join("\n");
          reject(new Error(workerError || stderrTail || `Müzik worker çıkış kodu: ${code}`));
        });
        proc.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      let workerResult = {};
      try {
        workerResult = parseWorkerJson(stdout);
      } catch (_) {}

      if (!fs.existsSync(wavPath)) {
        throw new Error(workerResult.error || "Ses dosyası üretilemedi.");
      }

      const resolvedModel = workerResult.model || model;
      const metadata = {
        id: "music_" + stamp,
        prompt: body.prompt,
        duration: duration,
        model: resolvedModel,
        filename: wavFilename,
        sampleRate: workerResult.sampleRate || 32000,
        channels: workerResult.channels || 1,
        genDuration: workerResult.genDuration,
        seed: workerResult.seed,
        isSfx: workerResult.isSfx || false,
        createdAt: new Date().toISOString(),
        url: `/audio-outputs/${wavFilename}`
      };
      fs.writeFileSync(path.join(AUDIO_OUTPUTS, jsonFilename), JSON.stringify(metadata, null, 2), "utf8");

      audioGenerationProgress.progress = 100;
      audioGenerationProgress.phase = "Tamamlandı";

      return json(res, 200, {
        ok: true,
        message: workerResult.isSfx 
          ? `Ses efekti (${duration} sn) başarıyla üretildi!`
          : `Yapay zekâ müzik parçası (${duration} sn) başarıyla üretildi!`,
        url: `/audio-outputs/${wavFilename}`,
        audioUrl: `/audio-outputs/${wavFilename}`,
        filename: wavFilename,
        audio: metadata
      });
    } catch (err) {
      console.error("Music generation error:", err);
      return json(res, 500, { ok: false, error: "Üretim sırasında hata oluştu: " + err.message });
    } finally {
      isAudioGenerating = false;
      audioGenerationProgress.active = false;
      audioGenerationProgress.progress = 0;
    }
  }

  // GET /api/audio/history - Unified history of music, sfx, and tts generations
  if (req.url === "/api/audio/history" && req.method === "GET") {
    try {
      const items = [];

      // Read audio-outputs (music & sfx)
      if (fs.existsSync(AUDIO_OUTPUTS)) {
        const audioFiles = fs.readdirSync(AUDIO_OUTPUTS);
        for (const file of audioFiles) {
          if (file.toLowerCase().endsWith(".json")) {
            const jsonPath = path.join(AUDIO_OUTPUTS, file);
            try {
              const meta = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
              const stat = fs.statSync(jsonPath);
              const wavFile = meta.filename || file.replace(/\.json$/i, ".wav");
              const wavPath = path.join(AUDIO_OUTPUTS, wavFile);
              if (fs.existsSync(wavPath)) {
                items.push({
                  id: meta.id || file.replace(/\.json$/i, ""),
                  type: meta.isSfx ? "sfx" : "music",
                  title: meta.prompt || "Ses Üretimi",
                  prompt: meta.prompt || "",
                  duration: meta.duration || 10,
                  model: meta.model || (meta.isSfx ? "audioldm-sfx" : "musicgen-small"),
                  isSfx: Boolean(meta.isSfx),
                  sampleRate: meta.sampleRate,
                  genDuration: meta.genDuration,
                  url: meta.url || `/audio-outputs/${encodeURIComponent(wavFile)}`,
                  filename: wavFile,
                  createdAt: meta.createdAt || stat.mtime.toISOString(),
                  mtimeMs: stat.mtimeMs,
                  size: formatBytes(fs.statSync(wavPath).size),
                });
              }
            } catch (_) {}
          }
        }
      }

      // Read tts-outputs
      if (fs.existsSync(TTS_OUTPUTS)) {
        const ttsFiles = fs.readdirSync(TTS_OUTPUTS);
        for (const file of ttsFiles) {
          if (file.toLowerCase().endsWith(".json")) {
            const jsonPath = path.join(TTS_OUTPUTS, file);
            try {
              const meta = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
              const stat = fs.statSync(jsonPath);
              const wavFile = meta.audioFile || file.replace(/\.json$/i, ".wav");
              const wavPath = path.join(TTS_OUTPUTS, wavFile);
              if (fs.existsSync(wavPath)) {
                items.push({
                  id: meta.id || file.replace(/\.json$/i, ""),
                  type: "tts",
                  title: meta.text || meta.displayName || "Seslendirme",
                  prompt: meta.text || "",
                  duration: meta.duration || meta.audioDuration || 0,
                  model: meta.modelId || meta.model || "TTS",
                  voice: meta.voice || meta.speaker || "",
                  isSfx: false,
                  url: meta.url || `/tts-outputs/${encodeURIComponent(wavFile)}`,
                  filename: wavFile,
                  createdAt: meta.createdAt || stat.mtime.toISOString(),
                  mtimeMs: stat.mtimeMs,
                  size: formatBytes(fs.statSync(wavPath).size),
                });
              }
            } catch (_) {}
          }
        }
      }

      items.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));

      return json(res, 200, { ok: true, items });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // POST /api/audio/delete - Delete audio output and metadata
  if (req.url === "/api/audio/delete" && req.method === "POST") {
    try {
      const body = await readJsonBody(req, res);
      const filename = body?.filename;
      const type = body?.type;
      if (!filename) return json(res, 400, { ok: false, error: "Dosya adı gereklidir." });

      const targetDir = type === "tts" ? TTS_OUTPUTS : AUDIO_OUTPUTS;
      const cleanName = path.basename(filename);
      const wavPath = path.join(targetDir, cleanName);
      const jsonFile = cleanName.replace(/\.[^.]+$/, ".json");
      const jsonPath = path.join(targetDir, jsonFile);

      if (fs.existsSync(wavPath) && pathInside(wavPath, targetDir)) {
        try { fs.unlinkSync(wavPath); } catch (_) {}
      }
      if (fs.existsSync(jsonPath) && pathInside(jsonPath, targetDir)) {
        try { fs.unlinkSync(jsonPath); } catch (_) {}
      }

      return json(res, 200, { ok: true });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // GET /api/video/models - List video generation models & library
  if (req.url === "/api/video/models" && req.method === "GET") {
    try {
      const catalog = [
        {
          id: "animatediff-v15",
          name: "AnimateDiff v1.5 v2 + Realistic Vision 5.1 (T2V)",
          tier: "Low",
          tierLabel: "Düşük: 6-8 GB VRAM",
          filename: "mm_sd_v15_v2.ckpt",
          format: "Motion module (CKPT) + SD 1.5",
          approxSize: "1.8 GB (+2.1 GB SD 1.5)",
          resolution: "512x512, 16 kare",
          minVramGb: 6,
          modes: ["t2v"],
          installed: isAnimateDiffReady(),
          notes: "SD 1.5 tabanlı hareket modülü; 512x512 çözünürlükte 16 karelik kısa klip üretir. app/models içinde Realistic Vision 5.1 (veya DreamShaper 8 / SD 1.5) de gerekir.",
          url: "https://huggingface.co/guoyww/animatediff/resolve/main/mm_sd_v15_v2.ckpt",
          pageUrl: "https://huggingface.co/guoyww/animatediff",
          recommendedTiers: ["Low", "Mid", "High"],
        },
        {
          id: "wan21-1.3b",
          name: "Wan 2.1 T2V 1.3B (Diffusers)",
          tier: "Mid",
          tierLabel: "Orta: 8 GB+ VRAM (CPU offload ile)",
          filename: "wan21-t2v-1.3b",
          snapshotId: "wan21-t2v-1.3b",
          format: "Diffusers (DiT + UMT5-XXL + VAE)",
          approxSize: "~29 GB (fp32 UMT5-XXL metin kodlayıcı dahil)",
          resolution: "832x480 (480p), 16 FPS",
          minVramGb: 8,
          modes: ["t2v"],
          installed: isWan13bReady(),
          notes: "Alibaba Wan 2.1'in 1.3B parametreli metinden video modeli. Resmi önerilen çözünürlük 480p (720p kararsızdır); resmi asgari 8.19 GB VRAM. Model CPU offload ile çalıştırılır, 32 GB+ sistem RAM önerilir. Apache-2.0.",
          url: "https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
          pageUrl: "https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
          recommendedTiers: ["Mid", "High"],
        },
        {
          id: "svd-xt",
          name: "Stable Video Diffusion XT 1.1 (I2V, Diffusers fp16)",
          tier: "Mid",
          tierLabel: "Orta: 12 GB+ VRAM",
          filename: "svd-xt-1.1",
          snapshotId: "svd-xt-1.1",
          format: "Diffusers fp16 (UNet + VAE + CLIP görüntü kodlayıcı)",
          approxSize: "4.5 GB",
          resolution: "1024x576, 25 kare",
          minVramGb: 12,
          modes: ["i2v"],
          installed: isSvdReady(),
          notes: "Tek bir görselden 25 karelik kısa video üretir (görselden video). Stability AI Community lisansı. Tek dosyalık svd_xt_1_1.safetensors diffusers ile yüklenemediği için Diffusers klasörü indirilir.",
          url: "https://huggingface.co/vdo/stable-video-diffusion-img2vid-xt-1-1",
          pageUrl: "https://huggingface.co/vdo/stable-video-diffusion-img2vid-xt-1-1",
          recommendedTiers: ["Mid", "High"],
        },
        {
          id: "ltx-video-2b",
          name: "Lightricks LTX-Video 2B v0.9 (entegre değil)",
          tier: "Mid",
          tierLabel: "Bu sürümde desteklenmiyor",
          filename: "ltx-video-2b-v0.9.safetensors",
          format: "Safetensors (DiT + VAE)",
          approxSize: "9.4 GB (+ T5 metin kodlayıcı)",
          resolution: "768x512, 24 FPS",
          minVramGb: 12,
          modes: ["t2v", "i2v"],
          installed: false,
          supported: false,
          downloaded: fs.existsSync(path.join(VIDEO_MODELS, "ltx-video-2b-v0.9.safetensors")),
          notes: "2B parametreli DiT video modeli. Ayrı bir T5-XXL metin kodlayıcısı ve LTX boru hattı gerektirir; bu sürümde video worker'ına entegre edilmedi.",
          url: "",
          pageUrl: "https://huggingface.co/Lightricks/LTX-Video",
          recommendedTiers: ["Mid", "High"],
        },
        {
          id: "cloud:minimax-hailuo-02",
          name: "MiniMax Hailuo 02 (Bulut API)",
          tier: "Cloud",
          tierLabel: "Bulut API",
          filename: "cloud:minimax-hailuo-02",
          format: "API",
          approxSize: "Bulut API",
          resolution: "768P, 6 veya 10 sn",
          minVramGb: 0,
          modes: ["t2v"],
          installed: Boolean(getProvidersConfig().keys?.minimax),
          isCloud: true,
          notes: "MiniMax API anahtarı ile api.minimax.io üzerinden metinden video (MiniMax-Hailuo-02). Ücretlidir.",
          url: "",
          pageUrl: "https://platform.minimax.io",
          recommendedTiers: ["Cloud", "Low", "Mid", "High"],
        },
        {
          id: "cloud:minimax-hailuo-2.3",
          name: "MiniMax Hailuo 2.3 (Bulut API)",
          tier: "Cloud",
          tierLabel: "Bulut API",
          filename: "cloud:minimax-hailuo-2.3",
          format: "API",
          approxSize: "Bulut API",
          resolution: "768P, 6 veya 10 sn",
          minVramGb: 0,
          modes: ["t2v"],
          installed: Boolean(getProvidersConfig().keys?.minimax),
          isCloud: true,
          notes: "MiniMax API anahtarı ile api.minimax.io üzerinden metinden video (MiniMax-Hailuo-2.3). Ücretlidir.",
          url: "",
          pageUrl: "https://platform.minimax.io",
          recommendedTiers: ["Cloud", "Low", "Mid", "High"],
        },
      ];
      return json(res, 200, { ok: true, models: catalog });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

function getFfmpegPath() {
  const wingetPath = path.join(os.homedir(), "AppData", "Local", "Microsoft", "WinGet", "Links", "ffmpeg.exe");
  if (fs.existsSync(wingetPath)) return wingetPath;
  try {
    const which = spawnSync(os.platform() === "win32" ? "where" : "which", ["ffmpeg"], { encoding: "utf8" });
    if (which.status === 0) {
      const line = which.stdout.trim().split("\n")[0].trim();
      if (line && fs.existsSync(line)) return line;
    }
  } catch (_) {}
  return "ffmpeg";
}

function sd15AnimateDiffBases() {
  return ["Realistic_Vision_V5.1_fp16-no-ema.safetensors", "DreamShaper_8_pruned.safetensors", "v1-5-pruned-emaonly.safetensors"];
}

function isAnimateDiffReady() {
  return fs.existsSync(path.join(VIDEO_MODELS, "mm_sd_v15_v2.ckpt")) &&
    sd15AnimateDiffBases().some((file) => fs.existsSync(path.join(MODELS, file)));
}

function isWan13bReady() {
  return isSnapshotInstalled("wan21-t2v-1.3b");
}

function isSvdReady() {
  return fs.existsSync(path.join(VIDEO_MODELS, "svd-xt-1.1", "model_index.json")) &&
    fs.existsSync(path.join(VIDEO_MODELS, "svd-xt-1.1", "unet", "diffusion_pytorch_model.fp16.safetensors"));
}

// Returns null when the engine can run locally, otherwise { status, error }.
function getLocalVideoEngineIssue(engine, mode, hasImage) {
  const id = String(engine || "");
  if (id === "animatediff-v15" || id === "animatediff") {
    if (mode === "i2v" || hasImage) return { status: 400, error: "AnimateDiff yalnızca metinden video (T2V) üretir. Görselden video için SVD-XT 1.1 seçin." };
    return isAnimateDiffReady() ? null : { status: 404, error: "AnimateDiff için app/video-models/mm_sd_v15_v2.ckpt ve app/models içinde bir SD 1.5 modeli (Realistic Vision 5.1, DreamShaper 8 veya SD 1.5) gerekir." };
  }
  if (id === "wan21-1.3b") {
    if (mode === "i2v" || hasImage) return { status: 400, error: "Wan 2.1 T2V 1.3B yalnızca metinden video üretir. Görselden video için SVD-XT 1.1 seçin." };
    return isWan13bReady() ? null : { status: 404, error: "Wan 2.1 T2V 1.3B Diffusers klasörü (app/video-models/wan21-t2v-1.3b) bulunamadı veya indirme yarım kalmış (vae/transformer eksik). Model Merkezi > Video'dan indirmeyi yeniden başlatın; tamamlanmış dosyalar atlanır." };
  }
  if (id === "svd-xt") {
    if (!hasImage) return { status: 400, error: "SVD-XT 1.1 görselden video (I2V) modelidir; bir başlangıç görseli yükleyin." };
    return isSvdReady() ? null : { status: 404, error: "SVD-XT 1.1 Diffusers klasörü (app/video-models/svd-xt-1.1) bulunamadı. Model Merkezi > Video'dan indirin (tek dosyalık svd_xt_1_1.safetensors diffusers ile yüklenemez)." };
  }
  return { status: 501, error: `"${id}" video motoru bu sürümde entegre değil. Desteklenen yerel motorlar: AnimateDiff, Wan 2.1 T2V 1.3B, SVD-XT 1.1.` };
}

async function renderAIVideo({ prompt, mode = "t2v", engine = "animatediff-v15", duration = 3, fps = 16, resolution = "512x512", outputPath, inputImageBase64 }) {
  if (!fs.existsSync(VIDEO_WORKER)) {
    throw new Error("Video üretim worker'ı (scripts/workers/video-generator-worker.py) bulunamadı.");
  }
  const pyBin = requirePythonFor("video", "Yerel video üretimi");
  return new Promise((resolve, reject) => {
    console.log(`  [video] Yapay zeka video uretimi baslatiliyor: "${String(prompt || '').slice(0, 45)}..." engine=${engine} mode=${mode}`);
    const proc = trackJobProcess(spawn(pyBin, [VIDEO_WORKER], {
      cwd: ROOT,
      stdio: "pipe",
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1"
      }
    }));

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => {
      const text = d.toString();
      stderr += text;
      process.stderr.write("  [video-worker] " + text);
      for (const line of text.split(/\r?\n/)) {
        if (!line.includes("@@PROGRESS")) continue;
        try {
          const p = JSON.parse(line.split("@@PROGRESS")[1].trim());
          if (p.phase === "loading") {
            videoGenerationState.phase = "loading";
            videoGenerationState.progress = 10;
          } else if (p.phase === "denoising" && p.total > 0) {
            videoGenerationState.phase = "denoising";
            videoGenerationState.progress = Math.min(95, Math.max(10, 10 + Math.round((p.step / p.total) * 85)));
            videoGenerationState.step = p.step;
            videoGenerationState.totalSteps = p.total;
          } else if (p.phase === "encoding") {
            videoGenerationState.phase = "encoding";
            videoGenerationState.progress = 96;
          }
        } catch (_) {}
      }
    });

    proc.on("error", reject);

    proc.on("close", (code) => {
      let parsed = null;
      try {
        const lastLine = stdout.trim().split(/\r?\n/).pop();
        parsed = JSON.parse(lastLine || "{}");
      } catch (_) {}
      if (code === 0 && parsed?.ok !== false && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
        console.log(`  [video] AI Video basariyla olusturuldu (${fs.statSync(outputPath).size} bytes): ${outputPath}`);
        resolve(parsed || {});
        return;
      }
      if (parsed && parsed.ok === false && parsed.error) {
        reject(new Error(parsed.error));
        return;
      }
      reject(new Error(code === null ? "Video üretimi durduruldu." : `Video worker basarisiz oldu (kod: ${code}). Hata: ${stderr.slice(-400)}`));
    });

    proc.stdin.write(JSON.stringify({
      prompt,
      mode,
      engine,
      duration,
      fps,
      resolution,
      output: outputPath,
      input_image: inputImageBase64
    }));
    proc.stdin.end();
  });
}

  // POST /api/video/generate - Video Generation (Wan 2.1 / AnimateDiff / LTX-Video)
  if (req.url === "/api/video/generate" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    const { prompt, mode = "t2v", engine = "wan21-1.3b", duration = 3, fps = 16, resolution = "512x512", inputImageBase64 } = body;

    // Cloud Video Generation Handler (only MiniMax Hailuo is implemented)
    if (String(engine).startsWith("cloud:")) {
      if (!String(engine).startsWith("cloud:minimax")) {
        return json(res, 501, { ok: false, error: `${engine} bulut video servisi bu sürümde entegre değil. Bulut video için MiniMax Hailuo kullanılabilir.` });
      }
      const cfg = getProvidersConfig();
      const apiKey = cfg.keys?.minimax;
      if (!apiKey) {
        return json(res, 400, {
          ok: false,
          error: "MiniMax API anahtarınız ayarlanmamış. Lütfen 'Hibrit API' sekmesinden MiniMax anahtarınızı kaydedin."
        });
      }
      if (videoGenerationState.active) {
        return json(res, 409, { ok: false, error: "Başka bir video üretimi devam ediyor." });
      }

      const videoId = "vid_" + Date.now();
      const filename = `${videoId}.mp4`;
      const outputPath = path.join(VIDEO_OUTPUTS, filename);
      const cloudVideoUrl = `/video-outputs/${filename}`;
      const mmModel = String(engine).includes("2.3") ? "MiniMax-Hailuo-2.3" : "MiniMax-Hailuo-02";
      const mmDuration = Number(duration) >= 10 ? 10 : 6;

      videoGenerationState = {
        active: true, id: videoId, filename, url: cloudVideoUrl, prompt, mode, engine, duration: mmDuration, fps, resolution,
        status: "processing", phase: "loading", progress: 5, step: 0, totalSteps: 20, error: null,
      };
      isVideoGenerating = true;

      (async () => {
        const base = "https://api.minimax.io/v1";
        const headers = { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" };
        const createRes = await fetch(`${base}/video_generation`, {
          method: "POST",
          headers,
          body: JSON.stringify({ model: mmModel, prompt: String(prompt || "").slice(0, 2000), duration: mmDuration, resolution: "768P" }),
        });
        const createData = await createRes.json().catch(() => ({}));
        if (!createRes.ok || !createData.task_id) {
          throw new Error(`MiniMax video görevi oluşturulamadı: ${createData.base_resp?.status_msg || `HTTP ${createRes.status}`}`);
        }
        videoGenerationState.phase = "denoising";
        videoGenerationState.progress = 15;
        const startedAt = Date.now();
        while (videoGenerationState.active && Date.now() - startedAt < 15 * 60 * 1000) {
          await new Promise((r) => setTimeout(r, 5000));
          const qRes = await fetch(`${base}/query/video_generation?task_id=${encodeURIComponent(createData.task_id)}`, { headers });
          const qData = await qRes.json().catch(() => ({}));
          const status = String(qData.status || "").toLowerCase();
          if (status === "success" && qData.file_id) {
            const fRes = await fetch(`${base}/files/retrieve?file_id=${encodeURIComponent(qData.file_id)}`, { headers });
            const fData = await fRes.json().catch(() => ({}));
            const downloadUrl = fData.file?.download_url;
            if (!downloadUrl) throw new Error("MiniMax video dosyası bağlantısı alınamadı.");
            videoGenerationState.phase = "encoding";
            videoGenerationState.progress = 92;
            const vRes = await fetch(downloadUrl);
            if (!vRes.ok) throw new Error(`MiniMax video indirilemedi (HTTP ${vRes.status}).`);
            fs.writeFileSync(outputPath, Buffer.from(await vRes.arrayBuffer()));
            return;
          }
          if (status === "fail" || status === "failed") {
            throw new Error(`MiniMax video üretimi başarısız oldu: ${qData.base_resp?.status_msg || "bilinmeyen hata"}`);
          }
          videoGenerationState.progress = Math.min(90, 15 + Math.round((Date.now() - startedAt) / 4000));
        }
        if (!videoGenerationState.active) throw new Error("Video üretimi iptal edildi.");
        throw new Error("MiniMax video üretimi zaman aşımına uğradı (15 dakika).");
      })().then(() => {
        fs.writeFileSync(path.join(VIDEO_OUTPUTS, `${videoId}.json`), JSON.stringify({
          id: videoId, filename, url: cloudVideoUrl, prompt, mode, engine, model: mmModel, duration: mmDuration, isCloud: true, createdAt: new Date().toISOString(),
        }, null, 2), "utf8");
        videoGenerationState.progress = 100;
        videoGenerationState.phase = "completed";
        videoGenerationState.status = "completed";
        videoGenerationState.active = false;
        isVideoGenerating = false;
      }).catch((err) => {
        console.error("  [cloud-video]", err.message);
        videoGenerationState.active = false;
        videoGenerationState.status = "error";
        videoGenerationState.phase = "error";
        videoGenerationState.error = err.message;
        isVideoGenerating = false;
      });

      return json(res, 200, {
        ok: true,
        message: "Bulut video üretimi başlatıldı.",
        video: { id: videoId, name: filename, url: cloudVideoUrl, prompt, mode, engine, status: "processing", createdAt: new Date().toISOString() },
      });
    }

    const engineIssue = getLocalVideoEngineIssue(engine, mode, Boolean(inputImageBase64));
    if (engineIssue) {
      return json(res, engineIssue.status, { ok: false, error: engineIssue.error });
    }
    if (videoGenerationState.active) {
      return json(res, 409, { ok: false, error: "Başka bir video üretimi devam ediyor." });
    }
    try {
      requirePythonFor("video", "Yerel video üretimi");
    } catch (err) {
      return json(res, 503, { ok: false, error: err.message });
    }

    const videoId = "vid_" + Date.now();
    const filename = `${videoId}.mp4`;
    const outputPath = path.join(VIDEO_OUTPUTS, filename);
    const videoUrl = `/video-outputs/${filename}`;

    const totalSteps = 20;

    videoGenerationState = {
      active: true,
      id: videoId,
      filename,
      url: videoUrl,
      prompt,
      mode,
      engine,
      duration,
      fps,
      resolution,
      status: "processing",
      phase: "loading",
      progress: 5,
      step: 0,
      totalSteps,
      error: null
    };
    isVideoGenerating = true;
    const renderStartedAt = Date.now();

    // Start background video render with AI Worker + FFmpeg
    renderAIVideo({
      prompt,
      mode,
      engine,
      duration,
      fps,
      resolution,
      outputPath,
      inputImageBase64
    }).then(() => {
      console.log(`  [video] Video basariyla olusturuldu: ${filename}`);
      // Sidecar metadata so the gallery can show the real engine/settings later.
      try {
        fs.writeFileSync(path.join(VIDEO_OUTPUTS, `${videoId}.json`), JSON.stringify({
          id: videoId, filename, url: videoUrl, prompt, mode, engine, duration, fps, resolution,
          genDuration: `${Math.round((Date.now() - renderStartedAt) / 1000)} sn`, createdAt: new Date().toISOString(),
        }, null, 2), "utf8");
      } catch (_) {}
      videoGenerationState.readyOnDisk = true;
      videoGenerationState.progress = 100;
      videoGenerationState.phase = "completed";
      videoGenerationState.step = videoGenerationState.totalSteps;
      videoGenerationState.active = false;
      videoGenerationState.status = "completed";
      isVideoGenerating = false;
    }).catch((err) => {
      console.error(`  [video] Video render hatasi:`, err);
      videoGenerationState.active = false;
      videoGenerationState.status = "error";
      videoGenerationState.phase = "error";
      videoGenerationState.error = err.message;
      isVideoGenerating = false;
    });

    return json(res, 200, {
      ok: true,
      message: "Video üretimi başlatıldı.",
      video: {
        id: videoId,
        name: filename,
        url: videoUrl,
        prompt,
        mode,
        engine,
        duration,
        fps,
        resolution,
        status: "processing",
        createdAt: new Date().toISOString()
      }
    });
  }

  // GET /api/video/status - returns ongoing video generation state
  if (req.url === "/api/video/status" && req.method === "GET") {
    return json(res, 200, {
      ok: true,
      active: videoGenerationState.active,
      progress: videoGenerationState.progress,
      phase: videoGenerationState.phase || "idle",
      step: videoGenerationState.step,
      totalSteps: videoGenerationState.totalSteps,
      status: videoGenerationState.status,
      error: videoGenerationState.error || null,
      video: {
        id: videoGenerationState.id,
        name: videoGenerationState.filename,
        url: videoGenerationState.url,
        prompt: videoGenerationState.prompt,
        progress: videoGenerationState.progress,
        phase: videoGenerationState.phase || "idle",
        step: videoGenerationState.step
      }
    });
  }

  // GET /api/video/gallery - List generated videos
  if (req.url === "/api/video/gallery" && req.method === "GET") {
    const vids = [];
    if (fs.existsSync(VIDEO_OUTPUTS)) {
      const files = fs.readdirSync(VIDEO_OUTPUTS).filter(f => f.endsWith(".mp4") || f.endsWith(".webm"));
      for (const file of files) {
        let meta = {};
        try { meta = JSON.parse(fs.readFileSync(path.join(VIDEO_OUTPUTS, `${path.parse(file).name}.json`), "utf8")); } catch (_) {}
        vids.push({
          ...meta,
          id: file,
          name: file,
          url: `/video-outputs/${file}`,
          createdAt: meta.createdAt || fs.statSync(path.join(VIDEO_OUTPUTS, file)).mtime
        });
      }
    }
    vids.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return json(res, 200, { ok: true, videos: vids });
  }

  // POST /api/cloud-image - Cloud image generation
  //   openai:<model>      -> OpenAI Images API (gpt-image-2)
  //   gemini:<model>      -> Google Gemini API image model ("Nano Banana", gemini-2.5-flash-image)
  //   openrouter:<model>  -> OpenRouter chat completions with image output
  //   minimax:image-01    -> MiniMax image_generation
  // The client saves the returned image into the gallery (no server-side save here).
  if (req.url === "/api/cloud-image" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    const { prompt } = body;
    const width = Number(body.width) || 1024;
    const height = Number(body.height) || 1024;
    if (!prompt) return json(res, 400, { ok: false, error: "İstem (prompt) gereklidir." });
    const rawModel = String(body.model || "").replace(/^cloud:/, "");
    const sep = rawModel.indexOf(":") >= 0 ? rawModel.indexOf(":") : rawModel.indexOf("/");
    const provider = sep > 0 ? rawModel.slice(0, sep).toLowerCase() : "";
    const modelId = sep > 0 ? rawModel.slice(sep + 1) : rawModel;
    const cfg = getProvidersConfig();
    const startTime = Date.now();
    const aspect = width === height ? "1:1" : width > height ? (width / height >= 1.6 ? "16:9" : "4:3") : (height / width >= 1.6 ? "9:16" : "3:4");
    const needKey = (key, label) => {
      const value = cfg.keys?.[key];
      if (!value) {
        const err = new Error(`${label} API anahtarınız ayarlanmamış. Lütfen 'Hibrit API & Bulut' sekmesinden kaydedin.`);
        err.statusCode = 400;
        throw err;
      }
      return value;
    };

    try {
      let b64 = "";
      let mime = "image/png";

      if (provider === "openai") {
        const apiKey = needKey("openai", "OpenAI");
        const size = width === height ? "1024x1024" : width > height ? "1536x1024" : "1024x1536";
        const oaiRes = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: modelId || "gpt-image-2", prompt, n: 1, size }),
        });
        const oaiData = await oaiRes.json().catch(() => ({}));
        if (!oaiRes.ok) throw new Error(`OpenAI görsel hatası (${oaiRes.status}): ${oaiData.error?.message || "bilinmeyen hata"}`);
        b64 = oaiData.data?.[0]?.b64_json || "";
      } else if (provider === "gemini") {
        const apiKey = needKey("gemini", "Google Gemini");
        const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId || "gemini-2.5-flash-image")}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${prompt}\n\n(Aspect ratio ${aspect})` }] }],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
          }),
        });
        const gData = await gRes.json().catch(() => ({}));
        if (!gRes.ok) throw new Error(`Gemini görsel hatası (${gRes.status}): ${gData.error?.message || "bilinmeyen hata"}`);
        const part = (gData.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data || p.inline_data?.data);
        const inline = part?.inlineData || part?.inline_data;
        b64 = inline?.data || "";
        mime = inline?.mimeType || inline?.mime_type || mime;
      } else if (provider === "openrouter") {
        const apiKey = needKey("openrouter", "OpenRouter");
        const orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/DDYapayZeka/SansursuzLokalAIStudyosu-V2",
            "X-Title": "DDYZ AI Studio",
          },
          body: JSON.stringify({
            model: modelId || "google/gemini-2.5-flash-image",
            messages: [{ role: "user", content: prompt }],
            modalities: ["image", "text"],
          }),
        });
        const orData = await orRes.json().catch(() => ({}));
        if (!orRes.ok) throw new Error(`OpenRouter görsel hatası (${orRes.status}): ${orData.error?.message || "bilinmeyen hata"}`);
        const img = orData.choices?.[0]?.message?.images?.[0];
        const dataUrl = typeof img === "string" ? img : (img?.image_url?.url || img?.image_url || "");
        const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          mime = match[1];
          b64 = match[2];
        } else if (/^https?:/i.test(String(dataUrl))) {
          const fetched = await fetch(dataUrl);
          mime = fetched.headers.get("content-type") || mime;
          b64 = Buffer.from(await fetched.arrayBuffer()).toString("base64");
        }
      } else if (provider === "minimax") {
        const apiKey = needKey("minimax", "MiniMax");
        const mmRes = await fetch("https://api.minimax.io/v1/image_generation", {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "image-01", prompt: String(prompt).slice(0, 1500), aspect_ratio: aspect, n: 1, response_format: "base64" }),
        });
        const mmData = await mmRes.json().catch(() => ({}));
        if (!mmRes.ok || (mmData.base_resp && mmData.base_resp.status_code !== 0)) {
          throw new Error(`MiniMax görsel hatası: ${mmData.base_resp?.status_msg || `HTTP ${mmRes.status}`}`);
        }
        b64 = mmData.data?.image_base64?.[0] || "";
        mime = "image/jpeg";
      } else {
        return json(res, 400, { ok: false, error: `Bilinmeyen bulut görsel modeli: ${rawModel}` });
      }

      if (!b64) throw new Error("Bulut servisi görsel verisi döndürmedi (içerik filtresi veya kota olabilir).");
      const buf = Buffer.from(b64, "base64");
      if (buf[0] === 0xff && buf[1] === 0xd8) mime = "image/jpeg";
      else if (buf[0] === 0x89 && buf[1] === 0x50) mime = "image/png";
      else if (buf.toString("ascii", 8, 12) === "WEBP") mime = "image/webp";
      const durationSec = parseFloat(((Date.now() - startTime) / 1000).toFixed(1));
      return json(res, 200, { ok: true, image: `data:${mime};base64,${b64}`, seed: null, duration_sec: durationSec });
    } catch (err) {
      console.error("  [cloud-image] Hata:", err.message || err);
      return json(res, err.statusCode || 500, { ok: false, error: err.message || String(err) });
    }
  }

  // POST /api/llm/cloud-chat - Hybrid Cloud Chat Provider Bridge
  if (req.url === "/api/llm/cloud-chat" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    const { provider = "openrouter", model, messages, temperature = 0.7, max_tokens = 2048 } = body;
    const cfg = getProvidersConfig();
    const apiKey = cfg.keys?.[provider];

    if (!apiKey) {
      return json(res, 400, {
        ok: false,
        error: `${provider.toUpperCase()} API anahtarı bulunamadı. Lütfen 'Hibrit API' sekmesinden anahtarınızı kaydedin.`
      });
    }

    try {
      if (provider === "openrouter") {
        const targetModel = model || "anthropic/claude-sonnet-5.5";
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/DDYapayZeka/SansursuzLokalAIStudyosu-V2",
            "X-Title": "DDYZ AI Studio"
          },
          body: JSON.stringify({
            model: targetModel,
            messages,
            temperature,
            max_tokens
          })
        });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`OpenRouter (${response.status}): ${errText}`);
        }
        const data = await response.json();
        return json(res, 200, { ok: true, result: data });
      } else if (provider === "anthropic") {
        const targetModel = model || "claude-sonnet-5-5";
        const systemMsg = messages.find(m => m.role === "system")?.content || "";
        const anthropicMessages = messages.filter(m => m.role !== "system").map(m => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content
        }));
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: targetModel,
            system: systemMsg,
            messages: anthropicMessages,
            max_tokens: max_tokens || 2048
          })
        });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Anthropic (${response.status}): ${errText}`);
        }
        const data = await response.json();
        const contentText = data.content?.map(c => c.text).join("\n") || "";
        return json(res, 200, {
          ok: true,
          result: {
            choices: [{ message: { role: "assistant", content: contentText } }]
          }
        });
      } else if (provider === "openai") {
        const targetModel = model || "gpt-5.5";
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: targetModel,
            messages,
            max_completion_tokens: max_tokens
          })
        });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`OpenAI (${response.status}): ${errText}`);
        }
        const data = await response.json();
        return json(res, 200, { ok: true, result: data });
      } else if (provider === "gemini") {
        const targetModel = model || "gemini-2.5-flash";
        const contents = messages.filter(m => m.role !== "system").map(m => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }]
        }));
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents })
        });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Gemini (${response.status}): ${errText}`);
        }
        const data = await response.json();
        const contentText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        return json(res, 200, {
          ok: true,
          result: {
            choices: [{ message: { role: "assistant", content: contentText } }]
          }
        });
      }
    } catch (err) {
      console.error("  [cloud-chat] Hata:", err);
      return json(res, 500, { ok: false, error: err.message || String(err) });
    }
  }

  // Helper: Read local version.json and git commit
  function readLocalVersionMeta() {
    let version = "2.0.0";
    let buildNumber = 200;
    let repo = "DDYapayZeka/SansursuzLokalAIStudyosu-V2";
    let branch = "main";
    let notes = "";
    try {
      const vf = path.join(ROOT, "version.json");
      if (fs.existsSync(vf)) {
        const parsed = JSON.parse(fs.readFileSync(vf, "utf8"));
        if (parsed.version) version = String(parsed.version).replace(/^v/i, "");
        if (Number.isFinite(Number(parsed.buildNumber))) buildNumber = Number(parsed.buildNumber);
        if (parsed.repo) repo = String(parsed.repo);
        if (parsed.branch) branch = String(parsed.branch);
        if (parsed.notes) notes = String(parsed.notes);
      }
    } catch (_) {}
    let localCommit = "";
    try {
      const headFile = path.join(ROOT, ".git", "HEAD");
      if (fs.existsSync(headFile)) {
        const headTxt = fs.readFileSync(headFile, "utf8").trim();
        if (headTxt.startsWith("ref:")) {
          const refRel = headTxt.replace(/^ref:\s*/, "").trim();
          const refFile = path.join(ROOT, ".git", refRel);
          if (fs.existsSync(refFile)) {
            localCommit = fs.readFileSync(refFile, "utf8").trim().slice(0, 7);
          }
        } else {
          localCommit = headTxt.slice(0, 7);
        }
      }
    } catch (_) {}
    return { version: "v" + version.replace(/^v/i, ""), rawVersion: version.replace(/^v/i, ""), buildNumber, repo, branch, notes, localCommit };
  }

  function compareSemverStrings(a, b) {
    const pa = String(a || "0.0.0").replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
    const pb = String(b || "0.0.0").replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) > (pb[i] || 0)) return 1;
      if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    }
    return 0;
  }

  // GET /api/updater/check
  if (req.url.startsWith("/api/updater/check") && req.method === "GET") {
    const localMeta = readLocalVersionMeta();
    const headers = { "User-Agent": "DDYZ-Local-Studio/2.0", "Accept": "application/vnd.github.v3+json" };
    let reachable = false;
    // A private, renamed or deleted repo answers 404 everywhere; that must not read as "up to date".
    let repoFound = false;
    let remoteVersion = localMeta.version;
    let remoteBuildNumber = localMeta.buildNumber;
    let remoteNotes = "";
    let remoteCommitSha = "";
    let remoteCommitMsg = "";
    let remoteCommitDate = "";

    // 1. Check raw version.json on main branch (works without GitHub Releases)
    try {
      const rawUrl = `https://raw.githubusercontent.com/${localMeta.repo}/${localMeta.branch}/version.json?t=${Date.now()}`;
      const rawRes = await fetch(rawUrl, { headers, signal: AbortSignal.timeout(7000) });
      if (rawRes.ok) {
        reachable = true;
        repoFound = true;
        const remoteJson = await rawRes.json();
        if (remoteJson && remoteJson.version) {
          const v = "v" + String(remoteJson.version).replace(/^v/i, "");
          if (compareSemverStrings(v, remoteVersion) >= 0) {
            remoteVersion = v;
          }
          if (Number.isFinite(Number(remoteJson.buildNumber))) {
            remoteBuildNumber = Number(remoteJson.buildNumber);
          }
          if (remoteJson.notes) remoteNotes = String(remoteJson.notes);
        }
      } else if (rawRes.status === 404) {
        // Repo is reachable even if version.json is not on remote branch yet
        reachable = true;
      }
    } catch (_) {}

    // 2. Check GitHub Releases (/releases/latest)
    try {
      const ghRes = await fetch(`https://api.github.com/repos/${localMeta.repo}/releases/latest`, {
        headers,
        signal: AbortSignal.timeout(7000),
      });
      if (ghRes.ok) {
        reachable = true;
        repoFound = true;
        const rel = await ghRes.json();
        if (rel && rel.tag_name) {
          const relVer = "v" + String(rel.tag_name).replace(/^v/i, "");
          if (compareSemverStrings(relVer, remoteVersion) > 0) {
            remoteVersion = relVer;
            if (rel.body) remoteNotes = String(rel.body);
          }
        }
      } else if (ghRes.status === 404) {
        reachable = true;
      }
    } catch (_) {}

    // 3. Check latest commit on main branch
    try {
      const commitRes = await fetch(`https://api.github.com/repos/${localMeta.repo}/commits/${localMeta.branch}`, {
        headers,
        signal: AbortSignal.timeout(7000),
      });
      if (commitRes.ok) {
        reachable = true;
        repoFound = true;
        const commitData = await commitRes.json();
        if (commitData && commitData.sha) {
          remoteCommitSha = String(commitData.sha).slice(0, 7);
          remoteCommitMsg = commitData.commit && commitData.commit.message ? String(commitData.commit.message).split("\n")[0] : "";
          remoteCommitDate = commitData.commit && commitData.commit.committer ? String(commitData.commit.committer.date || "") : "";
        }
      }
    } catch (_) {}

    if (!reachable) {
      return json(res, 200, {
        ok: false,
        currentVersion: localMeta.version,
        latestVersion: localMeta.version,
        updateAvailable: false,
        error: "GitHub güncelleme sunucusuna erişilemedi. Lütfen internet bağlantınızı kontrol edin."
      });
    }

    if (!repoFound) {
      return json(res, 200, {
        ok: false,
        currentVersion: localMeta.version,
        latestVersion: localMeta.version,
        updateAvailable: false,
        error: `GitHub deposundaki sürüm bilgisi okunamadı (${localMeta.repo}). Depo gizli ya da taşınmış olabilir veya GitHub istek sınırı dolmuş olabilir; biraz sonra tekrar deneyin.`
      });
    }

    const semverDiff = compareSemverStrings(remoteVersion, localMeta.version);
    const updateAvailable = semverDiff > 0 || (semverDiff === 0 && remoteBuildNumber > localMeta.buildNumber);

    return json(res, 200, {
      ok: true,
      currentVersion: localMeta.version,
      latestVersion: updateAvailable ? remoteVersion : localMeta.version,
      updateAvailable,
      canSelfUpdate: true,
      localCommit: localMeta.localCommit || null,
      remoteCommitSha: remoteCommitSha || null,
      remoteCommitMsg: remoteCommitMsg || null,
      remoteCommitDate: remoteCommitDate || null,
      notes: remoteNotes || localMeta.notes || ""
    });
  }

  // POST /api/updater/apply - One-click in-app self-updater (preserves models, outputs, configs, runtimes)
  if (req.url === "/api/updater/apply" && req.method === "POST") {
    try {
      const body = (await readJsonBody(req, res)) || {};
      const localMeta = readLocalVersionMeta();
      const zipUrl = `https://codeload.github.com/${localMeta.repo}/zip/refs/heads/${localMeta.branch}`;
      const tmpBase = path.join(os.tmpdir(), `ddyz_update_${Date.now()}`);
      fs.mkdirSync(tmpBase, { recursive: true });
      const zipPath = path.join(tmpBase, "update.zip");
      const extractDir = path.join(tmpBase, "extracted");
      fs.mkdirSync(extractDir, { recursive: true });

      console.log("  [updater] Guncelleme arsivi indiriliyor:", zipUrl);
      const zipRes = await fetch(zipUrl, {
        headers: { "User-Agent": "DDYZ-Local-Studio/2.0" },
        signal: AbortSignal.timeout(120000),
      });
      if (!zipRes.ok) {
        throw new Error(`GitHub arşivi indirilemedi (HTTP ${zipRes.status})`);
      }
      const arrayBuf = await zipRes.arrayBuffer();
      fs.writeFileSync(zipPath, Buffer.from(arrayBuf));

      // Extract zip archive cross-platform
      if (osPlatform === "win32") {
        execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force"`, { stdio: "ignore" });
      } else {
        try {
          execSync(`unzip -q -o "${zipPath}" -d "${extractDir}"`, { stdio: "ignore" });
        } catch (_) {
          execSync(`python3 -m zipfile -e "${zipPath}" "${extractDir}"`, { stdio: "ignore" });
        }
      }

      const entries = fs.readdirSync(extractDir, { withFileTypes: true }).filter((e) => e.isDirectory());
      if (entries.length === 0) {
        throw new Error("İndirilen güncelleme arşivi açılamadı.");
      }
      const unpackedRoot = path.join(extractDir, entries[0].name);

      // Verify remote version before overwriting local files if force !== true
      const remoteVf = path.join(unpackedRoot, "version.json");
      let incomingVersion = localMeta.version;
      if (fs.existsSync(remoteVf)) {
        try {
          const parsedVf = JSON.parse(fs.readFileSync(remoteVf, "utf8"));
          if (parsedVf.version) incomingVersion = "v" + String(parsedVf.version).replace(/^v/i, "");
        } catch (_) {}
      } else if (!body.force) {
        // If remote branch does not yet have version.json (e.g. older v1 branch before v2 push), protect v2 files unless forced
        fs.rmSync(tmpBase, { recursive: true, force: true });
        return json(res, 200, {
          ok: true,
          alreadyLatest: true,
          updatedVersion: localMeta.version,
          updatedFilesCount: 0,
          message: `Yerel sürümünüz (${localMeta.version}) zaten GitHub deposundaki sürümden daha güncel veya aynı seviyede.`
        });
      }

      let updatedFilesCount = 0;
      function copyRecursiveSafe(srcPath, dstPath) {
        if (!fs.existsSync(srcPath)) return;
        const stat = fs.statSync(srcPath);
        if (stat.isDirectory()) {
          fs.mkdirSync(dstPath, { recursive: true });
          for (const child of fs.readdirSync(srcPath)) {
            copyRecursiveSafe(path.join(srcPath, child), path.join(dstPath, child));
          }
        } else {
          fs.mkdirSync(path.dirname(dstPath), { recursive: true });
          fs.copyFileSync(srcPath, dstPath);
          updatedFilesCount++;
        }
      }

      // Safely update only code & UI directories (never overwrite models/, outputs/, app/config/api-providers.json, runtimes)
      const safeOverlayTargets = [
        "version.json",
        "windows.bat",
        "linux.sh",
        "mac.sh",
        "README.md",
        "YENI_SURUM_GUNCELLEMELERI.md",
        "scripts",
        "app/frontend/src",
        "app/frontend/public",
        "app/frontend/index.html",
        "app/frontend/package.json",
        "app/frontend/vite.config.js",
        "app/dist"
      ];

      // Built assets have hashed names, so old bundles would pile up next to the new ones.
      if (fs.existsSync(path.join(unpackedRoot, "app", "dist", "index.html"))) {
        fs.rmSync(path.join(ROOT, "app", "dist", "assets"), { recursive: true, force: true });
      }

      for (const relTarget of safeOverlayTargets) {
        copyRecursiveSafe(path.join(unpackedRoot, relTarget), path.join(ROOT, relTarget));
      }

      // Rebuild app/frontend -> app/dist if npm is available
      let distRebuilt = false;
      try {
        const frontendDir = path.join(ROOT, "app", "frontend");
        const portableNpm = path.join(ROOT, "app", "tools", "node-win", "npm.cmd");
        const portableNodeDir = path.join(ROOT, "app", "tools", "node-win");
        if (fs.existsSync(path.join(frontendDir, "node_modules"))) {
          if (osPlatform === "win32" && fs.existsSync(portableNpm)) {
            execSync(`"${portableNpm}" run build`, {
              cwd: frontendDir,
              env: { ...process.env, PATH: `${portableNodeDir};${process.env.PATH || ""}` },
              stdio: "ignore",
              timeout: 90000,
            });
            distRebuilt = true;
          } else {
            execSync("npm run build", { cwd: frontendDir, stdio: "ignore", timeout: 90000 });
            distRebuilt = true;
          }
        }
      } catch (buildErr) {
        console.warn("  [updater] Frontend derleme uyarisi:", buildErr.message);
      }

      try {
        fs.rmSync(tmpBase, { recursive: true, force: true });
      } catch (_) {}

      return json(res, 200, {
        ok: true,
        updatedVersion: incomingVersion,
        updatedFilesCount,
        distRebuilt,
        restartRequired: true,
        // The running server keeps the old code, and new Python packages are installed by windows.bat on launch.
        message: `Güncelleme başarıyla tamamlandı (${incomingVersion}). ${updatedFilesCount} dosya güncellendi. Yeni özelliklerin tamamen etkinleşmesi için uygulamayı kapatıp yeniden başlatın (Windows'ta windows.bat).`
      });
    } catch (err) {
      console.error("  [updater] Guncelleme hatasi:", err);
      return json(res, 500, { ok: false, error: err.message || "Güncelleme uygulanırken hata oluştu." });
    }
  }

  // GET /api/diagnostics
  if (req.url === "/api/diagnostics" && req.method === "GET") {
    return json(res, 200, {
      generatedAt: new Date().toISOString(),
      health: await getHealth(),
      cleanupCandidates: getCleanupCandidates(),
      download: downloadState,
      generation: generationState,
      llm: {
        ready: llmReady,
        running: llmProc !== null,
        error: llmError,
        settings: llmSettings,
        port: PORT_LLM,
      },
      speech: {
        ready: speechReady,
        error: speechError,
        settings: speechSettings,
        backend: getSpeechBackend(),
        transcription: speechTranscriptionState,
      },
      hardware: getHardwareSpecs(),
      telemetry: getTelemetry(),
    });
  }

  // GET /api/cleanup-candidates
  if (req.url === "/api/cleanup-candidates" && req.method === "GET") {
    return json(res, 200, { candidates: getCleanupCandidates() });
  }

  // POST /api/cleanup
  if (req.url === "/api/cleanup" && req.method === "POST") {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return;
      const deleted = cleanupSelected(Array.isArray(body.ids) ? body.ids : []);
      return json(res, 200, { ok: true, deleted });
    } catch (err) {
      console.error("  [api] Temizlik basarisiz:", err);
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // GET /api/active-job - returns currently active generation job across all modalities
  if (req.url === "/api/active-job" && req.method === "GET") {
    const job = getActiveGenerationJob();
    return json(res, 200, {
      ok: true,
      active: Boolean(job),
      job: job || null,
      runtime: getActiveHeavyRuntime()
    });
  }

  // POST /api/cancel-active-job - aborts whichever job is currently generating
  if (req.url === "/api/cancel-active-job" && req.method === "POST") {
    const job = getActiveGenerationJob();
    console.log("  [api] Cancelling active generation job:", job);
    if (generationState.active) {
      resetGenerationState();
    }
    if (videoGenerationState.timer) {
      clearInterval(videoGenerationState.timer);
      videoGenerationState.timer = null;
    }
    // Actually stop running worker processes (video / music / TTS / speech).
    const killed = activeJobProcesses.size;
    for (const proc of [...activeJobProcesses]) killProcessTree(proc);
    videoGenerationState.active = false;
    videoGenerationState.progress = 0;
    videoGenerationState.status = "cancelled";
    ttsGenerationState = { active: false, phase: "", progress: 0, model: "", voice: "", output: "" };
    audioGenerationProgress.active = false;
    audioGenerationProgress.progress = 0;
    isLlmGenerating = false;
    isVideoGenerating = false;
    isAudioGenerating = false;
    return json(res, 200, { ok: true, killedProcesses: killed, message: "Devam eden üretim iptal edildi." });
  }

  // GET /api/backend-status
  if (req.url === "/api/backend-status" && req.method === "GET") {
    return json(res, 200, {
      ready: backendReady || openvinoReady,
      running: backendProc !== null || openvinoProc !== null,
      port: PORT_BACKEND,
      preferredPort: PREFERRED_BACKEND_PORT,
      error: backendError,
      loading: backendLoadState,
      unloading: backendUnloadState,
      settings: currentSettings,
      build: SERVER_BUILD,
    });
  }

  if (req.url === "/api/llm/status" && req.method === "GET") {
    const backend = getLlmBackend();
    const probe = getLlmBackendProbe();
    return json(res, 200, {
      ready: llmReady,
      running: llmProc !== null || Boolean(llmSettings?.isCloud),
      port: PORT_LLM,
      preferredPort: PREFERRED_LLM_PORT,
      error: llmError,
      settings: llmSettings,
      backendInstalled: Boolean(backend),
      backendMode: backend?.mode || "",
      backendPath: backend?.path || "",
      selectedBackend: probe.selected,
      availableBackends: probe.available,
    });
  }

  if (req.url.startsWith("/api/llm/backends") && req.method === "GET") {
    const parsed = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    return json(res, 200, { ok: true, ...getLlmBackendProbe(parsed.searchParams.get("refresh") === "1") });
  }

  if (req.url === "/api/llm/stats" && req.method === "GET") {
    return json(res, 200, getLlmRuntimeStats());
  }

  if (req.url === "/api/llm/model-settings" && req.method === "GET") {
    return json(res, 200, { ok: true, ...getPersistedLlmModelSettings() });
  }

  if (req.url === "/api/llm/model-settings" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    const filename = path.basename(String(body.model || ""));
    if (!filename) return json(res, 400, { ok: false, error: "model gereklidir" });
    const updated = updateLlmModelSettings(filename, {
      preferredBackend: body.preferredBackend ? String(body.preferredBackend).toLowerCase() : undefined,
    });
    return json(res, 200, { ok: true, model: filename, settings: updated });
  }

  if (req.url === "/api/llm/conversations" && req.method === "GET") {
    return json(res, 200, { ok: true, conversations: listChatConversations() });
  }

  if (req.url === "/api/llm/save-conversation" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    try {
      const conversation = saveChatConversation(body.conversation || body);
      return json(res, 200, { ok: true, conversation });
    } catch (err) {
      console.error("  [api] Sohbet kaydi kaydedilemedi:", err);
      return json(res, 500, { ok: false, error: err.message || String(err) });
    }
  }

  if (req.url === "/api/llm/delete-conversation" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    try {
      const deleted = deleteChatConversation(body.id);
      return json(res, 200, { ok: true, deleted });
    } catch (err) {
      console.error("  [api] Sohbet kaydi silinemedi:", err);
      return json(res, 500, { ok: false, error: err.message || String(err) });
    }
  }

  if (req.url === "/api/llm/models" && req.method === "GET") {
    return json(res, 200, { models: getLlmModels() });
  }

  if (req.url.startsWith("/api/huggingface/models") && req.method === "GET") {
    const parsed = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const query = String(parsed.searchParams.get("query") || "").slice(0, 120);
    const filters = String(parsed.searchParams.get("filters") || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => ["vision", "uncensored"].includes(value));
    const page = Math.max(1, Math.min(20, Number(parsed.searchParams.get("page")) || 1));
    const pageSize = 9;
    try {
      const rankedModels = await searchHuggingFaceModels(query, [...new Set(filters)]);
      const start = (page - 1) * pageSize;
      const pageModels = rankedModels.slice(start, start + pageSize);
      const models = await Promise.all(pageModels.map(addHuggingFaceFileSize));
      return json(res, 200, {
        ok: true,
        source: "huggingface",
        models,
        page,
        hasMore: start + models.length < rankedModels.length,
      });
    } catch (err) {
      return json(res, 502, { ok: false, error: err.message || "Hugging Face search failed." });
    }
  }

  if (req.url === "/api/llm/start" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    try {
      await runExclusiveLlmOperation(() => startLlm(body));
      return json(res, 200, { ok: true, ready: llmReady, port: PORT_LLM, settings: llmSettings });
    } catch (err) {
      llmError = err.message || String(err);
      if (err.code !== "MODEL_ALREADY_ACTIVE") {
        await runExclusiveLlmOperation(() => killLlm());
      }
      return json(res, jsonErrorStatus(err), { ok: false, error: llmError, code: err.code || "", activeRuntime: err.activeRuntime || null });
    }
  }

  if (req.url === "/api/llm/stop" && req.method === "POST") {
    await runExclusiveLlmOperation(() => killLlm());
    return json(res, 200, { ok: true });
  }

  if (req.url === "/api/llm/benchmark" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    try {
      const result = await runExclusiveLlmOperation(() => benchmarkLlmModel(body));
      return json(res, 200, result);
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message || String(err) });
    }
  }

  if (req.url === "/api/speech/status" && req.method === "GET") {
    const backend = getSpeechBackend();
    return json(res, 200, {
      ok: true,
      ready: speechReady,
      running: speechReady,
      port: PORT_SPEECH,
      preferredPort: PREFERRED_SPEECH_PORT,
      backendInstalled: Boolean(backend.cli),
      backendPath: backend.cli || "",
      serverPath: backend.server || "",
      backendMode: backend.mode,
      backendPreference: backend.preference,
      backends: backend.candidates,
      error: speechError,
      settings: speechSettings,
      transcription: speechTranscriptionState,
    });
  }

  if (req.url === "/api/speech/models" && req.method === "GET") {
    return json(res, 200, { ok: true, models: getSpeechModels() });
  }

  if (req.url === "/api/speech/start" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    try {
      await runExclusiveSpeechOperation(() => startSpeech(body));
      return json(res, 200, { ok: true, ready: speechReady, settings: speechSettings, port: PORT_SPEECH });
    } catch (err) {
      speechError = err.message || String(err);
      return json(res, jsonErrorStatus(err), { ok: false, error: speechError, code: err.code || "", activeRuntime: err.activeRuntime || null });
    }
  }

  if (req.url === "/api/speech/stop" && req.method === "POST") {
    await stopSpeech();
    return json(res, 200, { ok: true });
  }

  if (req.url.startsWith("/api/speech/transcribe") && req.method === "POST") {
    const parsed = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    try {
      const audio = await readBinaryBody(req);
      const result = await runExclusiveSpeechOperation(() => transcribeWavBuffer(audio, {
        model: parsed.searchParams.get("model") || speechSettings.model,
        language: parsed.searchParams.get("language") || "auto",
        filename: parsed.searchParams.get("filename") || req.headers["x-filename"] || "recording.wav",
        threads: parsed.searchParams.get("threads") || speechSettings.threads,
        backendPreference: parsed.searchParams.get("backendPreference") || speechSettings.backendPreference,
        translate: parsed.searchParams.get("translate") === "true",
      }));
      return json(res, 200, { ok: true, transcription: result });
    } catch (err) {
      speechError = err.message || String(err);
      return json(res, err.message?.includes("too large") ? 413 : 500, { ok: false, error: speechError });
    }
  }

  if (req.url === "/api/speech/download-model" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    const modelId = String(body.modelId || body.model_id || body.model || "");
    const catalogModel = SPEECH_MODEL_CATALOG.find((model) => model.id === modelId || model.filename === modelId);
    if (catalogModel && PYTHON_SPEECH_ENGINES[catalogModel.engine]) {
      return json(res, 200, enqueueModelDownload({ type: "snapshot", snapshotId: PYTHON_SPEECH_ENGINES[catalogModel.engine].folder, name: catalogModel.name, kind: "speech" }));
    }
    const url = body.url ? String(body.url) : (catalogModel ? `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${catalogModel.filename}` : "");
    const filename = path.basename(String(body.filename || catalogModel?.filename || ""));
    if (!url || !filename || !filename.toLowerCase().endsWith(".bin")) {
      return json(res, 400, { ok: false, error: "Bir konusma modeli .bin URL'i veya katalog model kimligi gereklidir." });
    }
    const result = enqueueModelDownload({
      url,
      filename,
      targetDir: SPEECH_MODELS,
      kind: "speech",
      name: catalogModel?.name || filename
    });
    return json(res, 200, result);
  }

  if (req.url.startsWith("/api/speech/import-model") && req.method === "POST") {
    try {
      const parsed = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const result = await streamModelUpload(req, parsed.searchParams.get("filename"), SPEECH_MODELS, "speech");
      return json(res, 200, { ok: true, message: `Imported ${result.filename}`, model: result });
    } catch (err) {
      console.error("  [api] Failed to import speech model:", err);
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  if (req.url === "/api/speech/delete-model" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    const filename = path.basename(String(body.filename || ""));
    const modelPath = path.join(SPEECH_MODELS, filename);
    if (!filename || filename === "." || filename === ".." || !pathInside(modelPath, SPEECH_MODELS)) {
      return json(res, 400, { ok: false, error: "Invalid filename" });
    }
    if (speechSettings.model === filename) await stopSpeech();
    try {
      // Duyu and Seda are model folders, whisper.cpp models single .bin files.
      if (fs.statSync(modelPath).isDirectory()) fs.rmSync(modelPath, { recursive: true, force: true });
      else fs.unlinkSync(modelPath);
      return json(res, 200, { ok: true });
    } catch (err) {
      return json(res, err.code === "ENOENT" ? 404 : 500, { ok: false, error: err.code === "ENOENT" ? "Speech model not found" : err.message });
    }
  }

  if (req.url === "/api/speech/transcriptions" && req.method === "GET") {
    return json(res, 200, { ok: true, transcriptions: listTranscriptions() });
  }

  if (req.url === "/api/speech/delete-transcription" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    const filename = path.basename(String(body.filename || ""));
    if (!filename || !filename.endsWith(".json")) {
      return json(res, 400, { ok: false, error: "Invalid filename" });
    }
    const jsonPath = path.join(TRANSCRIPTIONS, filename);
    if (!pathInside(jsonPath, TRANSCRIPTIONS)) {
      return json(res, 400, { ok: false, error: "Invalid path" });
    }
    try {
      if (!fs.existsSync(jsonPath)) {
        return json(res, 404, { ok: false, error: "Transkripsiyon meta verisi bulunamadi" });
      }
      
      const metadata = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      const textFile = metadata.textFile ? path.basename(String(metadata.textFile)) : "";
      
      fs.unlinkSync(jsonPath);
      
      if (textFile) {
        const textPath = path.join(TRANSCRIPTIONS, textFile);
        if (pathInside(textPath, TRANSCRIPTIONS) && fs.existsSync(textPath)) {
          fs.unlinkSync(textPath);
        }
      }
      
      return json(res, 200, { ok: true });
    } catch (err) {
      console.error("  [api] Failed to delete transcription:", err);
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  if (req.url === "/api/tts/status" && req.method === "GET") {
    const runtime = getTtsRuntimeStatus();
    return json(res, 200, {
      ok: true,
      ready: ttsReady,
      running: ttsReady,
      port: PORT_TTS,
      preferredPort: PREFERRED_TTS_PORT,
      runtimeInstalled: runtime.installed,
      runtimePath: runtime.runtime,
      workerPath: runtime.worker,
      cachePath: runtime.cache,
      backendMode: runtime.backendMode,
      error: ttsError,
      settings: ttsSettings,
      generation: ttsGenerationState,
      voices: TTS_VOICES,
    });
  }

  if (req.url === "/api/tts/models" && req.method === "GET") {
    return json(res, 200, { ok: true, models: getTtsModels(), voices: TTS_VOICES });
  }

  if (req.url === "/api/tts/start" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    try {
      await runExclusiveTtsOperation(() => startTts(body));
      return json(res, 200, { ok: true, ready: ttsReady, settings: ttsSettings, port: PORT_TTS });
    } catch (err) {
      ttsError = err.message || String(err);
      return json(res, jsonErrorStatus(err), { ok: false, error: ttsError, code: err.code || "", activeRuntime: err.activeRuntime || null });
    }
  }

  if (req.url === "/api/tts/stop" && req.method === "POST") {
    await stopTts();
    return json(res, 200, { ok: true });
  }

  if (req.url === "/api/tts/speak" && req.method === "POST") {
    const body = await readJsonBody(req, res, 512 * 1024);
    if (!body) return;
    try {
      if (!ttsReady || (body.model && ttsSettings.model !== body.model)) {
        await runExclusiveTtsOperation(() => startTts(body));
      }
      const output = await runExclusiveTtsOperation(() => synthesizeTts(body.text, body));
      return json(res, 200, { ok: true, output });
    } catch (err) {
      ttsError = err.message || String(err);
      return json(res, jsonErrorStatus(err), { ok: false, error: ttsError, code: err.code || "", activeRuntime: err.activeRuntime || null });
    }
  }

  if (req.url === "/api/tts/download-model" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    try {
      const model = installTtsCatalogModel(body.modelId || body.model_id || body.model || body.filename);
      if (model.id === "omnivoice" && !findOmniVoiceWeights().installed) {
        const queued = enqueueModelDownload({ type: "snapshot", snapshotId: "omnivoice", name: "OmniVoice (3.3 GB)", kind: "tts" });
        return json(res, 200, { ...queued, filename: model.filename, model });
      }
      return json(res, 200, { ok: true, message: "TTS model manifest installed", filename: model.filename, model });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message || String(err) });
    }
  }

  if (req.url.startsWith("/api/tts/import-model") && req.method === "POST") {
    try {
      const parsed = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const result = await streamModelUpload(req, parsed.searchParams.get("filename"), TTS_MODELS, "tts");
      return json(res, 200, { ok: true, message: `Imported ${result.filename}`, model: result });
    } catch (err) {
      console.error("  [api] Failed to import TTS model:", err);
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  if (req.url === "/api/tts/delete-model" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    const filename = path.basename(String(body.filename || ""));
    const modelPath = path.join(TTS_MODELS, filename);
    if (!filename || !filename.endsWith(".json") || !pathInside(modelPath, TTS_MODELS)) {
      return json(res, 400, { ok: false, error: "Invalid filename" });
    }
    if (ttsSettings.model === filename) await stopTts();
    try {
      fs.unlinkSync(modelPath);
      return json(res, 200, { ok: true });
    } catch (err) {
      return json(res, err.code === "ENOENT" ? 404 : 500, { ok: false, error: err.code === "ENOENT" ? "TTS model not found" : err.message });
    }
  }

  if (req.url === "/api/tts/outputs" && req.method === "GET") {
    return json(res, 200, { ok: true, outputs: listTtsOutputs() });
  }

  if (req.url === "/api/tts/delete-output" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    const filename = path.basename(String(body.filename || ""));
    if (!filename || !filename.endsWith(".json")) {
      return json(res, 400, { ok: false, error: "Invalid filename" });
    }
    const jsonPath = path.join(TTS_OUTPUTS, filename);
    if (!pathInside(jsonPath, TTS_OUTPUTS)) {
      return json(res, 400, { ok: false, error: "Invalid path" });
    }
    try {
      if (!fs.existsSync(jsonPath)) {
        return json(res, 404, { ok: false, error: "TTS cikti meta verisi bulunamadi" });
      }
      const metadata = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      const audioFile = metadata.audioFile ? path.basename(String(metadata.audioFile)) : "";
      fs.unlinkSync(jsonPath);
      if (audioFile) {
        const audioPath = path.join(TTS_OUTPUTS, audioFile);
        if (pathInside(audioPath, TTS_OUTPUTS) && fs.existsSync(audioPath)) {
          fs.unlinkSync(audioPath);
        }
      }
      return json(res, 200, { ok: true });
    } catch (err) {
      console.error("  [api] Failed to delete TTS output:", err);
      return json(res, 500, { ok: false, error: err.message });
    }
  }

function isOomError(msg) {
  if (!msg) return false;
  const lower = String(msg).toLowerCase();
  return lower.includes("out of memory") ||
         lower.includes("failed to allocate") ||
         lower.includes("failed to initialize the context") ||
         lower.includes("oom") ||
         lower.includes("not enough memory") ||
         lower.includes("allocation failed") ||
         lower.includes("failed to create context");
}

async function retryLowerContext() {
  const currentCtx = llmSettings.contextSize || 4096;
  const contextLadder = [32768, 24576, 16384, 12288, 8192, 4096, 2048, 1024, 512];
  const nextLimit = contextLadder.find(limit => limit < currentCtx);
  if (!nextLimit) {
    throw new Error("Cannot lower context size any further.");
  }
  console.log(`  [llm] Retrying with lower context limit: ${nextLimit} (was ${currentCtx})`);
  
  const originalModel = llmSettings.model;
  const newSettings = {
    model: originalModel,
    threads: llmSettings.threads,
    contextSize: nextLimit,
    gpuLayers: llmSettings.gpuLayers,
    enableThinking: llmSettings.enableThinking,
  };
  
  await runExclusiveLlmOperation(() => startLlm(newSettings));
}

function getMessageText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === "string") return item;
      if (typeof item?.text === "string") return item.text;
      if (typeof item?.content === "string") return item.content;
      return "";
    }).join("\n");
  }
  if (content && typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (typeof content.content === "string") return content.content;
  }
  return "";
}

function getLastUserQuery(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      return getMessageText(messages[i].content).trim();
    }
  }
  return "";
}

async function augmentMessagesWithWebSearch(messages, body) {
  if (body.useWeb !== true && body.use_web !== true) {
    return { messages, webSources: [], webContext: "" };
  }
  const query = String(body.webQuery || body.query || getLastUserQuery(messages) || "").trim();
  if (!query) return { messages, webSources: [], webContext: "" };

  const result = await comprehensiveWebSearch(query, {
    timeFilter: body.timeFilter || body.time_filter || "any",
    resultLimit: body.webResultLimit || 5,
    fetchLimit: body.webFetchLimit || 3,
    cacheDir: WEB_SEARCH_CACHE,
  });
  if (!result.context || !result.sources.length) {
    return { messages, webSources: [], webContext: "" };
  }
  let insertAt = 0;
  while (insertAt < messages.length && messages[insertAt]?.role === "system") {
    insertAt += 1;
  }
  const augmentedMessages = [
    ...messages.slice(0, insertAt),
    { role: "user", content: result.context },
    ...messages.slice(insertAt),
  ];
  return {
    messages: augmentedMessages,
    webSources: result.sources,
    webContext: result.context,
  };
}

async function doCloudLlmChat(req, res, body, webAugmentation) {
  const isStream = body.stream === true;
  const rawModel = String(body.model || llmSettings.model || "");
  const parts = rawModel.startsWith("cloud:") ? rawModel.split(":") : ["cloud", llmSettings.provider || "openrouter", llmSettings.cloudModelId || "minimax/minimax-m3.1-flash:free"];
  const provider = parts[1] || "openrouter";
  let cloudModelId = parts.slice(2).join(":") || "minimax/minimax-m3.1-flash:free";

  const cfg = getProvidersConfig();
  const apiKey = cfg?.keys?.[provider];
  if (!apiKey || !String(apiKey).trim()) {
    return json(res, 400, { ok: false, error: `${provider.toUpperCase()} API anahtarı bulunamadı. Lütfen Hibrit API sekmesinden anahtarınızı kaydedin.` });
  }

  const temperature = Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : 0.7;
  const maxTokens = Math.max(64, Math.min(8192, Number(body.max_tokens) || Number(body.maxTokens) || 2048));

  const executeCloudFetch = async (targetModelId) => {
    if (provider === "anthropic") {
      const sysMsgs = webAugmentation.messages.filter((m) => m.role === "system").map((m) => getMessageText(m.content)).join("\n\n");
      const chatMsgs = webAugmentation.messages.filter((m) => m.role !== "system").map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: getMessageText(m.content),
      }));
      return await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": String(apiKey).trim(),
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        // temperature is omitted: current Claude models (Opus/Sonnet 5.x) reject sampling parameters.
        body: JSON.stringify({
          model: targetModelId,
          max_tokens: maxTokens,
          system: sysMsgs || undefined,
          messages: chatMsgs,
          stream: false,
        }),
      });
    }

    const endpoint = provider === "openai"
      ? "https://api.openai.com/v1/chat/completions"
      : provider === "gemini"
        ? "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
        : "https://openrouter.ai/api/v1/chat/completions";

    const headers = {
      "Authorization": `Bearer ${String(apiKey).trim()}`,
      "Content-Type": "application/json",
    };
    if (provider === "openrouter") {
      headers["HTTP-Referer"] = "http://localhost:8080";
      headers["X-Title"] = "Sansursuz Lokal AI Studyosu DD:YZ";
    }

    const isOpenAiReasoningModel = provider === "openai" && /^(gpt-5|o\d)/i.test(targetModelId);
    const isAnthropicViaRouter = provider === "openrouter" && /^anthropic\//i.test(targetModelId);
    const requestBody = {
      model: targetModelId,
      messages: webAugmentation.messages,
      stream: isStream,
    };
    if (isOpenAiReasoningModel) {
      requestBody.max_completion_tokens = maxTokens;
    } else {
      requestBody.max_tokens = maxTokens;
      if (!isAnthropicViaRouter) requestBody.temperature = temperature;
    }
    return await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });
  };

  isLlmGenerating = true;
  try {
    let upstreamRes = await executeCloudFetch(cloudModelId);

    // If user selected a paid MiniMax model on OpenRouter with a 0-credit free account (402/404), seamlessly fall back to minimax/minimax-m3.1-flash:free
    if (!upstreamRes.ok && provider === "openrouter" && (upstreamRes.status === 402 || upstreamRes.status === 404) && cloudModelId.toLowerCase().includes("minimax") && cloudModelId !== "minimax/minimax-m3.1-flash:free") {
      console.log(`  [llm-cloud] ${cloudModelId} returned HTTP ${upstreamRes.status}; falling back to minimax/minimax-m3.1-flash:free`);
      cloudModelId = "minimax/minimax-m3.1-flash:free";
      upstreamRes = await executeCloudFetch(cloudModelId);
    }

    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text();
      let errMsg = `Bulut API hatası (HTTP ${upstreamRes.status})`;
      try {
        const parsedErr = JSON.parse(errText);
        errMsg = parsedErr?.error?.message || parsedErr?.message || errMsg;
      } catch (_) {
        if (errText) errMsg += `: ${errText.slice(0, 240)}`;
      }
      isLlmGenerating = false;
      return json(res, upstreamRes.status || 500, { ok: false, error: errMsg });
    }

    if (provider === "anthropic") {
      const data = await upstreamRes.json();
      const textContent = (data.content || []).map((c) => c.text || "").join("");
      isLlmGenerating = false;
      if (isStream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
        });
        if (webAugmentation.webSources.length) {
          res.write(`event: web_sources\ndata: ${JSON.stringify({ sources: webAugmentation.webSources })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: textContent }, finish_reason: "stop" }] })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      return json(res, 200, {
        choices: [{ message: { role: "assistant", content: textContent }, finish_reason: "stop" }],
        usage: data.usage || null,
        web_sources: webAugmentation.webSources,
      });
    }

    if (isStream && upstreamRes.body) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
      });
      if (webAugmentation.webSources.length) {
        res.write(`event: web_sources\ndata: ${JSON.stringify({ sources: webAugmentation.webSources })}\n\n`);
      }
      const reader = upstreamRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) res.write(Buffer.from(value));
      }
      isLlmGenerating = false;
      res.end();
      return;
    } else {
      const data = await upstreamRes.json();
      if (webAugmentation.webSources.length) {
        data.web_sources = webAugmentation.webSources;
      }
      isLlmGenerating = false;
      return json(res, 200, data);
    }
  } catch (err) {
    isLlmGenerating = false;
    return json(res, 500, { ok: false, error: err.message || String(err) });
  }
}

async function doLlmChat(req, res, body, retryCount = 0) {
  try {
    const isStream = body.stream === true;
    const rawMessages = Array.isArray(body.messages) ? body.messages : [];
    const webAugmentation = await augmentMessagesWithWebSearch(rawMessages, body);
    if (llmSettings.isCloud || String(body.model || llmSettings.model || "").startsWith("cloud:")) {
      return await doCloudLlmChat(req, res, body, webAugmentation);
    }
    const requestData = JSON.stringify({
      model: llmSettings.model || "local-model",
      messages: webAugmentation.messages,
      temperature: Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : 0.7,
      max_tokens: Math.max(1, Math.min(4096, Number(body.max_tokens) || Number(body.maxTokens) || 1024)),
      stream: isStream,
      // New sampling parameters
      top_p: Number.isFinite(Number(body.top_p)) ? Number(body.top_p) : 0.95,
      top_k: Number.isFinite(Number(body.top_k)) ? Number(body.top_k) : 40,
      min_p: Number.isFinite(Number(body.min_p)) ? Number(body.min_p) : 0.05,
      repeat_penalty: Number.isFinite(Number(body.repeat_penalty)) ? Number(body.repeat_penalty) : 1.1,
      frequency_penalty: Number.isFinite(Number(body.frequency_penalty)) ? Number(body.frequency_penalty) : 0.0,
      presence_penalty: Number.isFinite(Number(body.presence_penalty)) ? Number(body.presence_penalty) : 0.0,
      seed: Number.isInteger(Number(body.seed)) ? Number(body.seed) : undefined,
      stop: Array.isArray(body.stop) ? body.stop : (body.stop ? [body.stop] : undefined),
    });

    if (isStream) {
      isLlmGenerating = true;
      const clientReq = http.request({
        hostname: "127.0.0.1",
        port: PORT_LLM,
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(requestData),
        },
        agent: llmHttpAgent,  //  HTTP keep-alive: eliminates TCP handshake per turn
      }, (clientRes) => {
        if (clientRes.statusCode < 200 || clientRes.statusCode >= 300) {
          isLlmGenerating = false;
          let errorBody = "";
          clientRes.setEncoding("utf8");
          clientRes.on("data", (chunk) => { errorBody += chunk; });
          clientRes.on("end", async () => {
            let message = `Text backend returned HTTP ${clientRes.statusCode}`;
            try {
              message = JSON.parse(errorBody || "{}").error?.message || message;
            } catch (_) {}
            
            if (isOomError(message) && retryCount === 0) {
              try {
                await retryLowerContext();
                return doLlmChat(req, res, body, retryCount + 1);
              } catch (retryErr) {
                console.error("Failed OOM recovery retry:", retryErr);
              }
            }
            json(res, clientRes.statusCode || 500, { ok: false, error: message });
          });
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
          "X-Content-Type-Options": "nosniff",
        });
        const socket = res.socket || res.connection;
        socket?.setNoDelay?.(true);
        res.flushHeaders?.();
        if (webAugmentation.webSources.length) {
          res.write(`event: web_sources\ndata: ${JSON.stringify({ sources: webAugmentation.webSources })}\n\n`);
        }
        clientRes.on("data", (chunk) => res.write(chunk));
        clientRes.on("end", () => {
          isLlmGenerating = false;
          res.end();
        });
        clientRes.on("error", (err) => {
          isLlmGenerating = false;
          res.destroy(err);
        });
      });

      clientReq.on("error", async (err) => {
        isLlmGenerating = false;
        console.error("LLM stream request error:", err);
        if (isOomError(err.message) && retryCount === 0) {
          try {
            await retryLowerContext();
            return doLlmChat(req, res, body, retryCount + 1);
          } catch (retryErr) {
            console.error("Failed OOM recovery retry:", retryErr);
          }
        }
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        } else {
          res.end();
        }
      });

      clientReq.write(requestData);
      clientReq.end();
      res.on("close", () => {
        isLlmGenerating = false;
        if (!res.writableEnded && !clientReq.destroyed) clientReq.destroy();
      });
      return;
    } else {
      isLlmGenerating = true;
      try {
        const result = await requestJson(`http://127.0.0.1:${PORT_LLM}/v1/chat/completions`, JSON.parse(requestData), 300000);
        if (webAugmentation.webSources.length) {
          result.web_sources = webAugmentation.webSources;
        }
        isLlmGenerating = false;
        return json(res, 200, result);
      } catch (err) {
        isLlmGenerating = false;
        if (isOomError(err.message) && retryCount === 0) {
          try {
            await retryLowerContext();
            return doLlmChat(req, res, body, retryCount + 1);
          } catch (retryErr) {
            console.error("Failed OOM recovery retry:", retryErr);
          }
        }
        throw err;
      }
    }
  } catch (err) {
    isLlmGenerating = false;
    return json(res, 500, { ok: false, error: err.message || String(err) });
  }
}

function getLlmRuntimeStats() {
  const benchmarks = getPersistedLlmBenchmarks();
  return {
    ok: true,
    ready: llmReady,
    running: llmProc !== null,
    selectedBackend: getLlmBackendProbe().selected,
    settings: llmSettings,
    modelSettings: getPersistedLlmModelSettings(),
    benchmarks: (benchmarks.results || []).slice(0, 20),
  };
}

async function benchmarkLlmBackend(model, backend, baseSettings = {}) {
  const prompt = String(baseSettings.prompt || "Reply with one short sentence about local AI performance.");
  const startedAt = Date.now();
  await startLlmWithBackend({
    ...baseSettings,
    model,
    contextSize: Math.min(2048, Number(baseSettings.contextSize) || 2048),
    gpuLayers: Number.isFinite(Number(baseSettings.gpuLayers)) ? Number(baseSettings.gpuLayers) : -1,
    enableThinking: false,
  }, backend);

  const result = await requestJson(`http://127.0.0.1:${PORT_LLM}/v1/chat/completions`, {
    model: llmSettings.model || "local-model",
    messages: [
      { role: "system", content: "You are a concise local benchmark assistant." },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
    max_tokens: 64,
    stream: false,
  }, 180000);
  const finishedAt = Date.now();
  const timings = result.timings || {};
  return {
    backendKey: backend.key,
    backendMode: llmSettings.backendMode || backend.mode,
    backendBinary: llmSettings.backendBinary || path.basename(backend.path),
    model,
    ok: true,
    total_ms: finishedAt - startedAt,
    prompt_ms: Number(timings.prompt_ms) || null,
    predicted_ms: Number(timings.predicted_ms) || null,
    predicted_n: Number(timings.predicted_n) || null,
    predicted_per_second: Number(timings.predicted_per_second) || null,
    prompt_per_second: Number(timings.prompt_per_second) || null,
  };
}

async function benchmarkLlmModel(settings = {}) {
  const filename = path.basename(String(settings.model || llmSettings.model || ""));
  const modelPath = path.join(LLM_MODELS, filename);
  if (!filename || !pathInside(modelPath, LLM_MODELS) || !fs.existsSync(modelPath)) {
    throw new Error("Select a downloaded GGUF text model before benchmarking.");
  }

  const previous = {
    ready: llmReady,
    model: llmSettings.model,
    settings: { ...llmSettings },
  };
  const requestedBackends = Array.isArray(settings.backends)
    ? settings.backends.map((item) => String(item).toLowerCase())
    : [];
  const candidates = getLlmBackendCandidates()
    .filter((backend) => backend.key !== "cpu" || settings.includeCpu !== false)
    .filter((backend) => requestedBackends.length === 0 || requestedBackends.includes(backend.key));

  if (candidates.length === 0) {
    throw new Error("No available text backends were detected for benchmarking.");
  }

  const results = [];
  for (const backend of candidates) {
    try {
      const result = await benchmarkLlmBackend(filename, backend, settings);
      results.push(recordLlmBenchmark(result));
    } catch (err) {
      results.push(recordLlmBenchmark({
        backendKey: backend.key,
        backendMode: backend.mode,
        backendBinary: path.basename(backend.path),
        model: filename,
        ok: false,
        error: (err.message || String(err)).slice(-800),
      }));
      await killLlm();
    }
  }

  const successful = results
    .filter((item) => item.ok && Number(item.predicted_per_second) > 0)
    .sort((a, b) => Number(b.predicted_per_second) - Number(a.predicted_per_second));
  const winner = successful[0] || null;
  if (winner) {
    updateLlmModelSettings(filename, {
      preferredBackend: winner.backendKey,
      benchmarkWinner: {
        backendMode: winner.backendMode,
        predicted_per_second: winner.predicted_per_second,
        createdAt: winner.createdAt,
      },
    });
  }

  if (previous.ready && previous.model && previous.model === filename && winner) {
    try {
      await startLlm({ ...previous.settings, model: filename, preferredBackend: winner.backendKey });
    } catch (err) {
      console.warn("  [llm] Failed to restore text model after benchmark:", err.message || err);
    }
  }

  return { ok: true, model: filename, winner, results };
}

// -- llmfit Integration ----------------------------------------------------------
let cachedLlmfitResults = new Map();

function getHardwareHash() {
  const cpus = os.cpus();
  const gpu = getGpuInfo();
  const ram = os.totalmem();
  return `${cpus.length}-${cpus[0]?.model || 'unknown'}-${gpu.name}-${ram}`;
}

async function getLlmfitRecommendations(useCase = "chat", limit = 10) {
  const hardwareHash = getHardwareHash();
  const cacheKey = `${hardwareHash}:${useCase}:${limit}`;
  
  const cached = cachedLlmfitResults.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < 3600000) { // 1 hour cache
    return cached.data;
  }
  
  // Try to find llmfit binary
  const llmfitPaths = [
    path.join(ROOT, "app", "tools", "llmfit", osPlatform === "win32" ? "llmfit.exe" : "llmfit"),
    "llmfit", // PATH
  ];
  
  let llmfitPath = null;
  for (const p of llmfitPaths) {
    try {
      if (fs.existsSync(p)) {
        llmfitPath = p;
        break;
      }
      if (osPlatform !== "win32") {
        const whichResult = spawnSync("which", [p], { stdio: "ignore" });
        if (whichResult.status === 0) {
          llmfitPath = p;
          break;
        }
      }
    } catch (_) {}
  }
  
  if (!llmfitPath) return null; // Fallback to tier table
  
  try {
    const result = spawnSync(llmfitPath, [
      "recommend", "--json", "--limit", String(limit),
      "--use-case", useCase, "--force-runtime", "llamacpp"
    ], {
      encoding: "utf8",
      timeout: 8000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    
    if (result.status !== 0) return null;
    
    const data = JSON.parse(result.stdout);
    cachedLlmfitResults.set(cacheKey, { timestamp: Date.now(), data });
    return data;
  } catch (_) {
    return null;
  }
}

  if (req.url === "/api/web-search/config" && req.method === "GET") {
    return json(res, 200, {
      ok: true,
      provider: "duckduckgo",
      providers: [{ key: "duckduckgo", name: "DuckDuckGo", requiresApiKey: false, active: true }],
      cachePath: WEB_SEARCH_CACHE,
      defaults: { resultLimit: 5, fetchLimit: 3, timeFilter: "any" },
    });
  }

  if (req.url === "/api/web-search" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    try {
      const result = await comprehensiveWebSearch(body.query || body.q || "", {
        timeFilter: body.timeFilter || body.time_filter || "any",
        resultLimit: body.resultLimit || 5,
        fetchLimit: body.fetchLimit || 3,
        cacheDir: WEB_SEARCH_CACHE,
      });
      return json(res, 200, { ok: true, ...result });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message || String(err) });
    }
  }

  if (req.url === "/api/llm/chat" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    if (!llmReady) return json(res, 409, { ok: false, error: "Load a text model before sending a message." });
    await doLlmChat(req, res, body);
    return;
  }

  // GET /api/llm/recommend - llmfit recommendations
  if (req.url.startsWith("/api/llm/recommend") && req.method === "GET") {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const useCase = url.searchParams.get("useCase") || "chat";
    const limit = Math.min(20, Math.max(1, Number(url.searchParams.get("limit")) || 10));
    const recommendations = await getLlmfitRecommendations(useCase, limit);
    return json(res, 200, { ok: true, recommendations, source: recommendations ? "llmfit" : "fallback" });
  }

  // GET /api/hardware-specs
  if (req.url === "/api/hardware-specs" && req.method === "GET") {
    return json(res, 200, getHardwareSpecs());
  }

  // GET /api/backend-options
  if (req.url === "/api/backend-options" && req.method === "GET") {
    return json(res, 200, getBackendOptions());
  }

  // GET /api/telemetry
  if (req.url === "/api/telemetry" && req.method === "GET") {
    return json(res, 200, getTelemetry());
  }

  // GET /api/models - list available model files
  if (req.url === "/api/models" && req.method === "GET") {
    try {
      let files = fs.readdirSync(MODELS).filter(isModelFile).map(getModelInfo);
      if (downloadState.active && downloadState.filename) {
        files = files.filter(model => model.filename !== downloadState.filename);
      }
      return json(res, 200, { models: files });
    } catch (_) { return json(res, 200, { models: [] }); }
  }

  if (req.url === "/api/openvino-models" && req.method === "GET") {
    const npuInfo = getOpenVinoNpuInfo();
    return json(res, 200, {
      supported: npuInfo.supported,
      reason: npuInfo.reason || "",
      npu: npuInfo.npu || null,
      python: npuInfo.python || "",
      models: npuInfo.supported ? getOpenVinoModelInfo() : [],
    });
  }

  // POST /api/restart-backend - restart with new settings
  if (req.url === "/api/restart-backend" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    console.log("  [api] Restart backend request:", body);
    const newSettings = {};
    if (body.model)    newSettings.model    = body.backend_type === "openvino-npu" ? String(body.model) : path.join(MODELS, body.model);
    if (body.steps)    newSettings.steps    = parseInt(body.steps);
    if (body.cfgScale) newSettings.cfgScale = parseFloat(body.cfgScale);
    if (body.sampler)  newSettings.sampler  = normalizeSdSampler(body.sampler);
    if (body.threads)  newSettings.threads  = parseInt(body.threads);
    if (body.width)    newSettings.width    = Math.max(256, Math.round(parseInt(body.width) / 64) * 64);
    if (body.height)   newSettings.height   = Math.max(256, Math.round(parseInt(body.height) / 64) * 64);
    if (typeof body.use_gpu === "boolean") newSettings.useGpu = body.use_gpu;
    if (body.backend_type) {
      newSettings.backendType = String(body.backend_type);
      newSettings.useGpu = body.backend_type !== "cpu";
    }
    if (typeof body.vae_tiling === "boolean") newSettings.vaeTiling = body.vae_tiling;
    if (typeof body.vae_on_cpu === "boolean") newSettings.vaeOnCpu = body.vae_on_cpu;
    if (typeof body.flash_attn === "boolean") newSettings.flashAttn = body.flash_attn;
    try {
      const targetModel = newSettings.model || currentSettings.model || getDefaultModel();
      assertNoOtherActiveRuntime("image", targetModel, body);
      const requestedSettings = { ...currentSettings, ...newSettings, model: targetModel };
      const imageBackendReady = (backendReady && backendProc) || (openvinoReady && openvinoProc);
      if (imageBackendReady && backendSettingsMatch(currentSettings, requestedSettings)) {
        currentSettings.width = requestedSettings.width || currentSettings.width;
        currentSettings.height = requestedSettings.height || currentSettings.height;
        return json(res, 200, { ok: true, message: "Backend already running with requested settings.", settings: currentSettings, port: PORT_BACKEND });
      }
      if (generationState.active && !body.cancelActive) {
        return json(res, 409, {
          ok: false,
          error: "Image generation is in progress. Wait for it to finish or cancel it before changing backend settings.",
        });
      }
      if (backendReady && backendProc && appleNpuRuntimeMatches(currentSettings, requestedSettings)) {
        currentSettings = requestedSettings;
        return json(res, 200, { ok: true, message: "Apple NPU backend already running; updated generation defaults.", settings: currentSettings, port: PORT_BACKEND });
      }
      await killBackend();
      await killLlm();
      await new Promise(r => setTimeout(r, 500));
      if (newSettings.backendType === "openvino-npu") {
        startBackend(newSettings).catch((err) => {
          backendError = err.message || String(err);
          backendLoadState = {
            ...backendLoadState,
            active: false,
            phase: "OpenVINO NPU model load failed",
          };
          console.error("  [openvino-npu] Startup failed:", backendError);
        });
        return json(res, 200, { ok: true, message: "OpenVINO NPU backend starting...", settings: currentSettings, port: PORT_BACKEND });
      }
      if (newSettings.backendType === "apple-npu") {
        const backendPort = await findAvailableBackendPort();
        PORT_BACKEND = backendPort;
        newSettings.backendPort = backendPort;
        currentSettings = { ...currentSettings, ...newSettings };
        backendLoadState = {
          active: true,
          phase: "Starting Apple NPU backend...",
          progress: 1,
          current: 0,
          total: 0,
          speed: "",
          model: path.basename(newSettings.model || targetModel),
          backendMode: "Apple NPU",
          backendBinary: path.basename(getCoreMLPythonPath()),
          device: "",
        };
        startBackend(newSettings).catch((err) => {
          backendError = err.message || String(err);
          backendLoadState = {
            ...backendLoadState,
            active: false,
            phase: "Apple NPU model load failed",
          };
          console.error("  [coreml-npu] Startup failed:", backendError);
        });
        return json(res, 200, { ok: true, message: "Apple NPU backend starting...", settings: { ...currentSettings, ...newSettings }, port: backendPort });
      }
      await startBackend(newSettings);
      return json(res, 200, { ok: true, message: "Backend restarting...", settings: currentSettings, port: PORT_BACKEND });
    } catch (err) {
      backendError = err.message || String(err);
      return json(res, jsonErrorStatus(err), { ok: false, error: backendError, code: err.code || "", activeRuntime: err.activeRuntime || null, port: PORT_BACKEND });
    }
  }

  // POST /api/stop-backend
  if (req.url === "/api/stop-backend" && req.method === "POST") {
    await killBackend();
    await killOpenVinoWorker();
    return json(res, 200, { ok: true });
  }

  // POST /api/download-backend
  if (req.url === "/api/download-backend" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    try {
      const backendId = String(body.backend_id || body.backendId || body.id || "");
      const result = enqueueModelDownload({
        type: "backend",
        backendId,
        name: `Backend (${backendId})`
      });
      return json(res, 200, result);
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message || String(err) });
    }
  }

  // POST /api/download-model
  if (req.url === "/api/download-model" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    const { url, filename, kind, name, indexUrl, indexFilename, snapshotId } = body;
    if (snapshotId) {
      if (!SNAPSHOT_MODELS[snapshotId]) return json(res, 400, { ok: false, error: `Bilinmeyen model paketi: ${snapshotId}` });
      return json(res, 200, enqueueModelDownload({ type: "snapshot", snapshotId, name: name || SNAPSHOT_MODELS[snapshotId].label, kind: kind || "model" }));
    }
    if (!url) return json(res, 400, { ok: false, error: "URL is required" });
    if (/huggingface\.co\//i.test(url) && !/\/(resolve|blob)\//i.test(url)) {
      return json(res, 400, { ok: false, error: "Bu bağlantı bir Hugging Face depo sayfası, dosya değil. Doğrudan dosya bağlantısı (…/resolve/main/dosya.safetensors) kullanın." });
    }
    
    let targetDir = MODELS;
    let modelKind = kind || "image";
    if (kind === "video") {
      targetDir = VIDEO_MODELS;
    } else if (kind === "music") {
      targetDir = MUSIC_MODELS;
    } else if (kind === "rvc") {
      targetDir = RVC_MODELS;
      modelKind = "rvc";
    } else {
      const lower = (filename || url).toLowerCase();
      if (lower.includes("wan") || lower.includes("animatediff") || lower.includes("ltx") || lower.includes("cogvideo") || lower.includes("svd")) {
        targetDir = VIDEO_MODELS;
        modelKind = "video";
      } else if (lower.includes("musicgen") || lower.includes("stable-audio") || lower.includes("audioldm")) {
        targetDir = MUSIC_MODELS;
        modelKind = "music";
      } else if (lower.endsWith(".pth") || lower.endsWith(".index") || lower.includes("rvc")) {
        targetDir = RVC_MODELS;
        modelKind = "rvc";
      }
    }
    
    const result = enqueueModelDownload({
      url,
      filename: filename || null,
      targetDir,
      kind: modelKind,
      name: name || filename
    });

    if (indexUrl && indexFilename) {
      enqueueModelDownload({
        url: indexUrl,
        filename: indexFilename,
        targetDir: RVC_MODELS,
        kind: "rvc",
        name: `${indexFilename} (RVC Index)`
      });
    }

    return json(res, 200, result);
  }

  if (req.url === "/api/llm/download-model" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    const url = String(body.url || "");
    if (!url) return json(res, 400, { ok: false, error: "URL is required" });
    try {
      const directUrl = url.includes("huggingface.co") ? url.replace("/blob/", "/resolve/") : url;
      const overrideFilename = body.filename ? path.basename(String(body.filename)) : null;
      const filename = overrideFilename || path.basename(new URL(directUrl).pathname);
      if (!filename.toLowerCase().endsWith(".gguf")) {
        return json(res, 400, { ok: false, error: "Text model URL must point to a .gguf file." });
      }
      const projector = body.projectorUrl && body.projectorFilename
        ? { url: String(body.projectorUrl), filename: path.basename(String(body.projectorFilename)) }
        : await resolveHuggingFaceProjector(directUrl, filename);

      const result = enqueueModelDownload({
        url: directUrl,
        filename,
        targetDir: LLM_MODELS,
        kind: "text",
        name: body.name || filename
      });

      if (projector?.url && projector?.filename) {
        enqueueModelDownload({
          url: projector.url,
          filename: projector.filename,
          targetDir: LLM_MODELS,
          kind: "text",
          name: `${filename} (Vision Projector)`
        });
      }

      return json(res, 200, {
        ...result,
        projectorUrl: projector?.url || "",
        projectorFilename: projector?.filename || "",
      });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message || String(err) });
    }
  }

  if (req.url === "/api/download-openvino-model" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    const modelId = String(body.model_id || body.modelId || "");
    if (!modelId) return json(res, 400, { ok: false, error: "model_id is required" });
    try {
      const result = enqueueModelDownload({
        type: "openvino",
        modelId,
        name: `OpenVINO: ${modelId}`
      });
      return json(res, 200, result);
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message || String(err) });
    }
  }

  // GET /api/compatible-models  (hangi modellerin secilecegini ve nedenini dondurur)
  if (req.url === "/api/compatible-models" && req.method === "GET") {
    try {
      const compat = getCompatibleModels();
      return json(res, 200, { ok: true, tier: compat.tier, vram: compat.vram, ram: compat.ram, models: compat.models });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message || String(err) });
    }
  }

  // POST /api/download-default-models
  if (req.url === "/api/download-default-models" && req.method === "POST") {
    try {
      const body = await readJsonBody(req, res);
      const selected = Array.isArray(body?.models) ? body.models : (Array.isArray(body?.selectedModels) ? body.selectedModels : null);
      const result = startDefaultModelsDownload(selected);
      return json(res, 200, result);
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message || String(err) });
    }
  }

  // GET /api/download-progress
  if (req.url === "/api/download-progress" && req.method === "GET") {
    if (!downloadState.active && downloadState.kind === "backend" && downloadState.backendId) {
      const backend = IMAGE_BACKEND_DOWNLOADS[downloadState.backendId];
      const installed = backend &&
        fs.existsSync(path.join(backend.destDir, backend.exeName)) &&
        fs.existsSync(path.join(backend.destDir, backend.requiredDll));
      if (installed && !downloadState.error) {
        cachedBackendOptions = null;
        downloadState = {
          active: false,
          filename: "",
          progress: 0,
          speed: "0 MB/s",
          eta: 0,
          totalBytes: 0,
          downloadedBytes: 0,
          error: null,
        };
      }
    }
    const speedNumeric = parseFloat(downloadState.speed) || 0;
    const progressVal = downloadState.progress === -1 ? 0 : Math.round(downloadState.progress || 0);
    const activeDisplayName = downloadState.displayName || downloadState.name || downloadState.filename || "";

    return json(res, 200, {
      ...downloadState,
      hasHfToken: Boolean(getHuggingFaceToken()),
      isGated: Boolean(downloadState.isGated),
      gatedRepo: downloadState.gatedRepo || "",
      gatedPageUrl: downloadState.gatedPageUrl || "",
      percent: progressVal,
      speed_mb_s: speedNumeric,
      displayName: activeDisplayName,
      name: activeDisplayName,
      queue: downloadQueue.map((item, idx) => ({
        id: item.id,
        filename: item.filename,
        name: item.name || item.filename,
        displayName: item.displayName || item.name || item.filename,
        kind: item.kind,
        type: item.type,
        position: idx + 1
      })),
      queueCount: downloadQueue.length,
      queue_count: downloadQueue.length
    });
  }

  // POST /api/cancel-queued-download
  if (req.url === "/api/cancel-queued-download" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    const target = String(body?.id || body?.filename || "");
    if (!target) return json(res, 400, { ok: false, error: "id or filename required" });
    const idx = downloadQueue.findIndex(item => item.id === target || item.filename === target);
    if (idx !== -1) {
      const removed = downloadQueue.splice(idx, 1)[0];
      console.log(`  [download-queue] Kuyruktan cikarildi: ${removed.filename || removed.name}`);
      return json(res, 200, { ok: true, removed, remaining: downloadQueue.length });
    }
    return json(res, 404, { ok: false, error: "Model kuyrukta bulunamadi." });
  }

  // POST /api/cancel-download
  if (req.url === "/api/cancel-download" && req.method === "POST") {
    let cancelAll = false;
    try {
      const body = await readJsonBody(req, res);
      cancelAll = Boolean(body?.cancelAll);
    } catch (_) {}
    const cancelled = cancelModelDownload(cancelAll);
    return json(res, 200, { ok: true, cancelled, queueCleared: cancelAll });
  }

  // GET /api/generation-progress
  if (req.url === "/api/generation-progress" && req.method === "GET") {
    return json(res, 200, {
      ...generationState,
      backendMode: generationState.backendMode || currentSettings.backendMode || "",
      backendDevice: generationState.backendDevice || currentSettings.backendDevice || "",
    });
  }

  if (req.url === "/api/openvino-generate" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    try {
      return json(res, 200, await generateWithOpenVino(body));
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message || String(err) });
    }
  }

  // GET /api/outputs
  if (req.url === "/api/outputs" && req.method === "GET") {
    return json(res, 200, { outputs: listGeneratedOutputs() });
  }

  // GET /api/output-file?filename=...
  if (req.url.startsWith("/api/output-file") && req.method === "GET") {
    const parsed = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const filename = path.basename(parsed.searchParams.get("filename") || "");
    const filePath = path.join(OUTPUTS, filename);
    if (!filename || !fs.existsSync(filePath)) {
      return json(res, 404, { error: "Output file not found" });
    }
    const ext = path.extname(filePath).toLowerCase();
    fs.readFile(filePath, (err, data) => {
      if (err) return json(res, 500, { error: err.message });
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(data);
    });
    return;
  }

  if (req.url.startsWith("/tts-outputs/") && req.method === "GET") {
    const filename = path.basename(decodeURIComponent(req.url.replace(/^\/tts-outputs\//, "").split("?")[0] || ""));
    const filePath = path.join(TTS_OUTPUTS, filename);
    if (!filename || !pathInside(filePath, TTS_OUTPUTS) || !fs.existsSync(filePath)) {
      return json(res, 404, { ok: false, error: "TTS output not found" });
    }
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".wav") ensureBrowserCompatibleTtsWav(filePath);
    const stat = fs.statSync(filePath);
    const contentType = MIME[ext] || "application/octet-stream";
    const range = req.headers.range;

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        res.writeHead(416, {
          "Content-Range": `bytes */${stat.size}`,
          "Accept-Ranges": "bytes",
        });
        res.end();
        return;
      }

      let start = match[1] ? Number(match[1]) : 0;
      let end = match[2] ? Number(match[2]) : stat.size - 1;
      if (!match[1] && match[2]) {
        const suffixLength = Math.min(Number(match[2]) || 0, stat.size);
        start = stat.size - suffixLength;
        end = stat.size - 1;
      }

      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end >= stat.size || start > end) {
        res.writeHead(416, {
          "Content-Range": `bytes */${stat.size}`,
          "Accept-Ranges": "bytes",
        });
        res.end();
        return;
      }

      res.writeHead(206, {
        "Content-Type": contentType,
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "Accept-Ranges": "bytes",
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  if (req.url.startsWith("/video-outputs/") && (req.method === "GET" || req.method === "HEAD")) {
    const filename = path.basename(decodeURIComponent(req.url.replace(/^\/video-outputs\//, "").split("?")[0] || ""));
    const filePath = path.join(VIDEO_OUTPUTS, filename);
    if (!filename || !pathInside(filePath, VIDEO_OUTPUTS) || !fs.existsSync(filePath)) {
      return json(res, 404, { ok: false, error: "Video output not found" });
    }
    const ext = path.extname(filePath).toLowerCase();
    const stat = fs.statSync(filePath);
    const contentType = MIME[ext] || "video/mp4";
    const range = req.headers.range;

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        res.writeHead(416, {
          "Content-Range": `bytes */${stat.size}`,
          "Accept-Ranges": "bytes",
        });
        res.end();
        return;
      }

      let start = match[1] ? Number(match[1]) : 0;
      let end = match[2] ? Number(match[2]) : stat.size - 1;
      if (!match[1] && match[2]) {
        const suffixLength = Math.min(Number(match[2]) || 0, stat.size);
        start = stat.size - suffixLength;
        end = stat.size - 1;
      }

      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end >= stat.size || start > end) {
        res.writeHead(416, {
          "Content-Range": `bytes */${stat.size}`,
          "Accept-Ranges": "bytes",
        });
        res.end();
        return;
      }

      res.writeHead(206, {
        "Content-Type": contentType,
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "Accept-Ranges": "bytes",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  if (req.url.startsWith("/audio-outputs/") && (req.method === "GET" || req.method === "HEAD")) {
    const filename = path.basename(decodeURIComponent(req.url.replace(/^\/audio-outputs\//, "").split("?")[0] || ""));
    const filePath = path.join(AUDIO_OUTPUTS, filename);
    if (!filename || !pathInside(filePath, AUDIO_OUTPUTS) || !fs.existsSync(filePath)) {
      return json(res, 404, { ok: false, error: "Audio output not found" });
    }
    const ext = path.extname(filePath).toLowerCase();
    const stat = fs.statSync(filePath);
    const contentType = ext === ".mp3" ? "audio/mpeg" : (ext === ".ogg" ? "audio/ogg" : "audio/wav");

    if (req.method === "HEAD") {
      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": stat.size,
        "Accept-Ranges": "bytes",
      });
      res.end();
      return;
    }

    const range = req.headers.range;

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        res.writeHead(416, {
          "Content-Range": `bytes */${stat.size}`,
          "Accept-Ranges": "bytes",
        });
        res.end();
        return;
      }

      let start = match[1] ? Number(match[1]) : 0;
      let end = match[2] ? Number(match[2]) : stat.size - 1;
      if (!match[1] && match[2]) {
        const suffixLength = Math.min(Number(match[2]) || 0, stat.size);
        start = stat.size - suffixLength;
        end = stat.size - 1;
      }

      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end >= stat.size || start > end) {
        res.writeHead(416, {
          "Content-Range": `bytes */${stat.size}`,
          "Accept-Ranges": "bytes",
        });
        res.end();
        return;
      }

      res.writeHead(206, {
        "Content-Type": contentType,
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "Accept-Ranges": "bytes",
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // POST /api/save-output
  if (req.url === "/api/save-output" && req.method === "POST") {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return;
      const saved = saveGeneratedOutput(body.image, body.metadata || {});
      return json(res, 200, { ok: true, output: { ...saved, url: `/api/output-file?filename=${encodeURIComponent(saved.image)}` } });
    } catch (err) {
      console.error("  [api] Failed to save output:", err);
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // POST /api/delete-outputs
  if (req.url === "/api/delete-outputs" && req.method === "POST") {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return;
      const deleted = deleteGeneratedOutputs(body.outputs || []);
      return json(res, 200, { ok: true, deleted });
    } catch (err) {
      console.error("  [api] Failed to delete outputs:", err);
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // POST /api/reveal-file or POST /api/open-folder
  if ((req.url === "/api/reveal-file" || req.url === "/api/open-folder") && req.method === "POST") {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return;
      const { url, filename, type, folder, image } = body;

      let targetDir = OUTPUTS;
      const kind = (type || folder || "").toLowerCase();
      if (kind === "video") targetDir = VIDEO_OUTPUTS;
      else if (kind === "audio" || kind === "music" || kind === "sfx") targetDir = AUDIO_OUTPUTS;
      else if (kind === "tts") targetDir = TTS_OUTPUTS;
      else if (kind === "image") targetDir = OUTPUTS;

      let targetFile = "";

      if (url && typeof url === "string") {
        let cleanUrl = url;
        try {
          if (url.startsWith("http://") || url.startsWith("https://")) {
            const u = new URL(url);
            cleanUrl = u.pathname + u.search;
          }
        } catch (_) {}

        if (cleanUrl.includes("/video-outputs/")) {
          targetDir = VIDEO_OUTPUTS;
          const part = cleanUrl.substring(cleanUrl.indexOf("/video-outputs/") + "/video-outputs/".length).split("?")[0];
          targetFile = path.basename(decodeURIComponent(part));
        } else if (cleanUrl.includes("/audio-outputs/")) {
          targetDir = AUDIO_OUTPUTS;
          const part = cleanUrl.substring(cleanUrl.indexOf("/audio-outputs/") + "/audio-outputs/".length).split("?")[0];
          targetFile = path.basename(decodeURIComponent(part));
        } else if (cleanUrl.includes("/tts-outputs/")) {
          targetDir = TTS_OUTPUTS;
          const part = cleanUrl.substring(cleanUrl.indexOf("/tts-outputs/") + "/tts-outputs/".length).split("?")[0];
          targetFile = path.basename(decodeURIComponent(part));
        } else if (cleanUrl.includes("/api/output-file")) {
          targetDir = OUTPUTS;
          try {
            const u = new URL(cleanUrl, "http://localhost");
            const fname = u.searchParams.get("filename") || "";
            if (fname) targetFile = path.basename(fname);
          } catch (_) {}
        } else if (cleanUrl.includes("/outputs/")) {
          targetDir = OUTPUTS;
          const part = cleanUrl.substring(cleanUrl.indexOf("/outputs/") + "/outputs/".length).split("?")[0];
          targetFile = path.basename(decodeURIComponent(part));
        }
      }

      if (!targetFile && image) {
        targetDir = OUTPUTS;
        targetFile = path.basename(String(image));
      }
      if (!targetFile && filename) {
        targetFile = path.basename(String(filename));
      }

      let isFile = false;
      let targetPath = targetDir;
      if (targetFile) {
        const candidatePath = path.join(targetDir, targetFile);
        if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
          targetPath = candidatePath;
          isFile = true;
        }
      }

      // Security jail: targetPath and targetDir must be inside ROOT
      if (!pathInside(targetPath, ROOT) || !pathInside(targetDir, ROOT)) {
        return json(res, 403, { ok: false, error: "Access denied" });
      }

      const opened = revealPathInExplorer(targetPath, targetDir, isFile);
      console.log(`  [reveal-file] Opened: ${targetPath} (isFile: ${isFile})`);
      return json(res, 200, { ok: true, opened, path: targetPath, isFile });
    } catch (err) {
      console.error("  [api] Failed to reveal file or folder:", err);
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // POST /api/import-model?filename=...
  if (req.url.startsWith("/api/import-model") && req.method === "POST") {
    try {
      const parsed = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const kind = parsed.searchParams.get("kind") || "image";
      let destDir = MODELS;
      if (kind === "video") destDir = VIDEO_MODELS;
      else if (kind === "music") destDir = MUSIC_MODELS;
      else if (kind === "rvc") destDir = RVC_MODELS;
      const result = await streamModelUpload(req, parsed.searchParams.get("filename"), destDir, kind);
      return json(res, 200, { ok: true, message: `Imported ${result.filename}`, model: result, filename: result.filename });
    } catch (err) {
      console.error("  [api] Failed to import model:", err);
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  if (req.url.startsWith("/api/llm/import-model") && req.method === "POST") {
    try {
      const parsed = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const result = await streamModelUpload(req, parsed.searchParams.get("filename"), LLM_MODELS, "text");
      return json(res, 200, { ok: true, message: `Imported ${result.filename}`, model: result });
    } catch (err) {
      console.error("  [api] Failed to import text model:", err);
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  if (req.url === "/api/llm/delete-model" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    const filename = path.basename(String(body.filename || ""));
    const modelPath = path.join(LLM_MODELS, filename);
    if (!filename || !pathInside(modelPath, LLM_MODELS)) {
      return json(res, 400, { ok: false, error: "Invalid filename" });
    }
    if (llmSettings.model === filename && llmProc) await killLlm();
    try {
      fs.unlinkSync(modelPath);
      return json(res, 200, { ok: true });
    } catch (err) {
      return json(res, err.code === "ENOENT" ? 404 : 500, {
        ok: false,
        error: err.code === "ENOENT" ? "Text model not found" : err.message,
      });
    }
  }

  // POST /api/delete-model
  if (req.url === "/api/delete-model" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    const { filename } = body;
    if (!filename) return json(res, 400, { error: "Filename is required" });
    
    const openvinoModel = findOpenVinoModel(filename);
    const safeFilename = path.basename(filename);
    // Folders are removed recursively below, so "." and ".." must never reach path.join.
    if (!safeFilename || safeFilename === "." || safeFilename === "..") return json(res, 400, { error: "Invalid filename" });
    const modelPath = path.join(MODELS, safeFilename);

    try {
      if (openvinoModel?.installed && openvinoModel.path && pathInside(openvinoModel.path, OPENVINO_MODELS)) {
        fs.rmSync(openvinoModel.path, { recursive: true, force: true });
        cachedBackendOptions = null;
        console.log(`  [api] Deleted OpenVINO model: ${openvinoModel.id}`);
        return json(res, 200, { ok: true, message: `Deleted ${openvinoModel.name}` });
      } else if (fs.existsSync(modelPath)) {
        fs.unlinkSync(modelPath);
        console.log(`  [api] Deleted model file: ${safeFilename}`);
        return json(res, 200, { ok: true, message: `Deleted ${safeFilename}` });
      } else if (fs.existsSync(path.join(VIDEO_MODELS, safeFilename))) {
        // Snapshot models (Wan, SVD, MusicGen, AudioLDM, Stable Audio) are folders.
        fs.rmSync(path.join(VIDEO_MODELS, safeFilename), { recursive: true, force: true });
        console.log(`  [api] Deleted video model file: ${safeFilename}`);
        return json(res, 200, { ok: true, message: `Deleted ${safeFilename}` });
      } else if (fs.existsSync(path.join(MUSIC_MODELS, safeFilename))) {
        fs.rmSync(path.join(MUSIC_MODELS, safeFilename), { recursive: true, force: true });
        console.log(`  [api] Deleted music model file: ${safeFilename}`);
        return json(res, 200, { ok: true, message: `Deleted ${safeFilename}` });
      } else if (fs.existsSync(path.join(RVC_MODELS, safeFilename))) {
        fs.unlinkSync(path.join(RVC_MODELS, safeFilename));
        console.log(`  [api] Deleted RVC model file: ${safeFilename}`);
        return json(res, 200, { ok: true, message: `Deleted ${safeFilename}` });
      } else {
        return json(res, 404, { error: "Model file not found" });
      }
    } catch (err) {
      console.error(`  [api] Failed to delete model ${safeFilename}:`, err);
      return json(res, 500, { error: err.message });
    }
  }

  if (req.url.startsWith("/api/")) {
    return json(res, 404, { ok: false, error: "Unknown API endpoint" });
  }

  // -- Static frontend files -------------------------------------------------
  let requestPath = "/";
  try {
    requestPath = decodeURIComponent(String(req.url || "/").split("?")[0]);
  } catch (_) {}
  let filePath = path.join(DIST, requestPath === "/" ? "index.html" : requestPath);
  if (!pathInside(filePath, DIST) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, "index.html");
  }

  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    // Only Vite's content-hashed bundles are safe to cache forever; fixed names like logo.png must revalidate.
    const cacheControl = ext === ".html"
      ? "no-cache, no-store, must-revalidate"
      : requestPath.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache";
    res.writeHead(200, {
      "Content-Type": mime,
      "Cache-Control": cacheControl,
    });
    res.end(data);
  });
});

server.timeout = 0; // Disable socket timeout for large model uploads/downloads

server.listen(PORT_FRONTEND, LISTEN_HOST, () => {
  console.log("");
  console.log("  ============================================================");
  console.log("   Sansursuz Lokal AI Studyosu - DD:YZ   |  Calisiyor");
  console.log("   Server Build: " + SERVER_BUILD);
  console.log("   Frontend : http://localhost:" + PORT_FRONTEND);
  console.log("   Image API: http://127.0.0.1:" + PORT_BACKEND);
  console.log("   Text API : starts on http://127.0.0.1:" + PREFERRED_LLM_PORT);
  console.log("   Speech   : managed locally, API on frontend port");
  console.log("   TTS      : Kokoro ONNX managed locally, API on frontend port");
  console.log("  ============================================================");
  console.log("");

  // Do not auto-start backend; wait for selection from the Web UI
  console.log("  [backend] Ready. Waiting for model load request from the webapp...");

  // Otomatik yarım/bozuk indirme kalıntılarını temizle
  try { cleanupOrphanedPartFiles(); } catch (_) {}

  warmPythonResolver().catch(() => {});
});

// Graceful shutdown
process.on("SIGINT",  async () => { await killBackend(); await killOpenVinoWorker(); await killLlm(); await stopSpeech(); await stopTts(); process.exit(0); });
process.on("SIGTERM", async () => { await killBackend(); await killOpenVinoWorker(); await killLlm(); await stopSpeech(); await stopTts(); process.exit(0); });
