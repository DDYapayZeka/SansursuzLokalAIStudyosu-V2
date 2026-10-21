import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { uiText } from "../i18n";
import {
  FileAudio,
  Film,
  LoaderCircle,
  Mic,
  Play,
  RefreshCw,
  Save,
  Sparkles,
  Square,
  Subtitles,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import {
  getSpeechStatus,
  listSpeechModels,
  speakTts,
  startSpeech,
  stopSpeech,
  transcribeSpeech,
} from "../services/api";

const LANGUAGE_OPTIONS = [
  { value: "auto", label: "Otomatik Algıla (Auto Detect)" },
  { value: "tr", label: "Türkçe (Turkish)" },
  { value: "en", label: "İngilizce (English)" },
  { value: "de", label: "Almanca (German)" },
  { value: "fr", label: "Fransızca (French)" },
  { value: "es", label: "İspanyolca (Spanish)" },
  { value: "it", label: "İtalyanca (Italian)" },
  { value: "ru", label: "Rusça (Russian)" },
  { value: "ar", label: "Arapça (Arabic)" },
  { value: "ja", label: "Japonca (Japanese)" },
  { value: "ko", label: "Korece (Korean)" },
  { value: "zh", label: "Çince (Chinese)" },
];

const CAPTION_STYLES = [
  { id: "karaoke", label: "Karaoke (Kelime Vurgulu)" },
  { id: "glass", label: "Buzlu Cam (Apple Frosted Glass)" },
  { id: "pop", label: "Pop Vurgu (Reels / Shorts)" },
  { id: "box", label: "Dolgu Kutu (Aktif Kelime Kutulu)" },
  { id: "classic", label: "Klasik Sinema (Alt Merkez)" },
];

const VIDEO_RATIOS = [
  { id: "16:9", label: "16:9 Yatay (YouTube - 1280×720)", width: 1280, height: 720 },
  { id: "9:16", label: "9:16 Dikey (Reels / Shorts - 720×1280)", width: 720, height: 1280 },
  { id: "1:1", label: "1:1 Kare (Sosyal Medya - 720×720)", width: 720, height: 720 },
];

const AURA_THEMES = [
  { id: "violet", label: "Kuantum Mor & Siyan Aurası", primary: "#8b5cf6", secondary: "#06b6d4", bg1: "#090a14", bg2: "#161936" },
  { id: "emerald", label: "Zümrüt & Altın Frekans Aurası", primary: "#10b981", secondary: "#f59e0b", bg1: "#06120e", bg2: "#0d2820" },
  { id: "crimson", label: "Kızıl & Kehribar Stüdyo Aurası", primary: "#f43f5e", secondary: "#fb923c", bg1: "#14080c", bg2: "#2c1018" },
  { id: "midnight", label: "Obsidyen Minimalist Karanlık", primary: "#3b82f6", secondary: "#a855f7", bg1: "#05060a", bg2: "#0f131f" },
];

const DUBBING_TTS_MODELS = [
  { id: "ahenk-cep.json", label: "Ahenk Cep Türkçe (48kHz - kadın sesi, nötr üslup)", voice: "ahenk_neutral" },
  { id: "antalia-mini.json", label: "Antalia-2 Mini Türkçe (48kHz Doğal Erkek)", voice: "antalia_dogal" },
  { id: "ema-lightning.json", label: "EMA Lightning Türkçe (48kHz Doğal Kadın)", voice: "ema_kadin" },
  { id: "supertonic-3.json", label: "Supertone Supertonic-3 (44.1kHz Çoklu Ses)", voice: "M1" },
];

// --- Harfiyen Türkçe Akıllı İmla, Noktalama, Özel Ad Kesme İşareti & TDK Sayı Biçimlendirici ---
const TURKISH_ABBREVIATIONS = [
  "TBMM", "TÜBİTAK", "THY", "TRT", "SGK", "TCK", "BDDK", "YÖK", "ÖSYM",
  "İTÜ", "ODTÜ", "YTÜ", "KTÜ", "AB", "ABD", "BM", "NATO", "KDV", "ÖTV", "TL", "TV", "AI"
];

const TURKISH_PROPER_NOUNS = [
  ["türkiye", "Türkiye"],
  ["istanbul", "İstanbul"],
  ["ankara", "Ankara"],
  ["izmir", "İzmir"],
  ["bursa", "Bursa"],
  ["antalya", "Antalya"],
  ["adana", "Adana"],
  ["konya", "Konya"],
  ["gaziantep", "Gaziantep"],
  ["trabzon", "Trabzon"],
  ["samsun", "Samsun"],
  ["eskişehir", "Eskişehir"],
  ["diyarbakır", "Diyarbakır"],
  ["kayseri", "Kayseri"],
  ["mersin", "Mersin"],
  ["erzurum", "Erzurum"],
  ["malatya", "Malatya"],
  ["çanakkale", "Çanakkale"],
  ["muğla", "Muğla"],
  ["aydın", "Aydın"],
  ["balıkesir", "Balıkesir"],
  ["sakarya", "Sakarya"],
  ["kocaeli", "Kocaeli"],
  ["avrupa", "Avrupa"],
  ["asya", "Asya"],
  ["almanya", "Almanya"],
  ["ingiltere", "İngiltere"],
  ["fransa", "Fransa"],
  ["rusya", "Rusya"],
  ["azerbaycan", "Azerbaycan"],
  ["atatürk", "Atatürk"],
  ["cumhuriyet", "Cumhuriyet"],
  ["boğaziçi", "Boğaziçi"],
  ["anadolu", "Anadolu"],
  ["karadeniz", "Karadeniz"],
  ["akdeniz", "Akdeniz"],
  ["marmara", "Marmara"],
];

const TURKISH_CASE_SUFFIXES = "(da|de|ta|te|dan|den|tan|ten|a|e|ya|ye|ı|i|u|ü|yi|yı|yu|yü|in|ın|un|ün|nin|nın|nun|nün|nda|nde|ndan|nden|na|ne|la|le|yla|yle|ki|li|lı|lu|lü|dır|dir|dur|dür|tır|tir|tur|tür)";

// JavaScript's \b only knows ASCII letters, so words starting/ending with ç, ğ, ı, ö, ş, ü never matched.
// These Unicode-aware boundaries are used with the "u" flag instead.
const WORD_START = "(?<![\\p{L}\\p{N}])";
const WORD_END = "(?![\\p{L}\\p{N}])";

function capitalizeTr(str) {
  if (!str) return "";
  return str.charAt(0).toLocaleUpperCase("tr-TR") + str.slice(1);
}

export function applyHarfiyenTurkishFormatting(rawText) {
  if (!rawText || !rawText.trim()) return rawText;

  const lines = rawText.split("\n");
  const formattedLines = lines.map((line) => {
    let trimmed = line.trim();
    if (!trimmed) return "";

    let tsPrefix = "";
    const tsMatch = trimmed.match(/^(\[[^\]]+\]\s*)(.*)$/);
    if (tsMatch) {
      tsPrefix = tsMatch[1];
      trimmed = tsMatch[2].trim();
    }
    if (!trimmed) return tsPrefix.trim();

    let s = trimmed.replace(/\s+/g, " ");

    // 1. TDK Yüzde ve Saat Biçimlendirme
    s = s.replace(/(?<![\p{L}\p{N}])yüzde\s+(\d+(?:[.,]\d+)?)(?![\p{L}\p{N}])/giu, "%$1");
    s = s.replace(/\bsaat\s+(\d{1,2})\s+(\d{2})\s*'?\s*(da|de|ta|te|a|e|ya|ye|dan|den|tan|ten)\b/gi, "saat $1.$2'$3");
    s = s.replace(/\bsaat\s+(\d{1,2})\s+(\d{2})\b/gi, "saat $1.$2");

    // 2. Kurum Kısaltmalarına Kesme İşareti ('TBMM'de', 'TÜBİTAK'ın' vb.)
    for (const abbr of TURKISH_ABBREVIATIONS) {
      const re = new RegExp(`${WORD_START}${abbr.toLocaleLowerCase("tr-TR")}'?${TURKISH_CASE_SUFFIXES}${WORD_END}`, "giu");
      s = s.replace(re, (_, suffix) => `${abbr}'${suffix.toLocaleLowerCase("tr-TR")}`);
      const exactRe = new RegExp(`${WORD_START}${abbr.toLocaleLowerCase("tr-TR")}${WORD_END}`, "giu");
      s = s.replace(exactRe, abbr);
    }

    // 3. Özel İsimler ve Şehir/Ülke Adlarına Kesme İşareti ('İstanbul'da', 'Türkiye'nin' vb.)
    for (const [lowerRoot, properRoot] of TURKISH_PROPER_NOUNS) {
      const suffixRe = new RegExp(`${WORD_START}${lowerRoot}'?${TURKISH_CASE_SUFFIXES}${WORD_END}`, "giu");
      s = s.replace(suffixRe, (_, suffix) => `${properRoot}'${suffix.toLocaleLowerCase("tr-TR")}`);
      const rootRe = new RegExp(`${WORD_START}${lowerRoot}${WORD_END}`, "giu");
      s = s.replace(rootRe, properRoot);
    }

    // 4. Bağlaçlardan Önce Virgül Ekleme
    s = s.replace(/\s+(ama|fakat|lakin|ancak|çünkü|yani|örneğin|mesela|üstelik|böylece|dolayısıyla)(?![\p{L}\p{N}])/giu, (match, conj, offset) => {
      if (offset < 4) return match;
      const before = s.slice(0, offset).trimEnd();
      if (/[,.;:?!]$/.test(before)) return ` ${conj.toLocaleLowerCase("tr-TR")}`;
      return `, ${conj.toLocaleLowerCase("tr-TR")}`;
    });

    // 5. Cümle Başı Büyük Harf
    s = capitalizeTr(s);
    s = s.replace(/([.?!]\s+)([a-zçğıöşü])/g, (_, punct, ch) => punct + ch.toLocaleUpperCase("tr-TR"));

    // 6. Cümle Sonu Noktalama (Soru Edatı / Soru Kelimesi Algılama)
    if (!/[.?!…:;]$/.test(s)) {
      const lowerS = s.toLocaleLowerCase("tr-TR");
      const isQuestion =
        /(?<![\p{L}\p{N}])(mi|mı|mu|mü|misin|mısın|musun|müsün|misiniz|mısınız|musunuz|müsünüz|miyim|mıyım|muyum|müyüm|miyiz|mıyız|muyuz|müyüz|midir|mıdır|mudur|müdür)(?![\p{L}\p{N}])/u.test(lowerS) ||
        /(?<![\p{L}\p{N}])(neden|nasıl|niçin|nerede|nereye|nereden|ne zaman|kaç|hangisi|kim|kimin)(?![\p{L}\p{N}])/u.test(lowerS);
      s += isQuestion ? "?" : ".";
    }

    return tsPrefix + s;
  });

  return formattedLines.join("\n");
}

function flattenFloat32(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    merged.set(chunk, offset);
    offset += chunk.length;
  });
  return merged;
}

