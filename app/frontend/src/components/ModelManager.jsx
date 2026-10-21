import React, { memo, useState, useEffect, useCallback, useRef } from "react";
import { uiText } from "../i18n";
import { FolderOpen, DownloadCloud, RefreshCw, Database, Trash2, Square, HardDrive, Library, AlertTriangle, Search, X, CheckCircle2, Clock, ListPlus, KeyRound, ExternalLink, ShieldCheck, Eye, EyeOff } from "lucide-react";
import {
  listLocalModels,
  startServer,
  stopServer,
  importModelFile,
  deleteModel,
  downloadModel,
  downloadOpenVinoModel,
  cancelModelDownload,
  cancelQueuedDownload,
  getDownloadProgress,
  getBackendStatus,
  pingServer,
  formatBytes,
  normalizeModel,
  listLlmModels,
  startLlm,
  stopLlm,
  downloadLlmModel,
  deleteLlmModel,
  importLlmModel,
  getLlmStatus,
  searchHuggingFaceModels,
  listSpeechModels,
  startSpeech,
  stopSpeech,
  downloadSpeechModel,
  deleteSpeechModel,
  importSpeechModel,
  getSpeechStatus,
  listTtsModels,
  startTts,
  stopTts,
  downloadTtsModel,
  deleteTtsModel,
  importTtsModel,
  getTtsStatus,
  isLocalServerMode,
  downloadDefaultModels,
  getCompatibleModels,
  listMusicModels,
  downloadMusicModel,
  deleteMusicModel,
  importMusicModel,
  listVideoModels,
  downloadVideoModel,
  deleteVideoModel,
  importVideoModel,
  getHuggingFaceToken,
  saveHuggingFaceToken,
  deleteHuggingFaceToken,
  downloadSnapshotModel,
} from "../services/api";

const MODEL_FILTERS = [
  { id: "vision", label: "Vision" },
  { id: "uncensored", label: "Uncensored" },
];

// Sizes are the real download sizes (GB = 10^9 bytes) checked against Hugging Face.
// Only single-file checkpoints that stable-diffusion.cpp can load with --model are listed.
const MODEL_LIBRARY = [
  {
    group: "SDXL - Yüksek Kalite (8 GB+ VRAM, 1024x1024)",
    items: [
      {
        name: "RealVisXL V5.0 (Fotogerçekçi SDXL, fp16)",
        filename: "RealVisXL_V5.0_fp16.safetensors",
        format: "Safetensors (SDXL)",
        approxSize: "6.9 GB",
        resolution: "1024x1024",
        minVramGb: 8,
        notes: "Fotogerçekçi portre ve sahne üretimi için SDXL ince ayarı. Önerilen: 30 adım, CFG 4-6, DPM++ 2M + Karras zamanlayıcı (model seçilince otomatik ayarlanır).",
        url: "https://huggingface.co/SG161222/RealVisXL_V5.0/resolve/main/RealVisXL_V5.0_fp16.safetensors",
        pageUrl: "https://huggingface.co/SG161222/RealVisXL_V5.0",
        recommendedTiers: ["Mid", "High", "Ultra"],
      },
      {
        name: "Juggernaut XL v9 Lightning (RunDiffusion Photo 2)",
        filename: "Juggernaut_RunDiffusionPhoto2_Lightning_4Steps.safetensors",
        format: "Safetensors (SDXL Lightning)",
        approxSize: "7.1 GB",
        resolution: "1024x1024",
        minVramGb: 8,
        notes: "Fotogerçekçi SDXL Lightning modeli. Önerilen: 4-6 adım, CFG 1.5-2, Euler + SGM Uniform zamanlayıcı (model seçilince otomatik ayarlanır).",
        url: "https://huggingface.co/RunDiffusion/Juggernaut-XL-Lightning/resolve/main/Juggernaut_RunDiffusionPhoto2_Lightning_4Steps.safetensors",
        pageUrl: "https://huggingface.co/RunDiffusion/Juggernaut-XL-Lightning",
        recommendedTiers: ["Mid", "High"],
      },
      {
        name: "DreamShaper XL Lightning",
        filename: "DreamShaperXL_Lightning.safetensors",
        format: "Safetensors (SDXL Lightning)",
        approxSize: "6.9 GB",
        resolution: "1024x1024",
        minVramGb: 8,
        notes: "İllüstrasyon, fantastik sanat ve 3D render tarzı için çok yönlü SDXL Lightning. Önerilen: 4-6 adım, CFG 1.5-2, Euler + SGM Uniform zamanlayıcı.",
        url: "https://huggingface.co/Lykon/dreamshaper-xl-lightning/resolve/main/DreamShaperXL_Lightning.safetensors",
        pageUrl: "https://huggingface.co/Lykon/dreamshaper-xl-lightning",
        recommendedTiers: ["Mid", "High"],
      },
    ],
  },
  {
    group: "SD 1.5 - Hızlı / Düşük Bellek (4 GB VRAM veya CPU, 512x512)",
    items: [
      {
        name: "Realistic Vision V5.1 (fp16, VAE'siz)",
        filename: "Realistic_Vision_V5.1_fp16-no-ema.safetensors",
        format: "Safetensors (SD 1.5)",
        approxSize: "2.1 GB",
        resolution: "512x512",
        notes: "Fotogerçekçi SD 1.5 modeli. AnimateDiff video üretimi de bu modeli temel olarak kullanır.",
        url: "https://huggingface.co/SG161222/Realistic_Vision_V5.1_noVAE/resolve/main/Realistic_Vision_V5.1_fp16-no-ema.safetensors",
        pageUrl: "https://huggingface.co/SG161222/Realistic_Vision_V5.1_noVAE",
        recommendedTiers: ["Low"],
      },
      {
        name: "DreamShaper 8",
        filename: "DreamShaper_8_pruned.safetensors",
        format: "Safetensors (SD 1.5)",
        approxSize: "2.1 GB",
        resolution: "512x512",
        notes: "İllüstrasyon, anime ve yarı gerçekçi portreler için genel amaçlı SD 1.5 modeli.",
        url: "https://huggingface.co/Lykon/DreamShaper/resolve/main/DreamShaper_8_pruned.safetensors",
        pageUrl: "https://huggingface.co/Lykon/DreamShaper",
        recommendedTiers: ["Low"],
      },
      {
        name: "CyberRealistic V8 (fp16)",
        filename: "CyberRealistic_V8_FP16.safetensors",
        format: "Safetensors (SD 1.5)",
        approxSize: "2.1 GB",
        resolution: "512x512",
        notes: "SD 1.5 ekosisteminde yüksek gerçekçilik odaklı model.",
        url: "https://huggingface.co/cyberdelia/CyberRealistic/resolve/main/CyberRealistic_V8_FP16.safetensors",
        pageUrl: "https://huggingface.co/cyberdelia/CyberRealistic",
        recommendedTiers: ["Low"],
      },
      {
        name: "ReV Animated v1.2.2",
        filename: "rev-animated-v1-2-2.safetensors",
        format: "Safetensors (SD 1.5, fp32)",
        approxSize: "5.5 GB",
        resolution: "512x512",
        notes: "2.5D, anime ve fantastik dijital sanat. Bu dosya fp32 olduğu için diğer SD 1.5 modellerinden büyüktür.",
        url: "https://huggingface.co/danbrown/RevAnimated-v1-2-2/resolve/main/rev-animated-v1-2-2.safetensors",
        pageUrl: "https://huggingface.co/danbrown/RevAnimated-v1-2-2",
        recommendedTiers: ["Low"],
      },
      {
        name: "Stable Diffusion 1.5 (pruned EMA)",
        filename: "v1-5-pruned-emaonly.safetensors",
        format: "Safetensors (SD 1.5)",
        approxSize: "4.3 GB",
        resolution: "512x512",
        notes: "Orijinal Stable Diffusion 1.5 temel modeli (runwayml deposu kaldırıldığı için resmi yansıdan indirilir).",
        url: "https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5/resolve/main/v1-5-pruned-emaonly.safetensors",
        pageUrl: "https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5",
        recommendedTiers: ["Low", "Mid"],
      },
    ],
  },
];

const TEXT_MODEL_LIBRARY = [
  {
    group: "Hafif LLM'ler (≤ 6 GB VRAM / 8 GB RAM)",
    tier: "Low",
    items: [
      {
        name: "Qwen 2.5 3B Instruct (Q4_K_M)",
        filename: "Qwen2.5-3B-Instruct-Q4_K_M.gguf",
        format: "GGUF",
        approxSize: "1.9 GB",
        resolution: "N/A",
        minVramGb: 4,
        notes: "Alibaba Qwen 2.5 ailesinin 3B sohbet modeli; 29+ dil desteği (çok dilli, Türkçe de kullanılabilir), 32K bağlam. Hafif sistemler için iyi bir genel asistan. Qwen Research lisansı.",
        url: "https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf",
        pageUrl: "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct",
        recommendedTiers: ["Low"],
      },
      {
        name: "Meta Llama 3.2 3B Instruct (Q4_K_M)",
        filename: "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
        format: "GGUF",
        approxSize: "2.0 GB",
        resolution: "N/A",
        minVramGb: 4,
        notes: "Meta'nın 3B çok dilli sohbet modeli, 128K bağlam. Resmi olarak desteklenen 8 dil arasında Türkçe yoktur. Llama 3.2 lisansı.",
        url: "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
        pageUrl: "https://huggingface.co/meta-llama/Llama-3.2-3B-Instruct",
        recommendedTiers: ["Low"],
      },
      {
        name: "Qwen 2.5 Coder 3B Instruct (Q4_K_M)",
        filename: "qwen2.5-coder-3b-instruct-q4_k_m.gguf",
        format: "GGUF",
        approxSize: "2.1 GB",
        resolution: "N/A",
        minVramGb: 4,
        notes: "Kod üretimi ve hata ayıklama için 3B Qwen 2.5 Coder (resmi Qwen GGUF).",
        url: "https://huggingface.co/Qwen/Qwen2.5-Coder-3B-Instruct-GGUF/resolve/main/qwen2.5-coder-3b-instruct-q4_k_m.gguf",
        pageUrl: "https://huggingface.co/Qwen/Qwen2.5-Coder-3B-Instruct",
        recommendedTiers: ["Low"],
      },
    ],
  },
  {
    group: "Orta Seviye LLM'ler (8-12 GB VRAM / 16-32 GB RAM)",
    tier: "Mid",
    items: [
      {
        name: "Qwen 2.5 7B Instruct (Q4_K_M)",
        filename: "Qwen2.5-7B-Instruct-Q4_K_M.gguf",
        format: "GGUF",
        approxSize: "4.7 GB",
        resolution: "N/A",
        minVramGb: 8,
        notes: "7B sınıfında güçlü çok dilli sohbet modeli; 29+ dil desteği (çok dilli, Türkçe de kullanılabilir), 32K bağlam (YaRN ile 128K). Apache-2.0.",
        url: "https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf",
        pageUrl: "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct",
        recommendedTiers: ["Mid"],
      },
      {
        name: "Meta Llama 3.1 8B Instruct (Q4_K_M)",
        filename: "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
        format: "GGUF",
        approxSize: "4.9 GB",
        resolution: "N/A",
        minVramGb: 8,
        notes: "Meta'nın 128K bağlamlı 8B genel amaçlı sohbet modeli. Llama 3.1 lisansı.",
        url: "https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
        pageUrl: "https://huggingface.co/meta-llama/Meta-Llama-3.1-8B-Instruct",
        recommendedTiers: ["Mid"],
      },
      {
        name: "Qwen 2.5 Coder 7B Instruct (Q4_K_M)",
        filename: "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
        format: "GGUF",
        approxSize: "4.7 GB",
        resolution: "N/A",
        minVramGb: 8,
        notes: "Kodlama odaklı 7B model; Qwen'in raporladığı HumanEval skoru %88.4. Apache-2.0.",
        url: "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf",
        pageUrl: "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct",
        recommendedTiers: ["Mid"],
      },
    ],
  },
  {
    group: "Üst Seviye LLM'ler (12-16 GB+ VRAM veya RAM offload)",
    tier: "High",
    items: [
      {
        name: "DeepSeek-R1 Distill Qwen 14B (Q4_K_M)",
        filename: "DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf",
        format: "GGUF",
        approxSize: "9.0 GB",
        resolution: "N/A",
        minVramGb: 12,
        notes: "DeepSeek-R1'den damıtılmış düşünce zincirli (<think>) muhakeme modeli. DeepSeek raporu: AIME 2024 %69.7 (pass@1), MATH-500 %93.9 — o1-mini'nin üzerinde. MIT lisansı.",
        url: "https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf",
        pageUrl: "https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-14B",
        recommendedTiers: ["High"],
      },
      {
        name: "Qwen 2.5 14B Instruct (Q4_K_M)",
        filename: "Qwen2.5-14B-Instruct-Q4_K_M.gguf",
        format: "GGUF",
        approxSize: "9.0 GB",
        resolution: "N/A",
        minVramGb: 12,
        notes: "Qwen 2.5'in 14B sohbet modeli; 29+ dil desteği (çok dilli, Türkçe de kullanılabilir), 32K bağlam (YaRN ile 128K). Apache-2.0.",
        url: "https://huggingface.co/bartowski/Qwen2.5-14B-Instruct-GGUF/resolve/main/Qwen2.5-14B-Instruct-Q4_K_M.gguf",
        pageUrl: "https://huggingface.co/Qwen/Qwen2.5-14B-Instruct",
        recommendedTiers: ["High"],
      },
      {
        name: "Qwen 2.5 Coder 14B Instruct (Q4_K_M)",
        filename: "qwen2.5-coder-14b-instruct-q4_k_m.gguf",
        format: "GGUF",
        approxSize: "9.0 GB",
        resolution: "N/A",
        minVramGb: 12,
        notes: "Kodlama odaklı 14B model; Qwen'in raporladığı HumanEval skoru %89.6. Apache-2.0.",
        url: "https://huggingface.co/Qwen/Qwen2.5-Coder-14B-Instruct-GGUF/resolve/main/qwen2.5-coder-14b-instruct-q4_k_m.gguf",
        pageUrl: "https://huggingface.co/Qwen/Qwen2.5-Coder-14B-Instruct",
        recommendedTiers: ["High"],
      },
      {
        name: "DeepSeek-R1 Distill Qwen 32B (Q4_K_M)",
        filename: "DeepSeek-R1-Distill-Qwen-32B-Q4_K_M.gguf",
        format: "GGUF",
        approxSize: "19.9 GB",
        resolution: "N/A",
        minVramGb: 16,
        notes: "32B muhakeme modeli (DeepSeek raporu: AIME 2024 %72.6, MATH-500 %94.3). 16 GB VRAM'de bir kısmı sistem RAM'ine aktarılarak (offload) daha yavaş çalışır; 32 GB+ RAM önerilir.",
        url: "https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-32B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-32B-Q4_K_M.gguf",
        pageUrl: "https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
        recommendedTiers: ["Ultra"],
      },
    ],
  },
];

const OPENVINO_MODEL_LIBRARY = [
  {
    group: "Intel NPU - OpenVINO Test",
    items: [
      {
        id: "lcm-dreamshaper-v7-fp16",
        name: "LCM DreamShaper v7 FP16",
        filename: "lcm-dreamshaper-v7-fp16",
        format: "OpenVINO",
        backendType: "openvino-npu",
        approxSize: "2.0 GB",
        resolution: "512x512",
        notes: "NPU test model for Windows and Linux. Runs the text encoder on CPU, UNet on Intel NPU, and VAE decoder on Intel GPU or CPU fallback.",
        url: "https://huggingface.co/OpenVINO/LCM_Dreamshaper_v7-fp16-ov",
      },
    ],
  },
];

// TTS entries mirror the server catalog (/api/tts/models). "supported: false" entries are
// shown for reference only and cannot be installed.
const TTS_MODEL_LIBRARY = [
  {
    group: "Türkçe Seslendirme Modelleri (Yerel)",
    items: [
      {
        id: "antalia-mini",
        name: "Antalia-2 Mini Türkçe (48 kHz, tek erkek sesi)",
        filename: "antalia-mini.json",
        format: "Flow-Matching / PyTorch (7.62M)",
        approxSize: "31 MB",
        resolution: "48 kHz",
        notes: "7.62M parametre, 48 kHz, tek sentetik erkek sesi; sayı/tarih/tutar normalleştiricisi dahili. Freya-TR-Eval WER %1.02. Python paketi: pip install antalia-mini. Apache-2.0.",
        url: "tts://install/antalia-mini",
        pageUrl: "https://huggingface.co/cloud0day3/antalia-mini",
        recommendedTiers: ["Low", "Mid", "High", "Ultra"],
      },
      {
        id: "ema-lightning",
        name: "EMA Lightning Türkçe (48 kHz, tek ses)",
        filename: "ema-lightning.json",
        format: "Flow-Matching DiT / PyTorch (8.6M)",
        approxSize: "34 MB",
        resolution: "48 kHz",
        notes: "5.6M DiT + 3M vokoder (8.6M), 4 adımda 48 kHz. Freya-TR-Eval'de %0.92 WER (ElevenLabs v4 ve Trendyol-TTS dahil ölçülen sistemlerin en düşüğü). Tek ses, klonlama yok. Python paketi: pip install ema-lightning. Apache-2.0.",
        url: "tts://install/ema-lightning",
        pageUrl: "https://huggingface.co/canberkkkkkk/ema-lightning",
        recommendedTiers: ["Low", "Mid", "High", "Ultra"],
      },
      {
        id: "ahenk-cep",
        name: "Ahenk Cep Türkçe (48 kHz, kadın sesi, 7 üslup)",
        filename: "ahenk-cep.json",
        format: "Flow-Matching DiT / PyTorch (8.6M)",
        approxSize: "34 MB",
        resolution: "48 kHz",
        notes: "EMA Lightning'den türetilmiş 8.6M model, tek tasarlanmış kadın sesi, 7 üslup (nötr, neşeli, sakin, empatik, hüzünlü, şaşkın, öfkeli; farklar hafiftir). Ağırlıklar CC-BY-4.0 (atıf gerekir).",
        url: "tts://install/ahenk-cep",
        pageUrl: "https://huggingface.co/ozgurguler/ahenk-cep-tr",
        recommendedTiers: ["Low", "Mid", "High", "Ultra"],
      },
      {
        id: "supertonic-3",
        name: "Supertone Supertonic-3 (31 dil, 44.1 kHz, 10 ses)",
        filename: "supertonic-3.json",
        format: "Supertone ONNX (~99M)",
        approxSize: "~395 MB",
        resolution: "44.1 kHz",
        notes: "~99M parametreli ONNX motoru; Türkçe dahil 31 dil, 10 hazır ses stili (M1-M5, F1-F5) ve <laugh>, <breath>, <sigh> etiketleri. Python paketi: pip install supertonic. OpenRAIL.",
        url: "tts://install/supertonic-3",
        pageUrl: "https://huggingface.co/Supertone/supertonic-3",
        recommendedTiers: ["Low", "Mid", "High"],
      },
      {
        id: "omnivoice",
        name: "OmniVoice Zero-Shot Ses Klonlama (600+ dil)",
        filename: "omnivoice.json",
        format: "OmniVoice (Qwen3-0.6B tabanlı)",
        approxSize: "3.3 GB",
        minVramGb: 6,
        resolution: "24 kHz",
        notes: "k2-fsa'nın zero-shot TTS modeli: kısa bir referans sesle klonlama ve metinle ses tasarımı, Türkçe dahil 600+ dil. Python paketi: pip install omnivoice. GPU önerilir.",
        url: "tts://install/omnivoice",
        pageUrl: "https://huggingface.co/k2-fsa/OmniVoice",
        recommendedTiers: ["Mid", "High", "Ultra"],
      },
      {
        id: "kokoro-onnx-q8",
        name: "Kokoro 82M ONNX Q8 (İngilizce)",
        filename: "kokoro-onnx-q8.json",
        format: "Kokoro ONNX",
        approxSize: "92 MB",
        resolution: "24 kHz",
        notes: "Hızlı ve hafif İngilizce TTS (Amerikan / İngiliz sesleri). Türkçe sesi yoktur; Türkçe metin deneysel fonetik dönüşümle, aksanlı okunur.",
        url: "tts://install/kokoro-onnx-q8",
        pageUrl: "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX",
        recommendedTiers: ["Low", "Mid", "High"],
      },
      {
        id: "kokoro-onnx-fp32",
        name: "Kokoro 82M ONNX FP32 (İngilizce)",
        filename: "kokoro-onnx-fp32.json",
        format: "Kokoro ONNX",
        approxSize: "326 MB",
        resolution: "24 kHz",
        notes: "Kokoro v1.0'ın tam hassasiyetli (fp32) sürümü. Yalnızca İngilizce sesler.",
        url: "tts://install/kokoro-onnx-fp32",
        pageUrl: "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX",
        recommendedTiers: ["Mid", "High"],
      },
    ],
  },
  {
    group: "Henüz Entegre Edilmemiş Modeller (Bilgi Amaçlı)",
    items: [
      {
        id: "xtts-v2",
        name: "Coqui XTTS-v2",
        filename: "xtts-v2.json",
        format: "PyTorch",
        approxSize: "-",
        supported: false,
        notes: "Türkçe dahil 17 dilde ~6 saniyelik referansla ses klonlama (CPML, ticari olmayan lisans). Bu sürümde uygulamaya entegre edilmedi.",
        pageUrl: "https://huggingface.co/coqui/XTTS-v2",
        recommendedTiers: ["Mid", "High"],
      },
      {
        id: "chatterbox-multilingual",
        name: "Chatterbox Multilingual (Resemble AI)",
        filename: "chatterbox-multilingual-v3.json",
        format: "PyTorch",
        approxSize: "-",
        supported: false,
        notes: "0.5B parametreli, Türkçe dahil 23 dilli ses klonlamalı TTS. Bu sürümde uygulamaya entegre edilmedi.",
        pageUrl: "https://huggingface.co/ResembleAI/chatterbox",
        recommendedTiers: ["Mid", "High"],
      },
      {
        id: "piper-tr-dfki",
        name: "Piper TTS Türkçe DFKI (elle kurulum)",
        filename: "piper-tr-dfki.json",
        format: "Piper ONNX",
        approxSize: "63 MB",
        supported: false,
        notes: "22.05 kHz, CPU'da çok hızlı tek sesli Türkçe TTS. piper.exe'yi app/tools/piper, tr_TR-dfki-medium.onnx (+ .json) dosyalarını app/tts-models/piper klasörüne koyarsanız Ses Stüdyosu'nda çalışır.",
        pageUrl: "https://huggingface.co/rhasspy/piper-voices/tree/main/tr/tr_TR/dfki/medium",
        recommendedTiers: ["Low", "Mid", "High"],
      },
    ],
  },
];

