// A stand-in AI provider for the Mac app's UI tests (N13): an OpenAI-compatible server on 127.0.0.1 that answers every
// chat completion with the same short streamed answer (and one known question slowly, for Stop), so the Staff room can
// be shown answering without any real provider, key or network. `macos/scripts/test.sh` starts it, points the app's
// local provider at it (`PENNANT_DEV_LOCAL_AI_URL`, passed to the server as `OLLAMA_BASE_URL`) and stops it after the
// tests. Node, as the server is: a Python server's name lookup on macOS 26 asked for local-network access and its
// dialog covered the windows under test (CI run 38085037441).
//
// Usage: node fake-ai-provider.mjs <port file>   (writes the port it listens on into the file, then serves)
import fs from 'node:fs';
import http from 'node:http';

// The answer, in pieces as a model streams them: the Staff room's markdown subset, and a link the model made up, which
// the app must never open (D-074)
const PIECES = [
  '**The read**\n',
  'Everything in the figures says the club is about where its record puts it. ',
  'Nothing there calls for a change yet; see [this page](https://example.com/made-up) for more.\n',
  '• The decision is yours.',
];

// The slow answer, for one known question (the UI test's "And the bullpen?"): a first piece at once, then a piece every
// 300 ms for about half a minute, so the test can see Stop and press Escape while it is still streaming (review N13B,
// M5). Its last piece is never reached when the answer is stopped.
const SLOW_TRIGGER = 'And the bullpen?';
const SLOW_PIECES = ['Starting on the bullpen. ', ...Array(100).fill('More on the bullpen. '), 'That is the whole bullpen read.'];
const SLOW_MS = 300;

/** The last question the GM asked, as the server passed it on (a string, or the parts of one). */
const lastQuestion = (asked) => {
  const users = (Array.isArray(asked.messages) ? asked.messages : []).filter((m) => m && m.role === 'user');
  const content = users.length ? users[users.length - 1].content : '';
  return typeof content === 'string' ? content : JSON.stringify(content ?? '');
};

const json = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
};

const server = http.createServer((req, res) => {
  const path = (req.url ?? '').split('?')[0].replace(/\/+$/, '');
  if (req.method === 'GET' && path.endsWith('/models')) {
    return json(res, 200, { object: 'list', data: [{ id: 'stub', object: 'model', owned_by: 'pennant-tests' }] });
  }
  if (req.method !== 'POST' || !path.endsWith('/chat/completions')) return json(res, 404, { error: { message: 'not here' } });
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    let asked = {};
    try { asked = JSON.parse(raw || '{}'); } catch { /* answered all the same */ }
    const created = Math.floor(Date.now() / 1000);
    if (!asked.stream) {
      return json(res, 200, {
        id: 'stub', object: 'chat.completion', created, model: 'stub',
        choices: [{ index: 0, message: { role: 'assistant', content: PIECES.join('') }, finish_reason: 'stop' }],
      });
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const chunk = (delta, finish = null) => res.write(`data: ${JSON.stringify({
      id: 'stub', object: 'chat.completion.chunk', created, model: 'stub', choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`);
    chunk({ role: 'assistant', content: '' });
    const slow = lastQuestion(asked).includes(SLOW_TRIGGER);
    const pieces = slow ? SLOW_PIECES : PIECES;
    const pause = slow ? SLOW_MS : 400;
    let i = 0;
    const next = () => {
      if (res.destroyed) return;
      if (i < pieces.length) {
        chunk({ content: pieces[i++] });
        setTimeout(next, pause);
      } else {
        chunk({}, 'stop');
        res.end('data: [DONE]\n\n');
      }
    };
    setTimeout(next, slow ? 0 : 400);
  });
});

server.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(process.argv[2], String(server.address().port));
});
