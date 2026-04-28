require('dotenv').config();

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();

app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

const {
  CLICKUP_API_TOKEN,
  CLICKUP_LIST_ID,
  LINE_CHANNEL_ACCESS_TOKEN,
  LINE_CHANNEL_SECRET,
  LINE_ALLOWED_USER_IDS = '',
  PORT = 3000,
} = process.env;

if (!CLICKUP_API_TOKEN || !CLICKUP_LIST_ID) {
  console.error('Missing CLICKUP_API_TOKEN or CLICKUP_LIST_ID in .env');
  process.exit(1);
}

const lineEnabled = Boolean(LINE_CHANNEL_ACCESS_TOKEN && LINE_CHANNEL_SECRET);
const allowedUserIds = new Set(
  LINE_ALLOWED_USER_IDS.split(',').map((s) => s.trim()).filter(Boolean)
);

const CLICKUP_BASE_URL = 'https://api.clickup.com/api/v2';
const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';

function toUnixMs(dateInput, fieldName) {
  if (dateInput === undefined || dateInput === null || dateInput === '') return null;
  if (typeof dateInput === 'number') return dateInput;

  const ms = Date.parse(dateInput);
  if (Number.isNaN(ms)) {
    const err = new Error(`Invalid date for "${fieldName}": ${dateInput}`);
    err.statusCode = 400;
    throw err;
  }
  return ms;
}

function timeEstimateToMs(input) {
  if (input === undefined || input === null || input === '') return null;
  if (typeof input === 'number') return Math.round(input * 60 * 1000);

  const match = String(input).trim().match(/^(\d+(?:\.\d+)?)\s*(m|h)?$/i);
  if (!match) {
    const err = new Error(`Invalid time_estimate: ${input}. Use a number (minutes) or "90m" / "2h".`);
    err.statusCode = 400;
    throw err;
  }
  const value = parseFloat(match[1]);
  const unit = (match[2] || 'm').toLowerCase();
  const multiplier = unit === 'h' ? 60 * 60 * 1000 : 60 * 1000;
  return Math.round(value * multiplier);
}

function buildClickUpPayload(body) {
  const payload = { name: body.name };

  if (body.description !== undefined) payload.description = body.description;
  if (body.status !== undefined) payload.status = body.status;
  if (body.priority !== undefined) payload.priority = body.priority;
  if (Array.isArray(body.assignees)) payload.assignees = body.assignees;
  if (Array.isArray(body.tags)) payload.tags = body.tags;

  const startMs = toUnixMs(body.start_date, 'start_date');
  if (startMs !== null) {
    payload.start_date = startMs;
    payload.start_date_time = true;
  }

  const dueMs = toUnixMs(body.due_date, 'due_date');
  if (dueMs !== null) {
    payload.due_date = dueMs;
    payload.due_date_time = true;
  }

  const estimateMs = timeEstimateToMs(body.time_estimate);
  if (estimateMs !== null) payload.time_estimate = estimateMs;

  return payload;
}

async function createTaskInClickUp(payload) {
  const { data } = await axios.post(
    `${CLICKUP_BASE_URL}/list/${CLICKUP_LIST_ID}/task`,
    payload,
    {
      headers: {
        Authorization: CLICKUP_API_TOKEN,
        'Content-Type': 'application/json',
      },
    }
  );
  return data;
}

app.post('/api/tasks', async (req, res) => {
  try {
    if (!req.body.name || typeof req.body.name !== 'string' || !req.body.name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Field "name" is required and must be a non-empty string.',
      });
    }

    const payload = buildClickUpPayload(req.body);
    const data = await createTaskInClickUp(payload);

    return res.status(201).json({
      success: true,
      message: 'Task created successfully.',
      task_id: data.id,
      task_url: data.url,
    });
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ success: false, message: err.message });
    }
    if (err.response) {
      return res.status(err.response.status).json({
        success: false,
        message: 'ClickUp API rejected the request.',
        clickup_error: err.response.data,
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Unexpected server error.',
      error: err.message,
    });
  }
});

const PRIORITY_MAP = { urgent: 1, high: 2, normal: 3, low: 4 };
const PRIORITY_LABEL = { 1: 'Urgent', 2: 'High', 3: 'Normal', 4: 'Low' };
const PRIORITY_EMOJI = { 1: '🔴', 2: '🟠', 3: '🔵', 4: '⚪' };

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowYmd() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function parseLineMessage(text) {
  let stripped = text;
  let priority;
  let due_date;
  let time_estimate;
  const tags = [];

  stripped = stripped.replace(/#(urgent|high|normal|low)\b/gi, (_m, p) => {
    priority = PRIORITY_MAP[p.toLowerCase()];
    return '';
  });

  stripped = stripped.replace(/!(\S+)/g, (_m, d) => {
    const lower = d.toLowerCase();
    if (d === 'วันนี้' || lower === 'today') due_date = todayYmd();
    else if (d === 'พรุ่งนี้' || lower === 'tomorrow') due_date = tomorrowYmd();
    else due_date = d;
    return '';
  });

  stripped = stripped.replace(/@(\d+(?:\.\d+)?[hm]?)\b/gi, (_m, t) => {
    time_estimate = t;
    return '';
  });

  stripped = stripped.replace(/\+(\S+)/g, (_m, t) => {
    tags.push(t);
    return '';
  });

  const name = stripped.trim().replace(/\s+/g, ' ');
  return {
    name,
    priority,
    due_date,
    time_estimate,
    tags: tags.length ? tags : undefined,
  };
}

