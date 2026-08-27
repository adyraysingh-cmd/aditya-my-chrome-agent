import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));

const port = Number(process.env.PORT || 8787);
const model = process.env.OPENAI_MODEL || 'gpt-5.5';
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM = `You are Chrome Autopilot, an autonomous browser task agent.\n\nYour job is to convert a user's goal into ONE concrete browser action at a time. You receive a compact DOM snapshot from the Chrome extension. Choose the next action that makes measurable progress. Do not invent element ids. If an action fails, adapt using the new snapshot.\n\nReturn strict JSON only with this schema:\n{"action":"click|type|scroll|navigate|wait|finish","elementId":"string or null","text":"string or null","url":"string or null","amount":"number or null","reason":"short string","result":"string or null"}\n\nRules:\n- click: use an elementId from the snapshot.\n- type: use elementId and text.\n- navigate: use a fully-qualified URL.\n- scroll: amount is pixels; positive means down, negative up.\n- wait: amount is milliseconds, max 5000.\n- finish: result briefly states what was accomplished.\n- Never claim success before the browser result confirms it.\n- Prefer visible, semantically relevant controls.\n- Work autonomously; do not ask the user for routine confirmation.\n- If the requested task cannot be completed from the browser context, finish with a clear explanation.`;

function normalizeSnapshot(snapshot = {}) {
  return {
    url: String(snapshot.url || ''),
    title: String(snapshot.title || ''),
    text: String(snapshot.text || '').slice(0, 12000),
    elements: Array.isArray(snapshot.elements) ? snapshot.elements.slice(0, 250) : []
  };
}

app.get('/health', (_req, res) => res.json({ ok: true, model }));

app.post('/next', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the backend.' });
    }

    const { goal, snapshot, history = [], step = 0 } = req.body || {};
    if (!goal) return res.status(400).json({ error: 'goal is required' });

    const safeHistory = Array.isArray(history) ? history.slice(-12) : [];
    const input = [{
      role: 'user',
      content: `USER GOAL:\n${String(goal).slice(0, 5000)}\n\nCURRENT STEP: ${step}\n\nPAGE SNAPSHOT:\n${JSON.stringify(normalizeSnapshot(snapshot))}\n\nRECENT ACTION RESULTS:\n${JSON.stringify(safeHistory)}`
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
    console.error(error?.message || error);
    res.status(500).json({ error: error?.message || 'Agent error' });
  }
});

app.listen(port, () => console.log(`Chrome Autopilot backend listening on port ${port}`));
