(() => {
"use strict";
const $ = id => document.getElementById(id);
let selectedFile = null;
let originalUrl = null;
let convertedUrl = null;
let lastAnalysis = null;

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    $("health").textContent = data.ok ? "● Python API 接続済み · " + data.version : "APIエラー";
    $("health").className = "status online";
  } catch {
    $("health").textContent = "● APIに接続できません";
    $("health").className = "status offline";
  }
}

$("file").addEventListener("change", () => {
  const file = $("file").files[0];
  selectedFile = file || null;
  lastAnalysis = null;
  $("analyze").disabled = !file;
  $("convert").disabled = !file;
  $("median").textContent = "—";
  $("voiced").textContent = "—";
  $("duration").textContent = "—";
  $("rate").textContent = "—";
  clearChart();
  $("download").hidden = true;
  $("converted").removeAttribute("src");
  if (convertedUrl) URL.revokeObjectURL(convertedUrl);
  convertedUrl = null;
  if (!file) return;

  if (!file.name.toLowerCase().endsWith(".wav")) {
    $("fileInfo").textContent = "現在の試験版はWAVファイルのみ対応です。";
    $("analyze").disabled = true;
    $("convert").disabled = true;
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    $("fileInfo").textContent = "20MBを超えています。";
    $("analyze").disabled = true;
    $("convert").disabled = true;
    return;
  }
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  originalUrl = URL.createObjectURL(file);
  $("original").src = originalUrl;
  $("fileInfo").textContent = file.name + " · " + (file.size / 1024).toFixed(1) + " KB";
});

function clearChart() {
  const canvas = $("pitchChart");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#9aabc8";
  ctx.fillText("解析するとF0グラフが表示されます", 20, 30);
}

function drawChart(frames) {
  const canvas = $("pitchChart");
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0b1426";
  ctx.fillRect(0, 0, w, h);
  const valid = frames.filter(x => x.f0 !== null);
  if (!valid.length) { clearChart(); return; }
  const maxTime = frames[frames.length - 1].time || 1;
  const maxF0 = Math.max(400, ...valid.map(x => x.f0)) * 1.1;
  const minF0 = 50;
  ctx.strokeStyle = "#2c3c59";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = 12 + (h - 35) * i / 4;
    ctx.beginPath(); ctx.moveTo(45, y); ctx.lineTo(w - 10, y); ctx.stroke();
    ctx.fillStyle = "#9aabc8";
    ctx.fillText(Math.round(maxF0 - (maxF0 - minF0) * i / 4) + " Hz", 4, y + 4);
  }
  ctx.strokeStyle = "#7ddbd0";
  ctx.lineWidth = 2;
  ctx.beginPath();
  let drawing = false;
  frames.forEach(frame => {
    if (frame.f0 === null) { drawing = false; return; }
    const x = 45 + frame.time / maxTime * (w - 60);
    const y = 12 + (maxF0 - frame.f0) / (maxF0 - minF0) * (h - 35);
    if (!drawing) { ctx.moveTo(x, y); drawing = true; }
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

async function postAudio(endpoint, extra = {}) {
  const form = new FormData();
  form.append("audio", selectedFile, selectedFile.name);
  Object.entries(extra).forEach(([key, value]) => form.append(key, value));
  const response = await fetch(endpoint, { method: "POST", body: form });
  if (!response.ok) {
    let message = "サーバーエラー";
    try { message = (await response.json()).error || message; } catch {}
    throw new Error(message);
  }
  return response;
}

$("analyze").addEventListener("click", async () => {
  if (!selectedFile) return;
  $("analyze").disabled = true;
  $("analyze").textContent = "解析中...";
  try {
    const response = await postAudio("/api/analyze");
    const data = await response.json();
    lastAnalysis = data;
    $("median").textContent = data.median_f0 === null ? "検出なし" : data.median_f0.toFixed(1) + " Hz";
    $("voiced").textContent = data.voiced_frames + " / " + data.frames.length;
    $("duration").textContent = data.duration.toFixed(2) + " 秒";
    $("rate").textContent = data.sample_rate.toLocaleString() + " Hz";
    drawChart(data.frames);
  } catch (error) {
    alert("解析に失敗しました: " + error.message);
  } finally {
    $("analyze").disabled = !selectedFile;
    $("analyze").textContent = "音声を解析";
  }
});

$("semitones").addEventListener("input", () => {
  const n = Number($("semitones").value);
  $("shiftLabel").textContent = (n > 0 ? "+" : "") + n + " 半音";
});
document.querySelectorAll("[data-shift]").forEach(button => {
  button.addEventListener("click", () => {
    $("semitones").value = button.dataset.shift;
    $("semitones").dispatchEvent(new Event("input"));
  });
});

$("convert").addEventListener("click", async () => {
  if (!selectedFile) return;
  $("convert").disabled = true;
  $("convertStatus").textContent = "Pythonエンジンで変換中...";
  $("download").hidden = true;
  try {
    const response = await postAudio("/api/convert", { semitones: $("semitones").value });
    const blob = await response.blob();
    if (convertedUrl) URL.revokeObjectURL(convertedUrl);
    convertedUrl = URL.createObjectURL(blob);
    $("converted").src = convertedUrl;
    $("download").href = convertedUrl;
    $("download").download = "myvocal_" + Number($("semitones").value) + "st.wav";
    $("download").hidden = false;
    $("convertStatus").textContent = "変換完了。元音声と聴き比べてください。";
  } catch (error) {
    $("convertStatus").textContent = "変換エラー: " + error.message;
  } finally {
    $("convert").disabled = !selectedFile;
  }
});

window.addEventListener("beforeunload", () => {
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  if (convertedUrl) URL.revokeObjectURL(convertedUrl);
});
clearChart();
checkHealth();
})();