function resampleLinear(input, sourceRate, targetRate) {
  if (sourceRate === targetRate) return input;
  const ratio = sourceRate / targetRate;
  const newLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(newLength);
  for (let i = 0; i < newLength; i += 1) {
    const src = i * ratio;
    const left = Math.floor(src);
    const right = Math.min(input.length - 1, left + 1);
    const weight = src - left;
    output[i] = input[left] * (1 - weight) + input[right] * weight;
  }
  return output;
}

function encodeWavPcm16(samples, sampleRate = 16000) {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  const writeString = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1, offset += 2) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([view], { type: "audio/wav" });
}

function downloadBlob(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function parseTimestampToSeconds(tsStr) {
  if (!tsStr || typeof tsStr !== "string") return 0;
  const clean = tsStr.trim().replace(",", ".");
  const parts = clean.split(":");
  if (parts.length === 3) {
    return (parseFloat(parts[0]) || 0) * 3600 + (parseFloat(parts[1]) || 0) * 60 + (parseFloat(parts[2]) || 0);
  }
  if (parts.length === 2) {
    return (parseFloat(parts[0]) || 0) * 60 + (parseFloat(parts[1]) || 0);
  }
  return parseFloat(clean) || 0;
}

function formatSecondsToSrt(sec, useDot = false) {
  const safe = Math.max(0, Number(sec) || 0);
  const hr = Math.floor(safe / 3600);
  const mi = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  const sep = useDot ? "." : ",";
  return `${String(hr).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(s).padStart(2, "0")}${sep}${String(Math.min(999, ms)).padStart(3, "0")}`;
}

function normalizeTimestamp(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const from = value.match(/from=([^;},]+)/)?.[1];
    const to = value.match(/to=([^;},]+)/)?.[1];
    return from && to ? `${from} - ${to}` : value;
  }
  if (typeof value === "object" && value.from && value.to) {
    return `${value.from} - ${value.to}`;
  }
  return "";
}

