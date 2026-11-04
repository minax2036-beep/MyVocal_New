#include <cmath>
#include <algorithm>
#include <cstdlib>

#if defined(__EMSCRIPTEN__)
#include <emscripten/emscripten.h>
#define API EMSCRIPTEN_KEEPALIVE
#else
#define API
#endif

static constexpr float PI_F = 3.14159265358979323846f;

static float yin_frame(const float* samples, int length, int sampleRate,
                       float minHz, float maxHz, float threshold) {
    if (!samples || length < 32 || sampleRate <= 0) return 0.0f;
    const int minLag = std::max(2, static_cast<int>(sampleRate / maxHz));
    const int maxLag = std::min(length / 2, static_cast<int>(sampleRate / minHz));
    if (maxLag <= minLag) return 0.0f;

    float* difference = static_cast<float*>(std::calloc(maxLag + 1, sizeof(float)));
    float* cmnd = static_cast<float*>(std::calloc(maxLag + 1, sizeof(float)));
    if (!difference || !cmnd) {
        std::free(difference);
        std::free(cmnd);
        return 0.0f;
    }

    for (int tau = 1; tau <= maxLag; ++tau) {
        double sum = 0.0;
        for (int i = 0; i < length - maxLag; ++i) {
            const float d = samples[i] - samples[i + tau];
            sum += d * d;
        }
        difference[tau] = static_cast<float>(sum);
    }

    float running = 0.0f;
    cmnd[0] = 1.0f;
    int selected = -1;
    for (int tau = 1; tau <= maxLag; ++tau) {
        running += difference[tau];
        cmnd[tau] = running > 0.0f ? difference[tau] * tau / running : 1.0f;
        if (tau >= minLag && cmnd[tau] < threshold) {
            while (tau + 1 <= maxLag && cmnd[tau + 1] < cmnd[tau]) ++tau;
            selected = tau;
            break;
        }
    }
    if (selected < 0) {
        float best = threshold;
        for (int tau = minLag; tau <= maxLag; ++tau) {
            if (cmnd[tau] < best) {
                best = cmnd[tau];
                selected = tau;
            }
        }
    }

    float result = 0.0f;
    if (selected > 0) {
        const int t = selected;
        const float a = t > 1 ? cmnd[t - 1] : cmnd[t];
        const float b = cmnd[t];
        const float c = t < maxLag ? cmnd[t + 1] : cmnd[t];
        const float denom = a - 2.0f * b + c;
        const float correction = std::abs(denom) > 1e-9f
            ? 0.5f * (a - c) / denom : 0.0f;
        const float period = t + std::clamp(correction, -1.0f, 1.0f);
        if (period > 0.0f) result = sampleRate / period;
    }

    std::free(difference);
    std::free(cmnd);
    return result;
}

static int find_pitch_mark(const float* input, int start, int end,
                           int expected, int radius) {
    const int low = std::max(start + 1, expected - radius);
    const int high = std::min(end - 1, expected + radius);
    if (low > high) return std::clamp(expected, start, end - 1);
    int best = std::clamp(expected, low, high);
    float bestScore = -1.0f;
    for (int i = low; i <= high; ++i) {
        if (input[i - 1] <= 0.0f && input[i] > 0.0f) {
            const float score = input[i] - input[i - 1];
            if (score > bestScore) {
                bestScore = score;
                best = i;
            }
        }
    }
    return best;
}

extern "C" {
API int processed_length(int inputLength, int startSample, int endSample, float) {
    if (inputLength <= 0) return 0;
    const int start = std::clamp(startSample, 0, inputLength);
    const int end = std::clamp(endSample, start, inputLength);
    return end - start;
}

// Time-domain PSOLA prototype. Output duration equals the selected input duration.
// The sample rate is required for estimating the local fundamental period.
API int process_audio(const float* input, int inputLength, int startSample, int endSample,
                      int sampleRate, float semitones, float gain,
                      float* output, int outputCapacity) {
    const int start = std::clamp(startSample, 0, inputLength);
    const int end = std::clamp(endSample, start, inputLength);
    const int count = end - start;
    if (!input || !output || count <= 0 || count > outputCapacity || sampleRate <= 0) return -1;

    const float ratio = std::pow(2.0f, semitones / 12.0f);
    if (!std::isfinite(ratio) || ratio <= 0.0f) return -1;
    if (std::abs(semitones) < 0.001f) {
        for (int i = 0; i < count; ++i)
            output[i] = std::clamp(input[start + i] * gain, -1.0f, 1.0f);
        return count;
    }

    float* weights = static_cast<float*>(std::calloc(count, sizeof(float)));
    if (!weights) return -1;
    std::fill(output, output + count, 0.0f);

    const int frameSize = std::min(4096, std::max(1024, static_cast<int>(sampleRate * 0.045f)));
    const int analysisHop = std::max(128, sampleRate / 100);
    int nextAnalysis = 0;
    float period = 0.0f;
    double synthesisMark = 0.0;

    while (synthesisMark < count) {
        const int outCenter = static_cast<int>(std::lround(synthesisMark));
        if (outCenter >= nextAnalysis) {
            const int frameStart = std::clamp(outCenter - frameSize / 2, 0, std::max(0, count - frameSize));
            const int available = std::min(frameSize, count - frameStart);
            const float f0 = available >= 64
                ? yin_frame(input + start + frameStart, available, sampleRate, 65.0f, 1000.0f, 0.18f)
                : 0.0f;
            period = f0 > 0.0f ? sampleRate / f0 : 0.0f;
            nextAnalysis = outCenter + analysisHop;
        }

        if (period < 8.0f || period > sampleRate / 65.0f) {
            synthesisMark += std::max(1.0, static_cast<double>(analysisHop));
            continue;
        }

        const int radius = std::clamp(static_cast<int>(std::lround(period)), 8, frameSize / 2);
        const int expectedSource = start + outCenter;
        const int sourceCenter = find_pitch_mark(input, start, end, expectedSource,
                                                  std::max(2, radius / 3));
        for (int offset = -radius; offset <= radius; ++offset) {
            const int outIndex = outCenter + offset;
            const int inIndex = sourceCenter + offset;
            if (outIndex < 0 || outIndex >= count || inIndex < start || inIndex >= end) continue;
            const float phase = static_cast<float>(offset + radius) / (2.0f * radius);
            const float window = 0.5f - 0.5f * std::cos(2.0f * PI_F * phase);
            output[outIndex] += input[inIndex] * window;
            weights[outIndex] += window;
        }

        const double step = std::clamp(static_cast<double>(period / ratio), 8.0, static_cast<double>(sampleRate));
        synthesisMark += step;
    }

    for (int i = 0; i < count; ++i) {
        const float sample = weights[i] > 1e-5f
            ? output[i] / weights[i]
            : input[start + i];
        output[i] = std::clamp(sample * gain, -1.0f, 1.0f);
    }

    std::free(weights);
    return count;
}

API int analyze_f0(const float* input, int length, int sampleRate, int frameSize,
                   int hopSize, float* output, int outputCapacity) {
    if (!input || !output || length <= 0 || sampleRate <= 0 || frameSize < 32 || hopSize < 1) return -1;
    const int frames = length < frameSize ? 1 : 1 + (length - frameSize) / hopSize;
    if (frames > outputCapacity) return -1;
    for (int frame = 0; frame < frames; ++frame) {
        const int offset = frame * hopSize;
        const int available = std::min(frameSize, length - offset);
        output[frame] = available >= 32
            ? yin_frame(input + offset, available, sampleRate, 65.0f, 1000.0f, 0.15f)
            : 0.0f;
    }
    return frames;
}
}
