from __future__ import annotations

import io
import os
from pathlib import Path

import numpy as np
import soundfile as sf
from flask import Flask, jsonify, request, send_from_directory, send_file

app = Flask(__name__, static_folder="static", static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024

MIN_F0 = 65.0
MAX_F0 = 700.0
FRAME_MS = 40.0
HOP_MS = 10.0


def yin_frame(frame: np.ndarray, sr: int) -> tuple[float, float]:
    x = np.asarray(frame, dtype=np.float64)
    x -= np.mean(x)
    n = len(x)
    min_tau = max(2, int(sr / MAX_F0))
    max_tau = min(n // 2, int(np.ceil(sr / MIN_F0)))
    if max_tau <= min_tau or np.sqrt(np.mean(x * x)) < 1e-5:
        return 0.0, 0.0

    fft_size = 1 << (2 * n - 1).bit_length()
    spectrum = np.fft.rfft(x, n=fft_size)
    autocorr = np.fft.irfft(spectrum * np.conjugate(spectrum), n=fft_size)[:max_tau + 1]
    prefix = np.concatenate(([0.0], np.cumsum(x * x)))
    taus = np.arange(max_tau + 1)
    difference = prefix[n - taus] + (prefix[n] - prefix[taus]) - 2.0 * autocorr
    difference = np.maximum(difference, 0.0)

    cmnd = np.ones_like(difference)
    cumulative = np.cumsum(difference[1:])
    idx = np.arange(1, len(difference), dtype=np.float64)
    cmnd[1:] = difference[1:] * idx / np.maximum(cumulative, 1e-12)

    chosen = None
    for tau in range(min_tau, max_tau):
        if cmnd[tau] < 0.15 and cmnd[tau] <= cmnd[tau + 1]:
            chosen = tau
            break
    if chosen is None:
        chosen = min_tau + int(np.argmin(cmnd[min_tau:max_tau + 1]))

    refined = float(chosen)
    if 1 <= chosen < len(cmnd) - 1:
        a, b, c = cmnd[chosen - 1], cmnd[chosen], cmnd[chosen + 1]
        den = a - 2.0 * b + c
        if abs(den) > 1e-12:
            refined += 0.5 * (a - c) / den

    if refined <= 0:
        return 0.0, 0.0
    return float(sr / refined), float(np.clip(1.0 - cmnd[chosen], 0.0, 1.0))


def analyze_audio(mono: np.ndarray, sr: int) -> list[dict]:
    frame_size = max(64, int(sr * FRAME_MS / 1000))
    hop_size = max(1, int(sr * HOP_MS / 1000))
    if len(mono) < frame_size:
        mono = np.pad(mono, (0, frame_size - len(mono)))
    peak_rms = float(np.sqrt(np.mean(mono * mono)))
    silence_floor = max(1e-5, peak_rms * 0.015)
    rows = []

    for start in range(0, len(mono) - frame_size + 1, hop_size):
        frame = mono[start:start + frame_size]
        rms = float(np.sqrt(np.mean(frame * frame)))
        f0, confidence = yin_frame(frame, sr)
        voiced = rms >= silence_floor and confidence >= 0.75 and f0 > 0
        rows.append({
            "time": round((start + frame_size / 2) / sr, 4),
            "f0": round(f0, 2) if voiced else None,
            "confidence": round(confidence, 3),
            "voiced": bool(voiced),
        })
    return rows


def interpolate_f0(rows: list[dict], time_sec: float) -> float | None:
    if not rows:
        return None
    step = HOP_MS / 1000.0
    pos = (time_sec - rows[0]["time"]) / step
    i = int(np.floor(pos))
    if i < 0 or i >= len(rows):
        return None
    a = rows[i]
    b = rows[min(i + 1, len(rows) - 1)]
    if a["f0"] is None or b["f0"] is None:
        return None
    frac = float(np.clip(pos - i, 0.0, 1.0))
    return float(a["f0"] * (1.0 - frac) + b["f0"] * frac)


def nearest_peak(signal: np.ndarray, center: int, radius: int) -> int:
    left = max(1, center - radius)
    right = min(len(signal) - 2, center + radius)
    if right <= left:
        return max(0, min(len(signal) - 1, center))
    segment = signal[left:right + 1]
    local = np.where((segment[1:-1] >= segment[:-2]) &
                     (segment[1:-1] >= segment[2:]))[0] + 1
    if len(local) == 0:
        return left + int(np.argmax(segment))
    candidates = left + local
    return int(candidates[np.argmin(np.abs(candidates - center))])


def psola_channel(signal: np.ndarray, sr: int, rows: list[dict], ratio: float) -> np.ndarray:
    if abs(ratio - 1.0) < 1e-8:
        return signal.copy()

    n = len(signal)
    output = np.zeros(n, dtype=np.float64)
    weights = np.zeros(n, dtype=np.float64)
    analysis_marks: list[tuple[int, float]] = []

    # Build analysis marks from the estimated pitch contour.
    phase = 0.0
    previous_voiced = False
    last_mark = -10**9
    for sample in range(n):
        f0 = interpolate_f0(rows, sample / sr)
        if f0 is None or not (MIN_F0 <= f0 <= MAX_F0):
            phase = 0.0
            previous_voiced = False
            continue
        if not previous_voiced:
            phase = 0.0
            previous_voiced = True
        phase += f0 / sr
        if phase >= 1.0:
            phase -= int(phase)
            radius = max(2, int(sr / f0 * 0.18))
            mark = nearest_peak(signal, sample, radius)
            if mark - last_mark > sr / f0 * 0.45:
                analysis_marks.append((mark, f0))
                last_mark = mark

    if len(analysis_marks) < 3:
        raise ValueError("十分な有声音を検出できませんでした。母音を含む音声を試してください。")

    # Synthesis marks are spaced according to the requested pitch ratio.
    mark_cursor = 0
    t = 0.0
    previous_segment_voiced = False
    while t < n:
        f0 = interpolate_f0(rows, t / sr)
        if f0 is None or not (MIN_F0 <= f0 <= MAX_F0):
            previous_segment_voiced = False
            t += max(1, int(sr * HOP_MS / 1000.0))
            continue

        target_period = sr / (f0 * ratio)
        source_period = sr / f0
        if not previous_segment_voiced:
            nearest_index = min(range(len(analysis_marks)),
                                key=lambda k: abs(analysis_marks[k][0] - t))
            mark_cursor = nearest_index
            previous_segment_voiced = True

        while mark_cursor + 1 < len(analysis_marks) and abs(
            analysis_marks[mark_cursor + 1][0] - t
        ) < abs(analysis_marks[mark_cursor][0] - t):
            mark_cursor += 1

        source_center = analysis_marks[mark_cursor][0]
        half = max(8, int(round(source_period)))
        src_start = max(0, source_center - half)
        src_end = min(n, source_center + half)
        segment = signal[src_start:src_end]
        if len(segment) > 1:
            window = np.hanning(len(segment))
            dst_start = int(round(t)) - len(segment) // 2
            dst_end = dst_start + len(segment)
            copy_start = max(0, -dst_start)
            copy_end = len(segment) - max(0, dst_end - n)
            if copy_end > copy_start:
                d0 = max(0, dst_start)
                d1 = min(n, dst_end)
                output[d0:d1] += segment[copy_start:copy_end] * window[copy_start:copy_end]
                weights[d0:d1] += window[copy_start:copy_end]

        t += target_period

    valid = weights > 0.08
    result = signal.astype(np.float64).copy()
    result[valid] = output[valid] / weights[valid]
    return np.clip(result, -1.0, 1.0).astype(np.float32)


def read_upload(file_storage):
    data = file_storage.read()
    if not data:
        raise ValueError("空のファイルです。")
    audio, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
    if sr < 8000 or sr > 96000:
        raise ValueError("サンプリング周波数は8kHz〜96kHzにしてください。")
    if audio.shape[0] / sr > 20:
        raise ValueError("試験版では音声の長さは20秒以内です。")
    if not np.all(np.isfinite(audio)):
        raise ValueError("音声データに不正な値があります。")
    return audio, int(sr)


@app.get("/")
def home():
    return send_from_directory("static", "index.html")


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "service": "My Vocal Audio API", "version": "0.1.0"})


