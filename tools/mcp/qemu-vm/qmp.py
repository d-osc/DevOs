#!/usr/bin/env python3
"""Linux-side bridge for the DevOs QEMU MCP server.

  qmp.py qmp SOCKET     stdin: JSON list of steps, stdout: JSON list of replies
  qmp.py serial SOCKET  stdin: raw bytes written to the guest serial socket

A QMP step is {"execute": name, "arguments": {...}} or {"sleep": seconds}.
Only private Unix sockets created by the server are used; nothing is evaluated.
"""
import json
import socket
import sys
import time


def connect(path):
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(15)
    sock.connect(path)
    return sock


def read_line(sock, buffer):
    while b"\n" not in buffer:
        chunk = sock.recv(65536)
        if not chunk:
            raise ConnectionError("QMP socket closed")
        buffer += chunk
    line, _, rest = buffer.partition(b"\n")
    return json.loads(line), rest


def qmp(path):
    steps = json.load(sys.stdin)
    if not isinstance(steps, list) or len(steps) > 2000:
        raise ValueError("steps must be a list of at most 2000 items")
    sock = connect(path)
    buffer = b""
    _, buffer = read_line(sock, buffer)  # greeting
    replies = []

    def call(step):
        nonlocal buffer
        sock.sendall(json.dumps(step).encode() + b"\n")
        while True:
            message, buffer = read_line(sock, buffer)
            if "return" in message or "error" in message:
                return message

    call({"execute": "qmp_capabilities"})
    for step in steps:
        if "sleep" in step:
            time.sleep(min(float(step["sleep"]), 5))
            continue
        try:
            replies.append(call({"execute": step["execute"], **({"arguments": step["arguments"]} if "arguments" in step else {})}))
        except ConnectionError:
            # quit / system_powerdown may close the socket before replying.
            replies.append({"return": {}, "closed": True})
            break
    print(json.dumps(replies))


def serial(path):
    data = sys.stdin.buffer.read()
    sock = connect(path)
    sock.sendall(data)
    sock.close()
    print(json.dumps({"sent": len(data)}))


if __name__ == "__main__":
    try:
        if len(sys.argv) != 3 or sys.argv[1] not in ("qmp", "serial"):
            raise SystemExit("usage: qmp.py qmp|serial SOCKET")
        {"qmp": qmp, "serial": serial}[sys.argv[1]](sys.argv[2])
    except (OSError, ValueError, KeyError) as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)
