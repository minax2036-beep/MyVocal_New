#include <cmath>
#include <cstdint>
#include <algorithm>
#include <cstdlib>

#if defined(__EMSCRIPTEN__)
#include <emscripten/emscripten.h>
#define API EMSCRIPTEN_KEEPALIVE
#else
#define API
#endif

static constexpr float PI_F = 3.14159265358979323846f;

extern "C" {
API int processed_length(int inputLength, int startSample, int endSample, float semitones) {
    if (inputLength <= 0) return 0;
    const int start = std::clamp(startSample, 0, inputLength);
    const int end = std::clamp(endSample, start, inputLength);
    const float ratio = std::pow(2.0f, semitones / 12.0f);
    if (!std::isfinite(ratio) || ratio <= 0.0f) return 0;
    return std::max(0, static_cast<int>(std::ceil((end - start) / ratio)));
}

// First prototype: resampling pitch shift. Duration changes with pitch.
API int process_audio(const float* input, int inputLength, int startSample, int endSample,
                      float semitones, float gain, float* output, int outputCapacity) {
    const int count = processed_length(inputLength, startSample, endSample, semitones);
    if (!input || !output || count <= 0 || count > outputCapacity) return -1;
    const int start = std::clamp(startSample, 0, inputLength);
    const int end = std::clamp(endSample, start, inputLength);
    const float ratio = std::pow(2.0f, semitones / 12.0f);
    for (int i = 0; i < count; ++i) {
        const float position = start + i * ratio;
        const int left = std::clamp(static_cast<int>(position), start, end - 1);
        const int right = std::min(left + 1, end - 1);
        const float fraction = position - left;
        const float sample = input[left] + (input[right] - input[left]) * fraction;
        output[i] = std::clamp(sample * gain, -1.0f, 1.0f);
    }
    return count;
}

// YIN difference-function based F0 estimate. Returns 0 for unvoiced frames.
API float yin_frame(const float* samples, int length, int sampleRate,
                    float minHz, float maxHz, float threshold) {
    if (!samples || length < 16 || sampleRate <= 0) return 0.0f;
    const int minLag = std::max(2, static_cast<int>(sampleRate / maxHz));
    const int maxLag = std::min(length / 2, static_cast<int>(sampleRate / minHz));
    if (maxLag <= minLag) return 0.0f;
    float* difference = static_cast<float*>(std::calloc(maxLag + 1, sizeof(float)));
    float* cmnd = static_cast<float*>(std::calloc(maxLag + 1, sizeof(float)));
    if (!difference || !cmnd) { std::free(difference); std::free(cmnd); return 0.0f; }
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
            if (cmnd[tau] < best) { best = cmnd[tau]; selected = tau; }
        }
    }
    float result = 0.0f;
    if (selected > 0) {
        const int t = selected;
        const float a = t > 1 ? cmnd[t - 1] : cmnd[t];
        const float b = cmnd[t];
        const float c = t < maxLag ? cmnd[t + 1] : cmnd[t];
        const float denom = a - 2.0f * b + c;
        const float correction = std::abs(denom) > 1e-9f ? 0.5f * (a - c) / denom : 0.0f;
        const float period = t + std::clamp(correction, -1.0f, 1.0f);
        if (period > 0.0f) result = sampleRate / period;
    }
    std::free(difference);
    std::free(cmnd);
    return result;
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
