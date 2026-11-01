"""Local RFC 1179 peers and scoped spool submission/query/removal/delivery."""
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading

binary = str(Path(sys.argv[1]).resolve())


def exact(stream, count):
    result = bytearray()
    while len(result) < count:
        part = stream.read(count - len(result))
        assert part
        result.extend(part)
    return bytes(result)


with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    payload = bytes(range(256)) * 17
    source = root / "binary.dat"
    source.write_bytes(payload)
    errors = []
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        listener.settimeout(5)

        def reference():
            try:
                with listener.accept()[0] as connection:
                    connection.settimeout(5)
                    stream = connection.makefile("rwb", buffering=0)
                    assert stream.readline() == b"\x02lp\n"
                    stream.write(b"\0")
                    names = []
                    for kind in (3, 2):
                        header = stream.readline()
                        assert header[0] == kind, header
                        size, name = header[1:].split()
                        stream.write(b"\0")
                        data = exact(stream, int(size))
                        assert exact(stream, 1) == b"\0"
                        if kind == 3:
                            assert data == payload
                            names.append(name)
                        else:
                            assert b"Ptester\n" in data and b"JTitle\n" in data
                            assert b"Ltester\n" in data and b"Mtester\n" in data
                            assert b"l" + names[0] + b"\n" in data
                        stream.write(b"\0")
            except Exception as error:
                errors.append(error)

        worker = threading.Thread(target=reference)
        worker.start()
        result = subprocess.run([binary, "lpr", "-P", f"lp@127.0.0.1:{listener.getsockname()[1]}",
                                 "-U", "tester", "-J", "Title", "-mh", str(source)], capture_output=True, timeout=8)
        worker.join(timeout=6)
        assert not worker.is_alive() and not errors and result.returncode == 0, (errors, result)
    spool = root / "spool"
    queue = spool / "lp"
    queue.mkdir(parents=True)
    delivered = root / "delivered"
    helper = root / "print"
    helper.write_text(f'#!/bin/sh\ncat "$DATAFILE" >> "{delivered}"\n')
    helper.chmod(0o755)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen(5)
        listener.settimeout(8)

        def serve():
            try:
                for index in range(5):
                    with listener.accept()[0] as connection:
                        connection.settimeout(None)
                        args = [binary, "lpd", str(spool)] + ([str(helper)] if index == 4 else [])
                        result = subprocess.run(args, stdin=connection, stdout=connection,
                                                stderr=subprocess.PIPE, timeout=8)
                        assert result.returncode == 0, result
            except Exception as error:
                errors.append(error)

        worker = threading.Thread(target=serve)
        worker.start()
        printer = f"lp@127.0.0.1:{listener.getsockname()[1]}"

        def client(applet, *args):
            result = subprocess.run([binary, applet, "-P", printer, "-U", "tester", *args], capture_output=True, timeout=8)
            assert result.returncode == 0, result
            return result.stdout

        client("lpr", "-J", "stored", str(source))
        assert len(list(queue.glob("cf*"))) == 1 and next(queue.glob("df*")).read_bytes() == payload
        assert b"tester stored" in client("lpq", "-s")
        assert b"removed" in client("lpq", "-d")
        assert not list(queue.iterdir())
        client("lpr", str(source))
        client("lpq", "-f")
        worker.join(timeout=8)
        assert not worker.is_alive() and not errors, errors
        assert delivered.read_bytes() == payload and not list(queue.iterdir())
    outside = root / "outside"
    outside.write_bytes(b"KEEP")
    parent, child = socket.socketpair()
    with parent, child:
        parent.settimeout(3)
        process = subprocess.Popen([binary, "lpd", str(spool)], stdin=child, stdout=child, stderr=subprocess.PIPE)
        stream = parent.makefile("rwb", buffering=0)
        stream.write(b"\x02lp\n")
        assert exact(stream, 1) == b"\0"
        stream.write(b"\x031 ../../outside\n")
        assert exact(stream, 1) == b"\1"
        assert process.wait(timeout=3) == 1
    assert outside.read_bytes() == b"KEEP" and not list(queue.iterdir())
print("RFC 1179 binary submission/spool/query/removal/helper and path rejection checks passed")
