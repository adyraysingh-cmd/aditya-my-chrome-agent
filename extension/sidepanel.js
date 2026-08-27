const BACKEND_URL = 'http://127.0.0.1:8787';
const $ = id => document.getElementById(id);
let running = false;
let history = [];

function log(text) {
  const p = document.createElement('div');
  p.textContent = text;
  $('log').prepend(p);
}
function status(text) { $('status').textContent = text; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function msgTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, response => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}
async function activeTab() {
  const result = await chrome.runtime.sendMessage({ type: 'getActiveTab' });
  if (!result?.tab?.id) throw new Error('No active tab found');
  return result.tab;
}
async function nextAction(payload) {
  const r = await fetch(`${BACKEND_URL}/next`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Backend request failed');
  return data;
}

async function run() {
  if (running) return;
  const goal = $('goal').value.trim();
  if (!goal) return status('Enter a goal first.');
  running = true;
  history = [];
  $('run').disabled = true;
  $('stop').disabled = false;
  $('log').textContent = '';
  try {
    let step = 0;
    while (running && step < 40) {
      const tab = await activeTab();
      let snap;
      try {
        snap = await msgTab(tab.id, { type: 'snapshot' });
      } catch (e) {
        throw new Error(`Cannot access this tab. Open a normal webpage and try again. ${e.message}`);
      }
      if (!snap?.snapshot) throw new Error('Could not read the active page.');
      status(`Step ${step + 1}\n${snap.snapshot.title || snap.snapshot.url || ''}`);
      const data = await nextAction({ goal, snapshot: snap.snapshot, history, step });
      const a = data.action;
      log(`${step + 1}. ${a.action}${a.elementId ? ` → ${a.elementId}` : ''}${a.reason ? ` — ${a.reason}` : ''}`);
      if (a.action === 'finish') {
        status(a.result || 'Finished.');
        break;
      }
      const result = await msgTab(tab.id, { type: 'execute', action: a });
      history.push({ action: a, result: { ok: result?.ok, message: result?.message } });
      if (!result?.ok) log(`ERROR: ${result?.message || 'Unknown browser action failure'}`);
      await sleep(a.action === 'navigate' ? 1500 : 500);
      step++;
    }
    if (step >= 40) status('Stopped after 40 steps to prevent runaway execution.');
  } catch (e) {
    status(`Error: ${e.message}`);
    log(`ERROR: ${e.message}`);
  } finally {
    running = false;
    $('run').disabled = false;
    $('stop').disabled = true;
  }
}

$('run').onclick = run;
$('stop').onclick = () => {
  running = false;
  status('Stopping…');
};
