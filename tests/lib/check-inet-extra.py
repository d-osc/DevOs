"""Local UDP peer affinity/concurrency/environment checks and ident inetd mode."""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time

binary = str(Path(sys.argv[1]).resolve())
for query in (b"123, 456\r\n", b"bad\r\n"):
    result = subprocess.run([binary, "fakeidentd", "-i", "demo"], input=query,
                            capture_output=True, timeout=5)
    assert result.returncode == 0, result
    assert result.stdout == query.strip() + b" : USERID : UNIX : demo\r\n", result
with tempfile.TemporaryDirectory() as directory:
    helper = Path(directory) / "handler.py"
    helper.write_text('''import json, os, socket
s = socket.socket(fileno=0)
for sequence in range(2):
    payload = s.recv(4096)
    s.send(json.dumps({"payload": payload.decode(), "sequence": sequence,
                       "pid": os.getpid(), "proto": os.getenv("PROTO"),
                       "remote": os.getenv("UDPREMOTEIP"), "host": os.getenv("UDPLOCALHOST")}).encode())
''')
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    process = subprocess.Popen([binary, "udpsvd", "-c", "2", "-l", "local-test",
                                "127.0.0.1", str(port), "python3", str(helper)],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    clients = [socket.socket(socket.AF_INET, socket.SOCK_DGRAM) for _ in range(2)]
    try:
        time.sleep(.15)
        responses = []
        for client in clients:
            client.settimeout(3)
            client.connect(("127.0.0.1", port))
            client.send(b"first")
            reply = json.loads(client.recv(4096))
            assert reply["payload"] == "first" and reply["sequence"] == 0, reply
            assert reply["proto"] == "UDP" and reply["remote"] == "127.0.0.1" and reply["host"] == "local-test", reply
            responses.append(reply)
        assert responses[0]["pid"] != responses[1]["pid"], responses
        for client, previous in zip(clients, responses):
            client.send(b"second")
            reply = json.loads(client.recv(4096))
            assert reply["sequence"] == 1 and reply["pid"] == previous["pid"], reply
    finally:
        for client in clients:
            client.close()
        os.killpg(process.pid, signal.SIGTERM)
        process.communicate(timeout=5)
print("ident and UDP concurrent-peer/session/environment checks passed")
