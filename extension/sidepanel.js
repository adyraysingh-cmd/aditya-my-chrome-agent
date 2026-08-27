const BACKEND_URL = 'http://127.0.0.1:8787';
const $ = id => document.getElementById(id);
let running = false;
let history = [];
let chats = [];
let currentChatId = null;

function makeId() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }

async function loadChats() {
  const data = await chrome.storage.local.get(['autopilotChats', 'autopilotCurrentChatId']);
  chats = Array.isArray(data.autopilotChats) ? data.autopilotChats : [];
  currentChatId = data.autopilotCurrentChatId || chats[0]?.id || null;
  if (!currentChatId) newChat(false);
  else if (!chats.some(c => c.id === currentChatId)) currentChatId = chats[0]?.id || null;
  renderChatList();
  renderMessages();
}

async function saveChats() {
  await chrome.storage.local.set({ autopilotChats: chats, autopilotCurrentChatId: currentChatId });
}

function currentChat() { return chats.find(c => c.id === currentChatId); }

function newChat(save = true) {
  const chat = { id: makeId(), title: 'New chat', createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
  chats.unshift(chat);
  currentChatId = chat.id;
  history = [];
  renderChatList();
  renderMessages();
  if (save) saveChats();
}

function selectChat(id) {
  if (running) return;
  currentChatId = id;
  history = [];
  renderChatList();
  renderMessages();
  saveChats();
}

function addMessage(role, content) {
  const chat = currentChat();
  if (!chat) return;
  chat.messages.push({ role, content: String(content), ts: Date.now() });
  chat.updatedAt = Date.now();
  if (role === 'user' && chat.title === 'New chat') chat.title = String(content).replace(/\s+/g, ' ').slice(0, 42) || 'New chat';
  renderChatList();
  renderMessages();
  saveChats();
}

function renderChatList() {
  const list = $('chatList');
  list.textContent = '';
  for (const chat of chats.slice().sort((a,b) => b.updatedAt - a.updatedAt)) {
    const div = document.createElement('div');
    div.className = `chat-item${chat.id === currentChatId ? ' active' : ''}`;
    div.textContent = chat.title || 'New chat';
    div.onclick = () => selectChat(chat.id);
    list.appendChild(div);
  }
}

function renderMessages() {
  const container = $('messages');
  container.textContent = '';
  const chat = currentChat();
  const messages = chat?.messages || [];
  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '<strong>What can I do for you?</strong>Give me a browser task and I’ll work through it.';
    container.appendChild(empty);
    return;
  }
  for (const m of messages) {
    const row = document.createElement('div');
    row.className = `msg ${m.role}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = m.content;
    row.appendChild(bubble);
    container.appendChild(row);
  }
  container.scrollTop = container.scrollHeight;
}

function status(text) { $('status').textContent = text; }
function log(text) {
  const p = document.createElement('div');
  p.textContent = text;
  $('log').prepend(p);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function activeTab() {
  const result = await chrome.runtime.sendMessage({ type: 'getActiveTab' });
  if (!result?.tab?.id) throw new Error('No active tab found');
  return result.tab;
}

async function ensureContent(tabId) {
  const result = await chrome.runtime.sendMessage({ type: 'ensureContentScript', tabId });
  if (!result?.ok) throw new Error(result?.error || 'Could not inject page controller');
}

function msgTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, response => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}

async function nextAction(payload) {
  const r = await fetch(`${BACKEND_URL}/next`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Backend request failed');
  return data;
}

async function run() {
  if (running) return;
  const goal = $('goal').value.trim();
  if (!goal) return status('Enter a task first.');
  const chat = currentChat();
  if (!chat) return newChat();

  addMessage('user', goal);
  $('goal').value = '';
  running = true;
  history = [];
  $('run').disabled = true;
  $('stop').disabled = false;
  $('log').textContent = '';

  try {
    let step = 0;
    while (running && step < 40) {
      const tab = await activeTab();
      try { await ensureContent(tab.id); } catch (e) {
        throw new Error(`Cannot control this tab. Open a normal webpage (not chrome:// or the Chrome Web Store). ${e.message}`);
      }
      const snap = await msgTab(tab.id, { type: 'snapshot' });
      if (!snap?.snapshot) throw new Error('Could not read the active page.');
      status(`Working • step ${step + 1}`);
      const conversation = (currentChat()?.messages || []).slice(-20);
      const data = await nextAction({ goal, snapshot: snap.snapshot, history, conversation, step });
      const a = data.action || {};
      log(`${step + 1}. ${a.action}${a.elementId ? ` → ${a.elementId}` : ''}${a.reason ? ` — ${a.reason}` : ''}`);

      if (a.action === 'finish') {
        const result = a.result || 'Task finished.';
        addMessage('assistant', result);
        status('Finished');
        break;
      }

      const result = await msgTab(tab.id, { type: 'execute', action: a });
      history.push({ action: a, result: { ok: result?.ok, message: result?.message } });
      if (!result?.ok) log(`ERROR: ${result?.message || 'Browser action failed'}`);
      await sleep(a.action === 'navigate' ? 1500 : 500);
      step++;
    }
    if (step >= 40) { status('Stopped at 40 steps.'); addMessage('assistant', 'I stopped after 40 browser steps to avoid an endless loop.'); }
  } catch (e) {
    status('Error');
    log(`ERROR: ${e.message}`);
    addMessage('assistant', `I couldn’t complete the task: ${e.message}`);
  } finally {
    running = false;
    $('run').disabled = false;
    $('stop').disabled = true;
    await saveChats();
  }
}

$('run').onclick = run;
$('stop').onclick = () => { running = false; status('Stopping…'); };
$('newChat').onclick = () => newChat();
$('newTop').onclick = () => newChat();
$('historyToggle').onclick = () => $('historyPanel').classList.toggle('hidden');
$('goal').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(); }
});
loadChats();