// Music entries come from /api/music/models (server is the source of truth); this list is the
// offline fallback with the same ids.
const MUSIC_MODEL_LIBRARY = [
  {
    group: "Müzik Üretimi (MusicGen, 32 kHz mono)",
    items: [
      {
        id: "musicgen-small",
        name: "Meta MusicGen Small (300M)",
        filename: "musicgen-small-local",
        snapshotId: "musicgen-small",
        format: "Transformers (klasör)",
        approxSize: "2.4 GB",
        resolution: "32 kHz mono",
        notes: "En hızlı MusicGen. Medium ve Large modelleri de bu klasördeki metin kodlayıcıyı kullanır. CC-BY-NC 4.0.",
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
        notes: "1.5B parametreli MusicGen. MusicGen Small klasörü de gerekir. CC-BY-NC 4.0.",
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
        minVramGb: 12,
        notes: "3.3B parametreli en büyük MusicGen. MusicGen Small klasörü de gerekir. CC-BY-NC 4.0.",
        url: "https://huggingface.co/facebook/musicgen-large/resolve/main/state_dict.bin",
        pageUrl: "https://huggingface.co/facebook/musicgen-large",
        recommendedTiers: ["High", "Ultra"],
      },
    ],
  },
  {
    group: "Ses Efekti / Foley (AudioLDM, 16 kHz mono)",
    items: [
      {
        id: "audioldm2-large",
        name: "AudioLDM 2 Large",
        filename: "audioldm2-large",
        snapshotId: "audioldm2-large",
        format: "Diffusers (klasör)",
        approxSize: "6.0 GB",
        resolution: "16 kHz mono",
        notes: "750M parametreli UNet'li en büyük AudioLDM 2. CC-BY-NC-SA 4.0.",
        pageUrl: "https://huggingface.co/cvssp/audioldm2-large",
        recommendedTiers: ["High", "Ultra"],
      },
      {
        id: "audioldm2",
        name: "AudioLDM 2",
        filename: "audioldm2",
        snapshotId: "audioldm2",
        format: "Diffusers (klasör)",
        approxSize: "4.5 GB",
        resolution: "16 kHz mono",
        notes: "350M parametreli UNet'li temel AudioLDM 2. CC-BY-NC-SA 4.0.",
        pageUrl: "https://huggingface.co/cvssp/audioldm2",
        recommendedTiers: ["Mid", "High"],
      },
      {
        id: "audioldm-small",
        name: "AudioLDM-S Full v2",
        filename: "audioldm-s-full-v2",
        snapshotId: "audioldm-small",
        format: "Diffusers (klasör)",
        approxSize: "1.7 GB",
        resolution: "16 kHz mono",
        notes: "İlk nesil AudioLDM'nin küçük sürümü; en az bellekle hızlı ses efekti. CC-BY-NC-SA 4.0.",
        pageUrl: "https://huggingface.co/cvssp/audioldm-s-full-v2",
        recommendedTiers: ["Low", "Mid"],
      },
    ],
  },
];

const VIDEO_MODEL_LIBRARY = [
  {
    group: "Yerel Video Modelleri (NVIDIA CUDA GPU gerekir)",
    items: [
      {
        id: "animatediff-v15",
        name: "AnimateDiff v1.5 v2 hareket modülü (T2V)",
        filename: "mm_sd_v15_v2.ckpt",
        format: "CKPT (motion module)",
        approxSize: "1.8 GB",
        resolution: "512x512, 16 kare",
        minVramGb: 6,
        notes: "SD 1.5 tabanlı kısa video. app/models içinde Realistic Vision 5.1 (veya DreamShaper 8 / SD 1.5) de gerekir.",
        url: "https://huggingface.co/guoyww/animatediff/resolve/main/mm_sd_v15_v2.ckpt",
        pageUrl: "https://huggingface.co/guoyww/animatediff",
        recommendedTiers: ["Low", "Mid", "High"],
      },
      {
        id: "wan21-1.3b",
        name: "Wan 2.1 T2V 1.3B (Diffusers)",
        filename: "wan21-t2v-1.3b",
        snapshotId: "wan21-t2v-1.3b",
        format: "Diffusers (DiT + UMT5-XXL + VAE)",
        approxSize: "~29 GB",
        resolution: "832x480 (480p), 16 FPS",
        minVramGb: 8,
        notes: "Alibaba Wan 2.1 1.3B metinden video. Resmi asgari 8.19 GB VRAM; 480p önerilir. CPU offload ile çalışır, 32 GB+ RAM önerilir. Apache-2.0.",
        pageUrl: "https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
        recommendedTiers: ["Mid", "High"],
      },
      {
        id: "svd-xt",
        name: "Stable Video Diffusion XT 1.1 (I2V, fp16)",
        filename: "svd-xt-1.1",
        snapshotId: "svd-xt-1.1",
        format: "Diffusers fp16",
        approxSize: "4.5 GB",
        resolution: "1024x576, 25 kare",
        minVramGb: 12,
        notes: "Tek görselden 25 karelik video (görselden video). Stability AI Community lisansı.",
        pageUrl: "https://huggingface.co/vdo/stable-video-diffusion-img2vid-xt-1-1",
        recommendedTiers: ["Mid", "High"],
      },
      {
        id: "ltx-video-2b",
        name: "Lightricks LTX-Video 2B v0.9 (entegre değil)",
        filename: "ltx-video-2b-v0.9.safetensors",
        format: "Safetensors (DiT + VAE)",
        approxSize: "9.4 GB",
        resolution: "768x512, 24 FPS",
        supported: false,
        notes: "Ayrı bir T5-XXL metin kodlayıcısı ve LTX boru hattı gerektirir; bu sürümde video worker'ına entegre edilmedi.",
        pageUrl: "https://huggingface.co/Lightricks/LTX-Video",
        recommendedTiers: ["Mid", "High"],
      },
    ],
  },
];

const COREML_MODEL_LIBRARY = [
  {
    group: "Apple Silicon NPU - CoreML Test",
    items: [
      {
        name: "Stable Diffusion v1.5 CoreML (split_einsum, palettized 6-bit)",
        filename: "coreml-stable-diffusion-v1-5-palettized_split_einsum_v2_compiled",
        format: "CoreML",
        approxSize: "2.0 GB",
        resolution: "512x512",
        notes: "Apple Silicon ANE (Neural Engine) optimized 6-bit palettized Stable Diffusion 1.5 model. Unzips automatically on download completion and runs extremely fast on Mac NPUs.",
        url: "https://huggingface.co/apple/coreml-stable-diffusion-v1-5-palettized/resolve/main/coreml-stable-diffusion-v1-5-palettized_split_einsum_v2_compiled.zip",
      },
      {
        name: "CyberRealistic v1.5 CoreML (6-bit palettized)",
        filename: "cyberrealistic-6bit.coreml",
        format: "CoreML",
        approxSize: "815 MB",
        resolution: "512x512",
        notes: "6-bit palettized CoreML version of CyberRealistic. Extremely fast and optimized for Apple Silicon Neural Engine (ANE).",
        url: "https://huggingface.co/orailnooor/cyberrealistic-coreml/resolve/main/cyberrealistic-6bit.coreml.zip",
      },
      {
        name: "CyberRealistic v1.5 CoreML (Standard)",
        filename: "cyberrealistic.coreml",
        format: "CoreML",
        approxSize: "1.8 GB",
        resolution: "512x512",
        notes: "Standard CoreML version of CyberRealistic. Provides high-fidelity realism optimized for Apple Silicon NPUs.",
        url: "https://huggingface.co/orailnooor/cyberrealistic-coreml/resolve/main/cyberrealistic.coreml.zip",
      },
    ],
  },
];

const ALL_LIBRARY_MODELS = [
  ...MODEL_LIBRARY.flatMap((s) => s.items || []),
  ...TEXT_MODEL_LIBRARY.flatMap((s) => s.items || []),
  ...VIDEO_MODEL_LIBRARY.flatMap((s) => s.items || []),
  ...MUSIC_MODEL_LIBRARY.flatMap((s) => s.items || []),
  ...TTS_MODEL_LIBRARY.flatMap((s) => s.items || []),
  ...OPENVINO_MODEL_LIBRARY.flatMap((s) => s.items || []),
  ...COREML_MODEL_LIBRARY.flatMap((s) => s.items || []),
];

const getHardwareTier = (specs) => {
  if (!specs) return "Low";
  const ram = Number(specs.ram_total_gb) || 0;
  const vram = Number(specs.gpu_vram_gb) || 0;

  if (vram >= 20 || (vram >= 16 && ram >= 48)) {
    return "Ultra";
  } else if (vram >= 12 || (vram >= 8 && ram >= 32)) {
    return "High";
  } else if (vram >= 6 || ram >= 16) {
    return "Mid";
  } else {
    return "Low";
  }
};

