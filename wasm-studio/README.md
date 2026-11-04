# MyVocal Studio (WORLD / WebAssembly)

MyVocal Studio uses an HTML/CSS/JavaScript interface and a C++ audio engine compiled to WebAssembly. Audio decoding, analysis, pitch modification, and synthesis run locally in the browser. Audio is not uploaded to an API server.

## Audio engine

The C++ engine integrates the upstream [WORLD vocoder](https://github.com/mmorise/World), pinned to revision `c794856b537758a3d300757db2e5e31685a822c2`.

Processing pipeline:

1. Convert the selected mono audio segment to WORLD's internal double-precision format.
2. Estimate F0 with DIO and refine it with StoneMask.
3. Estimate the spectral envelope with CheapTrick.
4. Estimate aperiodicity with D4C.
5. Apply the requested semitone ratio to voiced F0 frames.
6. Resynthesize with WORLD Synthesis using the original sample count.

The synthesis output buffer is explicitly allocated to the selected segment's original sample count. The WAV writer uses the original sample rate, so pitch adjustment is designed to change pitch without changing clip duration. Actual sound quality still needs testing with real recordings.

## Current features

- Load browser-supported audio files (decoded by the Web Audio API)
- Display a mono waveform preview
- Estimate and visualize F0 using WORLD DIO + StoneMask
- Export F0 frames as CSV
- Trim by start/end time
- Change pitch by modifying the WORLD F0 contour
- Adjust gain and export mono PCM 16-bit WAV
- Run all processing in the browser using WebAssembly

## Requirements and limitations

- WORLD is intended for speech sampled at 16 kHz or higher. The current adapter rejects lower sample rates.
- The current UI downmixes multi-channel input to mono.
- Pitch shifting changes F0 while retaining the analyzed spectral envelope and aperiodicity. This is not a complete voice-conversion or singing-synthesis system.
- Very short, noisy, polyphonic, or heavily processed audio may produce poor analysis or artifacts.
- Pitch-shift quality, timing, and memory use must be validated in the target browser. This first integration is not yet a production-quality release.

## Build

Install Emscripten and CMake, then from this directory:

```sh
emcmake cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
```

CMake downloads the pinned upstream WORLD source during configuration. No separate audio server is needed.

The generated browser files are `build/engine.js` and `build/engine.wasm`. The GitHub Actions workflow assembles them with the UI and publishes the static site.

## Local testing

Serve the generated static files over HTTP (for example, `python3 -m http.server 8000`) and open the local page. Opening the HTML as a `file://` URL may prevent WebAssembly loading.

## Third-party notices

WORLD is distributed under its modified BSD license. The license text and pinned upstream revision are included in [WORLD-LICENSE.txt](WORLD-LICENSE.txt).
