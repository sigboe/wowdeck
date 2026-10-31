# Serves a directory to the phone through `adb reverse` with the CORS header a
# module import from Steam needs. Usage: python3 -I serve.py <dir> <port>
import http.server, sys, functools
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[2])), functools.partial(H, directory=sys.argv[1])).serve_forever()
