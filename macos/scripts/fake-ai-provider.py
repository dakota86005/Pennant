"""A stand-in AI provider for the Mac app's UI tests (N13): an OpenAI-compatible server on 127.0.0.1 that answers every
chat completion with the same short streamed answer, so the Staff room can be shown answering without any real provider,
key or network. `macos/scripts/test.sh` starts it, points the app's local provider at it (`PENNANT_DEV_LOCAL_AI_URL`,
passed to the server as `OLLAMA_BASE_URL`) and stops it after the tests.

Usage: python3 -I fake-ai-provider.py <port file>   (writes the port it listens on into the file, then serves)
"""
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# The answer, in pieces as a model streams them: the Staff room's markdown subset, and a link the model made up, which
# the server must not pass on as a link (D-074)
PIECES = [
    "**The read**\n",
    "Everything in the figures says the club is about where its record puts it. ",
    "Nothing there calls for a change yet; see [this page](https://example.com/made-up) for more.\n",
    "• The decision is yours.",
]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):  # noqa: A002 (the base class's name)
        sys.stderr.write("fake-ai-provider: " + (format % args) + "\n")

    def _json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802 (the base class's name)
        if self.path.rstrip("/").endswith("/models"):
            self._json(200, {"object": "list", "data": [{"id": "stub", "object": "model", "owned_by": "pennant-tests"}]})
        else:
            self._json(404, {"error": {"message": "not here"}})

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        request = json.loads(self.rfile.read(length) or b"{}")
        if not self.path.rstrip("/").endswith("/chat/completions"):
            self._json(404, {"error": {"message": "not here"}})
            return
        if not request.get("stream"):
            self._json(200, {
                "id": "stub", "object": "chat.completion", "created": int(time.time()), "model": "stub",
                "choices": [{"index": 0, "message": {"role": "assistant", "content": "".join(PIECES)}, "finish_reason": "stop"}],
            })
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()

        def chunk(delta, finish=None):
            payload = {
                "id": "stub", "object": "chat.completion.chunk", "created": int(time.time()), "model": "stub",
                "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
            }
            self.wfile.write(b"data: " + json.dumps(payload).encode() + b"\n\n")
            self.wfile.flush()

        chunk({"role": "assistant", "content": ""})
        for piece in PIECES:
            time.sleep(0.4)
            chunk({"content": piece})
        chunk({}, "stop")
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    with open(sys.argv[1], "w") as port_file:
        port_file.write(str(server.server_address[1]))
    server.serve_forever()


if __name__ == "__main__":
    main()
