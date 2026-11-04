# My Vocal Online Lab

Standalone online test page for the My Vocal Python audio API.

## Deploy to Render

Create a **Web Service** connected to this repository.

- Root Directory: \`online-lab\`
- Runtime: Python 3
- Build Command: \`pip install -r requirements.txt\`
- Start Command: \`gunicorn server:app\`
- Instance: Free for initial testing

Render deploys the Flask API and serves the HTML/CSS/JS from the same origin. No CORS setup is needed.

## Local development

\`\`\`bash
cd online-lab
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python server.py
\`\`\`

Open \`http://localhost:10000\`.

## API

- \`GET /api/health\`
- \`POST /api/analyze\` with multipart field \`audio\`
- \`POST /api/convert\` with multipart fields \`audio\` and \`semitones\`

## Limits and privacy

- WAV input only for this first version.
- Maximum upload: 20 MB.
- Maximum duration: 20 seconds.
- Audio is processed in memory and is not intentionally written to disk.
- Free hosting can sleep while idle; the first request after idle may take around a minute to wake.
- This is an experimental PSOLA implementation. Audio quality is not yet validated for production use.
