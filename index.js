require('dotenv').config();

const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const { CLICKUP_API_TOKEN, CLICKUP_LIST_ID, PORT = 3000 } = process.env;

if (!CLICKUP_API_TOKEN || !CLICKUP_LIST_ID) {
  console.error('Missing CLICKUP_API_TOKEN or CLICKUP_LIST_ID in .env');
  process.exit(1);
}

const CLICKUP_BASE_URL = 'https://api.clickup.com/api/v2';

/**
 * Convert a date string ("YYYY-MM-DD" or ISO 8601) to Unix milliseconds.
 * Returns null if the input is falsy; throws if it's an invalid date.
 */
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

/**
 * Convert a time estimate to milliseconds.
 * Accepts:
 *   - number  -> treated as minutes
 *   - "90m"   -> minutes
 *   - "2h"    -> hours
 *   - "1.5h"  -> hours (fractional ok)
 */
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

app.post('/api/tasks', async (req, res) => {
  try {
    if (!req.body.name || typeof req.body.name !== 'string' || !req.body.name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Field "name" is required and must be a non-empty string.',
      });
    }

    const payload = buildClickUpPayload(req.body);

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

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`ClickUp wrapper listening on http://localhost:${PORT}`);
});