function extractTimedSegments(transcription, fallbackText, totalDurationSec = 10, autoFormat = true) {
  const rawSegments = transcription?.raw?.transcription;
  if (Array.isArray(rawSegments) && rawSegments.length > 0) {
    const parsed = rawSegments
      .map((seg, idx) => {
        let rawLine = String(seg.text || "").trim();
        if (!rawLine) return null;
        if (autoFormat) rawLine = applyHarfiyenTurkishFormatting(rawLine);
        let startSec = 0;
        let endSec = 0;
        if (seg.offsets && typeof seg.offsets.from === "number") {
          startSec = seg.offsets.from / 1000;
          endSec = seg.offsets.to / 1000;
        } else if (seg.timestamps) {
          const fromStr = typeof seg.timestamps === "object" ? seg.timestamps.from : seg.timestamps;
          const toStr = typeof seg.timestamps === "object" ? seg.timestamps.to : "";
          startSec = parseTimestampToSeconds(fromStr);
          endSec = parseTimestampToSeconds(toStr);
        }
        if (endSec <= startSec) {
          startSec = (idx / rawSegments.length) * totalDurationSec;
          endSec = ((idx + 1) / rawSegments.length) * totalDurationSec;
        }
        const words = rawLine.split(/\s+/).filter(Boolean);
        return {
          start: startSec,
          end: endSec,
          text: rawLine,
          words: words.map((w, wIdx) => ({
            word: w,
            start: startSec + (wIdx / Math.max(1, words.length)) * (endSec - startSec),
            end: startSec + ((wIdx + 1) / Math.max(1, words.length)) * (endSec - startSec),
          })),
        };
      })
      .filter(Boolean);

    if (parsed.length > 0) return parsed;
  }

  const cleanText = String(fallbackText || transcription?.text || "")
    .replace(/\[[^\]]+\]\s*/g, "")
    .trim();
  if (!cleanText) return [];

  const allWords = cleanText.split(/\s+/).filter(Boolean);
  const chunkSize = 6;
  const chunks = [];
  for (let i = 0; i < allWords.length; i += chunkSize) {
    chunks.push(allWords.slice(i, i + chunkSize));
  }
  const dur = Math.max(2, totalDurationSec || 10);
  let wordCursor = 0;
  return chunks.map((ch) => {
    const startSec = (wordCursor / Math.max(1, allWords.length)) * dur;
    const endSec = ((wordCursor + ch.length) / Math.max(1, allWords.length)) * dur;
    wordCursor += ch.length;
    const lineText = ch.join(" ");
    return {
      start: startSec,
      end: endSec,
      text: lineText,
      words: ch.map((w, wIdx) => ({
        word: w,
        start: startSec + (wIdx / Math.max(1, ch.length)) * (endSec - startSec),
        end: startSec + ((wIdx + 1) / Math.max(1, ch.length)) * (endSec - startSec),
      })),
    };
  });
}

function buildSrtContent(segments) {
  return segments
    .map((seg, i) => `${i + 1}\n${formatSecondsToSrt(seg.start, false)} --> ${formatSecondsToSrt(seg.end, false)}\n${seg.text}\n`)
    .join("\n");
}

