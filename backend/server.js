import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';

const app = express();
app.use(cors({ origin: true, methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.options('*', cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));

const port = Number(process.env.PORT || 8787);
const model = process.env.OPENAI_MODEL || 'gpt-5.5';
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM = `You are Chrome Autopilot, an autonomous browser task agent.

Convert the user's goal into ONE concrete browser action at a time. You receive a compact DOM snapshot and recent conversation context. Choose the next action that makes measurable progress. Do not invent element ids. If an action fails, adapt using the new snapshot.

Return valid json only. The JSON object must match this schema:
{"action":"click|type|scroll|navigate|wait|finish","elementId":"string or null","text":"string or null","url":"string or null","amount":"number or null","reason":"short string","result":"string or null"}

Rules:
- click: use an elementId from the snapshot.
- type: use elementId and text.
- navigate: use a fully-qualified URL.
- scroll: amount is pixels; positive means down, negative up.
- wait: amount is milliseconds, max 5000.
- finish: result briefly states what was accomplished.
- Never claim success before the browser result confirms it.
- Prefer visible, semantically relevant controls.
- Work autonomously; do not ask the user for routine confirmation.
- Use conversation context to understand follow-up requests and references such as 'that page', 'same thing', or 'go back'.
- If the requested task cannot be completed from the browser context, finish with a clear explanation.`;

function normalizeSnapshot(snapshot = {}) {
  return {
    url: String(snapshot.url || ''),
    title: String(snapshot.title || ''),
    text: String(snapshot.text || '').slice(0, 12000),
    elements: Array.isArray(snapshot.elements) ? snapshot.elements.slice(0, 250) : []
  };
}

function normalizeConversation(conversation = []) {
  if (!Array.isArray(conversation)) return [];
  return conversation.slice(-20).map(item => ({
    role: item?.role === 'assistant' ? 'assistant' : 'user',
    content: String(item?.content || '').slice(0, 3000)
  }));
}

app.get('/health', (_req, res) => res.json({ ok: true, model }));

app.post('/next', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the backend.' });
    }

    const { goal, snapshot, history = [], conversation = [], step = 0 } = req.body || {};
    if (!goal) return res.status(400).json({ error: 'goal is required' });

    const safeHistory = Array.isArray(history) ? history.slice(-12) : [];
    const safeConversation = normalizeConversation(conversation);
    const input = [{
      role: 'user',
      content: `USER GOAL:\n${String(goal).slice(0, 5000)}\n\nCURRENT STEP: ${step}\n\nPAGE SNAPSHOT:\n${JSON.stringify(normalizeSnapshot(snapshot))}\n\nRECENT ACTION RESULTS:\n${JSON.stringify(safeHistory)}\n\nCONVERSATION MEMORY (recent messages):\n${JSON.stringify(safeConversation)}\n\nRespond with valid json only. The response must be a JSON object matching the action schema from the system instructions.`
    }];

    const response = await client.responses.create({
      model,
      instructions: SYSTEM,
      input,
      text: { format: { type: 'json_object' } },
      reasoning: { effort: 'medium' }
    });

    let action;
    try {
      action = JSON.parse(response.output_text);
    } catch {
      return res.status(502).json({ error: 'Model returned invalid JSON' });
    }

    const allowed = new Set(['click', 'type', 'scroll', 'navigate', 'wait', 'finish']);
    if (!allowed.has(action.action)) action.action = 'finish';
    if (action.action !== 'finish' && action.action !== 'navigate' && !action.elementId && !['scroll', 'wait'].includes(action.action)) {
      action.action = 'finish';
      action.result = 'No valid target element was provided.';
    }

    res.json({ action, responseId: response.id });
  } catch (error) {
    console.error(error?.stack || error?.message || error);
    res.status(500).json({ error: error?.message || 'Agent error' });
  }
});

app.listen(port, '127.0.0.1', () => console.log(`Chrome Autopilot backend listening on http://127.0.0.1:${port}`));
