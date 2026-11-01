"""Exercise RFC 868 with local TCP responses; all calls are print-only."""
import datetime
import os
import socket
import struct
import subprocess
import sys
import threading
import time

binary = sys.argv[1]


def check(parts, flags, expected_status, expected_output=None):
    with socket.socket() as server:
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        server.settimeout(10)
        errors = []

        def respond():
            try:
                with server.accept()[0] as client:
                    for part in parts:
                        client.sendall(part)
                        time.sleep(0.03)
            except Exception as exc:
                errors.append(exc)

        worker = threading.Thread(target=respond)
        worker.start()
        try:
            result = subprocess.run(
                [binary, "rdate", *flags, f"127.0.0.1:{server.getsockname()[1]}"],
                env={**os.environ, "TZ": "UTC", "LC_ALL": "C"},
                capture_output=True, timeout=15,
            )
        finally:
            worker.join(timeout=12)
        assert not worker.is_alive() and not errors, errors
        assert result.returncode == expected_status, result
        if expected_output is not None:
            assert result.stdout == expected_output, result


for year in (2026, 2040):
    stamp = int(datetime.datetime(year, 1, 2, 3, 4, 5, tzinfo=datetime.timezone.utc).timestamp())
    wire = struct.pack("!I", (stamp + 2208988800) % 2**32)
    expected = datetime.datetime.fromtimestamp(stamp, datetime.timezone.utc).strftime(
        "%a %b %e %H:%M:%S %Y\n"
    ).encode()
    check([wire[:1], wire[1:]], ["-p"], 0, expected)
    check([wire], ["-sp"], 0, expected)
check([b"\x01\x02"], ["-p"], 1, b"")
check([], ["-p"], 1, b"")
print("rdate local TCP checks passed")
