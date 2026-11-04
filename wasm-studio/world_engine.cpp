#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

#include "world/cheaptrick.h"
#include "world/d4c.h"
#include "world/dio.h"
#include "world/harvest.h"
#include "world/stonemask.h"
#include "world/synthesis.h"

#if defined(__EMSCRIPTEN__)
#include <emscripten/emscripten.h>
#define API EMSCRIPTEN_KEEPALIVE
#else
#define API
#endif

namespace {
constexpr double kFramePeriodMs = 5.0;
constexpr double kF0Floor = 65.0;
constexpr double kF0Ceil = 1000.0;

int get_frame_count(int sample_rate, int sample_count, double frame_period_ms) {
    if (sample_rate <= 0 || sample_count <= 0) return 0;
    return GetSamplesForDIO(sample_rate, sample_count, frame_period_ms);
}

bool analyze_world(const double* input, int length, int sample_rate,
                   double frame_period_ms, std::vector<double>& time_axis,
                   std::vector<double>& f0) {
    if (!input || length < sample_rate / 10 || sample_rate < 16000) return false;

    const int frames = get_frame_count(sample_rate, length, frame_period_ms);
    if (frames <= 0) return false;

    time_axis.resize(frames);
    f0.resize(frames);

    DioOption option;
    InitializeDioOption(&option);
    option.f0_floor = kF0Floor;
    option.f0_ceil = kF0Ceil;
    option.frame_period = frame_period_ms;

    Dio(input, length, sample_rate, &option, time_axis.data(), f0.data());

    std::vector<double> refined(frames);
    StoneMask(input, length, sample_rate, time_axis.data(), f0.data(),
              frames, refined.data());
    f0.swap(refined);
    return true;
}

void copy_with_gain(const float* input, int start, int count,
                    float gain, float* output) {
    for (int i = 0; i < count; ++i) {
        const float value = input[start + i] * gain;
        output[i] = std::clamp(value, -1.0f, 1.0f);
    }
}
}  // namespace

extern "C" {
API int processed_length(int inputLength, int startSample, int endSample,
                         float /*semitones*/) {
    if (inputLength <= 0) return 0;
    const int start = std::clamp(startSample, 0, inputLength);
    const int end = std::clamp(endSample, start, inputLength);
    return end - start;
}

API int analyze_f0(const float* input, int length, int sampleRate,
                   int /*frameSize*/, int hopSize, float* output,
                   int outputCapacity) {
    if (!input || !output || length <= 0 || sampleRate < 16000 || hopSize <= 0)
        return -1;

    const double framePeriodMs =
        static_cast<double>(hopSize) * 1000.0 / sampleRate;
    const int frames = get_frame_count(sampleRate, length, framePeriodMs);
    if (frames <= 0 || frames > outputCapacity) return -1;

    std::vector<double> signal(length);
    for (int i = 0; i < length; ++i) signal[i] = input[i];

    std::vector<double> timeAxis;
    std::vector<double> f0;
    if (!analyze_world(signal.data(), length, sampleRate, framePeriodMs,
                       timeAxis, f0)) {
        return -1;
    }

    for (int i = 0; i < frames; ++i)
        output[i] = static_cast<float>(f0[i] > 0.0 ? f0[i] : 0.0);
    return frames;
}

API int process_audio(const float* input, int inputLength, int startSample,
                      int endSample, int sampleRate, float semitones,
                      float gain, float* output, int outputCapacity) {
    if (!input || !output || inputLength <= 0 || sampleRate < 16000 ||
        !std::isfinite(semitones) || !std::isfinite(gain)) {
        return -1;
    }

    const int start = std::clamp(startSample, 0, inputLength);
    const int end = std::clamp(endSample, start, inputLength);
    const int count = end - start;
    if (count < sampleRate / 10 || count > outputCapacity) return -1;

    if (std::abs(semitones) < 0.001f) {
        copy_with_gain(input, start, count, gain, output);
        return count;
    }

    std::vector<double> signal(count);
    for (int i = 0; i < count; ++i)
        signal[i] = static_cast<double>(input[start + i]);

    std::vector<double> timeAxis;
    std::vector<double> f0;
    if (!analyze_world(signal.data(), count, sampleRate, kFramePeriodMs,
                       timeAxis, f0)) {
        return -1;
    }

    bool hasVoicedFrame = false;
    for (double value : f0) {
        if (value > 0.0) {
            hasVoicedFrame = true;
            break;
        }
    }
    if (!hasVoicedFrame) {
        copy_with_gain(input, start, count, gain, output);
        return count;
    }

    CheapTrickOption cheapOption;
    InitializeCheapTrickOption(sampleRate, &cheapOption);
    const int fftSize = cheapOption.fft_size;
    const int bins = fftSize / 2 + 1;
    std::vector<std::vector<double>> spectralRows(
        f0.size(), std::vector<double>(bins));
    std::vector<std::vector<double>> aperiodicityRows(
        f0.size(), std::vector<double>(bins));
    std::vector<double*> spectralPointers(f0.size());
    std::vector<double*> aperiodicityPointers(f0.size());

    for (size_t i = 0; i < f0.size(); ++i) {
        spectralPointers[i] = spectralRows[i].data();
        aperiodicityPointers[i] = aperiodicityRows[i].data();
    }

    CheapTrick(signal.data(), count, sampleRate, timeAxis.data(), f0.data(),
               static_cast<int>(f0.size()), &cheapOption,
               spectralPointers.data());

    D4COption d4cOption;
    InitializeD4COption(&d4cOption);
    D4C(signal.data(), count, sampleRate, timeAxis.data(), f0.data(),
        static_cast<int>(f0.size()), fftSize, &d4cOption,
        aperiodicityPointers.data());

    const double pitchRatio = std::pow(2.0, static_cast<double>(semitones) / 12.0);
    if (!std::isfinite(pitchRatio) || pitchRatio <= 0.0) return -1;
    for (double& value : f0) {
        if (value > 0.0) value = std::clamp(value * pitchRatio, 40.0, 1200.0);
    }

    std::vector<const double*> spectralConst(f0.size());
    std::vector<const double*> aperiodicityConst(f0.size());
    for (size_t i = 0; i < f0.size(); ++i) {
        spectralConst[i] = spectralPointers[i];
        aperiodicityConst[i] = aperiodicityPointers[i];
    }

    std::vector<double> synthesized(count);
    Synthesis(f0.data(), static_cast<int>(f0.size()),
              spectralConst.data(), aperiodicityConst.data(), fftSize,
              kFramePeriodMs, sampleRate, count, synthesized.data());

    for (int i = 0; i < count; ++i) {
        const double value = synthesized[i] * gain;
        output[i] = static_cast<float>(std::clamp(value, -1.0, 1.0));
    }
    return count;
}
}