function ModelManager({
  activeModel,
  setActiveModel,
  serverRunning,
  setServerRunning,
  constraints,
  setConstraints,
  telemetry,
  backendOptions,
  showAlert = async ({ message }) => window.alert(message),
  showConfirm = async ({ message }) => window.confirm(message),
  activeTab,
  specs,
  textSettings,
}) {
  const [activeModelType, setActiveModelType] = useState("image"); // "image", "text", "speech", or "tts"
  const [hardwareTierFilter, setHardwareTierFilter] = useState("all"); // "all", "low", "mid", "high", "ultra"
  const [localModels, setLocalModels] = useState([]);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [downloadingModelId, setDownloadingModelId] = useState(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState("");
  const [downloadDetails, setDownloadDetails] = useState(null);
  const [downloadQueue, setDownloadQueue] = useState([]);
  const [downloadError, setDownloadError] = useState(null);
  const pollIntervalRef = useRef(null);
  const [loadingModelId, setLoadingModelId] = useState(null);
  const [modelLoadProgress, setModelLoadProgress] = useState(null);
  const [compatibleModels, setCompatibleModels] = useState([]);
  const [compatibleTier, setCompatibleTier] = useState("");
  const [compatibleVram, setCompatibleVram] = useState(0);
  const [showCompatibleModal, setShowCompatibleModal] = useState(false);
  const [selectedCompatibleModels, setSelectedCompatibleModels] = useState({});
  const [modelViewTab, setModelViewTab] = useState("library");
  const [importProgress, setImportProgress] = useState(null); // null when not importing
  const [importInfo, setImportInfo] = useState({ filename: "", speed: "0.0", eta: 0, status: "" });
  const [downloadUrl, setDownloadUrl] = useState("");
  const [importAbortController, setImportAbortController] = useState(null);
  const [isUnloading, setIsUnloading] = useState(false);
  const [unloadProgress, setUnloadProgress] = useState({ progress: 0, phase: "" });
  const [pendingLoadModel, setPendingLoadModel] = useState(null);
  const [vramWarning, setVramWarning] = useState(null);
  const [backendInfo, setBackendInfo] = useState({ backendMode: "", backendBinary: "", backendDevice: "" });
  const [activeLlmModel, setActiveLlmModel] = useState(null);
  const [llmRunning, setLlmRunning] = useState(false);
  const [activeSpeechModel, setActiveSpeechModel] = useState(null);
  const [speechRunning, setSpeechRunning] = useState(false);
  const [activeTtsModel, setActiveTtsModel] = useState(null);
  const [ttsRunning, setTtsRunning] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [selectedFilters, setSelectedFilters] = useState([]);
  const [huggingFaceModels, setHuggingFaceModels] = useState([]);
  const [isSearchingModels, setIsSearchingModels] = useState(false);
  const [modelSearchError, setModelSearchError] = useState("");
  const [hasHuggingFaceResults, setHasHuggingFaceResults] = useState(false);
  const [modelSearchPage, setModelSearchPage] = useState(1);
  const [isDownloadingDefaults, setIsDownloadingDefaults] = useState(false);
  const [hasMoreModels, setHasMoreModels] = useState(false);
  const [isLoadingMoreModels, setIsLoadingMoreModels] = useState(false);
  const searchRequestRef = React.useRef(0);
  const pendingCompanionDownloadRef = React.useRef(null);

  const [showGatedModal, setShowGatedModal] = useState(false);
  const [gatedModalModel, setGatedModalModel] = useState(null);
  const [hfTokenInput, setHfTokenInput] = useState("");
  const [hasHfToken, setHasHfToken] = useState(false);
  const [hfTokenPreview, setHfTokenPreview] = useState("");
  const [showHfTokenText, setShowHfTokenText] = useState(false);
  const [isSavingHfToken, setIsSavingHfToken] = useState(false);
  const hasAutoOpenedGatedModalRef = useRef(false);

  const refreshHfTokenStatus = useCallback(async () => {
    try {
      const res = await getHuggingFaceToken();
      if (res && res.ok) {
        setHasHfToken(Boolean(res.hasToken));
        setHfTokenPreview(res.tokenPreview || "");
      }
    } catch (e) {
      console.warn("Failed to fetch HF token info:", e);
    }
  }, []);

  useEffect(() => {
    refreshHfTokenStatus();
  }, [refreshHfTokenStatus]);

  const handleSaveHfToken = async (autoStartDownload = false) => {
    const trimmed = hfTokenInput.trim();
    if (!trimmed) {
      showAlert({ title: uiText("Token Boş", "Token Empty"), message: uiText("Lütfen geçerli bir Hugging Face tokeni girin (hf_...)", "Please enter a valid Hugging Face token (hf_...)"), danger: true });
      return;
    }
    setIsSavingHfToken(true);
    try {
      const res = await saveHuggingFaceToken(trimmed);
      if (res && res.ok) {
        await refreshHfTokenStatus();
        showAlert({ title: uiText("Başarılı", "Success"), message: uiText("Hugging Face Erişim Tokeni başarıyla kaydedildi.", "Hugging Face access token saved.") });
        if (autoStartDownload && gatedModalModel) {
          const modelToDownload = gatedModalModel;
          setShowGatedModal(false);
          setDownloadError(null);
          hasAutoOpenedGatedModalRef.current = false;
          downloadByUrl(modelToDownload.url, modelToDownload.filename, null, {
            kind: modelToDownload.kind || (modelToDownload.id?.includes("audio") ? "music" : undefined)
          });
        } else {
          setShowGatedModal(false);
        }
      } else {
        showAlert({ title: "Hata", message: res?.error || "Token kaydedilemedi.", danger: true });
      }
    } catch (err) {
      showAlert({ title: "Hata", message: err.message, danger: true });
    } finally {
      setIsSavingHfToken(false);
    }
  };

  const handleDeleteHfToken = async () => {
    const confirmed = await showConfirm({
      title: "Token Silinsin mi?",
      message: uiText("Kayıtlı Hugging Face erişim tokenini silmek istediğinize emin misiniz?", "Are you sure you want to delete the saved Hugging Face access token?"),
      confirmLabel: "Tokeni Sil",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteHuggingFaceToken();
      setHfTokenInput("");
      setHasHfToken(false);
      setHfTokenPreview("");
      showAlert({ title: "Silindi", message: uiText("Hugging Face erişim tokeni kaldırıldı.", "Hugging Face access token removed.") });
    } catch (err) {
      showAlert({ title: "Hata", message: err.message, danger: true });
    }
  };

  const cancelLoadRef = React.useRef(false);

  const handleCancelLoad = async () => {
    cancelLoadRef.current = true;
    try {
      await stopServer();
    } catch (err) {
      console.warn("Failed to stop server on cancel:", err);
    }
  };

  const isCatalogType = activeModelType === "speech" || activeModelType === "tts" || activeModelType === "music" || activeModelType === "video";
  const normalizedLocalModels = isCatalogType
    ? localModels.filter((model) => model.filename)
    : localModels.map(normalizeModel).filter((model) => model.filename);
  const displayedLocalModels = isCatalogType
    ? normalizedLocalModels.filter((model) => model.installed)
    : normalizedLocalModels.filter((model) => !model.isProjector);
  const allModelNames = isCatalogType
    ? displayedLocalModels.map((model) => model.filename)
    : normalizedLocalModels.map((model) => model.filename);
  const modelNames = displayedLocalModels.map((model) => model.filename);
  const isBusy = loadingModelId !== null || isUnloading;

  const openvinoSupported = Boolean(backendOptions?.openvinoNpu?.supported);
  const appleNpuSupported = Boolean(
    backendOptions?.options?.some((opt) => opt.id === "apple-npu") ||
    backendOptions?.unavailable?.some((opt) => opt.id === "apple-npu")
  );
  const displayedHuggingFaceModels = huggingFaceModels.filter((model) => (
    selectedFilters.every((filterId) => model.tags?.includes(filterId))
  ));

  const getModelTypeLabel = (type) => {
    if (type === "image") return "Image";
    if (type === "text") return "Text";
    if (type === "speech") return "Speech";
    if (type === "tts") return "TTS";
    if (type === "music") return "Music";
    if (type === "video") return "Video";
    return "Model";
  };

  const getRuntimeForType = (type) => {
    if (type === "image" && serverRunning && activeModel) {
      return { type: "image", model: activeModel, label: getModelTypeLabel("image") };
    }
    if (type === "text" && llmRunning && activeLlmModel) {
      return { type: "text", model: activeLlmModel, label: getModelTypeLabel("text") };
    }
    if (type === "speech" && speechRunning && activeSpeechModel) {
      return { type: "speech", model: activeSpeechModel, label: getModelTypeLabel("speech") };
    }
    if (type === "tts" && ttsRunning && activeTtsModel) {
      return { type: "tts", model: activeTtsModel, label: getModelTypeLabel("tts") };
    }
    return null;
  };

  const getActiveHeavyRuntime = () => (
    getRuntimeForType("image") ||
    getRuntimeForType("text")
  );

  const blockLoadIfOtherRuntimeActive = (modelId, targetType) => {
    if (targetType !== "image" && targetType !== "text") {
      return false;
    }

    const runtime = getActiveHeavyRuntime();
    if (!runtime || (runtime.type === targetType && runtime.model === modelId)) {
      return false;
    }
    setPendingLoadModel({
      modelId,
      targetType,
      activeRuntime: runtime,
    });
    return true;
  };

  let visibleModelLibrary = [];
  if (activeModelType === "image") {
    visibleModelLibrary = [...MODEL_LIBRARY];
    if (openvinoSupported) {
      visibleModelLibrary = [...visibleModelLibrary, ...OPENVINO_MODEL_LIBRARY];
    }
    if (appleNpuSupported) {
      visibleModelLibrary = [...visibleModelLibrary, ...COREML_MODEL_LIBRARY];
    }
  } else if (activeModelType === "text") {
    visibleModelLibrary = hasHuggingFaceResults
      ? [{ group: "Hugging Face Arama Sonuçları", items: displayedHuggingFaceModels }]
      : TEXT_MODEL_LIBRARY;
  } else if (activeModelType === "speech") {
    visibleModelLibrary = [{
      group: "Whisper Speech Models",
      items: normalizedLocalModels.filter((model) => model.url).map((model) => ({
        ...model,
        format: "Whisper.cpp",
        approxSize: model.size,
        notes: `${model.language || "Speech"} transcription model. Stored in app/speech-models/.`,
        recommendedTiers: [model.tier || (Number(model.sizeBytes) >= 1000000000 ? "High" : Number(model.sizeBytes) >= 300000000 ? "Mid" : "Low")],
      })),
    }];
  } else if (activeModelType === "music") {
    visibleModelLibrary = MUSIC_MODEL_LIBRARY;
  } else if (activeModelType === "video") {
    visibleModelLibrary = VIDEO_MODEL_LIBRARY;
  } else {
    visibleModelLibrary = TTS_MODEL_LIBRARY;
  }

  const getModelTierBadge = (model) => {
    // Ses Tanıma (Whisper) Modelleri için Gerçek Donanım Sınıflandırması
    if (activeModelType === "speech" || model.format === "Whisper.cpp") {
      const sizeBytes = Number(model.sizeBytes) || (typeof model.size === "string" && model.size.includes("GB") ? 1073741824 : 0);
      const isHigh = model.tier === "High" || sizeBytes >= 1000000000;
      const isMid = model.tier === "Mid" || sizeBytes >= 300000000;
      if (isHigh) {
        return { tier: "high", label: "[ÜST] GPU / 8GB+ RAM (Stüdyo Transkripsiyon)", bg: "rgba(99, 102, 241, 0.12)", border: "rgba(99, 102, 241, 0.4)", text: "#6366f1" };
      }
      if (isMid) {
        return { tier: "mid", label: "[ORTA] CPU veya GPU / 4GB+ RAM (Yüksek Doğruluk)", bg: "rgba(245, 158, 11, 0.12)", border: "rgba(245, 158, 11, 0.4)", text: "#f59e0b" };
      }
      return { tier: "low", label: "[DÜŞÜK] Saf CPU / Her Donanım (Anında & Hafif)", bg: "rgba(16, 185, 129, 0.12)", border: "rgba(16, 185, 129, 0.4)", text: "#10b981" };
    }

    // TTS Modelleri için Donanım Sınıflandırması
    if (activeModelType === "tts") {
      const minVram = Number(model.minVramGb) || 0;
      if (minVram >= 12 || model.tier === "High") {
        return { tier: "high", label: "[ÜST] 12 GB+ VRAM", bg: "rgba(99, 102, 241, 0.12)", border: "rgba(99, 102, 241, 0.4)", text: "#6366f1" };
      }
      if (minVram >= 6 || model.tier === "Mid") {
        return { tier: "mid", label: "[ORTA] GPU önerilir (6 GB+ VRAM)", bg: "rgba(245, 158, 11, 0.12)", border: "rgba(245, 158, 11, 0.4)", text: "#f59e0b" };
      }
      return { tier: "low", label: "[DÜŞÜK] CPU'da çalışır", bg: "rgba(16, 185, 129, 0.12)", border: "rgba(16, 185, 129, 0.4)", text: "#10b981" };
    }

    const minVram = Number(model.minVramGb) || 0;
    const tiers = Array.isArray(model.recommendedTiers) ? model.recommendedTiers : [];
    if (minVram >= 22 || tiers.includes("Ultra") || tiers.includes("Ultra High") || tiers.includes("Workstation")) {
      return { tier: "ultra", label: "[ÜST] 24GB+ VRAM / RAM Offload (Amiral Gemisi)", bg: "rgba(168, 85, 247, 0.12)", border: "rgba(168, 85, 247, 0.4)", text: "#a855f7" };
    }
    if (minVram >= 12 || (tiers.includes("High") && !tiers.includes("Low"))) {
      return { tier: "high", label: "[ORTA-ÜST] 12-16 GB VRAM", bg: "rgba(99, 102, 241, 0.12)", border: "rgba(99, 102, 241, 0.4)", text: "#6366f1" };
    }
    if (minVram >= 8 || (tiers.includes("Mid") && !tiers.includes("Low"))) {
      return { tier: "mid", label: "[ORTA] 8-12GB VRAM (Orta Seviye)", bg: "rgba(245, 158, 11, 0.12)", border: "rgba(245, 158, 11, 0.4)", text: "#f59e0b" };
    }
    return { tier: "low", label: "[DÜŞÜK] 4-8GB VRAM (Hafif & Hızlı)", bg: "rgba(16, 185, 129, 0.12)", border: "rgba(16, 185, 129, 0.4)", text: "#10b981" };
  };

  const filteredLibrary = visibleModelLibrary.map((section) => ({
    ...section,
    items: (section.items || []).filter((model) => {
      if (hardwareTierFilter === "all") return true;
      const badge = getModelTierBadge(model);
      if (hardwareTierFilter === "ultra") return badge.tier === "ultra";
      if (hardwareTierFilter === "high") return badge.tier === "high" || badge.tier === "ultra";
      if (hardwareTierFilter === "mid") return badge.tier === "mid";
      if (hardwareTierFilter === "low") return badge.tier === "low";
      return true;
    }),
  })).filter((section) => section.items && section.items.length > 0);

  useEffect(() => {
    if (activeModelType !== "text") return;
    const requestId = ++searchRequestRef.current;
    const timer = setTimeout(async () => {
      setIsSearchingModels(true);
      setModelSearchError("");
      try {
        const result = await searchHuggingFaceModels(modelSearch, selectedFilters, 1);
        if (requestId !== searchRequestRef.current) return;
        const matchingModels = result.models.filter((model) => (
          selectedFilters.every((filterId) => model.tags?.includes(filterId))
        ));
        setHuggingFaceModels(matchingModels);
        setHasHuggingFaceResults(true);
        setModelSearchPage(1);
        setHasMoreModels(result.hasMore);
      } catch (err) {
        if (requestId !== searchRequestRef.current) return;
        setHuggingFaceModels([]);
        setHasHuggingFaceResults(false);
        setHasMoreModels(false);
        setModelSearchError(err.message || "Could not search Hugging Face.");
      } finally {
        if (requestId === searchRequestRef.current) setIsSearchingModels(false);
      }
    }, modelSearch ? 400 : 0);
    return () => clearTimeout(timer);
  }, [activeModelType, modelSearch, selectedFilters]);

  const toggleModelFilter = (filterId) => {
    setSelectedFilters((current) => (
      current.includes(filterId)
        ? current.filter((id) => id !== filterId)
        : [...current, filterId]
    ));
  };

  const handleLoadMoreModels = async () => {
    if (isLoadingMoreModels || !hasMoreModels) return;
    const nextPage = modelSearchPage + 1;
    setIsLoadingMoreModels(true);
    setModelSearchError("");
    try {
      const [result] = await Promise.all([
        searchHuggingFaceModels(modelSearch, selectedFilters, nextPage),
        new Promise((resolve) => setTimeout(resolve, 350)),
      ]);
      const matchingModels = result.models.filter((model) => (
        selectedFilters.every((filterId) => model.tags?.includes(filterId))
      ));
      setHuggingFaceModels((current) => {
        const known = new Set(current.map((model) => model.id));
        return [...current, ...matchingModels.filter((model) => !known.has(model.id))];
      });
      setModelSearchPage(result.page);
      setHasMoreModels(result.hasMore);
    } catch (err) {
      setModelSearchError(err.message || "Could not load more Hugging Face models.");
    } finally {
      setIsLoadingMoreModels(false);
    }
  };

  const getLocalModelInfo = (modelId) => localModels.map(normalizeModel).find((model) => model.filename === modelId);

  const fetchModels = useCallback(async () => {
    setIsLoadingModels(true);
    try {
      if (activeModelType === "image") {
        const list = await listLocalModels();
        setLocalModels(list.map(normalizeModel).filter((model) => model.filename));
      } else if (activeModelType === "text") {
        const list = await listLlmModels();
        setLocalModels(list.map(normalizeModel).filter((model) => model.filename));
      } else if (activeModelType === "speech") {
        const list = await listSpeechModels();
        setLocalModels(list.filter((model) => model.filename));
      } else if (activeModelType === "music") {
        const list = await listMusicModels();
        setLocalModels(list.filter((model) => model.filename));
      } else if (activeModelType === "video") {
        const list = await listVideoModels();
        setLocalModels(list.filter((model) => model.filename));
      } else {
        const list = await listTtsModels();
        setLocalModels(list.filter((model) => model.filename));
      }
    } catch (e) {
      console.error(e);
      setLocalModels([]);
    } finally {
      setIsLoadingModels(false);
    }
  }, [activeModelType]);

  useEffect(() => {
    if (activeTab === "models") {
      fetchModels();
      checkActiveDownload();
      const interval = setInterval(() => {
        checkActiveDownload();
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [activeTab, fetchModels]);

  useEffect(() => {
    fetchModels();
    checkActiveDownload();
  }, [activeModelType]);

  useEffect(() => {
    let cancelled = false;
    const updateBackendInfo = async () => {
      try {
        const [sdStatus, llmStatus, speechStatus, ttsStatus] = await Promise.all([
          getBackendStatus(),
          getLlmStatus(),
          getSpeechStatus(),
          getTtsStatus()
        ]);
        if (cancelled) return;

        setBackendInfo({
          backendMode: sdStatus.settings?.backendMode || sdStatus.loading?.backendMode || "",
          backendBinary: sdStatus.settings?.backendBinary || sdStatus.loading?.backendBinary || "",
          backendDevice: sdStatus.settings?.backendDevice || sdStatus.loading?.device || "",
          llmBackendMode: llmStatus.settings?.backendMode || llmStatus.settings?.backendBinary || "",
          speechBackendMode: speechStatus.settings?.backendMode || speechStatus.backendMode || "",
          ttsBackendMode: ttsStatus.settings?.backendMode || ttsStatus.backendMode || "",
        });

        if (llmStatus.ready) {
          setActiveLlmModel(llmStatus.settings?.model || null);
          setLlmRunning(true);
        } else {
          setActiveLlmModel(null);
          setLlmRunning(false);
        }
        if (speechStatus.ready) {
          setActiveSpeechModel(speechStatus.settings?.model || null);
          setSpeechRunning(true);
        } else {
          setActiveSpeechModel(null);
          setSpeechRunning(false);
        }
        if (ttsStatus.ready) {
          setActiveTtsModel(ttsStatus.settings?.model || null);
          setTtsRunning(true);
        } else {
          setActiveTtsModel(null);
          setTtsRunning(false);
        }
      } catch (_) {}
    };

    updateBackendInfo();
    const interval = setInterval(updateBackendInfo, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [serverRunning, loadingModelId]);

  const checkActiveDownload = async () => {
    try {
      const status = await getDownloadProgress();
      setDownloadQueue(status.queue || []);
      if (status.error) {
        setDownloadError(status.error);
        const isGatedErr = Boolean(status.isGated || String(status.error).toLowerCase().includes("gated") || String(status.error).includes("401"));
        if (isGatedErr) {
          const matched = ALL_LIBRARY_MODELS.find(m => m.filename === status.filename || (status.error && status.error.includes(m.filename)) || (status.error && m.pageUrl && status.error.includes(m.pageUrl.replace("https://huggingface.co/", ""))));
          setGatedModalModel(matched || {
            name: status.displayName || status.filename || (status.gatedRepo ? status.gatedRepo.split("/")[1] : "Hugging Face Gated Model"),
            filename: status.filename,
            pageUrl: status.gatedPageUrl || (status.gatedRepo ? `https://huggingface.co/${status.gatedRepo}` : "https://huggingface.co"),
            url: status.url || (matched ? matched.url : null)
          });
          if (!hasAutoOpenedGatedModalRef.current) {
            hasAutoOpenedGatedModalRef.current = true;
            setShowGatedModal(true);
          }
        }
      } else if (status.active) {
        setDownloadError(null);
        hasAutoOpenedGatedModalRef.current = false;
      }
      if (status.active || (status.queue && status.queue.length > 0)) {
        if (status.defaultModels) {
          setIsDownloadingDefaults(true);
        }
        if (status.active) {
          setDownloadingModelId(status.displayName || status.name || status.filename || "Model İndiriliyor");
          setDownloadProgress(status.progress === -1 ? 0 : Math.round(status.progress ?? status.percent ?? 0));
          setDownloadSpeed(`${status.speed || ""}  ETA ${status.eta || 0}s`);
          setDownloadDetails(status);
        }
        if (!pollIntervalRef.current) {
          startProgressPolling(status.filename || status.displayName || status.queue?.[0]?.name || "Model İndirme");
        }
      } else {
        if (!pollIntervalRef.current) {
          setDownloadingModelId(null);
          setDownloadProgress(0);
          setDownloadSpeed("");
          setDownloadDetails(null);
        }
      }
    } catch (e) {
      console.error("Check active download failed:", e);
    }
  };

  const downloadByUrl = async (url, expectedFilename, companion = null, options = {}) => {
    if (downloadingModelId === expectedFilename) {
      showAlert({ title: uiText("Zaten İndiriliyor", "Already Downloading"), message: uiText(`"${expectedFilename}" şu anda indiriliyor.`, `"${expectedFilename}" is downloading right now.`) });
      return;
    }
    if (downloadQueue.some((q) => q.filename === expectedFilename)) {
      showAlert({ title: "Kuyrukta Bekliyor", message: uiText(`"${expectedFilename}" zaten indirme kuyruğunda bekliyor.`, `"${expectedFilename}" is already waiting in the download queue.`) });
      return;
    }

    if (!options.skipExistingConfirm && allModelNames.includes(expectedFilename)) {
      if (!(await showConfirm({
        title: uiText("Model Üzerine Yazılsın mı?", "Overwrite Model?"),
        message: uiText(`"${expectedFilename}" zaten indirilmiş. Yeniden indirilip üzerine yazılsın mı?`, `"${expectedFilename}" is already downloaded. Do you want to download and overwrite it?`),
        confirmLabel: uiText("Üzerine Yaz", "Overwrite"),
      }))) {
        return;
      }
    }

    const isTauriDesktop = typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;

    if (!isTauriDesktop && !isLocalServerMode()) {
      showAlert({ title: uiText("Yerel Sunucu Gerekli", "Server Required"), message: uiText("Model indirmek için yerel sunucunun çalışıyor olması gerekir.", "Model download requires the local server."), danger: true });
      return;
    }

    try {
      pendingCompanionDownloadRef.current = companion;
      let downloadType = options.kind || activeModelType;
      if (!options.kind) {
        const lower = (expectedFilename || url).toLowerCase();
        if (lower.includes("music") || lower.includes("audio") || lower.includes("sound")) {
          downloadType = "music";
        } else if (lower.includes("video") || lower.includes("wan") || lower.includes("ltx") || lower.includes("svd")) {
          downloadType = "video";
        } else if (lower.endsWith(".gguf")) {
          downloadType = "text";
        }
      }

      let res;
      if (downloadType === "image") {
        res = await downloadModel(url, expectedFilename);
      } else if (downloadType === "text") {
        res = await downloadLlmModel(url, expectedFilename, companion);
      } else if (downloadType === "speech") {
        res = await downloadSpeechModel(url, expectedFilename);
      } else if (downloadType === "video") {
        res = await downloadVideoModel(url, expectedFilename);
      } else if (downloadType === "music") {
        res = await downloadMusicModel(url, expectedFilename);
      } else {
        res = await downloadTtsModel(url, expectedFilename);
      }
      if (res && res.ok) {
        if (res.queued) {
          showAlert({
            title: uiText("Kuyruğa Eklendi", "Added to Queue"),
            message: uiText(`"${expectedFilename}" indirme kuyruğuna eklendi (#${res.position || (downloadQueue.length + 1)}. sırada). Sırası geldiğinde otomatik olarak indirilecek.`, `"${expectedFilename}" was added to the download queue (position #${res.position || (downloadQueue.length + 1)}). It will download automatically when its turn comes.`)
          });
        }
        if (!companion && res.projectorUrl && res.projectorFilename) {
          pendingCompanionDownloadRef.current = {
            url: res.projectorUrl,
            filename: res.projectorFilename,
          };
        }
        if (activeModelType === "tts" && !res.active && !res.queued) {
          fetchModels();
        } else {
          startProgressPolling(expectedFilename);
        }
      } else {
        pendingCompanionDownloadRef.current = null;
        showAlert({ title: uiText("İndirme Başarısız", "Download Failed"), message: res?.error || uiText("Bilinmeyen hata", "Unknown error"), danger: true });
      }
    } catch (err) {
      pendingCompanionDownloadRef.current = null;
      showAlert({ title: uiText("İndirme Hatası", "Download Error"), message: err.message, danger: true });
    }
  };

  const startProgressPolling = (modelId) => {
    setDownloadingModelId((prev) => prev || modelId);

    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    pollIntervalRef.current = setInterval(async () => {
      try {
        const status = await getDownloadProgress();
        setDownloadQueue(status.queue || []);

        if (status.active) {
          setDownloadingModelId(status.displayName || status.name || status.filename || modelId);
          setDownloadProgress(status.progress === -1 ? 0 : Math.round(status.progress ?? status.percent ?? 0));
          setDownloadSpeed(`${status.speed}  ETA ${status.eta}s`);
          setDownloadDetails(status);
          if (status.defaultModels) {
            setIsDownloadingDefaults(true);
          }
        } else if (status.queue && status.queue.length > 0) {
          fetchModels();
          setDownloadProgress(100);
          setDownloadSpeed("Sıradaki model hazırlanıyor...");
          setDownloadingModelId(status.queue[0]?.displayName || status.queue[0]?.name || status.queue[0]?.filename);
        } else {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          setDownloadingModelId(null);
          setIsDownloadingDefaults(false);
          setDownloadProgress(0);
          setDownloadSpeed("");
          setDownloadDetails(null);
          if (status.error) {
            setDownloadError(status.error);
            const isGatedErr = Boolean(status.isGated || String(status.error).toLowerCase().includes("gated") || String(status.error).includes("401"));
            if (isGatedErr) {
              const matched = ALL_LIBRARY_MODELS.find(m => m.filename === status.filename || (status.error && status.error.includes(m.filename)) || (status.error && m.pageUrl && status.error.includes(m.pageUrl.replace("https://huggingface.co/", ""))));
              setGatedModalModel(matched || {
                name: status.displayName || status.filename || (status.gatedRepo ? status.gatedRepo.split("/")[1] : "Hugging Face Gated Model"),
                filename: status.filename,
                pageUrl: status.gatedPageUrl || (status.gatedRepo ? `https://huggingface.co/${status.gatedRepo}` : "https://huggingface.co"),
                url: status.url || (matched ? matched.url : null)
              });
              hasAutoOpenedGatedModalRef.current = true;
              setShowGatedModal(true);
            } else if (!String(status.error).toLowerCase().includes("cancelled") && !String(status.error).toLowerCase().includes("iptal")) {
              showAlert({ title: uiText("İndirme Hatası", "Download Error"), message: status.error, danger: true });
            }
          } else {
            setDownloadError(null);
            fetchModels();
            try {
              const res = await getCompatibleModels();
              if (res && res.ok) {
                setCompatibleModels(res.models || []);
              }
            } catch (_) {}
            const companion = pendingCompanionDownloadRef.current;
            pendingCompanionDownloadRef.current = null;
            if (companion?.url && companion?.filename && !allModelNames.includes(companion.filename)) {
              setTimeout(() => {
                downloadByUrl(
                  companion.url,
                  companion.filename,
                  null,
                  { skipExistingConfirm: true }
                );
              }, 500);
            }
          }
        }
      } catch (e) {
        console.error("Polling error:", e);
      }
    }, 800);
  };

  const handleUrlDownloadSubmit = async (e) => {
    e.preventDefault();
    if (!downloadUrl.trim()) return;

    let modelName = activeModelType === "image" ? "model.safetensors" : activeModelType === "text" ? "model.gguf" : activeModelType === "speech" ? "model.bin" : "model.json";
    try {
      const parsed = new URL(downloadUrl.trim());
      modelName = parsed.pathname.split("/").pop() || modelName;
    } catch (_) {
      showAlert({ title: uiText("Geçersiz Bağlantı", "Invalid URL"), message: uiText("Lütfen geçerli bir HTTP/HTTPS bağlantısı girin.", "Please provide a valid HTTP/HTTPS link."), danger: true });
      return;
    }

    await downloadByUrl(downloadUrl.trim(), modelName);
    setDownloadUrl("");
  };

  const handleCancelQueued = async (item) => {
    const confirmed = await showConfirm({
      title: uiText("Kuyruktan Çıkarılsın mı?", "Remove From Queue?"),
      message: uiText(`"${item.name || item.filename}" indirme kuyruğundan çıkarılsın mı?`, `Remove "${item.name || item.filename}" from the download queue?`),
      confirmLabel: uiText("Kuyruktan Çıkar", "Remove From Queue"),
      danger: true,
    });
    if (!confirmed) return;
    try {
      const res = await cancelQueuedDownload(item.id || item.filename);
      if (res && res.ok) {
        setDownloadQueue((prev) => prev.filter((q) => (q.id ? q.id !== item.id : q.filename !== item.filename)));
      } else {
        showAlert({ title: "Hata", message: res?.error || "Kuyruktan çıkarılamadı.", danger: true });
      }
    } catch (e) {
      showAlert({ title: "Hata", message: e.message, danger: true });
    }
  };

  const handleLibraryDownload = async (model) => {
    const isThisDownloading = downloadingModelId === model.filename || downloadingModelId === model.projectorFilename || downloadingModelId === `${model.filename}.zip`;
    if (isThisDownloading) return;

    const isThisQueued = downloadQueue.some((q) => q.filename === model.filename || q.filename === model.projectorFilename || q.filename === `${model.filename}.zip`);
    if (isThisQueued) {
      showAlert({ title: "Kuyrukta Bekliyor", message: uiText(`"${model.name}" zaten indirme kuyruğunda yer alıyor.`, `"${model.name}" is already in the download queue.`) });
      return;
    }

    if (model.supported === false) {
      showAlert({
        title: uiText("Bu Sürümde Entegre Değil", "Not Integrated in This Version"),
        message: uiText(`"${model.name}" bilgi amaçlı listelenmiştir; uygulama bu modeli henüz çalıştıramaz.\n\n${model.notes || ""}`, `"${model.name}" is listed for information only; the app cannot run this model yet.\n\n${model.notes || ""}`),
      });
      return;
    }

    if (model.isGated && !hasHfToken) {
      setGatedModalModel(model);
      setShowGatedModal(true);
      return;
    }

    if (model.snapshotId) {
      const confirmed = await showConfirm({
        title: uiText("Model Paketi İndirilsin mi?", "Download Model Package?"),
        message: uiText(`"${model.name}" (${model.approxSize || model.size}) klasör halinde indirilecek. Onaylıyor musunuz?`, `"${model.name}" (${model.approxSize || model.size}) will be downloaded as a folder. Continue?`),
        confirmLabel: "İndir",
      });
      if (!confirmed) return;
      const res = await downloadSnapshotModel(model.snapshotId, model.name, activeModelType);
      if (res && res.ok) {
        startProgressPolling(model.filename);
      } else {
        showAlert({ title: uiText("İndirme Başlatılamadı", "Download Could Not Start"), message: res?.error || "Bilinmeyen hata", danger: true });
      }
      return;
    }

    if (activeModelType === "speech") {
      const confirmed = await showConfirm({
        title: uiText("Ses Tanıma Modeli İndirilsin mi?", "Download Speech Recognition Model?"),
        message: `"${model.name}" (${model.size || model.approxSize}) indirilsin mi?`,
        confirmLabel: "İndir",
      });
      if (confirmed) {
        // Catalog models are requested by id (the server knows how to fetch whisper files and Duyu's folder).
        await downloadByUrl(model.id && !model.custom ? model.id : model.url, model.filename, null, { kind: "speech" });
      }
      return;
    }

    if (activeModelType === "tts") {
      const confirmed = await showConfirm({
        title: "TTS Modeli Kurulsun mu?",
        message: model.id === "omnivoice"
          ? `"${model.name}" (≈3.3 GB) indirilecek. Gerekli Python paketi: pip install omnivoice.`
          : `"${model.name}" etkinleştirilsin mi? Model ağırlıkları ilk seslendirmede ilgili Python paketi tarafından Hugging Face'ten indirilir.`,
        confirmLabel: "Kur",
      });
      if (confirmed) {
        await downloadByUrl(model.id || model.url, model.filename);
      }
      return;
    }

    if (activeModelType === "music") {
      const confirmed = await showConfirm({
        title: uiText("Müzik Modeli İndirilsin mi?", "Download Music Model?"),
        message: uiText(`"${model.name}" (${model.approxSize || model.size}) indirilsin mi? Model app/music-models klasörüne kurulacak.`, `Download "${model.name}" (${model.approxSize || model.size})? It will be installed to app/music-models.`),
        confirmLabel: "İndir",
      });
      if (confirmed) {
        await downloadByUrl(model.url, model.filename, null, { kind: "music" });
      }
      return;
    }

    if (activeModelType === "video") {
      const confirmed = await showConfirm({
        title: uiText("Video Modeli İndirilsin mi?", "Download Video Model?"),
        message: uiText(`"${model.name}" (${model.approxSize || model.size}) indirilsin mi? Model app/video-models klasörüne kurulacak.`, `Download "${model.name}" (${model.approxSize || model.size})? It will be installed to app/video-models.`),
        confirmLabel: "İndir",
      });
      if (confirmed) {
        await downloadByUrl(model.url, model.filename, null, { kind: "video" });
      }
      return;
    }

    if (model.backendType === "openvino-npu") {
      const confirmed = await showConfirm({
        title: uiText("OpenVINO Modeli İndirilsin mi?", "Download OpenVINO Model?"),
        message: uiText(`"${model.name}" (~${model.approxSize}) indirilsin mi? OpenVINO modelleri Python betiğiyle klasör klasör indirilir.`, `Download "${model.name}" (~${model.approxSize})? OpenVINO models are downloaded folder-by-folder via python script.`),
        confirmLabel: uiText("İndir", "Download"),
      });
      if (!confirmed) return;
      try {
        await downloadOpenVinoModel(model.id);
        startProgressPolling(model.name);
      } catch (err) {
        showAlert({ title: uiText("İndirme Başarısız", "Download Failed"), message: err.message, danger: true });
      }
      return;
    }

    const hasMainModel = modelNames.includes(model.filename);
    const hasProjector = !model.projectorFilename || allModelNames.includes(model.projectorFilename);
    if (hasMainModel && model.projectorUrl && model.projectorFilename && !hasProjector) {
      const confirmed = await showConfirm({
        title: uiText("Görsel Projektör Dosyası İndirilsin mi?", "Download Vision Projector?"),
        message: uiText(`"${model.name}" indirildi, ancak görsel girişi için eşleşen projektör dosyası (${model.projectorFilename}) gerekiyor. Şimdi indirilsin mi?`, `"${model.name}" is downloaded, but image input needs the matching projector file (${model.projectorFilename}). Download it now?`),
        confirmLabel: uiText("Projektörü İndir", "Download Projector"),
      });
      if (confirmed) {
        await downloadByUrl(model.projectorUrl, model.projectorFilename, null, { skipExistingConfirm: true });
      }
      return;
    }

    const vramGb = Number(specs?.gpu_vram_gb || 0);
    let confirmed = false;
    if (model.minVramGb && vramGb > 0 && vramGb < model.minVramGb) {
      confirmed = await showConfirm({
        title: uiText(" Donanım Yetersizliği Uyarısı", "Insufficient Hardware Warning"),
        message: uiText(`Seçtiğiniz "${model.name}" modeli için en az ${model.minVramGb} GB VRAM önerilmektedir. Sisteminizde ${vramGb} GB VRAM bulunmaktadır.\n\nBu model ekran kartınızı aşırı zorlayabilir veya bellek yetersizliği hatası verebilir. Yine de indirmek istiyor musunuz?`, `At least ${model.minVramGb} GB VRAM is recommended for "${model.name}". Your system has ${vramGb} GB VRAM.\n\nThis model may overload your graphics card or fail with an out-of-memory error. Download it anyway?`),
        confirmLabel: uiText("Yine de İndir", "Download Anyway"),
        cancelLabel: "Vazgeç",
        danger: true,
      });
    } else {
      confirmed = await showConfirm({
        title: uiText("Model İndirilsin mi?", "Download Model?"),
        message: model.projectorUrl
          ? uiText(`"${model.name}" (~${model.approxSize}) ve gerekli görsel projektör dosyası indirilsin mi?`, `Download "${model.name}" (~${model.approxSize}) and its required vision projector?`)
          : uiText(`"${model.name}" (~${model.approxSize}) indirilsin mi?`, `Download "${model.name}" (~${model.approxSize})?`),
        confirmLabel: uiText("İndir", "Download"),
      });
    }
    if (confirmed) {
      await downloadByUrl(
        model.url,
        model.filename,
        model.projectorUrl && model.projectorFilename
          ? { url: model.projectorUrl, filename: model.projectorFilename }
          : null
      );
    }
  };

  const handleCancelDownload = async (cancelAll = false) => {
    try {
      await cancelModelDownload(cancelAll);
      if (cancelAll) {
        setDownloadQueue([]);
        setDownloadingModelId(null);
        setIsDownloadingDefaults(false);
        setDownloadProgress(0);
        setDownloadSpeed("");
        setDownloadDetails(null);
      }
      fetchModels();
      try {
        const res = await getCompatibleModels();
        if (res && res.ok) {
          setCompatibleModels(res.models || []);
        }
      } catch (_) {}
    } catch (err) {
      console.error(err);
    }
  };

  const checkVramAndLoad = async (modelId, options = {}) => {
    if (!options.skipActiveGuard && blockLoadIfOtherRuntimeActive(modelId, "image")) {
      return;
    }

    const modelInfo = getLocalModelInfo(modelId);
    if (!modelInfo) {
      await performLoadModel(modelId);
      return;
    }

    const isOpenVinoSelected = constraints.backendType === "openvino-npu";
    const isOpenVinoModel = modelInfo.backendType === "openvino-npu";
    const isCoreMLModel = modelInfo.format === "CoreML" || modelInfo.backendType === "apple-npu";
    const isStandardWeights = /\.(safetensors|ckpt|gguf)$/i.test(modelId) || (!isOpenVinoModel && !isCoreMLModel);
    if (isOpenVinoSelected && isStandardWeights) {
      const gpuBackend = backendOptions?.options?.find((backend) =>
        ["vulkan", "cuda", "rocm", "metal"].includes(backend.id)
      );
      const cpuBackend = backendOptions?.options?.find((backend) => backend.id === "cpu");
      const targetBackend = gpuBackend || cpuBackend;

      if (!targetBackend) {
        await showAlert({
          title: uiText("Arka Uç Değişikliği Gerekli", "Switch Backend Required"),
          message: uiText(`"${modelId}" standart bir ağırlık dosyası. OpenVINO NPU yalnızca indirilmiş OpenVINO model klasörlerini yükleyebilir ve şu anda kurulu bir GPU veya CPU arka ucu yok.`, `"${modelId}" is a standard weights file. OpenVINO NPU can only load downloaded OpenVINO model folders, and no GPU or CPU backend is currently installed.`),
          danger: true,
        });
        return;
      }

      const confirmed = await showConfirm({
        title: uiText("Hızlandırıcı Değiştirilsin mi?", "Switch Accelerator?"),
        message: uiText(`"${modelId}" OpenVINO NPU üzerinde yüklenemez. ${targetBackend.label} arka ucuna geçilip orada yüklensin mi?`, `"${modelId}" cannot load on OpenVINO NPU. Switch to ${targetBackend.label} and load it there?`),
        confirmLabel: uiText(`${targetBackend.label} Arka Ucuna Geç`, `Switch to ${targetBackend.label}`),
        cancelLabel: uiText("İptal", "Cancel"),
      });
      if (!confirmed) return;

      const nextConstraints = {
        ...constraints,
        backendType: targetBackend.id,
        useGpu: targetBackend.id !== "cpu",
      };
      setConstraints(nextConstraints);
      await performLoadModel(modelId, nextConstraints);
      return;
    }

    const totalSizeBytes = Number(modelInfo.sizeBytes) || 0;
    if (totalSizeBytes <= 0) {
      await performLoadModel(modelId);
      return;
    }

    const freeVramGb = Number(telemetry.vram_total_gb - telemetry.vram_used_gb) || 0;
    const modelSizeGb = totalSizeBytes / (1024 ** 3);
    const hasNvidiaGpu = Boolean(telemetry.gpu_name && telemetry.gpu_name.toLowerCase().includes("nvidia"));

    const isCpuOnlyBackend = constraints.backendType === "cpu" || constraints.useGpu === false;

    if (hasNvidiaGpu && !isCpuOnlyBackend && modelInfo.backendType !== "openvino-npu" && modelInfo.format !== "CoreML") {
      const safetyMarginGb = 0.8;
      if (modelSizeGb + safetyMarginGb > freeVramGb) {
        setVramWarning({
          modelId,
          modelSizeGb,
          freeVramGb,
          totalVramGb: telemetry.vram_total_gb,
        });
        return;
      }
    }
    await performLoadModel(modelId);
  };

  const loadTextModel = async (modelId) => {
    setLoadingModelId(modelId);
    setModelLoadProgress({
      progress: 40,
      phase: "Starting llama.cpp server...",
      speed: "",
      current: 0,
      total: 0,
      model: modelId,
      backendMode: "",
      backendBinary: "",
      device: "",
    });
    try {
      const cores = textSettings?.threads || specs?.cpu_cores_physical || 4;
      const context = textSettings?.contextSize ?? 0;
      await startLlm(modelId, {
        threads: cores,
        contextSize: context,
        gpuLayers: -1,
        preferredBackend: textSettings?.preferredBackend
      });
      setActiveLlmModel(modelId);
      setLlmRunning(true);
    } catch (err) {
      showAlert({ title: uiText("Model Yüklenemedi", "Model Load Failed"), message: err.message || String(err), danger: true });
    } finally {
      setModelLoadProgress(null);
      setLoadingModelId(null);
    }
  };

  const loadSpeechModel = async (modelId) => {
    setLoadingModelId(modelId);
    setModelLoadProgress({
      progress: 30,
      phase: "Starting whisper.cpp speech runtime...",
      speed: "",
      current: 0,
      total: 0,
      model: modelId,
      backendMode: "",
      backendBinary: "",
      device: "",
    });
    try {
      await startSpeech(modelId, { threads: textSettings?.threads || specs?.cpu_cores_physical || 4 });
      setActiveSpeechModel(modelId);
      setSpeechRunning(true);
    } catch (err) {
      showAlert({ title: uiText("Ses Tanıma Modeli Yüklenemedi", "Speech Model Load Failed"), message: err.message || String(err), danger: true });
    } finally {
      setModelLoadProgress(null);
      setLoadingModelId(null);
    }
  };

  const loadTtsModel = async (modelId) => {
    setLoadingModelId(modelId);
    setModelLoadProgress({
      progress: 30,
      phase: "Starting Kokoro ONNX TTS runtime...",
      speed: "",
      current: 0,
      total: 0,
      model: modelId,
      backendMode: "",
      backendBinary: "",
      device: "",
    });
    try {
      await startTts(modelId);
      setActiveTtsModel(modelId);
      setTtsRunning(true);
    } catch (err) {
      showAlert({ title: uiText("TTS Modeli Yüklenemedi", "TTS Model Load Failed"), message: err.message || String(err), danger: true });
    } finally {
      setModelLoadProgress(null);
      setLoadingModelId(null);
    }
  };

  const handleLoadModel = async (modelId) => {
    if (blockLoadIfOtherRuntimeActive(modelId, activeModelType)) {
      return;
    }

    if (activeModelType === "image") {
      await checkVramAndLoad(modelId);
    } else if (activeModelType === "text") {
      await loadTextModel(modelId);
    } else if (activeModelType === "speech") {
      await loadSpeechModel(modelId);
    } else {
      await loadTtsModel(modelId);
    }
  };

  const performLoadModel = async (modelId, forcedConstraints = null) => {
    const isTauriDesktop = typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
    const backendStatus = await getBackendStatus();
    const backendPort = backendStatus?.port || 8080;

    if (!isTauriDesktop && !isLocalServerMode()) {
      const isAlreadyRunning = await pingServer();
      const modelInfo = getLocalModelInfo(modelId);
      const isOpenVinoModel = modelInfo?.backendType === "openvino-npu";
      const cmd = isOpenVinoModel
        ? `Run the platform launcher and load "${modelId}" from Model Manager on a configured Intel NPU machine.`
        : `.\\backend\\win\\vulkan\\sd-vulkan.exe --listen-port ${backendPort} --model .\\models\\${modelId} --threads 8`;

      if (isAlreadyRunning) {
        if (await showConfirm({ title: uiText("Web Tarayıcı Modu", "Web Browser Mode"), message: uiText(`"${modelId}" modelini etkin GPU sunucusunda yüklemek için terminaldeki arka ucu şu komutla yeniden başlatın:\n\n${cmd}\n\nArayüz durumu yine de güncellensin mi?`, `To load "${modelId}" on the active GPU server, restart your terminal backend with:\n\n${cmd}\n\nUpdate the UI status anyway?`), confirmLabel: uiText("Arayüzü Güncelle", "Update UI") })) {
          setActiveModel(modelId);
          setServerRunning(true);
        }
      } else {
        if (await showConfirm({ title: uiText("Arka Uç Çalışmıyor", "Backend Not Running"), message: uiText(`C++ arka uç sunucusu ${backendPort} portunda çalışmıyor.\n\nYerel olarak çalıştırmak için şunu başlatın:\n\n${cmd}\n\nBunun yerine Simülasyon Modu ile devam edilsin mi?`, `C++ backend server is not running on port ${backendPort}.\n\nTo run locally, start:\n\n${cmd}\n\nProceed in Simulation Mode instead?`), confirmLabel: uiText("Devam Et", "Proceed") })) {
          setActiveModel(modelId);
          setServerRunning(false);
        }
      }
      return;
    }

    cancelLoadRef.current = false;
    setLoadingModelId(modelId);
    setModelLoadProgress({
      progress: 0,
      phase: "Starting backend...",
      speed: "",
      current: 0,
      total: 0,
      model: modelId,
      backendMode: "",
      backendBinary: "",
      device: "",
    });
    try {
      const modelInfo = getLocalModelInfo(modelId);
      const isCoreMLModel = modelInfo?.format === "CoreML" || modelInfo?.backendType === "apple-npu";
      const activeConstraints = forcedConstraints || constraints;
      const loadConstraints = isCoreMLModel
        ? {
            ...activeConstraints,
            backendType: "apple-npu",
            useGpu: true,
            width: 512,
            height: 512,
            steps: activeConstraints.steps || 20,
            cfgScale: Number(activeConstraints.cfgScale) > 1 ? activeConstraints.cfgScale : 7,
          }
        : modelInfo?.backendType === "openvino-npu"
        ? {
            ...activeConstraints,
            backendType: "openvino-npu",
            useGpu: true,
            width: activeConstraints.width >= 1024 ? 1024 : 512,
            height: activeConstraints.height >= 1024 ? 1024 : 512,
            steps: Math.max(1, Math.min(8, activeConstraints.steps || 4)),
            cfgScale: activeConstraints.cfgScale || 1,
          }
        : activeConstraints;

      const response = await startServer(modelId, loadConstraints);
      console.log(response);

      let isReady = false;
      let crashError = null;
      let readyStatus = null;
      const isOpenVinoModel = modelInfo?.backendType === "openvino-npu";
      const maxStartupPolls = (isOpenVinoModel || isCoreMLModel) ? 1200 : 240;
      for (let i = 0; i < maxStartupPolls; i++) {
        if (cancelLoadRef.current) {
          crashError = "Model load cancelled by the user.";
          break;
        }
        const status = await getBackendStatus();
        if (status.loading) {
          setModelLoadProgress({
            progress: status.loading.progress || 0,
            phase: status.loading.phase || "Loading model...",
            speed: status.loading.speed || "",
            current: status.loading.current || 0,
            total: status.loading.total || 0,
            model: status.loading.model || modelId,
            backendMode: status.loading.backendMode || status.settings?.backendMode || "",
            backendBinary: status.loading.backendBinary || status.settings?.backendBinary || "",
            device: status.loading.device || status.settings?.backendDevice || "",
          });
        }
        if (status.ready) {
          isReady = true;
          readyStatus = status;
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

      if (isReady) {
        const loadedModelId = readyStatus?.settings?.backendType === "openvino-npu"
          ? (readyStatus.settings.model || readyStatus.loading?.model || modelId)
          : modelId;
        setModelLoadProgress((prev) => ({
          ...(prev || {}),
          progress: 100,
          phase: "Model ready",
          speed: "",
          current: prev?.current || 0,
          total: prev?.total || 0,
          model: loadedModelId,
        }));
        setActiveModel(loadedModelId);
        setServerRunning(true);
      } else {
        throw new Error(crashError || `Model server failed to respond on port ${backendPort}.`);
      }
    } catch (e) {
      console.error("Failed to load model:", e);
      if (e.message !== "Model load cancelled by the user.") {
        showAlert({ title: uiText("Model Yüklenemedi", "Model Load Failed"), message: e.message || String(e), danger: true });
      }
    } finally {
      setTimeout(() => setModelLoadProgress(null), 800);
      setLoadingModelId(null);
    }
  };

  const handleUnloadThenLoad = async () => {
    const pendingLoad = pendingLoadModel;
    const nextModel = pendingLoad?.modelId;
    const targetType = pendingLoad?.targetType;
    setPendingLoadModel(null);
    await handleUnloadModel(pendingLoad?.activeRuntime);
    if (nextModel) {
      if (targetType === "image") {
        await checkVramAndLoad(nextModel, { skipActiveGuard: true });
      } else if (targetType === "text") {
        await loadTextModel(nextModel);
      } else if (targetType === "speech") {
        await loadSpeechModel(nextModel);
      } else if (targetType === "tts") {
        await loadTtsModel(nextModel);
      }
    }
  };

  const handleUnloadPendingOnly = async () => {
    const pendingLoad = pendingLoadModel;
    setPendingLoadModel(null);
    await handleUnloadModel(pendingLoad?.activeRuntime);
  };

  const handleUnloadModel = async (runtimeOverride = null) => {
    const runtime = runtimeOverride?.type ? runtimeOverride : getRuntimeForType(activeModelType);
    if (!runtime || isUnloading) return;

    if (runtime.type === "image") {
      if (isUnloading) return;
      setIsUnloading(true);
      setUnloadProgress({ progress: 10, phase: "Stopping backend process..." });

      const poll = setInterval(async () => {
        try {
          const status = await getBackendStatus();
          if (status.unloading?.active) {
            setUnloadProgress({
              progress: status.unloading.progress || 50,
              phase: status.unloading.phase || "Unloading model...",
            });
          } else {
            setUnloadProgress((prev) => ({
              progress: Math.min(95, prev.progress + 10),
              phase: prev.phase || "Unloading model...",
            }));
          }
        } catch (_) {}
      }, 300);

      try {
        await stopServer();
        setUnloadProgress({ progress: 100, phase: "Model unloaded" });
        setActiveModel(null);
        setPendingLoadModel(null);
        setServerRunning(false);
      } catch (e) {
        console.error(e);
        showAlert({ title: uiText("Bellekten Çıkarma Başarısız", "Unload Failed"), message: e.message || String(e), danger: true });
      } finally {
        clearInterval(poll);
        setTimeout(() => {
          setIsUnloading(false);
          setUnloadProgress({ progress: 0, phase: "" });
        }, 500);
      }
    } else if (runtime.type === "text") {
      setIsUnloading(true);
      setUnloadProgress({ progress: 50, phase: "Stopping llama.cpp backend process..." });
      try {
        await stopLlm();
        setActiveLlmModel(null);
        setLlmRunning(false);
      } catch (e) {
        showAlert({ title: uiText("Bellekten Çıkarma Başarısız", "Unload Failed"), message: e.message || String(e), danger: true });
      } finally {
        setIsUnloading(false);
        setUnloadProgress({ progress: 0, phase: "" });
      }
    } else if (runtime.type === "speech") {
      setIsUnloading(true);
      setUnloadProgress({ progress: 50, phase: "Stopping whisper.cpp speech runtime..." });
      try {
        await stopSpeech();
        setActiveSpeechModel(null);
        setSpeechRunning(false);
      } catch (e) {
        showAlert({ title: uiText("Bellekten Çıkarma Başarısız", "Unload Failed"), message: e.message || String(e), danger: true });
      } finally {
        setIsUnloading(false);
        setUnloadProgress({ progress: 0, phase: "" });
      }
    } else {
      setIsUnloading(true);
      setUnloadProgress({ progress: 50, phase: "Stopping Kokoro TTS runtime..." });
      try {
        await stopTts();
        setActiveTtsModel(null);
        setTtsRunning(false);
      } catch (e) {
        showAlert({ title: uiText("Bellekten Çıkarma Başarısız", "Unload Failed"), message: e.message || String(e), danger: true });
      } finally {
        setIsUnloading(false);
        setUnloadProgress({ progress: 0, phase: "" });
      }
    }
  };

  // Bilgisayarinizin ozelliklerine gore secilecek uyumlu modelleri yukle (aciklama icin)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getCompatibleModels();
      if (!cancelled && res.ok) {
        setCompatibleModels(res.models || []);
        setCompatibleTier(res.tier || "");
        setCompatibleVram(res.vram || 0);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleOpenCompatibleModal = async () => {
    let list = compatibleModels;
    try {
      const res = await getCompatibleModels();
      if (res && res.ok && Array.isArray(res.models)) {
        list = res.models;
        setCompatibleModels(res.models);
        if (res.tier) setCompatibleTier(res.tier);
        if (typeof res.vram !== "undefined") setCompatibleVram(res.vram);
      }
    } catch (_) {}

    const initial = {};
    for (const m of list) {
      initial[m.filename || m.kind] = !m.installed;
    }
    const anyUninstalled = list.some(m => !m.installed);
    if (!anyUninstalled) {
      for (const m of list) {
        initial[m.filename || m.kind] = true;
      }
    }
    setSelectedCompatibleModels(initial);
    setShowCompatibleModal(true);
  };

  const toggleSelectCompatibleModel = (key) => {
    setSelectedCompatibleModels((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const handleSelectAllCompatible = (select) => {
    const next = {};
    for (const m of compatibleModels) {
      next[m.filename || m.kind] = select;
    }
    setSelectedCompatibleModels(next);
  };

  const handleDownloadSelectedModels = async () => {
    const selectedKeys = Object.entries(selectedCompatibleModels)
      .filter(([_, isSelected]) => isSelected)
      .map(([key]) => key);

    if (selectedKeys.length === 0) {
      showAlert({
        title: uiText("Model Seçilmedi", "No Model Selected"),
        message: uiText("Lütfen indirmek istediğiniz en az bir modeli işaretleyin.", "Please select at least one model to download."),
        danger: true
      });
      return;
    }

    setShowCompatibleModal(false);
    setIsDownloadingDefaults(true);
    setDownloadProgress(0);
    setDownloadSpeed("İndirme başlatılıyor...");

    try {
      const result = await downloadDefaultModels(selectedKeys);
      if (!result || result.ok === false) {
        throw new Error(result?.error || "Uyumlu modeller indirilemedi.");
      }
      startProgressPolling("Uyumlu En Verimli Modeller Paketi");
    } catch (err) {
      setIsDownloadingDefaults(false);
      setDownloadingModelId(null);
      setDownloadProgress(0);
      setDownloadSpeed("");
      showAlert({ title: uiText("İndirme Başlatılamadı", "Download Could Not Start"), message: err.message || String(err), danger: true });
    }
  };

  const handleDownloadDefaultModels = () => {
    handleOpenCompatibleModal();
  };

  const handleDeleteModel = async (filename) => {
    if (await showConfirm({
      title: uiText("Model Silinsin mi?", "Delete Model?"),
      message: uiText(`"${filename}" diskinizden silinsin mi?`, `Delete "${filename}" from your drive?`),
      confirmLabel: uiText("Sil", "Delete"),
      danger: true,
    })) {
      try {
        if (activeModelType === "image") {
          await deleteModel(filename);
          if (activeModel === filename) {
            await handleUnloadModel();
          }
        } else if (activeModelType === "text") {
          await deleteLlmModel(filename);
          if (activeLlmModel === filename) {
            await handleUnloadModel();
          }
        } else if (activeModelType === "speech") {
          await deleteSpeechModel(filename);
          if (activeSpeechModel === filename) {
            await handleUnloadModel();
          }
        } else if (activeModelType === "video") {
          await deleteVideoModel(filename);
        } else if (activeModelType === "music") {
          await deleteMusicModel(filename);
        } else {
          await deleteTtsModel(filename);
          if (activeTtsModel === filename) {
            await handleUnloadModel();
          }
        }
        await fetchModels();
      } catch (err) {
        console.error("Failed to delete model:", err);
        showAlert({ title: uiText("Silme Başarısız", "Delete Failed"), message: err.message || String(err), danger: true });
      }
    }
  };

  const executeImport = async (sourcePath, displayName) => {
    const controller = new AbortController();
    setImportAbortController(controller);
    setImportProgress(0);
    setImportInfo({
      filename: displayName,
      speed: "0.0",
      eta: 0,
      status: "Initiating file copy..."
    });

    try {
      if (activeModelType === "image") {
        await importModelFile(sourcePath, (progressData) => {
          setImportProgress(Math.round(progressData.progress));
          setImportInfo({
            filename: progressData.filename,
            speed: progressData.speed_mb_s.toFixed(1),
            eta: Math.round(progressData.eta_secs),
            status: progressData.status
          });
        }, controller.signal);
      } else if (activeModelType === "text") {
        await importLlmModel(sourcePath, (progressData) => {
          setImportProgress(Math.round(progressData.progress));
          setImportInfo({
            filename: progressData.filename,
            speed: progressData.speed_mb_s.toFixed(1),
            eta: Math.round(progressData.eta_secs),
            status: progressData.status
          });
        }, controller.signal);
      } else if (activeModelType === "speech") {
        await importSpeechModel(sourcePath, (progressData) => {
          setImportProgress(Math.round(progressData.progress));
          setImportInfo({
            filename: progressData.filename,
            speed: progressData.speed_mb_s.toFixed(1),
            eta: Math.round(progressData.eta_secs),
            status: progressData.status
          });
        }, controller.signal);
      } else if (activeModelType === "video") {
        await importVideoModel(sourcePath, (progressData) => {
          setImportProgress(Math.round(progressData.progress));
          setImportInfo({
            filename: progressData.filename,
            speed: progressData.speed_mb_s.toFixed(1),
            eta: Math.round(progressData.eta_secs),
            status: progressData.status
          });
        }, controller.signal);
      } else {
        await importTtsModel(sourcePath, (progressData) => {
          setImportProgress(Math.round(progressData.progress));
          setImportInfo({
            filename: progressData.filename,
            speed: progressData.speed_mb_s.toFixed(1),
            eta: Math.round(progressData.eta_secs),
            status: progressData.status
          });
        }, controller.signal);
      }

      await fetchModels();
    } catch (err) {
      console.error("Import failed:", err);
      if (err.name !== "AbortError") {
        showAlert({ title: uiText("İçe Aktarma Başarısız", "Import Failed"), message: err.message || String(err), danger: true });
      }
    } finally {
      setImportProgress(null);
      setImportAbortController(null);
    }
  };

  const handleCancelImport = () => {
    if (importAbortController) {
      importAbortController.abort();
    }
  };

  const handleImportFile = (e) => {
    const file = e.target.files[0];
    if (file) {
      executeImport(file, file.name);
    }
    e.target.value = "";
  };

  const isCompatibleDownloading = Boolean(
    isDownloadingDefaults ||
    (downloadingModelId && compatibleModels.some((m) => m.filename && (downloadingModelId === m.filename || downloadingModelId.includes(m.filename)))) ||
    (downloadDetails && downloadDetails.defaultModels)
  );

  const isUrlDownloading = Boolean(downloadingModelId && !isCompatibleDownloading);

  return (
    <div className="workspace-area">
      <div className="workspace-title-section">
        <h2 className="workspace-title">Model Merkezi (Model Hub)</h2>
        <p className="workspace-subtitle">
          Donanımınıza en uygun yapay zeka modellerini keşfedin, doğrudan yerel depolama alanınıza indirin ve yönetin.
        </p>
      </div>

      {/*  İNDİRME HATASI BİLDİRİMİ */}
      {downloadError && (
        <div style={{
          background: "rgba(239, 68, 68, 0.15)",
          border: "1px solid rgba(239, 68, 68, 0.4)",
          borderRadius: "14px",
          padding: "14px 18px",
          marginBottom: "20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          color: "#fca5a5",
          flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: "260px" }}>
            <AlertTriangle size={20} style={{ color: "#ef4444", flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#f87171" }}>
                {downloadError.toLowerCase().includes("gated") || downloadError.includes("401")
                  ? "İndirme İzni / Token Gerekli (Hugging Face Gated Model)"
                  : "İndirme Başarısız Oldu"}
              </div>
              <div style={{ fontSize: "0.82rem", opacity: 0.9 }}>{downloadError}</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {(downloadError.toLowerCase().includes("gated") || downloadError.includes("401")) && (
              <button
                type="button"
                className="m3-btn m3-btn-filled"
                style={{
                  height: "32px",
                  fontSize: "0.78rem",
                  padding: "0 14px",
                  background: "#eab308",
                  color: "#000",
                  fontWeight: 700,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px"
                }}
                onClick={() => setShowGatedModal(true)}
              >
                <KeyRound size={14} />
                <span>Token Gir & Çöz</span>
              </button>
            )}
            <button
              type="button"
              className="m3-btn m3-btn-outlined"
              style={{ borderColor: "rgba(239,68,68,0.5)", color: "#fca5a5", height: "32px", fontSize: "0.78rem" }}
              onClick={() => setDownloadError(null)}
            >
              Kapat
            </button>
          </div>
        </div>
      )}

      {/*  SABİT ÜST İNDİRME VE KUYRUK YÖNETİCİSİ (STICKY TOP DOWNLOAD & QUEUE BAR) */}
      {(downloadingModelId || downloadQueue.length > 0) && (
        <div style={{
          position: "sticky",
          top: "0px",
          zIndex: 60,
          backdropFilter: "blur(28px) saturate(190%)",
          WebkitBackdropFilter: "blur(28px) saturate(190%)",
          background: "var(--glass-bg, rgba(20, 20, 26, 0.94))",
          border: "1.5px solid rgba(59, 130, 246, 0.35)",
          borderRadius: "16px",
          padding: "16px 20px",
          marginBottom: "24px",
          boxShadow: "0 12px 36px -4px rgba(0, 0, 0, 0.45), 0 0 20px rgba(59, 130, 246, 0.15)",
          animation: "fadeIn 0.25s ease-out"
        }}>
          {downloadingModelId ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px", flexWrap: "wrap", gap: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                  <div style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "10px",
                    background: "rgba(59, 130, 246, 0.15)",
                    border: "1px solid rgba(59, 130, 246, 0.35)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--md-sys-color-primary, #3b82f6)",
                    flexShrink: 0
                  }}>
                    <RefreshCw className="progress-spinner" size={18} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <span style={{
                        fontSize: "0.72rem",
                        fontWeight: 700,
                        background: "var(--md-sys-color-primary, #3b82f6)",
                        color: "#ffffff",
                        padding: "2px 8px",
                        borderRadius: "999px",
                        letterSpacing: "0.03em"
                      }}>
                        İNDİRİLİYOR
                      </span>
                      <strong style={{
                        fontSize: "0.95rem",
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: "450px"
                      }} title={downloadingModelId}>
                        {downloadingModelId}
                      </strong>
                    </div>
                    <span style={{ fontSize: "0.76rem", color: "var(--md-sys-color-outline)", marginTop: "2px" }}>
                      {downloadSpeed || "Bağlanıyor..."}
                    </span>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                  <span style={{ fontSize: "1.35rem", fontWeight: 800, color: "var(--md-sys-color-primary, #3b82f6)", fontVariantNumeric: "tabular-nums" }}>
                    %{downloadProgress > 0 ? downloadProgress : 0}
                  </span>
                  <button
                    type="button"
                    className="m3-btn m3-btn-error"
                    style={{ height: "34px", padding: "0 14px", fontSize: "0.78rem", fontWeight: 600, borderRadius: "8px" }}
                    onClick={() => handleCancelDownload(false)}
                    title="Şu anki modelin indirmesini durdurup sıradakine geç"
                  >
                    <Square size={13} />
                    <span>Durdur</span>
                  </button>
                  {downloadQueue.length > 0 && (
                    <button
                      type="button"
                      className="m3-btn m3-btn-outlined"
                      style={{ height: "34px", padding: "0 14px", fontSize: "0.78rem", fontWeight: 600, borderColor: "#ef4444", color: "#ef4444", borderRadius: "8px" }}
                      onClick={() => handleCancelDownload(true)}
                      title="Tüm indirme kuyruğunu temizle ve durdur"
                    >
                      <X size={13} />
                      <span>Tümünü İptal Et</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Doluluk Çubuğu */}
              <div style={{
                width: "100%",
                height: "8px",
                background: "rgba(255, 255, 255, 0.08)",
                borderRadius: "999px",
                overflow: "hidden",
                boxShadow: "inset 0 1px 2px rgba(0, 0, 0, 0.3)"
              }}>
                <div style={{
                  height: "100%",
                  width: `${Math.min(100, Math.max(0, downloadProgress))}%`,
                  background: "linear-gradient(90deg, #3b82f6, #06b6d4, #10b981)",
                  borderRadius: "999px",
                  transition: "width 0.2s ease"
                }} />
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: "0.88rem", fontWeight: 600 }}>Sıradaki model indirmesi hazırlanıyor...</span>
              {downloadQueue.length > 0 && (
                <button
                  type="button"
                  className="m3-btn m3-btn-outlined"
                  style={{ height: "30px", padding: "0 10px", fontSize: "0.75rem", borderColor: "#ef4444", color: "#ef4444" }}
                  onClick={() => handleCancelDownload(true)}
                >
                  <X size={12} />
                  <span>Tümünü İptal Et</span>
                </button>
              )}
            </div>
          )}

          {/* Bekleyen Kuyruk Listesi */}
          {downloadQueue.length > 0 && (
            <div style={{
              marginTop: "14px",
              paddingTop: "12px",
              borderTop: "1px solid rgba(255, 255, 255, 0.08)"
            }}>
              <div style={{ fontSize: "0.82rem", fontWeight: 700, marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px", color: "var(--md-sys-color-primary, #3b82f6)" }}>
                <Clock size={14} />
                <span>İndirme Kuyruğu ({downloadQueue.length} model sırada bekliyor)</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "8px" }}>
                {downloadQueue.map((item, idx) => (
                  <div key={item.id || item.filename} style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 12px",
                    background: "rgba(255, 255, 255, 0.04)",
                    borderRadius: "10px",
                    border: "1px solid rgba(255, 255, 255, 0.08)"
                  }}>
                    <span style={{ fontSize: "0.8rem", display: "inline-flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                      <span style={{
                        fontWeight: 800,
                        color: "var(--md-sys-color-primary, #3b82f6)",
                        background: "rgba(59, 130, 246, 0.16)",
                        padding: "1px 6px",
                        borderRadius: "4px",
                        fontSize: "0.72rem"
                      }}>
                        #{idx + 1}
                      </span>
                      <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "150px" }} title={item.name || item.filename}>
                        {item.name || item.filename}
                      </span>
                      <span style={{ fontSize: "0.7rem", opacity: 0.65 }}>({item.kind || "model"})</span>
                    </span>
                    <button
                      type="button"
                      className="m3-btn m3-btn-tonal"
                      style={{ height: "26px", padding: "0 8px", fontSize: "0.72rem", borderRadius: "6px" }}
                      onClick={() => handleCancelQueued(item)}
                      title="Kuyruktan Çıkar"
                    >
                      <X size={12} />
                      <span>Kaldır</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Model Kategori Sekmeleri */}
      <div style={{ display: "flex", gap: "10px", borderBottom: "1px solid var(--border-color)", paddingBottom: "16px", marginBottom: "20px", flexWrap: "wrap" }}>
        <button
          type="button"
          className={`m3-btn ${activeModelType === "image" ? "m3-btn-filled" : "m3-btn-outlined"}`}
          onClick={() => setActiveModelType("image")}
          style={{ height: "40px", padding: "0 18px", borderRadius: "10px", fontWeight: 600 }}
        >
          Görsel Modelleri (Diffusion)
        </button>
        <button
          type="button"
          className={`m3-btn ${activeModelType === "text" ? "m3-btn-filled" : "m3-btn-outlined"}`}
          onClick={() => setActiveModelType("text")}
          style={{ height: "40px", padding: "0 18px", borderRadius: "10px", fontWeight: 600 }}
        >
          Metin Modelleri (LLM GGUF)
        </button>
        <button
          type="button"
          className={`m3-btn ${activeModelType === "speech" ? "m3-btn-filled" : "m3-btn-outlined"}`}
          onClick={() => setActiveModelType("speech")}
          style={{ height: "40px", padding: "0 18px", borderRadius: "10px", fontWeight: 600 }}
        >
          Ses Tanıma (Whisper)
        </button>
        <button
          type="button"
          className={`m3-btn ${activeModelType === "tts" ? "m3-btn-filled" : "m3-btn-outlined"}`}
          onClick={() => setActiveModelType("tts")}
          style={{ height: "40px", padding: "0 18px", borderRadius: "10px", fontWeight: 600 }}
        >
          Metinden Sese (TTS)
        </button>
        <button
          type="button"
          className={`m3-btn ${activeModelType === "music" ? "m3-btn-filled" : "m3-btn-outlined"}`}
          onClick={() => setActiveModelType("music")}
          style={{ height: "40px", padding: "0 18px", borderRadius: "10px", fontWeight: 600 }}
        >
          Müzik & Ses (Audio/Music)
        </button>
        <button
          type="button"
          className={`m3-btn ${activeModelType === "video" ? "m3-btn-filled" : "m3-btn-outlined"}`}
          onClick={() => setActiveModelType("video")}
          style={{ height: "40px", padding: "0 18px", borderRadius: "10px", fontWeight: 600 }}
        >
          Video Modelleri (Wan 2.1 / AnimateDiff)
        </button>
      </div>

      {/* Uyumlu Modelleri Indir (bilgisayara gore secilen modeller) */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <button
            className="m3-btn m3-btn-filled"
            style={{
              height: "42px",
              padding: "0 22px",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              fontWeight: 600,
              fontSize: "0.9rem",
              background: isCompatibleDownloading ? "var(--md-sys-color-surface-variant)" : "var(--md-sys-color-primary)",
              color: isCompatibleDownloading ? "var(--md-sys-color-on-surface-variant)" : "#ffffff",
              cursor: isCompatibleDownloading ? "not-allowed" : "pointer"
            }}
            disabled={isCompatibleDownloading}
            onClick={handleDownloadDefaultModels}
          >
            {isCompatibleDownloading ? (
              <RefreshCw className="progress-spinner" size={18} />
            ) : (
              <DownloadCloud size={18} />
            )}
            {isCompatibleDownloading ? "Uyumlu En Verimli Modeller İndiriliyor..." : "Uyumlu En Verimli Modelleri İndir"}
          </button>

          {isCompatibleDownloading && (
            <button
              type="button"
              onClick={handleCancelDownload}
              className="m3-btn m3-btn-outlined"
              style={{
                height: "40px",
                padding: "0 16px",
                borderColor: "#ef4444",
                color: "#ef4444",
                fontWeight: 600,
                borderRadius: "10px",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                background: "rgba(239, 68, 68, 0.08)"
              }}
              title="İndirmeyi Durdur / İptal Et"
            >
              <Square size={14} />
              <span>İndirmeyi Durdur</span>
            </button>
          )}

          <button
            type="button"
            className="m3-btn m3-btn-outlined"
            onClick={() => {
              setGatedModalModel(null);
              setShowGatedModal(true);
            }}
            style={{
              height: "42px",
              padding: "0 18px",
              borderRadius: "10px",
              fontWeight: 600,
              fontSize: "0.85rem",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              borderColor: hasHfToken ? "rgba(34, 197, 94, 0.45)" : "rgba(234, 179, 8, 0.45)",
              background: hasHfToken ? "rgba(34, 197, 94, 0.08)" : "rgba(234, 179, 8, 0.08)",
              color: hasHfToken ? "#4ade80" : "#facc15",
            }}
            title="Hugging Face Erişim Tokeni Ayarları (Gated Modeller İçin)"
          >
            <KeyRound size={16} />
            <span>{hasHfToken ? "HF Token: Tanımlı" : " HF Token Ekle"}</span>
          </button>
        </div>

        <p style={{ fontSize: "0.84rem", marginTop: "8px", opacity: 0.85, lineHeight: 1.4 }}>
          Bu bilgisayarın donanımına (VRAM: <strong>{compatibleVram} GB</strong>, seviye: <strong style={{ textTransform: "uppercase" }}>{compatibleTier || "-"}</strong>) göre en verimli ve uyumlu modelleri otomatik indirir. Her kategoriden (Görsel, Metin LLM, Konuşma, Müzik, Foley / SFX, Video) donanıma en uygun model seçilir.
        </p>

      </div>

      {/* Görünüm Sekmeleri: Model Kütüphanesi & Yüklü Yerel Modeller */}
      <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "20px", borderBottom: "1px solid var(--border-color)", paddingBottom: "14px" }}>
        <button
          type="button"
          className={`m3-btn ${modelViewTab === "library" ? "m3-btn-filled" : "m3-btn-outlined"}`}
          onClick={() => setModelViewTab("library")}
          style={{
            height: "40px",
            padding: "0 20px",
            borderRadius: "10px",
            fontWeight: 700,
            fontSize: "0.88rem",
            display: "inline-flex",
            alignItems: "center",
            gap: "8px"
          }}
        >
          <Library size={18} />
          <span>Model Kütüphanesi (Keşfet & İndir)</span>
        </button>

        <button
          type="button"
          className={`m3-btn ${modelViewTab === "local" ? "m3-btn-filled" : "m3-btn-outlined"}`}
          onClick={() => setModelViewTab("local")}
          style={{
            height: "40px",
            padding: "0 20px",
            borderRadius: "10px",
            fontWeight: 700,
            fontSize: "0.88rem",
            display: "inline-flex",
            alignItems: "center",
            gap: "8px"
          }}
        >
          <Database size={18} />
          <span>Yüklü Yerel Modeller ({displayedLocalModels.length})</span>
          {(activeModel || activeLlmModel || activeSpeechModel || activeTtsModel) && (
            <span style={{ fontSize: "0.72rem", background: "rgba(16, 185, 129, 0.2)", color: "#10b981", padding: "1px 6px", borderRadius: "6px" }}>
              Aktif Model
            </span>
          )}
        </button>
      </div>

      {/* Canlı İndirme İlerleme Kartı (Yalnızca İndirme Sırasında Gösterilir) */}
      {isCompatibleDownloading && downloadingModelId && (
        <div
          style={{
            fontSize: "0.82rem",
            padding: "16px 20px",
            background: "linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(16, 185, 129, 0.08))",
            borderRadius: "14px",
            border: "1.5px solid var(--md-sys-color-primary, #3b82f6)",
            boxShadow: "0 4px 20px rgba(59, 130, 246, 0.18)",
            transition: "all 0.2s ease",
            marginBottom: "20px"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", marginBottom: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span
                style={{
                  background: "#3b82f6",
                  color: "#fff",
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  padding: "3px 10px",
                  borderRadius: "999px"
                }}
              >
                İndiriliyor
              </span>
              <strong style={{ fontSize: "0.95rem" }}>{downloadingModelId}</strong>
            </div>

            <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
              <span style={{ fontSize: "0.82rem", fontWeight: 700, opacity: 0.75 }}>İlerleme:</span>
              <span style={{ fontSize: "1.5rem", fontWeight: 900, color: "var(--md-sys-color-primary, #3b82f6)", fontFamily: "monospace" }}>
                %{downloadProgress || 0}
              </span>
            </div>
          </div>

          <div style={{
            width: "100%",
            height: "12px",
            background: "rgba(0, 0, 0, 0.2)",
            borderRadius: "999px",
            overflow: "hidden",
            marginBottom: "10px",
            boxShadow: "inset 0 1px 3px rgba(0,0,0,0.2)"
          }}>
            <div
              style={{
                height: "100%",
                width: `${Math.min(100, Math.max(0, downloadProgress || 0))}%`,
                background: "linear-gradient(90deg, #3b82f6 0%, #6366f1 50%, #10b981 100%)",
                borderRadius: "999px",
                transition: "width 0.25s ease-out",
                boxShadow: "0 0 14px rgba(59, 130, 246, 0.6)"
              }}
            />
          </div>

          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "0.78rem",
            color: "var(--md-sys-color-on-surface-variant)",
            fontWeight: 500,
            flexWrap: "wrap",
            gap: "8px"
          }}>
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
              <span>
                Hız: <strong style={{ color: "var(--md-sys-color-on-surface)" }}>{downloadDetails?.speed || (downloadSpeed ? downloadSpeed.split("ETA")[0]?.trim() : "Hesaplanıyor...")}</strong>
              </span>
              {downloadDetails?.totalBytes > 0 && (
                <span>
                  Boyut: <strong style={{ color: "var(--md-sys-color-on-surface)" }}>{(downloadDetails.downloadedBytes / 1e9).toFixed(2)} GB / {(downloadDetails.totalBytes / 1e9).toFixed(2)} GB</strong>
                </span>
              )}
            </div>
            <div>
              <strong style={{ color: "var(--md-sys-color-on-surface)" }}>
                {downloadDetails?.eta > 0
                  ? `Tahmini Kalan Süre: ~${downloadDetails.eta} sn`
                  : downloadSpeed?.includes("ETA")
                  ? `Kalan Süre: ~${downloadSpeed.split("ETA")[1]?.trim()}`
                  : "Bağlantı kuruluyor..."}
              </strong>
            </div>
          </div>
        </div>
      )}




      {/* Loading Progress Bar */}
      {modelLoadProgress && (
        <div className="m3-card" style={{ borderLeft: "4px solid var(--md-sys-color-primary)", marginBottom: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h4 style={{ fontWeight: 600 }}>Loading Weights: {modelLoadProgress.model}</h4>
            <button className="m3-btn m3-btn-error" style={{ height: "34px", padding: "0 14px" }} onClick={handleCancelLoad}>
              <Square size={14} />
              <span>Iptal Yukle</span>
            </button>
          </div>
          <div className="model-progress-section" style={{ margin: "12px 0 6px 0" }}>
            <div className="model-progress-label">
              <span>
                {modelLoadProgress.phase}
                {modelLoadProgress.speed ? ` (${modelLoadProgress.speed})` : ""}
              </span>
              <span>
                {modelLoadProgress.total > 0
                  ? `Loaded ${modelLoadProgress.current} / ${modelLoadProgress.total} tensors`
                  : `${Math.round(modelLoadProgress.progress)}%`}
              </span>
            </div>
            <div className="model-progress-bar">
              <div className="model-progress-fill" style={{ width: `${Math.min(100, Math.max(0, modelLoadProgress.progress))}%`, transition: "width 0.2s ease" }}></div>
            </div>
            {(modelLoadProgress.backendMode || modelLoadProgress.device) && (
              <div style={{ fontSize: "0.75rem", color: "var(--md-sys-color-outline)", marginTop: "6px", lineHeight: "1.4" }}>
                <div>
                  Initializing {modelLoadProgress.backendMode || "backend"}
                  {modelLoadProgress.device ? `  ${modelLoadProgress.device}` : ""}
                </div>
                {(modelLoadProgress.backendMode === "Apple NPU" || modelLoadProgress.backendMode === "Apple Neural Engine (NPU)") && (
                  <div style={{ color: "var(--md-sys-color-primary)", marginTop: "4px", fontWeight: "500" }}>
                     Note: The first time loading this model, compilation on the Apple Neural Engine (NPU) can take 3-4 minutes. Subsequent loads will be almost instant.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Unloading Progress Bar */}
      {isUnloading && activeModelType === "image" && (
        <div className="m3-card" style={{ borderLeft: "4px solid var(--md-sys-color-error)", marginBottom: "20px" }}>
          <h4 style={{ fontWeight: 600 }}>{unloadProgress.phase || "Unloading active model..."}</h4>
          <div className="model-progress-section" style={{ margin: "12px 0 0 0" }}>
            <div className="model-progress-bar">
              <div className="model-progress-fill" style={{ width: `${unloadProgress.progress}%`, background: "var(--md-sys-color-error)", transition: "width 0.15s ease" }}></div>
            </div>
          </div>
        </div>
      )}

      {/* 2. SEKME: YÜKLÜ YEREL MODELLER */}
      {modelViewTab === "local" && (
        <>
          {/* Active Model Status Tonal Box */}
          {activeModelType === "image" && activeModel && (
        <div className="m3-card" style={{ borderLeft: "4px solid var(--md-sys-color-primary)", background: "var(--md-sys-color-primary-container)", color: "var(--md-sys-color-on-primary-container)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h4 style={{ fontWeight: 700 }}>Active Model: {activeModel}</h4>
              <p style={{ fontSize: "0.85rem", marginTop: "2px", opacity: 0.9 }}>
                The local C++ stable-diffusion server is running. Real-time telemetry is displaying performance status in the top bar.
              </p>
              {(backendInfo.backendMode || backendInfo.backendDevice || backendInfo.backendBinary) && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "10px" }}>
                  {backendInfo.backendMode && (
                    <span className="status-chip" style={{ cursor: "default" }}>
                      <HardDrive size={14} />
                      <span>Loaded on {backendInfo.backendMode}</span>
                    </span>
                  )}
                  {backendInfo.backendDevice && (
                    <span className="status-chip" style={{ cursor: "default" }}>
                      <span>{backendInfo.backendDevice}</span>
                    </span>
                  )}
                  {backendInfo.backendBinary && (
                    <span className="status-chip" style={{ cursor: "default" }}>
                      <span>{backendInfo.backendBinary}</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeModelType === "text" && activeLlmModel && (
        <div className="m3-card" style={{ borderLeft: "4px solid var(--md-sys-color-primary)", background: "var(--md-sys-color-primary-container)", color: "var(--md-sys-color-on-primary-container)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h4 style={{ fontWeight: 700 }}>Active Text Model: {activeLlmModel}</h4>
              <p style={{ fontSize: "0.85rem", marginTop: "2px", opacity: 0.9 }}>
                The local C++ llama.cpp server is running. Chat requests can be sent via the Text Chat interface.
              </p>
              {backendInfo.llmBackendMode && (
                <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                  <span className="status-chip" style={{ cursor: "default", background: "rgba(255,255,255,0.15)", color: "inherit", border: "1px solid rgba(255,255,255,0.2)" }}>
                    <span>{backendInfo.llmBackendMode}</span>
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeModelType === "speech" && activeSpeechModel && (
        <div className="m3-card" style={{ borderLeft: "4px solid var(--md-sys-color-primary)", background: "var(--md-sys-color-primary-container)", color: "var(--md-sys-color-on-primary-container)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h4 style={{ fontWeight: 700 }}>Active Speech Model: {activeSpeechModel}</h4>
              <p style={{ fontSize: "0.85rem", marginTop: "2px", opacity: 0.9 }}>
                The local whisper.cpp runtime is ready. Speech Transcriber can process WAV recordings and uploads.
              </p>
              {backendInfo.speechBackendMode && (
                <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                  <span className="status-chip" style={{ cursor: "default", background: "rgba(255,255,255,0.15)", color: "inherit", border: "1px solid rgba(255,255,255,0.2)" }}>
                    <span>{backendInfo.speechBackendMode}</span>
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeModelType === "tts" && activeTtsModel && (
        <div className="m3-card" style={{ borderLeft: "4px solid var(--md-sys-color-primary)", background: "var(--md-sys-color-primary-container)", color: "var(--md-sys-color-on-primary-container)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h4 style={{ fontWeight: 700 }}>Active TTS Model: {activeTtsModel}</h4>
              <p style={{ fontSize: "0.85rem", marginTop: "2px", opacity: 0.9 }}>
                The local Kokoro ONNX runtime is ready. Text to Speech can generate WAV narration.
              </p>
              {backendInfo.ttsBackendMode && (
                <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                  <span className="status-chip" style={{ cursor: "default", background: "rgba(255,255,255,0.15)", color: "inherit", border: "1px solid rgba(255,255,255,0.2)" }}>
                    <span>{backendInfo.ttsBackendMode}</span>
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Detected Local Models Section */}
      <div className="m3-card" style={{ marginTop: "24px" }}>
        <h3 className="m3-card-title">
          <Database size={18} style={{ color: "var(--md-sys-color-primary)" }} />
          Local {activeModelType === "image" ? "Image" : activeModelType === "text" ? "Text" : activeModelType === "speech" ? "Speech" : activeModelType === "music" ? "Music" : activeModelType === "video" ? "Video" : "TTS"} Models ({displayedLocalModels.length})
        </h3>

        {isLoadingModels ? (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "10px", padding: "24px 0", color: "var(--md-sys-color-outline)" }}>
            <RefreshCw className="progress-spinner" size={16} />
            <span style={{ fontSize: "0.9rem" }}>Scanning modeller folder...</span>
          </div>
        ) : displayedLocalModels.length === 0 ? (
          <p style={{ fontSize: "0.9rem", color: "var(--md-sys-color-outline)", textAlign: "center", padding: "16px 0" }}>
            {activeModelType === "image"
              ? "No image models detected in app/models/. Download from the library below or import a file."
              : activeModelType === "text"
              ? "No text models detected in app/llm-models/. Download from the library below or import a file."
              : activeModelType === "speech"
              ? "No speech models detected in app/speech-models/. Download from the library below or import a .bin file."
              : activeModelType === "music"
              ? "No music models detected in app/music-models/. Download from the library below or import a file."
              : activeModelType === "video"
              ? "No video models detected in app/video-models/. Download from the library below or import a file."
              : "No TTS models detected in app/tts-models/. Install Kokoro from the library below or import a .json manifest."}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {displayedLocalModels.map((model) => {
              const filename = model.filename;
              const isActive = activeModelType === "image" ? activeModel === filename : activeModelType === "text" ? activeLlmModel === filename : activeModelType === "speech" ? activeSpeechModel === filename : activeTtsModel === filename;

              return (
                <div
                  key={filename}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "12px 16px",
                    background: isActive ? "var(--md-sys-color-primary-container)" : "var(--md-sys-color-surface-variant)",
                    color: isActive ? "var(--md-sys-color-on-primary-container)" : "var(--md-sys-color-on-surface-variant)",
                    borderRadius: "var(--md-shape-corner-medium)",
                    border: "1px solid var(--md-sys-color-outline-variant)"
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>{model.displayName || filename}</span>
                    <span style={{ fontSize: "0.75rem", opacity: 0.8 }}>
                      {activeModelType === "image"
                        ? (model.backendType === "openvino-npu" ? "OpenVINO NPU Model" : model.format || "Local Weights File")
                        : activeModelType === "text"
                        ? (model.isCloud ? `Bulut API Modeli (${(model.provider || "API").toUpperCase()})` : "llama.cpp GGUF Model")
                        : activeModelType === "speech"
                        ? `${model.language || "Whisper"} Model`
                        : activeModelType === "video"
                        ? (model.format || "Video Modeli")
                        : activeModelType === "music"
                        ? (model.format || "Müzik / SFX Modeli")
                        : (model.format || "TTS Modeli")
                      } • {model.size || formatBytes(model.sizeBytes || 0) || "Hazır"}
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    {isActive ? (
                      <button className="m3-btn m3-btn-error" style={{ height: "36px", padding: "0 16px" }} onClick={() => handleUnloadModel()} disabled={isUnloading}>
                        {isUnloading ? <RefreshCw className="progress-spinner" size={14} /> : <Trash2 size={14} />}
                        <span>{isUnloading ? "Unloading" : "Unload"}</span>
                      </button>
                    ) : (
                      <>
                        {(activeModelType === "music" || activeModelType === "video") ? (
                          <span style={{ fontSize: "0.75rem", opacity: 0.8 }}>
                            {activeModelType === "music" ? "Ses & Müzik Stüdyosu'nda seçilir" : "Video Stüdyosu'nda seçilir"}
                          </span>
                        ) : (
                        <button
                          className="m3-btn m3-btn-filled"
                          style={{ height: "36px", padding: "0 16px" }}
                          onClick={() => handleLoadModel(filename)}
                          disabled={isBusy}
                        >
                          {loadingModelId === filename ? (
                            <RefreshCw className="progress-spinner" size={14} />
                          ) : (
                            <Database size={14} />
                          )}
                          <span>{loadingModelId === filename ? "Loading" : "Load"}</span>
                        </button>
                        )}
                        {!model.isCloud && (
                          <button
                            className="m3-btn m3-btn-error"
                            style={{ height: "36px", width: "36px", padding: 0, minWidth: "36px" }}
                            onClick={() => handleDeleteModel(filename)}
                            disabled={isBusy}
                            title="Model klasöründen sil"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </>
      )}

      {/* 1. SEKME: MODEL KÜTÜPHANESİ */}
      {modelViewTab === "library" && (
        <>
          <div className="workspace-title-section" style={{ marginTop: "12px", marginBottom: "16px" }}>
            <h3 className="m3-card-title">
          <Library size={20} style={{ color: "var(--md-sys-color-primary)" }} />
          {activeModelType === "text" ? "Hugging Face Model Library" : activeModelType === "speech" ? "Speech Model Library" : activeModelType === "tts" ? "TTS Model Library" : activeModelType === "video" ? "Video Model Kütüphanesi" : activeModelType === "music" ? "Müzik Model Kütüphanesi" : "Model Library"}
        </h3>
      </div>

      {activeModelType === "text" && (
        <div className="model-discovery-controls">
          <div className="model-search-box">
            <Search size={18} />
            <input
              type="search"
              value={modelSearch}
              onChange={(event) => setModelSearch(event.target.value)}
              placeholder="Hugging Face GGUF modellerinde ara..."
              aria-label="Hugging Face modellerinde ara"
            />
            {modelSearch && (
              <button type="button" onClick={() => setModelSearch("")} title="Aramayı temizle" aria-label="Model aramasını temizle">
                <X size={16} />
              </button>
            )}
          </div>
          <div className="model-filter-row" aria-label="Model filtreleri">
            {MODEL_FILTERS.map((filter) => {
              const selected = selectedFilters.includes(filter.id);
              return (
                <button
                  key={filter.id}
                  type="button"
                  className={`model-filter-chip ${selected ? "selected" : ""}`}
                  onClick={() => toggleModelFilter(filter.id)}
                  aria-pressed={selected}
                >
                  {filter.label}
                  {selected && <X size={14} />}
                </button>
              );
            })}
            {selectedFilters.length > 0 && (
              <button type="button" className="model-filter-clear" onClick={() => setSelectedFilters([])}>
                Clear filters
              </button>
            )}
          </div>
          {isSearchingModels && (
            <div className="model-discovery-loading">
              <RefreshCw className="progress-spinner" size={16} />
              <span>Yukleniyor modeller from Hugging Face...</span>
            </div>
          )}
          {modelSearchError && (
            <div className="model-search-warning">
              {modelSearchError} Showing the built-in fallback catalog.
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* Donanım Seviyesi Filtre Butonları */}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", padding: "10px 14px", background: "var(--md-sys-color-surface-container-high)", borderRadius: "10px", border: "1px solid var(--md-sys-color-outline-variant)" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--md-sys-color-on-surface)", display: "flex", alignItems: "center", gap: "4px" }}>
            <span> Donanım Filtresi:</span>
          </span>
          {[
            { id: "all", label: "Tüm Modeller" },
            { id: "low", label: " Hafif & Hızlı (4 - 8 GB)" },
            { id: "mid", label: " Orta Seviye (8 - 12 GB)" },
            { id: "high", label: " Yüksek Donanım (16 GB+)" },
            { id: "ultra", label: " Amiral Gemisi (24 GB+)" },
          ].map((tier) => (
            <button
              key={tier.id}
              type="button"
              className={`model-filter-chip ${hardwareTierFilter === tier.id ? "selected" : ""}`}
              onClick={() => setHardwareTierFilter(tier.id)}
              style={{
                borderRadius: "20px",
                padding: "5px 12px",
                fontSize: "0.75rem",
                fontWeight: hardwareTierFilter === tier.id ? 700 : 500,
                background: hardwareTierFilter === tier.id ? "var(--md-sys-color-primary)" : "var(--md-sys-color-surface)",
                color: hardwareTierFilter === tier.id ? "var(--md-sys-color-on-primary)" : "inherit",
                border: "1px solid var(--md-sys-color-outline-variant)",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {tier.label}
            </button>
          ))}
        </div>

        {activeModelType === "text" && hasHuggingFaceResults && !isSearchingModels && displayedHuggingFaceModels.length === 0 && (
          <div className="m3-card model-search-empty">
            No downloadable single-file GGUF models matched this search and filter combination.
          </div>
        )}

        {filteredLibrary.length === 0 && (
          <div className="m3-card" style={{ padding: "20px", textAlign: "center", color: "var(--md-sys-color-outline)" }}>
            Seçilen donanım filtresine ({hardwareTierFilter}) uygun model bulunamadı. Yukarıdaki filtreyi "Tüm Modeller" olarak değiştirebilirsiniz.
          </div>
        )}

        {filteredLibrary.map((section) => (
          <div key={section.group} className="m3-card" style={{ margin: 0 }}>
            <h4 style={{ fontWeight: 700, marginBottom: "12px" }}>{section.group}</h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "12px" }}>
              {section.items.map((model) => {
                const hasMainModel = modelNames.includes(model.filename);
                const hasProjector = !model.projectorFilename || allModelNames.includes(model.projectorFilename);
                const needsProjector = Boolean(hasMainModel && model.projectorFilename && !hasProjector);
                const installed = hasMainModel && hasProjector;
                const downloading = downloadingModelId === model.filename || downloadingModelId === model.projectorFilename || downloadingModelId === `${model.filename}.zip`;
                const queueItem = downloadQueue.find((q) => q.filename === model.filename || q.filename === model.projectorFilename || q.filename === `${model.filename}.zip`);
                const isQueued = Boolean(queueItem);
                const systemTier = getHardwareTier(specs);
                const isCompatible = compatibleModels.some((c) => c.filename && model.filename && c.filename === model.filename);
                const isRecommended = typeof model.recommendedFit === "boolean"
                  ? model.recommendedFit
                  : model.recommendedTiers && (
                      model.recommendedTiers.includes(systemTier) ||
                      (systemTier === "Ultra" && (model.recommendedTiers.includes("High") || model.recommendedTiers.includes("Ultra High")))
                    );
                const fitLabel = model.fitLabel || "Recommended Fit";
                const tierBadge = getModelTierBadge(model);
                return (
                  <div key={`${model.id || section.group}:${model.filename}`} style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "14px", background: "var(--md-sys-color-surface-variant)", border: "1px solid var(--md-sys-color-outline-variant)", borderRadius: "var(--md-shape-corner-medium)" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      <span style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                        {model.name}
                        {tierBadge && (
                          <span style={{
                            fontSize: "0.68rem",
                            color: tierBadge.text,
                            background: tierBadge.bg,
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontWeight: "bold",
                            border: `1px solid ${tierBadge.border}`
                          }}>
                            {tierBadge.label}
                          </span>
                        )}
                        {isCompatible && (
                          <span title="Bilgisayarınıza uygun en verimli model (Uyumlu En Verimli Modelleri İndir ile alınır)" style={{
                            fontSize: "0.68rem",
                            color: "#fff",
                            background: "#10b981",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontWeight: "bold"
                          }}>En Verimli</span>
                        )}
                        {isRecommended && (
                          <span title={model.fitReason || `Recommended for ${systemTier} tier hardware`} style={{
                            fontSize: "0.68rem",
                            color: "#2e7d32",
                            background: "#e8f5e9",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontWeight: "bold",
                            border: "1px solid #c8e6c9"
                          }}>
                            [{fitLabel}]
                          </span>
                        )}
                        {model.isGated && (
                          <span title="Bu model Hugging Face üzerinde gated lisans altındadır. İndirmek için HF token gereklidir." style={{
                            fontSize: "0.68rem",
                            color: "#ca8a04",
                            background: "rgba(234, 179, 8, 0.15)",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontWeight: "bold",
                            border: "1px solid rgba(234, 179, 8, 0.4)",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "3px"
                          }}>
                            <KeyRound size={10} />
                            <span>Gated (Token)</span>
                          </span>
                        )}
                      </span>
                      <span style={{ fontSize: "0.75rem", color: "var(--md-sys-color-outline)" }}>
                        {model.format} {model.resolution && model.resolution !== "N/A" && ` ${model.resolution}`}
                      </span>
                      {model.size && model.size !== "Unknown" ? (
                        <span style={{ fontSize: "0.75rem", color: "var(--md-sys-color-on-surface-variant)", fontWeight: 600 }}>
                          File size: {model.size}
                        </span>
                      ) : model.approxSize ? (
                        <span style={{ fontSize: "0.75rem", color: "var(--md-sys-color-on-surface-variant)", fontWeight: 600 }}>
                          File size: approx. {model.approxSize}
                        </span>
                      ) : null}
                    </div>
                    <p style={{ fontSize: "0.78rem", color: "var(--md-sys-color-on-surface-variant)", lineHeight: 1.35, margin: 0 }}>
                      {model.notes}
                    </p>
                    {downloading && (
                      <div className="model-progress-section" style={{ marginTop: "2px" }}>
                        <div className="model-progress-label">
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                            <span className="loading-dot"></span>
                            Downloading
                          </span>
                          <span>{downloadProgress > 0 ? `${downloadProgress}%` : "Preparing"}</span>
                        </div>
                        <div className="model-progress-bar">
                          <div className="model-progress-fill" style={{ width: `${Math.min(100, Math.max(0, downloadProgress))}%`, transition: "width 0.2s ease" }}></div>
                        </div>
                        {downloadSpeed && (
                          <div style={{ fontSize: "0.7rem", color: "var(--md-sys-color-outline)", marginTop: "4px" }}>
                            {downloadSpeed}
                          </div>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      className={installed ? "m3-btn m3-btn-tonal" : isQueued ? "m3-btn m3-btn-outlined" : "m3-btn m3-btn-filled"}
                      style={{
                        height: "38px",
                        marginTop: "auto",
                        borderRadius: "10px",
                        fontWeight: 600,
                        ...(isQueued ? { borderColor: "var(--md-sys-color-primary)", color: "var(--md-sys-color-primary)", background: "rgba(59, 130, 246, 0.08)" } : {})
                      }}
                      onClick={() => {
                        if (isQueued) {
                          handleCancelQueued(queueItem);
                        } else {
                          handleLibraryDownload(model);
                        }
                      }}
                      disabled={installed || downloading || model.supported === false}
                      title={isQueued ? "Kuyruktan çıkarmak için tıklayın" : model.supported === false ? "Bu sürümde entegre değil" : ""}
                    >
                      {installed ? (
                        <HardDrive size={14} />
                      ) : downloading ? (
                        <RefreshCw className="progress-spinner" size={14} />
                      ) : isQueued ? (
                        <Clock size={14} />
                      ) : downloadingModelId ? (
                        <ListPlus size={14} />
                      ) : (
                        <DownloadCloud size={14} />
                      )}
                      <span>
                        {model.supported === false
                          ? "Bu sürümde entegre değil"
                          : installed
                          ? "İndirildi (Kullanıma Hazır)"
                          : downloading
                            ? `İndiriliyor (${downloadProgress > 0 ? downloadProgress + "%" : "..."})`
                            : isQueued
                              ? `Sırada (#${queueItem.position || (downloadQueue.indexOf(queueItem) + 1)}) [Kaldır]`
                              : needsProjector
                                ? "Görsel Dosyasını İndir"
                                : downloadingModelId
                                  ? "Kuyruğa Ekle"
                                  : model.isGated && !hasHfToken
                                    ? " Token Gerekli (İndir)"
                                    : "İndir (Download)"}
                      </span>
                    </button>
                    <a
                      href={model.pageUrl || model.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        alignSelf: "center",
                        color: "var(--md-sys-color-primary)",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        lineHeight: 1.2,
                        textDecoration: "none",
                      }}
                    >
                      {model.pageUrl ? "Hugging Face'de İncele" : "Tarayıcı Üzerinden Doğrudan İndir"}
                    </a>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {activeModelType === "text" && hasHuggingFaceResults && hasMoreModels && !isSearchingModels && (
          <button
            type="button"
            className="m3-btn m3-btn-tonal model-load-more"
            onClick={handleLoadMoreModels}
            disabled={isLoadingMoreModels}
          >
            {isLoadingMoreModels && <RefreshCw className="progress-spinner" size={16} />}
            <span>{isLoadingMoreModels ? "Loading more models..." : "Load More"}</span>
          </button>
        )}
      </div>

      {/* URL ile Model İndirme (Kütüphane Sekmesi İçinde) */}
      <div className="m3-card" style={{ marginTop: "24px", padding: "20px" }}>
        <h4 style={{ fontWeight: 600, marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
          <DownloadCloud size={16} />
          Download Model from URL
        </h4>
        <p style={{ fontSize: "0.75rem", color: "var(--md-sys-color-outline)", marginBottom: "12px" }}>
          Download any {activeModelType === "image" ? "Safetensors" : activeModelType === "text" ? "GGUF" : activeModelType === "speech" ? "Whisper .bin" : activeModelType === "video" ? "Wan 2.1 / AnimateDiff / LTX" : activeModelType === "music" ? "MusicGen / Stable Audio" : "Kokoro manifest"} model from Hugging Face directly to your models folder.
        </p>
        <form onSubmit={handleUrlDownloadSubmit} style={{ display: "flex", gap: "8px" }}>
          <input
            type="text"
            className="m3-input"
            style={{ flex: 1, height: "40px" }}
            placeholder="e.g. https://huggingface.co/..."
            value={downloadUrl}
            onChange={(e) => setDownloadUrl(e.target.value)}
          />
          <button
            type="submit"
            className="m3-btn m3-btn-filled"
            style={{ height: "40px" }}
          >
            {downloadingModelId ? "Kuyruğa Ekle" : "Download"}
          </button>
        </form>
      </div>
      </>
      )}

      {/* Yerel Model İçe Aktarma (Yalnızca Yerel Sekmesinde) */}
      {modelViewTab === "local" && (
        <>
          {/* Local Drag and Drop Importer */}
          <div className="workspace-title-section" style={{ marginTop: "32px", marginBottom: "16px" }}>
            <h3 className="m3-card-title">
              <FolderOpen size={20} style={{ color: "var(--md-sys-color-primary)" }} />
              Local Model Import
            </h3>
          </div>
      {/* Importing Progress Bar */}
      {importProgress !== null && (
        <div className="m3-card" style={{ borderLeft: "4px solid var(--md-sys-color-primary)", marginTop: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
            <h4 style={{ fontWeight: 600 }}>Copying Model to local folder: {importInfo.filename}</h4>
            <button className="m3-btn m3-btn-error" style={{ height: "34px", padding: "0 14px" }} onClick={handleCancelImport}>
              <Square size={14} />
              <span>Ice Aktarmayi Durdur</span>
            </button>
          </div>
          <div className="model-progress-section" style={{ margin: "12px 0 6px 0" }}>
            <div className="model-progress-label">
              <span>{importInfo.status} ({importInfo.speed} MB/s)</span>
              <span>{importProgress}% ({importInfo.eta}s remaining)</span>
            </div>
            <div className="model-progress-bar">
              <div className="model-progress-fill" style={{ width: `${importProgress}%`, transition: "width 0.15s ease" }}></div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "16px", marginTop: "16px" }}>
        <label className="import-box" style={{ margin: 0, height: "100%", justifyContent: "center" }}>
          <input
            type="file"
            style={{ display: "none" }}
            accept={activeModelType === "image" ? ".safetensors,.ckpt" : activeModelType === "text" ? ".gguf" : activeModelType === "speech" ? ".bin" : activeModelType === "video" ? ".safetensors,.gguf,.ckpt" : activeModelType === "music" ? ".safetensors,.pt,.bin,.pth" : ".json"}
            onChange={handleImportFile}
            disabled={importProgress !== null}
          />
          <FolderOpen className="import-icon" />
          <span style={{ fontWeight: 600 }}>Choose weights dosya</span>
          <span style={{ fontSize: "0.75rem", color: "var(--md-sys-color-outline)", textAlign: "center" }}>
            Select {activeModelType === "image" ? "`.safetensors` or `.ckpt` weights." : activeModelType === "text" ? "`.gguf` weights." : activeModelType === "speech" ? "`whisper.cpp .bin` weights." : activeModelType === "video" ? "`Wan 2.1 / AnimateDiff / LTX` weights." : activeModelType === "music" ? "`MusicGen / Stable Audio` weights." : "`Kokoro .json` manifest."}
          </span>
        </label>

        <div className="m3-card" style={{ display: "flex", flexDirection: "column", justifyContent: "center", margin: 0, padding: "20px" }}>
          <h4 style={{ fontWeight: 600, marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
            <DownloadCloud size={16} />
            Download Model from URL
          </h4>
          <p style={{ fontSize: "0.75rem", color: "var(--md-sys-color-outline)", marginBottom: "12px" }}>
            Download any {activeModelType === "image" ? "Safetensors" : activeModelType === "text" ? "GGUF" : activeModelType === "speech" ? "Whisper .bin" : activeModelType === "video" ? "Wan 2.1 / AnimateDiff / LTX" : activeModelType === "music" ? "MusicGen / Stable Audio" : "Kokoro manifest"} model from Hugging Face directly to your models folder.
          </p>
          <form onSubmit={handleUrlDownloadSubmit} style={{ display: "flex", gap: "8px" }}>
            <input
              type="text"
              className="m3-input"
              style={{ flex: 1, height: "40px" }}
              placeholder="e.g. https://huggingface.co/..."
              value={downloadUrl}
              onChange={(e) => setDownloadUrl(e.target.value)}
            />
            <button
              type="submit"
              className="m3-btn m3-btn-filled"
              style={{ height: "40px" }}
            >
              {downloadingModelId ? "Kuyruğa Ekle" : "Download"}
            </button>
          </form>
        </div>
      </div>
      </>
      )}

      {pendingLoadModel && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
          <div className="m3-card" style={{ maxWidth: "460px", width: "100%", margin: 0, border: "1px solid var(--md-sys-color-outline-variant)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
              <AlertTriangle size={22} style={{ color: "var(--md-sys-color-error)" }} />
              <h3 style={{ fontSize: "1.05rem", fontWeight: 700 }}>Model Already Aktif</h3>
            </div>
            <p style={{ fontSize: "0.9rem", color: "var(--md-sys-color-on-surface-variant)", lineHeight: 1.45, marginBottom: "16px" }}>
              "{pendingLoadModel.activeRuntime?.model}" is already loaded as a {pendingLoadModel.activeRuntime?.label || "model"} model. Unload it before loading "{pendingLoadModel.modelId}" as a {getModelTypeLabel(pendingLoadModel.targetType)} model.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button className="m3-btn m3-btn-outlined" onClick={() => setPendingLoadModel(null)} disabled={isUnloading}>
                Cancel
              </button>
              <button className="m3-btn m3-btn-error" onClick={handleUnloadPendingOnly} disabled={isUnloading}>
                <Trash2 size={14} />
                <span>Kaldir</span>
              </button>
              <button className="m3-btn m3-btn-filled" onClick={handleUnloadThenLoad} disabled={isUnloading}>
                {isUnloading ? <RefreshCw className="progress-spinner" size={14} /> : <RefreshCw size={14} />}
                <span>Kaldir ve Yukle</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {vramWarning && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
          <div className="m3-card" style={{ maxWidth: "480px", width: "100%", margin: 0, padding: "24px", border: "1px solid var(--md-sys-color-error)", boxShadow: "0 8px 32px rgba(0, 0, 0, 0.45)", background: "var(--md-sys-color-surface)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
              <AlertTriangle size={28} style={{ color: "var(--md-sys-color-error)" }} />
              <h3 style={{ fontSize: "1.2rem", fontWeight: 700, margin: 0, color: "var(--md-sys-color-on-surface)" }}>VRAM Limit Exceeded</h3>
            </div>
            <p style={{ fontSize: "0.92rem", color: "var(--md-sys-color-on-surface-variant)", lineHeight: 1.5, marginBottom: "20px", margin: 0 }}>
              The model <strong style={{ color: "var(--md-sys-color-on-surface)" }}>{vramWarning.modelId}</strong> is approximately <strong>{vramWarning.modelSizeGb.toFixed(1)} GB</strong>, which exceeds your currently available GPU VRAM of <strong>{vramWarning.freeVramGb.toFixed(1)} GB free</strong> (out of {vramWarning.totalVramGb.toFixed(1)} GB total).
              <br /><br />
              Loading this model on your GPU may fail, crash the backend, or cause extremely slow generation due to memory spilling.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", flexWrap: "wrap" }}>
              <button
                className="m3-btn m3-btn-outlined"
                onClick={() => setVramWarning(null)}
              >
                Cancel
              </button>
              <button
                className="m3-btn m3-btn-tonal"
                style={{ borderColor: "var(--md-sys-color-primary)", color: "var(--md-sys-color-primary)" }}
                onClick={async () => {
                  const targetModel = vramWarning.modelId;
                  setVramWarning(null);
                  if (setConstraints) {
                    setConstraints((prev) => ({
                      ...prev,
                      backendType: "cpu",
                      useGpu: false,
                    }));
                  }
                  const cpuConstraints = {
                    ...constraints,
                    backendType: "cpu",
                    useGpu: false,
                  };
                  await performLoadModel(targetModel, cpuConstraints);
                }}
              >
                Load on CPU
              </button>
              <button
                className="m3-btn m3-btn-error"
                onClick={async () => {
                  const targetModel = vramWarning.modelId;
                  setVramWarning(null);
                  await performLoadModel(targetModel);
                }}
              >
                Proceed anyway (GPU)
              </button>
            </div>
          </div>
        </div>
      )}

      {/*  HUGGING FACE GATED MODEL & TOKEN YÖNERGE MODALI */}
      {showGatedModal && (
        <div style={{
          position: "fixed",
          inset: 0,
          zIndex: 100,
          background: "rgba(0, 0, 0, 0.72)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
          animation: "fadeIn 0.2s ease-out"
        }}>
          <div className="m3-card" style={{
            maxWidth: "620px",
            width: "100%",
            margin: 0,
            padding: "26px",
            background: "var(--glass-bg, rgba(24, 24, 30, 0.96))",
            border: "1.5px solid rgba(234, 179, 8, 0.45)",
            boxShadow: "0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(234, 179, 8, 0.15)",
            borderRadius: "20px",
            maxHeight: "90vh",
            overflowY: "auto"
          }}>
            {/* Modal Başlığı */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{
                  width: "42px",
                  height: "42px",
                  borderRadius: "12px",
                  background: "rgba(234, 179, 8, 0.15)",
                  border: "1px solid rgba(234, 179, 8, 0.4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#facc15"
                }}>
                  <KeyRound size={22} />
                </div>
                <div>
                  <h3 style={{ fontSize: "1.12rem", fontWeight: 700, margin: 0, color: "var(--md-sys-color-on-surface)" }}>
                    Hugging Face Erişim Tokeni & Gated Model İzni
                  </h3>
                  <div style={{ fontSize: "0.78rem", color: "var(--md-sys-color-outline)", marginTop: "2px" }}>
                    Özel lisanslı veya onay gerektiren modeller için kimlik doğrulama
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="m3-btn m3-btn-icon"
                onClick={() => setShowGatedModal(false)}
                style={{ width: "34px", height: "34px", borderRadius: "8px", border: "none", background: "rgba(255,255,255,0.06)" }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Model Bilgisi (Varsa) */}
            {gatedModalModel && (
              <div style={{
                background: "rgba(59, 130, 246, 0.1)",
                border: "1px solid rgba(59, 130, 246, 0.25)",
                borderRadius: "12px",
                padding: "12px 14px",
                marginBottom: "16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
                flexWrap: "wrap"
              }}>
                <div>
                  <div style={{ fontSize: "0.72rem", textTransform: "uppercase", fontWeight: 700, color: "#60a5fa", letterSpacing: "0.04em" }}>
                    İstenen Model
                  </div>
                  <div style={{ fontSize: "0.92rem", fontWeight: 700, color: "#ffffff", marginTop: "2px" }}>
                    {gatedModalModel.name || gatedModalModel.filename}
                  </div>
                </div>
                {gatedModalModel.pageUrl && (
                  <a
                    href={gatedModalModel.pageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="m3-btn m3-btn-outlined"
                    style={{
                      height: "32px",
                      padding: "0 10px",
                      fontSize: "0.76rem",
                      borderColor: "rgba(59, 130, 246, 0.5)",
                      color: "#93c5fd",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      textDecoration: "none",
                      whiteSpace: "nowrap"
                    }}
                  >
                    <span>Model Sayfasını Aç</span>
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            )}

            {/* 3 Adımlı Yönerge */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "18px" }}>
              <div style={{
                background: "rgba(255, 255, 255, 0.03)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: "12px",
                padding: "12px 14px"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", fontWeight: 700, fontSize: "0.85rem", color: "#facc15" }}>
                  <span style={{
                    width: "22px",
                    height: "22px",
                    borderRadius: "50%",
                    background: "rgba(234, 179, 8, 0.2)",
                    border: "1px solid rgba(234, 179, 8, 0.5)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.75rem",
                    flexShrink: 0
                  }}>1</span>
                  <span>Model Lisans Şartlarını Kabul Edin (Tarayıcıda)</span>
                </div>
                <p style={{ fontSize: "0.8rem", color: "var(--md-sys-color-on-surface-variant)", margin: "6px 0 0 32px", lineHeight: 1.45 }}>
                  Stability AI (ör. Stable Audio) gibi gated modeller lisans onayına tabidir. Hugging Face hesabınızla oturum açıp model sayfasındaki <strong>"Acknowledge license / Accept conditions"</strong> butonuna tıklayarak erişim izni alın.
                </p>
              </div>

              <div style={{
                background: "rgba(255, 255, 255, 0.03)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: "12px",
                padding: "12px 14px"
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", fontWeight: 700, fontSize: "0.85rem", color: "#facc15" }}>
                    <span style={{
                      width: "22px",
                      height: "22px",
                      borderRadius: "50%",
                      background: "rgba(234, 179, 8, 0.2)",
                      border: "1px solid rgba(234, 179, 8, 0.5)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.75rem",
                      flexShrink: 0
                    }}>2</span>
                    <span>Hugging Face Access Token Alın</span>
                  </div>
                  <a
                    href="https://huggingface.co/settings/tokens"
                    target="_blank"
                    rel="noreferrer"
                    className="m3-btn m3-btn-outlined"
                    style={{
                      height: "28px",
                      padding: "0 10px",
                      fontSize: "0.74rem",
                      borderColor: "rgba(234, 179, 8, 0.4)",
                      color: "#fde047",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                      textDecoration: "none"
                    }}
                  >
                    <span>Token Sayfasına Git</span>
                    <ExternalLink size={12} />
                  </a>
                </div>
                <p style={{ fontSize: "0.8rem", color: "var(--md-sys-color-on-surface-variant)", margin: "6px 0 0 32px", lineHeight: 1.45 }}>
                  Hugging Face profil ayarlarınızdan <strong>"Create new token"</strong> diyerek ücretsiz bir <strong>"Read"</strong> yetkili token oluşturun ve kopyalayın.
                </p>
              </div>

              <div style={{
                background: "rgba(255, 255, 255, 0.03)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: "12px",
                padding: "12px 14px"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", fontWeight: 700, fontSize: "0.85rem", color: "#facc15" }}>
                  <span style={{
                    width: "22px",
                    height: "22px",
                    borderRadius: "50%",
                    background: "rgba(234, 179, 8, 0.2)",
                    border: "1px solid rgba(234, 179, 8, 0.5)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.75rem",
                    flexShrink: 0
                  }}>3</span>
                  <span>Tokeninizi Aşağıya Yapıştırın ve Kaydedin</span>
                </div>
                <p style={{ fontSize: "0.8rem", color: "var(--md-sys-color-on-surface-variant)", margin: "6px 0 0 32px", lineHeight: 1.45 }}>
                  Tokeniniz yerel olarak stüdyo yapılandırmanıza kaydedilir. İndirme doğrudan stüdyo üzerinden kimlik doğrulamalı olarak devam edecektir.
                </p>
              </div>
            </div>

            {/* Token Durumu ve Giriş Formu */}
            <div style={{ marginBottom: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <label style={{ fontSize: "0.84rem", fontWeight: 700, color: "var(--md-sys-color-on-surface)" }}>
                  Hugging Face Access Token (hf_...)
                </label>
                {hasHfToken && (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      fontSize: "0.72rem",
                      color: "#4ade80",
                      background: "rgba(34, 197, 94, 0.12)",
                      padding: "2px 8px",
                      borderRadius: "6px",
                      fontWeight: 600
                    }}>
                      <ShieldCheck size={12} />
                      <span>Aktif: {hfTokenPreview}</span>
                    </span>
                    <button
                      type="button"
                      onClick={handleDeleteHfToken}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "#ef4444",
                        fontSize: "0.72rem",
                        cursor: "pointer",
                        textDecoration: "underline",
                        padding: 0
                      }}
                    >
                      Kaldır
                    </button>
                  </div>
                )}
              </div>

              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <input
                  type={showHfTokenText ? "text" : "password"}
                  className="m3-input"
                  style={{
                    width: "100%",
                    height: "44px",
                    borderRadius: "10px",
                    paddingRight: "44px",
                    fontFamily: "monospace",
                    fontSize: "0.88rem",
                    borderColor: hasHfToken ? "rgba(34, 197, 94, 0.4)" : "rgba(234, 179, 8, 0.4)"
                  }}
                  placeholder="hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={hfTokenInput}
                  onChange={(e) => setHfTokenInput(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowHfTokenText(!showHfTokenText)}
                  style={{
                    position: "absolute",
                    right: "10px",
                    background: "none",
                    border: "none",
                    color: "var(--md-sys-color-outline)",
                    cursor: "pointer",
                    padding: "6px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                  title={showHfTokenText ? "Gizle" : "Göster"}
                >
                  {showHfTokenText ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Aksiyon Butonları */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", flexWrap: "wrap" }}>
              <button
                type="button"
                className="m3-btn m3-btn-outlined"
                onClick={() => setShowGatedModal(false)}
                style={{ height: "40px", padding: "0 18px", borderRadius: "10px" }}
              >
                Kapat
              </button>

              <button
                type="button"
                className="m3-btn m3-btn-tonal"
                onClick={() => handleSaveHfToken(false)}
                disabled={isSavingHfToken || !hfTokenInput.trim()}
                style={{ height: "40px", padding: "0 18px", borderRadius: "10px", fontWeight: 600 }}
              >
                {isSavingHfToken ? <RefreshCw className="progress-spinner" size={16} /> : <CheckCircle2 size={16} />}
                <span>Yalnızca Kaydet</span>
              </button>

              {gatedModalModel && (
                <button
                  type="button"
                  className="m3-btn m3-btn-filled"
                  onClick={() => handleSaveHfToken(true)}
                  disabled={isSavingHfToken || !hfTokenInput.trim()}
                  style={{
                    height: "40px",
                    padding: "0 20px",
                    borderRadius: "10px",
                    fontWeight: 700,
                    background: "#eab308",
                    color: "#000000",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px"
                  }}
                >
                  {isSavingHfToken ? <RefreshCw className="progress-spinner" size={16} /> : <DownloadCloud size={16} />}
                  <span>Tokeni Kaydet & İndirmeyi Başlat</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Donanım İçin Uyumlu Modeller Seçim Modalı */}
      {showCompatibleModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 110,
            background: "rgba(0,0,0,0.72)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px"
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCompatibleModal(false);
          }}
        >
          <div
            className="m3-card"
            style={{
              maxWidth: "840px",
              width: "100%",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              margin: 0,
              padding: "24px",
              border: "1px solid var(--md-sys-color-outline-variant)",
              boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
              background: "var(--md-sys-color-surface)",
              overflow: "hidden"
            }}
          >
            {/* Modal Header */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", marginBottom: "14px" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <h3 style={{ fontSize: "1.2rem", fontWeight: 700, margin: 0, color: "var(--md-sys-color-on-surface)" }}>
                    Donanımınız İçin Uyumlu ve En Verimli Modeller
                  </h3>
                  <span
                    style={{
                      background: "var(--md-sys-color-primary-container)",
                      color: "var(--md-sys-color-on-primary-container)",
                      fontSize: "0.74rem",
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: "6px",
                      textTransform: "uppercase"
                    }}
                  >
                    VRAM: {compatibleVram} GB • {compatibleTier || "Donanım"} Seviyesi
                  </span>
                </div>
                <p style={{ fontSize: "0.83rem", color: "var(--md-sys-color-on-surface-variant)", marginTop: "6px", marginBottom: 0, lineHeight: 1.45 }}>
                  Bu modeller sisteminizin GPU ve RAM mimarisine göre en verimli, kararlı ve hızlı çalışacak şekilde belirlenmiştir. İndirmek istemediğiniz modellerin tikini kaldırabilirsiniz.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowCompatibleModal(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--md-sys-color-outline)",
                  cursor: "pointer",
                  padding: "4px"
                }}
                title="Kapat"
              >
                <X size={20} />
              </button>
            </div>

            {/* Hızlı Seçim ve Filtreleme Butonları */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "10px",
                padding: "10px 14px",
                background: "var(--md-sys-color-surface-container-high)",
                borderRadius: "10px",
                marginBottom: "14px",
                fontSize: "0.82rem"
              }}
            >
              <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="m3-btn m3-btn-tonal"
                  style={{ height: "30px", padding: "0 12px", fontSize: "0.78rem" }}
                  onClick={() => handleSelectAllCompatible(true)}
                >
                  Tümünü Seç
                </button>
                <button
                  type="button"
                  className="m3-btn m3-btn-outlined"
                  style={{ height: "30px", padding: "0 12px", fontSize: "0.78rem" }}
                  onClick={() => handleSelectAllCompatible(false)}
                >
                  Seçimi Temizle
                </button>
                <button
                  type="button"
                  className="m3-btn m3-btn-outlined"
                  style={{ height: "30px", padding: "0 12px", fontSize: "0.78rem" }}
                  onClick={() => {
                    const next = {};
                    for (const m of compatibleModels) {
                      next[m.filename || m.kind] = !m.installed;
                    }
                    setSelectedCompatibleModels(next);
                  }}
                >
                  Sadece Eksikleri Seç
                </button>
              </div>

              <div style={{ fontWeight: 600, color: "var(--md-sys-color-primary)" }}>
                {compatibleModels.filter(m => selectedCompatibleModels[m.filename || m.kind]).length} / {compatibleModels.length} Model Seçili
              </div>
            </div>

            {/* Kaydırılabilir Model Listesi */}
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px", paddingRight: "4px", marginBottom: "16px" }}>
              {compatibleModels.map((m, idx) => {
                const key = m.filename || m.kind;
                const isChecked = Boolean(selectedCompatibleModels[key]);

                return (
                  <div
                    key={idx}
                    onClick={() => toggleSelectCompatibleModel(key)}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "14px",
                      padding: "12px 14px",
                      borderRadius: "10px",
                      background: isChecked ? "var(--md-sys-color-surface-container-highest)" : "var(--md-sys-color-surface-container)",
                      border: isChecked ? "1.5px solid var(--md-sys-color-primary)" : "1px solid var(--md-sys-color-outline-variant)",
                      cursor: "pointer",
                      transition: "all 0.15s ease"
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {}}
                      style={{
                        marginTop: "4px",
                        width: "18px",
                        height: "18px",
                        accentColor: "var(--md-sys-color-primary)",
                        cursor: "pointer"
                      }}
                    />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", marginBottom: "4px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                          <span
                            style={{
                              background: "var(--md-sys-color-primary)",
                              color: "#fff",
                              fontSize: "0.7rem",
                              fontWeight: 700,
                              padding: "2px 8px",
                              borderRadius: "999px"
                            }}
                          >
                            {m.domainLabel || m.kind}
                          </span>
                          <strong style={{ fontSize: "0.9rem", color: "var(--md-sys-color-on-surface)" }}>
                            {m.name}
                          </strong>
                          {m.approxSize && (
                            <span style={{ fontSize: "0.76rem", opacity: 0.75, fontFamily: "monospace" }}>
                              ({m.approxSize})
                            </span>
                          )}
                        </div>

                        <div>
                          {m.installed ? (
                            <span style={{ fontSize: "0.74rem", fontWeight: 700, color: "#10b981", background: "rgba(16, 185, 129, 0.12)", padding: "2px 8px", borderRadius: "6px" }}>
                              Zaten Yüklü
                            </span>
                          ) : (
                            <span style={{ fontSize: "0.74rem", fontWeight: 600, color: "var(--md-sys-color-outline)" }}>
                              İndirilecek
                            </span>
                          )}
                        </div>
                      </div>

                      <div style={{ fontSize: "0.8rem", color: "var(--md-sys-color-on-surface-variant)", lineHeight: 1.4, marginTop: "4px" }}>
                        <strong>Neden Tavsiye Ediliyor:</strong> {m.reason}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Modal Footer */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px", borderTop: "1px solid var(--border-color)", paddingTop: "14px" }}>
              <button
                type="button"
                className="m3-btn m3-btn-outlined"
                onClick={() => setShowCompatibleModal(false)}
                style={{ height: "40px", padding: "0 18px", borderRadius: "10px" }}
              >
                Vazgeç
              </button>

              <button
                type="button"
                className="m3-btn m3-btn-filled"
                disabled={compatibleModels.filter(m => selectedCompatibleModels[m.filename || m.kind]).length === 0}
                onClick={handleDownloadSelectedModels}
                style={{
                  height: "40px",
                  padding: "0 22px",
                  borderRadius: "10px",
                  fontWeight: 700,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px"
                }}
              >
                <DownloadCloud size={18} />
                <span>
                  Seçilen Modelleri İndir ({compatibleModels.filter(m => selectedCompatibleModels[m.filename || m.kind]).length} Model)
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(ModelManager);