@app.post("/api/analyze")
def api_analyze():
    try:
        if "audio" not in request.files:
            return jsonify({"error": "音声ファイルがありません。"}), 400
        audio, sr = read_upload(request.files["audio"])
        mono = np.mean(audio, axis=1)
        rows = analyze_audio(mono, sr)
        voiced = [r["f0"] for r in rows if r["f0"] is not None]
        return jsonify({
            "sample_rate": sr,
            "duration": round(len(audio) / sr, 4),
            "channels": int(audio.shape[1]),
            "frames": rows,
            "voiced_frames": len(voiced),
            "median_f0": round(float(np.median(voiced)), 2) if voiced else None,
        })
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


@app.post("/api/convert")
def api_convert():
    try:
        if "audio" not in request.files:
            return jsonify({"error": "音声ファイルがありません。"}), 400
        semitones = float(request.form.get("semitones", "0"))
        if not -12 <= semitones <= 12:
            return jsonify({"error": "変換量は-12〜+12半音です。"}), 400
        audio, sr = read_upload(request.files["audio"])
        mono = np.mean(audio, axis=1)
        rows = analyze_audio(mono, sr)
        if sum(r["f0"] is not None for r in rows) < 3:
            return jsonify({"error": "有声音を十分に検出できませんでした。"}), 400

        ratio = 2.0 ** (semitones / 12.0)
        channels = []
        for channel in range(audio.shape[1]):
            channels.append(psola_channel(audio[:, channel], sr, rows, ratio))
        rendered = np.stack(channels, axis=1)

        wav_buffer = io.BytesIO()
        sf.write(wav_buffer, rendered, sr, format="WAV", subtype="PCM_16")
        wav_buffer.seek(0)
        filename = f"myvocal_{semitones:+.0f}st.wav"
        return send_file(
            wav_buffer, mimetype="audio/wav", as_attachment=True,
            download_name=filename
        )
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


@app.errorhandler(413)
def too_large(_error):
    return jsonify({"error": "ファイルサイズは20MB以下にしてください。"}), 413


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "10000"))
    app.run(host="0.0.0.0", port=port)