function buildVttContent(segments) {
  const body = segments
    .map((seg, i) => `${i + 1}\n${formatSecondsToSrt(seg.start, true)} --> ${formatSecondsToSrt(seg.end, true)}\n${seg.text}\n`)
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

function formatTranscriptText(transcription, showTimestamps, autoFormat = true) {
  const segments = transcription?.raw?.transcription;
  if (!Array.isArray(segments) || segments.length === 0) {
    const raw = transcription?.text || "";
    return autoFormat ? applyHarfiyenTurkishFormatting(raw) : raw;
  }
  const joined = segments
    .map((segment) => {
      let text = String(segment.text || "").trim();
      if (!text) return "";
      if (autoFormat) text = applyHarfiyenTurkishFormatting(text);
      if (!showTimestamps) return text;
      const time = normalizeTimestamp(segment.timestamps);
      return time ? `[${time}] ${text}` : text;
    })
    .filter(Boolean)
    .join("\n");
  return joined;
}

export default function SpeechTranscriber({
  showAlert,
  showConfirm,
  selectedTranscript,
  onTranscriptionsChanged,
  speechSettings,
  setSpeechSettings,
  setActiveTab,
}) {
  const [status, setStatus] = useState({ ready: false, running: false, backendInstalled: false, settings: {} });
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("");

  const language = speechSettings?.language || "auto";
  const threads = speechSettings?.threads || 4;
  const backendPreference = speechSettings?.backendPreference || "auto";
  // Whisper large-v3-turbo was not trained for translation, and Duyu and Seda are transcription-only:
  // they silently return the original language, so the option is disabled for them.
  const translateSupported = !/turbo|duyu|seda/i.test(selectedModel || "");
  const translate = speechSettings?.translate === true && translateSupported;

  const setLanguage = (val) => setSpeechSettings((prev) => ({ ...prev, language: val }));
  const setThreads = (val) => setSpeechSettings((prev) => ({ ...prev, threads: val }));
  const setBackendPreference = (val) => setSpeechSettings((prev) => ({ ...prev, backendPreference: val }));

  const [audioBlob, setAudioBlob] = useState(null);
  const [audioName, setAudioName] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [audioDuration, setAudioDuration] = useState(10);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [result, setResult] = useState(null);
  const [resultText, setResultText] = useState("");
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [autoHarfiyenFormat, setAutoHarfiyenFormat] = useState(true);
  const [isLoadingModel, setIsLoadingModel] = useState(false);

  // Harfiyen Altyazılı Video & Karaoke & Seslendirme (Voice-Over) State
  const [captionStyle, setCaptionStyle] = useState("karaoke");
  const [videoRatio, setVideoRatio] = useState("16:9");
  const [auraTheme, setAuraTheme] = useState("violet");
  const [isExportingVideo, setIsExportingVideo] = useState(false);
  const [selectedDubModel, setSelectedDubModel] = useState("ahenk-cep.json");
  const [isGeneratingDub, setIsGeneratingDub] = useState(false);
  const [dubOutputUrl, setDubOutputUrl] = useState("");

  const recorderRef = useRef(null);
  const abortRef = useRef(null);
  const audioPlayerRef = useRef(null);
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);

  const installedModels = useMemo(() => models.filter((model) => model.installed), [models]);
  const isSelectedRuntimeLoaded = status.ready &&
    status.settings?.model === selectedModel &&
    (status.settings?.backendPreference || "auto") === backendPreference;

  const timedSegments = useMemo(
    () => extractTimedSegments(result, resultText, audioDuration, autoHarfiyenFormat),
    [result, resultText, audioDuration, autoHarfiyenFormat]
  );

  const refresh = useCallback(async () => {
    const [nextStatus, nextModels] = await Promise.all([
      getSpeechStatus(),
      listSpeechModels(),
    ]);
    setStatus(nextStatus);
    setModels(nextModels);
    setSelectedModel((current) => {
      const installed = nextModels.filter((model) => model.installed);
      if (current && installed.some((model) => model.filename === current || model.id === current)) return current;
      const active = nextStatus.settings?.model;
      if (active && installed.some((model) => model.filename === active)) return active;
      return installed.find((model) => model.recommended)?.filename ||
        installed[0]?.filename ||
        "";
    });
  }, []);

  useEffect(() => {
    refresh().catch((err) => showAlert?.({ title: uiText("Ses Tanıma Durumu Alınamadı", "Could Not Get Speech Recognition Status"), message: err.message || String(err), danger: true }));
    const interval = setInterval(() => {
      refresh().catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, [refresh, showAlert]);

  useEffect(() => {
    if (!selectedTranscript) return;
    setResult(selectedTranscript);
  }, [selectedTranscript]);

  useEffect(() => {
    if (!result) return;
    setResultText(formatTranscriptText(result, showTimestamps, autoHarfiyenFormat));
  }, [result, showTimestamps, autoHarfiyenFormat]);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      abortRef.current?.abort();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [audioUrl]);

  const setCurrentAudio = useCallback((blob, name, durSec = 10) => {
    setAudioBlob(blob);
    setAudioName(name);
    setAudioDuration(durSec || 10);
    setResult(null);
    setResultText("");
    setAudioUrl((oldUrl) => {
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      return URL.createObjectURL(blob);
    });
  }, []);

  const clearCurrentAudio = useCallback(() => {
    setAudioBlob(null);
    setAudioName("");
    setAudioUrl((oldUrl) => {
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      return "";
    });
  }, []);

  const handleLoadSpeechModel = async () => {
    if (!selectedModel) return;
    setIsLoadingModel(true);
    try {
      if (!isSelectedRuntimeLoaded) {
        await startSpeech(selectedModel, { language, threads, backendPreference });
      }
      await refresh();
    } catch (err) {
      showAlert?.({ title: uiText("Ses Modeli Yüklenemedi", "Speech Model Load Failed"), message: err.message || String(err), danger: true });
    } finally {
      setIsLoadingModel(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const chunks = [];
      processor.onaudioprocess = (event) => {
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(audioContext.destination);
      recorderRef.current = { stream, audioContext, source, processor, chunks, sampleRate: audioContext.sampleRate };
      setIsRecording(true);
    } catch (err) {
      showAlert?.({ title: uiText("Mikrofon Başlatılamadı", "Microphone Could Not Start"), message: err.message || String(err), danger: true });
    }
  };

  const stopRecording = async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorder.processor.disconnect();
    recorder.source.disconnect();
    recorder.stream.getTracks().forEach((track) => track.stop());
    await recorder.audioContext.close();
    recorderRef.current = null;
    setIsRecording(false);
    const merged = flattenFloat32(recorder.chunks);
    const resampled = resampleLinear(merged, recorder.sampleRate, 16000);
    const wav = encodeWavPcm16(resampled, 16000);
    const durSec = Math.max(1, resampled.length / 16000);
    setCurrentAudio(wav, `kayit-${new Date().toISOString().replace(/[:.]/g, "-")}.wav`, durSec);
  };

  const handleUploadAudio = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith(".wav")) {
      setCurrentAudio(file, file.name, 10);
      return;
    }
    try {
      const arrayBuf = await file.arrayBuffer();
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const decoded = await audioCtx.decodeAudioData(arrayBuf);
      const channelData = decoded.getChannelData(0);
      const resampled = resampleLinear(channelData, decoded.sampleRate, 16000);
      const wavBlob = encodeWavPcm16(resampled, 16000);
      await audioCtx.close();
      setCurrentAudio(wavBlob, file.name.replace(/\.[^.]+$/, "") + ".wav", decoded.duration || 10);
    } catch (err) {
      showAlert?.({
        title: uiText("Ses Dönüştürme Hatası", "Audio Conversion Error"),
        message: uiText(`Seçilen medya dosyası (${file.name}) 16 kHz WAV formatına dönüştürülemedi: ${err.message || err}`, `The selected media file (${file.name}) could not be converted to 16 kHz WAV: ${err.message || err}`),
        danger: true,
      });
    }
  };

  const handleTranscribe = async () => {
    if (!audioBlob || !selectedModel) return;
    setIsTranscribing(true);
    setResult(null);
    setResultText("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      if (!isSelectedRuntimeLoaded) {
        setIsLoadingModel(true);
        try {
          await startSpeech(selectedModel, { language, threads, backendPreference });
          await refresh();
        } finally {
          setIsLoadingModel(false);
        }
      }
      const transcription = await transcribeSpeech(audioBlob, {
        model: selectedModel,
        language,
        threads,
        backendPreference,
        translate,
        filename: audioName || "audio.wav",
        signal: controller.signal,
      });
      setResult(transcription);
      await refresh();
      await onTranscriptionsChanged?.();
    } catch (err) {
      if (err.name !== "AbortError") {
        showAlert?.({ title: uiText("Ses Dökümü Başarısız", "Transcription Failed"), message: err.message || String(err), danger: true });
      }
    } finally {
      abortRef.current = null;
      setIsTranscribing(false);
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setIsTranscribing(false);
  };

  const saveText = () => {
    if (!resultText.trim()) return;
    downloadBlob("transkripsiyon.txt", resultText, "text/plain;charset=utf-8");
  };

  const saveJson = () => {
    const payload = { ...(result || {}), text: resultText, segments: timedSegments };
    downloadBlob("transkripsiyon.json", JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
  };

  const saveSrt = () => {
    if (timedSegments.length === 0) return;
    downloadBlob("altyazi-harfiyen.srt", buildSrtContent(timedSegments), "text/plain;charset=utf-8");
  };

  const saveVtt = () => {
    if (timedSegments.length === 0) return;
    downloadBlob("altyazi-harfiyen.vtt", buildVttContent(timedSegments), "text/vtt;charset=utf-8");
  };

  const handleApplyHarfiyenFormatManual = () => {
    if (!resultText.trim()) return;
    setResultText((prev) => applyHarfiyenTurkishFormatting(prev));
  };

  // --- Harfiyen Türkçe Seslendirme / Dublaj (Voice-Over) ---
  const handleGenerateTurkishDub = async () => {
    const cleanScript = resultText.replace(/\[[^\]]+\]\s*/g, "").trim();
    if (!cleanScript || isGeneratingDub) return;
    setIsGeneratingDub(true);
    try {
      const chosen = DUBBING_TTS_MODELS.find((m) => m.id === selectedDubModel) || DUBBING_TTS_MODELS[0];
      const output = await speakTts(cleanScript, {
        model: chosen.id,
        voice: chosen.voice,
        speed: 1.0,
      });
      if (output?.url || output?.audioUrl) {
        setDubOutputUrl(output.url || output.audioUrl);
      }
    } catch (err) {
      showAlert?.({
        title: uiText("Türkçe Dublaj Başarısız", "Voice-Over Failed"),
        message: err.message || String(err),
        danger: true,
      });
    } finally {
      setIsGeneratingDub(false);
    }
  };

  // --- Harfiyen Altyazılı Video & Ses Aurası Canvas Çizim Motoru ---
  const drawHarfiyenFrame = useCallback(
    (ctx, width, height, currentTimeSec, isPlayingAudio) => {
      const themeObj = AURA_THEMES.find((t) => t.id === auraTheme) || AURA_THEMES[0];
      // Stroke/padding sizes were tuned at 640px wide; scale them with the export resolution.
      const ui = width / 640;

      // 1. Arka Plan Gradyanı
      const bgGrad = ctx.createLinearGradient(0, 0, width, height);
      bgGrad.addColorStop(0, themeObj.bg1);
      bgGrad.addColorStop(1, themeObj.bg2);
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // 2. Dinamik Ses Aurası (Audio-Reactive Aura Küresi ve Frekans Çubukları)
      const centerX = width / 2;
      const centerY = height * 0.4;
      const pulse = isPlayingAudio
        ? 1 + 0.14 * Math.sin(currentTimeSec * 9.5) + 0.08 * Math.cos(currentTimeSec * 15.2)
        : 1 + 0.03 * Math.sin(currentTimeSec * 2.0);
      const baseRadius = Math.min(width, height) * 0.18 * pulse;

      const auraGrad = ctx.createRadialGradient(centerX, centerY, baseRadius * 0.1, centerX, centerY, baseRadius * 2.2);
      auraGrad.addColorStop(0, themeObj.primary + "cc");
      auraGrad.addColorStop(0.5, themeObj.secondary + "55");
      auraGrad.addColorStop(1, "transparent");
      ctx.fillStyle = auraGrad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius * 2.2, 0, Math.PI * 2);
      ctx.fill();

      // Frekans Halkası Çubukları
      const barCount = 36;
      ctx.save();
      ctx.translate(centerX, centerY);
      for (let i = 0; i < barCount; i++) {
        const angle = (i / barCount) * Math.PI * 2;
        const wave = isPlayingAudio
          ? Math.abs(Math.sin(currentTimeSec * 8 + i * 0.6) * Math.cos(currentTimeSec * 5 - i * 0.3))
          : 0.15;
        const barLen = baseRadius * (0.18 + wave * 0.55);
        const x1 = Math.cos(angle) * (baseRadius * 0.78);
        const y1 = Math.sin(angle) * (baseRadius * 0.78);
        const x2 = Math.cos(angle) * (baseRadius * 0.78 + barLen);
        const y2 = Math.sin(angle) * (baseRadius * 0.78 + barLen);

        ctx.strokeStyle = i % 2 === 0 ? themeObj.primary : themeObj.secondary;
        ctx.lineWidth = 3 * ui;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.restore();

      // 3. Aktif Altyazı Segmentini Bul
      const activeSeg =
        timedSegments.find((s) => currentTimeSec >= s.start && currentTimeSec <= s.end) ||
        timedSegments[0];

      if (!activeSeg) return;

      const fontSize = Math.max(15, Math.round(width * 0.038));
      ctx.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
      ctx.textBaseline = "middle";

      const words = activeSeg.words || [];
      const captionY = height * 0.78;
      const maxLineWidth = width * 0.86;

      // Kelimeleri satırlara sar
      const lines = [];
      let currentLine = [];
      let currentWidth = 0;
      const spaceWidth = ctx.measureText(" ").width;

      words.forEach((wObj) => {
        const wWidth = ctx.measureText(wObj.word).width;
        if (currentLine.length > 0 && currentWidth + spaceWidth + wWidth > maxLineWidth) {
          lines.push(currentLine);
          currentLine = [wObj];
          currentWidth = wWidth;
        } else {
          currentLine.push(wObj);
          currentWidth += (currentLine.length > 1 ? spaceWidth : 0) + wWidth;
        }
      });
      if (currentLine.length > 0) lines.push(currentLine);

      const lineHeight = fontSize * 1.45;
      const totalBlockHeight = lines.length * lineHeight;
      const startY = captionY - totalBlockHeight / 2 + lineHeight / 2;

      // Buzlu Cam (Frosted Glass) kapsülü
      if (captionStyle === "glass") {
        const boxPadX = 20 * ui;
        const boxPadY = 14 * ui;
        const boxW = Math.min(width * 0.9, maxLineWidth + boxPadX * 2);
        const boxH = totalBlockHeight + boxPadY * 2;
        const boxX = (width - boxW) / 2;
        const boxY = captionY - boxH / 2;

        ctx.fillStyle = "rgba(15, 18, 32, 0.76)";
        ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
        ctx.lineWidth = 1.5 * ui;
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, 14 * ui);
        ctx.fill();
        ctx.stroke();
      }

      // Kelime kelime çizim (Karaoke / Pop / Box / Classic)
      lines.forEach((lineWords, lineIdx) => {
        const lineStr = lineWords.map((w) => w.word).join(" ");
        const lineW = ctx.measureText(lineStr).width;
        let cursorX = (width - lineW) / 2;
        const y = startY + lineIdx * lineHeight;

        lineWords.forEach((wObj) => {
          const wText = wObj.word;
          const wW = ctx.measureText(wText).width;
          const isCurrentWord = currentTimeSec >= wObj.start && currentTimeSec <= wObj.end;
          const isPastWord = currentTimeSec > wObj.end;

          ctx.save();
          if (captionStyle === "box" && isCurrentWord) {
            ctx.fillStyle = themeObj.primary;
            ctx.beginPath();
            ctx.roundRect(cursorX - 5 * ui, y - fontSize * 0.62, wW + 10 * ui, fontSize * 1.24, 6 * ui);
            ctx.fill();
          }

          if (captionStyle === "pop" && isCurrentWord) {
            ctx.translate(cursorX + wW / 2, y);
            ctx.scale(1.16, 1.16);
            ctx.translate(-(cursorX + wW / 2), -y);
          }

          // Gölge / Kontur
          ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
          ctx.shadowBlur = 8 * ui;
          ctx.lineWidth = 3 * ui;
          ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
          ctx.strokeText(wText, cursorX, y);

          if (captionStyle === "karaoke") {
            ctx.fillStyle = isCurrentWord ? "#facc15" : isPastWord ? themeObj.secondary : "#f8fafc";
          } else if (captionStyle === "pop") {
            ctx.fillStyle = isCurrentWord ? "#38bdf8" : "#ffffff";
          } else {
            ctx.fillStyle = isCurrentWord ? "#ffffff" : "rgba(248, 250, 252, 0.88)";
          }

          ctx.fillText(wText, cursorX, y);
          ctx.restore();

          cursorX += wW + spaceWidth;
        });
      });
    },
    [auraTheme, captionStyle, timedSegments]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let active = true;

    const renderLoop = () => {
      if (!active) return;
      const audioEl = audioPlayerRef.current;
      const curTime = audioEl ? audioEl.currentTime : 0;
      const isPlaying = Boolean(audioEl && !audioEl.paused && !audioEl.ended);
      drawHarfiyenFrame(ctx, canvas.width, canvas.height, curTime, isPlaying);
      animFrameRef.current = requestAnimationFrame(renderLoop);
    };

    renderLoop();
    return () => {
      active = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [drawHarfiyenFrame, videoRatio]);

  const handleExportSubtitledVideo = async () => {
    const canvas = canvasRef.current;
    const audioEl = audioPlayerRef.current;
    if (!canvas || !audioEl || isExportingVideo) return;

    setIsExportingVideo(true);
    try {
      const canvasStream = canvas.captureStream(30);
      // The canvas stream has no sound; add the playing audio element's track so the export is not silent.
      const audioStream = audioEl.captureStream ? audioEl.captureStream() : audioEl.mozCaptureStream?.();
      const audioTracks = audioStream ? audioStream.getAudioTracks() : [];
      const mixedStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
      const chunks = [];
      const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(mixedStream, { mimeType });

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        const videoBlob = new Blob(chunks, { type: "video/webm" });
        downloadBlob(`harfiyen-altyazili-video-${videoRatio.replace(":", "x")}.webm`, videoBlob, "video/webm");
        setIsExportingVideo(false);
      };

      audioEl.currentTime = 0;
      recorder.start(100);
      await audioEl.play();

      audioEl.onended = () => {
        if (recorder.state === "recording") recorder.stop();
      };
    } catch (err) {
      setIsExportingVideo(false);
      showAlert?.({
        title: uiText("Video Dışa Aktarma Hatası", "Video Export Error"),
        message: err.message || String(err),
        danger: true,
      });
    }
  };

  const selectedRatioObj = VIDEO_RATIOS.find((r) => r.id === videoRatio) || VIDEO_RATIOS[0];

  return (
    <div className="workspace-area speech-workspace">
      <div className="workspace-title-section">
        <h2 className="workspace-title">Ses Tanıma, Türkçe Akıllı Noktalama & Altyazı Stüdyosu (Whisper & Harfiyen)</h2>
        <p className="workspace-subtitle">
          Mikrofon kaydını veya ses/video dosyalarını (WAV, MP3, M4A, MP4) yerel olarak yazıya dökün; Harfiyen motoruyla Türkçe noktalama/kesme işaretlerini düzeltin, SRT/VTT altyazı ve Karaoke video üretin.
        </p>
      </div>

      <div className="speech-grid">
        <section className="m3-card speech-panel">
          <div className="speech-panel-header">
            <h3>Çalıştırma Ortamı (Speech Runtime)</h3>
            <span className={`status-chip ${status.backendInstalled ? "" : "offline"}`}>
              {status.backendInstalled ? (status.ready ? "Hazır (Ready)" : "Kurulu (Installed)") : "Arka Uç Eksik"}
            </span>
          </div>

          {status.error && <div className="text-progress error">{status.error}</div>}

          <label className="speech-label">
            Konuşma Tanıma Modeli (Speech Model)
            <select className="m3-input" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
              {installedModels.length === 0 && <option value="">İndirilmiş konuşma modeli yok</option>}
              {installedModels.map((model) => (
                <option key={model.id || model.filename} value={model.filename}>
                  {model.name || model.filename} [Hazır]
                </option>
              ))}
            </select>
            {selectedModel === "duyu-small" && (
              <span style={{ fontSize: "0.75rem", color: "var(--md-sys-color-primary)", marginTop: "4px", display: "block" }}>
                Duyu-small: Türkçe ve İngilizce için optimize edilmiş 56 MB int8 ONNX Conformer modeli. CPU üzerinde çok hızlı çalışır (FLEURS-tr %7.87 WER).
              </span>
            )}
            {selectedModel === "seda-v0.2" && (
              <span style={{ fontSize: "0.75rem", color: "var(--md-sys-color-primary)", marginTop: "4px", display: "block" }}>
                Seda-v0.2 (Ahmet Atasoğlu): Yalnızca Türkçe, CPU'da çalışan Zipformer modeli (FLEURS-tr %6.38 WER). Noktalama, büyük harf, kesme işareti ve rakamları kendisi yazar; altyazı zamanları konuşma aralarından gerçek olarak çıkarılır.
              </span>
            )}
          </label>

          <div className="speech-controls-row">
            <label className="speech-label">
              Hızlandırıcı (Backend)
              <select className="m3-input" value={backendPreference} onChange={(event) => setBackendPreference(event.target.value)}>
                <option value="auto">Otomatik (Kuruluysa GPU)</option>
                {(status.backends || []).map((backend) => (
                  <option key={backend.key} value={backend.key}>
                    {backend.label}{backend.installed ? " - Hazır" : " - Eksik"}
                  </option>
                ))}
              </select>
            </label>
            <label className="speech-label">
              Dil (Language)
              <select className="m3-input" value={language} onChange={(event) => setLanguage(event.target.value)}>
                {LANGUAGE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="speech-label">
              İş Parçacığı (Threads)
              <input
                className="m3-input"
                type="number"
                min="1"
                max="32"
                value={threads}
                onChange={(event) => setThreads(Math.max(1, Math.min(32, Number(event.target.value) || 1)))}
              />
            </label>
          </div>

          <div style={{ marginTop: "10px", paddingLeft: "2px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.82rem", cursor: "pointer", color: "var(--md-sys-color-on-surface)" }}>
              <input
                type="checkbox"
                checked={autoHarfiyenFormat}
                onChange={(event) => setAutoHarfiyenFormat(event.target.checked)}
                style={{ cursor: "pointer", width: "15px", height: "15px" }}
              />
              <span>
                <strong>Harfiyen Türkçe Akıllı Noktalama & TDK İmla Motoru</strong> (Özel ad kesme işareti, soru/nokta ve sayı yazımı)
              </span>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.82rem", cursor: translateSupported ? "pointer" : "not-allowed", color: "var(--md-sys-color-on-surface)", opacity: translateSupported ? 1 : 0.55 }}>
              <input
                type="checkbox"
                checked={translate}
                disabled={!translateSupported}
                onChange={(event) => setSpeechSettings((prev) => ({ ...prev, translate: event.target.checked }))}
                style={{ cursor: translateSupported ? "pointer" : "not-allowed", width: "15px", height: "15px" }}
              />
              <span>İngilizce'ye Çevir (Translate to English)</span>
            </label>
            {!translateSupported && (
              <span style={{ fontSize: "0.72rem", color: "var(--md-sys-color-outline)", marginLeft: "23px" }}>
                Bu model çeviri yapmaz (yalnızca yazıya döker). İngilizce çeviri için Whisper Small veya Base seçin.
              </span>
            )}
          </div>

          <div className="speech-button-row">
            <button
              type="button"
              className="m3-btn m3-btn-filled"
              onClick={handleLoadSpeechModel}
              disabled={!selectedModel || isLoadingModel || isTranscribing || isSelectedRuntimeLoaded}
            >
              {isLoadingModel ? <LoaderCircle className="progress-spinner" size={14} /> : <Play size={14} />}
              <span>{isSelectedRuntimeLoaded ? "Yüklendi (Loaded)" : isLoadingModel ? "Yükleniyor..." : "Modeli Yükle"}</span>
            </button>
            <button type="button" className="m3-btn m3-btn-outlined" onClick={refresh}>
              <RefreshCw size={14} />
              <span>Yenile</span>
            </button>
          </div>

          {installedModels.length === 0 && (
            <div className="text-progress">
              Önce Model Merkezi sekmesinden bir Ses Tanıma modeli indirin.
            </div>
          )}
        </section>

        <section className="m3-card speech-panel">
          <div className="speech-panel-header">
            <h3>Ses & Video Girişi (Audio / Video Input)</h3>
            <span className="status-chip">{audioName || "Dosya seçilmedi"}</span>
          </div>

          <div className="speech-capture-zone">
            <FileAudio size={42} />
            <div>
              <strong>{audioName || "Mikrofonla kaydedin veya Ses / Video yükleyin"}</strong>
              <p>WAV, MP3, M4A, OGG, WebM ve MP4 dosyaları otomatik olarak 16 kHz mono PCM16 WAV formatına dönüştürülür.</p>
            </div>
          </div>

          {audioUrl && (
            <audio
              ref={audioPlayerRef}
              controls
              src={audioUrl}
              onLoadedMetadata={(e) => {
                if (e.currentTarget.duration && Number.isFinite(e.currentTarget.duration)) {
                  setAudioDuration(e.currentTarget.duration);
                }
              }}
              style={{ width: "100%" }}
            />
          )}

          <div className="speech-button-row">
            {isRecording ? (
              <button type="button" className="m3-btn m3-btn-error" onClick={stopRecording}>
                <Square size={14} />
                <span>Kaydı Durdur</span>
              </button>
            ) : (
              <button type="button" className="m3-btn m3-btn-filled" onClick={startRecording} disabled={isTranscribing}>
                <Mic size={14} />
                <span>Kaydı Başlat</span>
              </button>
            )}
            <label className="m3-btn m3-btn-outlined" style={{ cursor: "pointer" }}>
              <Upload size={14} />
              <span>Ses / Video Yükle (WAV, MP3, MP4)</span>
              <input type="file" accept=".wav,.mp3,.m4a,.ogg,.flac,.webm,.mp4,audio/*,video/*" onChange={handleUploadAudio} hidden />
            </label>
            {audioBlob && (
              <button type="button" className="m3-btn m3-btn-error" onClick={clearCurrentAudio} disabled={isTranscribing || isRecording}>
                <X size={14} />
                <span>Sesi Kaldır</span>
              </button>
            )}
          </div>

          <div className="speech-button-row" style={{ marginTop: "10px" }}>
            {isTranscribing ? (
              <button type="button" className="m3-btn m3-btn-error" onClick={handleCancel} style={{ width: "100%", height: "46px" }}>
                <Square size={14} />
                <span>İptal Et</span>
              </button>
            ) : (
              <button
                type="button"
                className="btn-beam"
                style={{ width: "100%", height: "46px" }}
                onClick={() => {
                  if (isTranscribing) return;
                  if (!selectedModel) {
                    showAlert({
                      title: uiText("Model Seçilmedi", "No Model Selected"),
                      message: uiText("Ses dökümü yapabilmek için lütfen bir konuşma tanıma modeli seçin.", "Please select a speech recognition model to transcribe."),
                      danger: true,
                    });
                    return;
                  }
                  if (!audioBlob) {
                    showAlert({
                      title: uiText("Ses Kaydı Eksik", "No Audio"),
                      message: uiText("Lütfen bir ses/video dosyası yükleyin veya mikrofonla ses kaydı alın.", "Please upload an audio/video file or record with the microphone."),
                      danger: false,
                    });
                    return;
                  }
                  handleTranscribe();
                }}
                disabled={isTranscribing}
              >
                <div className="btn-content">
                  <Mic size={16} />
                  <span>Yazıya Dök ve Altyazı Üret (Transcribe)</span>
                </div>
              </button>
            )}
            {isTranscribing && (
              <span className="text-progress">
                <LoaderCircle className="progress-spinner" size={14} /> Yerel olarak yazıya dökülüyor...
              </span>
            )}
          </div>
        </section>
      </div>

      {/* Transcript & SRT / WebVTT Export Card */}
      <section className="m3-card speech-result-panel">
        <div className="speech-panel-header" style={{ flexWrap: "wrap", gap: "10px" }}>
          <h3>Yazıya Dökülen Metin ve Zaman Kodlu Altyazı (Transcript & Subtitles)</h3>
          <div className="speech-button-row" style={{ flexWrap: "wrap", gap: "8px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.78rem", cursor: "pointer", userSelect: "none", color: "var(--md-sys-color-on-surface-variant)", marginRight: "6px" }}>
              <input
                type="checkbox"
                checked={showTimestamps}
                onChange={(e) => setShowTimestamps(e.target.checked)}
                style={{ width: "14px", height: "14px", cursor: "pointer" }}
              />
              <span>Zaman Damgalarını Göster</span>
            </label>
            <button
              type="button"
              className="m3-btn m3-btn-tonal"
              onClick={handleApplyHarfiyenFormatManual}
              disabled={!resultText.trim()}
              title="Metindeki özel isim kesme işaretlerini ('İstanbul'da', 'TBMM'de'), büyük harfleri ve noktalamaları Harfiyen kurallarıyla düzeltir"
            >
              <Sparkles size={14} />
              <span>Harfiyen İmla Düzelt</span>
            </button>
            <button className="m3-btn m3-btn-outlined" onClick={saveText} disabled={!resultText.trim()}>
              <Save size={14} />
              <span>TXT</span>
            </button>
            <button className="m3-btn m3-btn-outlined" onClick={saveSrt} disabled={!resultText.trim()} title="Standart SubRip (.srt) zaman kodlu altyazı dosyası indir">
              <Subtitles size={14} />
              <span>SRT Altyazı</span>
            </button>
            <button className="m3-btn m3-btn-outlined" onClick={saveVtt} disabled={!resultText.trim()} title="WebVTT (.vtt) zaman kodlu altyazı dosyası indir">
              <Subtitles size={14} />
              <span>VTT Altyazı</span>
            </button>
            <button className="m3-btn m3-btn-outlined" onClick={saveJson} disabled={!resultText.trim()}>
              <Save size={14} />
              <span>JSON</span>
            </button>
            {status.ready && (
              <button className="m3-btn m3-btn-error" onClick={() => stopSpeech().then(refresh)}>
                <Square size={14} />
                <span>Modeli Durdur</span>
              </button>
            )}
          </div>
        </div>
        <textarea
          className="m3-textarea speech-result-textarea"
          value={resultText}
          onChange={(event) => setResultText(event.target.value)}
          placeholder="Yazıya dökülen metin burada görünür. Ayrıca buraya doğrudan Türkçe bir metin yazıp 'Harfiyen İmla Düzelt' butonuna basarak noktalama ve kesme işaretlerini otomatik düzeltebilir, SRT/VTT altyazı veya Karaoke video üretebilirsiniz..."
        />

        {/* Harfiyen Türkçe Seslendirme / Dublaj (Voice-Over) Bar */}
        <div
          style={{
            marginTop: "14px",
            padding: "12px 14px",
            borderRadius: "12px",
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px solid var(--md-sys-color-outline-variant, rgba(255,255,255,0.1))",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", flex: 1 }}>
            <Volume2 size={18} style={{ color: "var(--md-sys-color-primary)" }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: "0.84rem" }}>
                Harfiyen Türkçe Seslendirme ve Dublaj (TTS Voice-Over)
              </div>
              <div style={{ fontSize: "0.73rem", color: "var(--md-sys-color-outline)" }}>
                Yazıya dökülen metni yerel 48 kHz Türkçe ses motorlarıyla stüdyo kalitesinde seslendirin.
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <select
              className="m3-input"
              value={selectedDubModel}
              onChange={(e) => setSelectedDubModel(e.target.value)}
              style={{ padding: "7px 10px", fontSize: "0.78rem", background: "#161824", color: "#f8fafc", colorScheme: "dark", minWidth: "240px" }}
            >
              {DUBBING_TTS_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="m3-btn m3-btn-filled"
              onClick={handleGenerateTurkishDub}
              disabled={!resultText.trim() || isGeneratingDub}
              style={{ height: "36px" }}
            >
              {isGeneratingDub ? <LoaderCircle className="progress-spinner" size={14} /> : <Volume2 size={14} />}
              <span>{isGeneratingDub ? "Seslendiriliyor..." : "Metni Seslendir (Dublaj Üret)"}</span>
            </button>
          </div>

          {dubOutputUrl && (
            <div style={{ width: "100%", marginTop: "6px", display: "flex", alignItems: "center", gap: "10px" }}>
              <audio controls src={dubOutputUrl} style={{ flex: 1, height: "36px" }} />
            </div>
          )}
        </div>
      </section>

      {/* Harfiyen Altyazılı Video, Karaoke & Ses Aurası Stüdyosu */}
      <section className="m3-card speech-result-panel" style={{ marginTop: "18px" }}>
        <div className="speech-panel-header" style={{ flexWrap: "wrap", gap: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Film size={18} style={{ color: "var(--md-sys-color-primary)" }} />
            <h3>Harfiyen Altyazılı Video, Karaoke & Ses Aurası Stüdyosu (Reels / Shorts / YouTube)</h3>
          </div>
          <button
            type="button"
            className="btn-beam"
            style={{ height: "38px", padding: "2px" }}
            onClick={handleExportSubtitledVideo}
            disabled={!audioUrl || !resultText.trim() || isExportingVideo}
            title="Ses aurası ve gömülü dinamik altyazılarla birlikte videoyu kaydedip indirir"
          >
            <div className="btn-content" style={{ padding: "0 14px", fontSize: "0.8rem", gap: "6px" }}>
              <Film size={14} />
              <span>{isExportingVideo ? "Video Kaydediliyor (Ses Oynatılıyor)..." : "Altyazılı Videoyu İndir (.WebM)"}</span>
            </div>
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px", marginBottom: "16px" }}>
          <label className="speech-label">
            Altyazı Stili (Caption Style)
            <select className="m3-input" value={captionStyle} onChange={(e) => setCaptionStyle(e.target.value)}>
              {CAPTION_STYLES.map((st) => (
                <option key={st.id} value={st.id}>{st.label}</option>
              ))}
            </select>
          </label>

          <label className="speech-label">
            Video Çerçeve Oranı (Aspect Ratio)
            <select className="m3-input" value={videoRatio} onChange={(e) => setVideoRatio(e.target.value)}>
              {VIDEO_RATIOS.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </label>

          <label className="speech-label">
            Ses Aurası Teması (Audio Aura)
            <select className="m3-input" value={auraTheme} onChange={(e) => setAuraTheme(e.target.value)}>
              {AURA_THEMES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: "16px", background: "rgba(0,0,0,0.35)", borderRadius: "14px", border: "1px solid rgba(255,255,255,0.08)" }}>
          <canvas
            ref={canvasRef}
            width={selectedRatioObj.width}
            height={selectedRatioObj.height}
            style={{
              maxWidth: "100%",
              maxHeight: "420px",
              borderRadius: "12px",
              boxShadow: "0 12px 32px rgba(0, 0, 0, 0.55)",
              border: "1px solid rgba(255, 255, 255, 0.14)",
            }}
          />
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--md-sys-color-outline)", textAlign: "center", marginTop: "8px" }}>
          Yukarıdaki ses oynatıcısını başlattığınızda Ses Aurası ve Karaoke kelime vurguları gerçek zamanlı olarak canlanır.
        </div>
      </section>
    </div>
  );
}
