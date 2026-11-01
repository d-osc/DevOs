"""Local SMTP/POP3 peers; never contacts a real mail server."""
import base64
import hashlib
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading

binary = str(Path(sys.argv[1]).resolve())


def peer(handler, client):
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        server.settimeout(8)
        errors = []

        def serve():
            try:
                with server.accept()[0] as connection:
                    connection.settimeout(8)
                    handler(connection.makefile("rwb", buffering=0))
            except Exception as error:
                errors.append(error)

        worker = threading.Thread(target=serve)
        worker.start()
        try:
            result = client(server.getsockname()[1])
        finally:
            worker.join(timeout=10)
        assert not worker.is_alive() and not errors, errors
        return result


recipients = []
messages = []


def smtp(stream):
    stream.write(b"220 local test\r\n")
    assert stream.readline() == b"EHLO localhost\r\n"
    stream.write(b"250-local\r\n250 AUTH LOGIN\r\n")
    assert stream.readline() == b"AUTH LOGIN\r\n"
    stream.write(b"334 VXNlcm5hbWU6\r\n")
    assert base64.b64decode(stream.readline()) == b"tester"
    stream.write(b"334 UGFzc3dvcmQ6\r\n")
    assert base64.b64decode(stream.readline()) == b"secret"
    stream.write(b"235 OK\r\n")
    assert stream.readline() == b"MAIL FROM:<sender@example.test>\r\n"
    stream.write(b"250 OK\r\n")
    while True:
        line = stream.readline()
        if line == b"DATA\r\n":
            stream.write(b"354 send message\r\n")
            break
        assert line.startswith(b"RCPT TO:"), line
        recipients.append(line)
        stream.write(b"250 OK\r\n")
    message = bytearray()
    while True:
        line = stream.readline()
        assert line
        if line == b".\r\n":
            break
        message.extend(line)
    messages.append(bytes(message))
    stream.write(b"250 stored\r\n")
    assert stream.readline() == b"QUIT\r\n"
    stream.write(b"221 bye\r\n")


message = b"To: Person <to@example.test>\nCc: cc@example.test\nBcc: hidden@example.test\nSubject: test\n\n.leading\nbody\n"
result = peer(smtp, lambda port: subprocess.run(
    [binary, "sendmail", "-f", "sender@example.test", "-S", f"127.0.0.1:{port}",
     "-autester", "-apsecret", "to@example.test"], input=message,
    capture_output=True, timeout=12))
assert result.returncode == 0, result
assert len(recipients) == 3 and any(b"hidden@" in line for line in recipients), recipients
assert b"Bcc:" not in messages[0] and b"..leading\r\n" in messages[0], messages

with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    helper = root / "connect.py"
    helper.write_text('''import os, select, socket, sys
s = socket.create_connection(("127.0.0.1", int(sys.argv[1])))
while True:
    ready, _, _ = select.select([0, s], [], [], 10)
    if not ready: break
    if 0 in ready:
        data = os.read(0, 65536)
        if not data: break
        s.sendall(data)
    if s in ready:
        data = s.recv(65536)
        if not data: break
        os.write(1, data)
''')
    for failure, keep, apop in ((False, False, False), (False, True, True), (True, False, False)):
        maildir = root / f"mail-{failure}-{keep}-{apop}"
        commands = []

        def pop(stream):
            challenge = b"<challenge@test>" if apop else b""
            stream.write(b"+OK ready " + challenge + b"\r\n")
            if apop:
                expected = b"APOP tester " + hashlib.md5(challenge + b"secret").hexdigest().encode() + b"\r\n"
                assert stream.readline() == expected
                stream.write(b"+OK\r\n")
            else:
                assert stream.readline() == b"USER tester\r\n"
                stream.write(b"+OK\r\n")
                assert stream.readline() == b"PASS secret\r\n"
                stream.write(b"+OK\r\n")
            assert stream.readline() == b"STAT\r\n"
            stream.write(b"+OK 1 40\r\n")
            assert stream.readline() == b"RETR 1\r\n"
            stream.write(b"+OK\r\nSubject: test\r\n\r\n..leading\r\nbody\r\n.\r\n")
            command = stream.readline()
            commands.append(command)
            if failure:
                assert command == b"", command
                return
            delivered = list((maildir / "new").iterdir())
            assert len(delivered) == 1
            assert b".leading\r\nbody\r\n" in delivered[0].read_bytes()
            if not keep:
                assert command == b"DELE 1\r\n", command
                stream.write(b"+OK\r\n")
                command = stream.readline()
            assert command == b"QUIT\r\n", command
            stream.write(b"+OK\r\n")

        options = ["-M", "exit 1"] if failure else (["-k"] if keep else [])
        result = peer(pop, lambda port: subprocess.run(
            [binary, "popmaildir", *options, str(maildir), "python3", str(helper), str(port)],
            input=b"tester\nsecret\n", capture_output=True, timeout=12))
        assert result.returncode == (1 if failure else 0), result
        if failure:
            assert b"DELE 1\r\n" not in commands
print("local SMTP auth/recipients/Bcc/dot-stuffing and POP3 APOP/durable-delivery/error checks passed")