async function lineReply(replyToken, messages) {
  await axios.post(LINE_REPLY_URL, { replyToken, messages }, {
    headers: {
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
}

function buildFlexCard(task, parsed) {
  const details = [];
  const row = (label, value) => ({
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#aaaaaa', flex: 2 },
      { type: 'text', text: value, size: 'sm', flex: 5, wrap: true },
    ],
  });

  if (parsed.priority) {
    details.push(row('Priority', `${PRIORITY_EMOJI[parsed.priority]} ${PRIORITY_LABEL[parsed.priority]}`));
  }
  if (parsed.due_date) details.push(row('Due', parsed.due_date));
  if (parsed.time_estimate) details.push(row('Estimate', parsed.time_estimate));
  if (parsed.tags?.length) details.push(row('Tags', parsed.tags.join(', ')));

  const bodyContents = [
    { type: 'text', text: '✅ สร้าง Task สำเร็จ', weight: 'bold', color: '#1DB446', size: 'sm' },
    { type: 'text', text: parsed.name, weight: 'bold', size: 'md', wrap: true, margin: 'md' },
  ];
  if (details.length) {
    bodyContents.push(
      { type: 'separator', margin: 'md' },
      { type: 'box', layout: 'vertical', margin: 'md', spacing: 'sm', contents: details }
    );
  }

  return {
    type: 'flex',
    altText: `✅ สร้าง task: ${parsed.name}`,
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: bodyContents },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [{
          type: 'button',
          style: 'primary',
          color: '#1DB446',
          action: { type: 'uri', label: 'เปิดใน ClickUp', uri: task.url },
        }],
      },
    },
  };
}

const HELP_TEXT =
  'รูปแบบข้อความ:\n' +
  '<ชื่องาน> [#priority] [!วันที่] [@เวลา] [+tag]\n\n' +
  'ตัวอย่าง:\n' +
  'ทำสไลด์นำเสนอ #urgent !2026-05-15 @2h +q2\n\n' +
  '• Priority: #urgent #high #normal #low\n' +
  '• Date: !YYYY-MM-DD, !วันนี้, !พรุ่งนี้\n' +
  '• Estimate: @2h, @90m\n' +
  '• Tag: +ชื่อ_tag (ห้ามมีช่องว่าง)\n\n' +
  'พิมพ์ "whoami" เพื่อดู userId ของคุณ';

async function handleLineEvent(event) {
  if (event.type !== 'message' || event.message?.type !== 'text') return;

  const userId = event.source?.userId;
  const replyToken = event.replyToken;
  const text = event.message.text.trim();

  if (text.toLowerCase() === 'whoami') {
    await lineReply(replyToken, [{
      type: 'text',
      text: `Your userId:\n${userId}\n\nแจ้ง admin เพิ่ม userId นี้ใน LINE_ALLOWED_USER_IDS เพื่อใช้สั่งสร้าง task`,
    }]);
    return;
  }

  if (!userId || !allowedUserIds.has(userId)) {
    await lineReply(replyToken, [{
      type: 'text',
      text: '❌ ไม่ได้รับอนุญาตให้ใช้งาน\nพิมพ์ "whoami" เพื่อรับ userId แล้วแจ้ง admin',
    }]);
    return;
  }

  if (text === '/help' || text.toLowerCase() === 'help') {
    await lineReply(replyToken, [{ type: 'text', text: HELP_TEXT }]);
    return;
  }

  try {
    const parsed = parseLineMessage(text);
    if (!parsed.name) {
      await lineReply(replyToken, [{
        type: 'text',
        text: '❌ ไม่พบชื่องาน — โปรดระบุชื่อก่อนใส่ tag/option\nพิมพ์ help เพื่อดูรูปแบบ',
      }]);
      return;
    }

    const payload = buildClickUpPayload(parsed);
    const task = await createTaskInClickUp(payload);
    await lineReply(replyToken, [buildFlexCard(task, parsed)]);
  } catch (err) {
    const detail = err.response?.data?.err || err.message || 'Unknown error';
    await lineReply(replyToken, [{ type: 'text', text: `❌ ไม่สามารถสร้าง task ได้\n${detail}` }]);
  }
}

app.post('/webhook/line', (req, res) => {
  if (!lineEnabled) return res.status(503).send('LINE not configured');

  const signature = req.headers['x-line-signature'];
  if (!signature) return res.status(401).send('Missing signature');

  const expected = crypto
    .createHmac('sha256', LINE_CHANNEL_SECRET)
    .update(req.rawBody || Buffer.from(''))
    .digest('base64');

  if (signature !== expected) return res.status(401).send('Bad signature');

  res.sendStatus(200);

  const events = req.body.events || [];
  for (const event of events) {
    handleLineEvent(event).catch((err) => {
      console.error('LINE event error:', err.response?.data || err.message);
    });
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok', line: lineEnabled }));

app.listen(PORT, () => {
  console.log(`ClickUp wrapper listening on http://localhost:${PORT} (line=${lineEnabled})`);
});

module.exports = { parseLineMessage };
