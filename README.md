# OpenAI Chrome Autopilot

A Chrome Manifest V3 extension + Node backend that lets an OpenAI model operate a browser page through a controlled DOM tool loop.

## Architecture

Chrome side panel → local/hosted Node backend → OpenAI Responses API → browser action → fresh DOM snapshot → repeat.

The backend uses the official OpenAI JavaScript SDK and Responses API. Keep the API key only on the backend; never put it in the extension bundle.

## Backend

Requirements: Node.js 20+.

```bash
cd backend
cp .env.example .env
npm install
npm start
```

Health check: `http://127.0.0.1:8787/health`

For hosting, set `OPENAI_API_KEY` and `PORT` in the platform environment. Never commit `.env`.

## Chrome extension

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select the `extension` folder.
5. Open a normal webpage.
6. Click the extension icon to open the side panel.
7. Enter a task and click **Run Autopilot**.

## Notes

- Browser control uses DOM actions: click, type, scroll, wait, and navigation.
- The agent receives a compact DOM/text snapshot each step.
- There is a 40-step execution ceiling to prevent runaway loops.
- Chrome-internal pages and the Chrome Web Store cannot be controlled by ordinary content scripts.
- For production, add authenticated backend access, persistent task state, richer element targeting, screenshots/vision, file handling, tab management, and robust action verification.
