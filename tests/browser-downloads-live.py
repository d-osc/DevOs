"""After npm run build, run the real WebKit download fixture under Xvfb."""
import http.server
import os
from pathlib import Path
import subprocess
import threading
import time


class Attachment(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/octet-stream')
        self.send_header('Content-Disposition', 'attachment; filename="sample.bin"')
        self.send_header('Content-Length', str(2 * 1024 * 1024))
        self.end_headers()
        try:
            for _ in range(32):
                self.wfile.write(b'A' * 65536)
                self.wfile.flush()
                time.sleep(.1)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    with http.server.ThreadingHTTPServer(('127.0.0.1', 0), Attachment) as server:
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            env = dict(os.environ, GDK_BACKEND='x11', NO_AT_BRIDGE='1',
                       DEV_OS_BROWSER_DOWNLOAD_URL=f'http://127.0.0.1:{server.server_port}/sample.bin')
            result = subprocess.run(['xvfb-run', '-a', 'gjs', '-m', 'dist/browser-downloads-live-test.js'],
                                    cwd=root, env=env, timeout=40)
        finally:
            server.shutdown()
    raise SystemExit(result.returncode)
