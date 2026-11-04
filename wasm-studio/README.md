# MyVocal Studio (WASM prototype)

HTML/CSS/JavaScript UI + C++ audio engine compiled to WebAssembly. Audio decoding and processing run in the browser; audio is not uploaded to an API server.

## Current features

- Load browser-supported audio files (decoded by the Web Audio API)
- Display a mono waveform preview
- Estimate F0 with a YIN difference-function implementation
- Export F0 frames as CSV
- Trim by start/end time, adjust gain, and export mono PCM 16-bit WAV
- Experimental time-domain PSOLA pitch shifting intended to preserve the selected clip duration

## PSOLA status and limitations

The pitch shifter is an early time-domain PSOLA-style prototype. It estimates local F0 with YIN, places synthesis grains at pitch-dependent intervals, and uses windowed overlap-add. Unvoiced sections are passed through. The selected clip duration remains unchanged.

This is not yet production-quality voice conversion. YIN errors, noisy or polyphonic audio, abrupt pitch changes, and unvoiced consonants may cause artifacts. Please validate with several clean, single-voice recordings and compare both pitch and duration. The engine currently processes mono audio.

## Build

Install Emscripten and CMake, then from this directory:

```sh
emcmake cmake -S . -B build
cmake --build build
```

Copy the generated `build/engine.js` and `build/engine.wasm` into this directory (next to `index.html`).

For local testing, serve this directory over HTTP (for example, `python3 -m http.server 8000`) and open `http://localhost:8000`. Opening the HTML as a `file://` URL may prevent WASM loading.

## GitHub Pages

Publish the built static files together with the generated `engine.js` and `engine.wasm`. GitHub Pages serves static files; the WASM engine runs in each visitor's browser.

## Notes

- Supported input formats depend on the browser's Web Audio decoder.
- Export format is mono 16-bit PCM WAV at the original sample rate.
- Multi-channel input is downmixed to mono for analysis and export.
- No intentional server-side audio storage or upload is implemented.
