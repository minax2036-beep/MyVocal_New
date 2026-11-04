# MyVocal Studio (WASM prototype)

HTML/CSS/JavaScript UI + C++ audio engine compiled to WebAssembly. Audio decoding and processing run in the browser; this prototype does not upload audio to an API server.

## Current features

- Load browser-supported audio files (decode through Web Audio API)
- Display a mono waveform preview
- Estimate F0 with a YIN difference-function implementation
- Export F0 frames as CSV
- Trim by start/end time, adjust gain, and export mono PCM 16-bit WAV
- Experimental pitch adjustment using linear resampling

## Important limitation

The current pitch adjustment changes playback duration as well as pitch. It is **not** duration-preserving PSOLA or a phase vocoder. The YIN implementation is an initial prototype and should be validated against reference audio before being treated as accurate.

## Build

Install Emscripten and CMake, then from this directory:

```sh
emcmake cmake -S . -B build
cmake --build build
```

Copy the generated `build/myvocal_engine.js` and `build/myvocal_engine.wasm` into this directory (next to `index.html`).

For local testing, serve this directory over HTTP (for example, `python3 -m http.server 8000`) and open `http://localhost:8000`. Opening the HTML as a `file://` URL may prevent WASM loading.

## GitHub Pages

After building, publish the contents of this directory together with the generated `myvocal_engine.js` and `myvocal_engine.wasm` files. GitHub Pages serves static files; it does not execute C++ or Python on the server. The WASM engine runs in each visitor's browser.

## Notes

- Supported input formats depend on the browser's Web Audio decoder.
- The export format is mono 16-bit PCM WAV at the original sample rate.
- Multi-channel input is downmixed to mono for analysis and export.
- No intentional server-side audio storage or upload is implemented.
