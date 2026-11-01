"""Validate composition with Python's email parser and extraction with binary data."""
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
import os
from pathlib import Path
import subprocess
import sys
import tempfile

binary = str(Path(sys.argv[1]).resolve())
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    payload = bytes(range(256)) * 23
    (root / "binary.dat").write_bytes(payload)
    result = subprocess.run([binary, "makemime", "-a", "From: dev@example.test",
                             "-a", "Subject: test", "-c", "application/octet-stream",
                             "binary.dat"], cwd=root, capture_output=True, timeout=10)
    assert result.returncode == 0, result
    parsed = BytesParser(policy=policy.default).parsebytes(result.stdout)
    assert not parsed.defects and parsed["From"] == "dev@example.test" and parsed["Subject"] == "test"
    attachments = list(parsed.iter_attachments())
    assert len(attachments) == 1 and attachments[0].get_filename() == "binary.dat"
    assert attachments[0].get_payload(decode=True) == payload
    extracted = root / "out"
    extracted.mkdir()
    decoded = subprocess.run([binary, "reformime", "-x", str(extracted) + "/"],
                              input=result.stdout, cwd=root, capture_output=True, timeout=10)
    assert decoded.returncode == 0, decoded
    assert (extracted / "binary.dat").read_bytes() == payload
    filtered = subprocess.run([binary, "reformime", "-X", "cat"], input=result.stdout,
                              cwd=root, capture_output=True, timeout=10)
    assert filtered.returncode == 0 and filtered.stdout == payload, filtered
    message = EmailMessage()
    message.set_content("quoted = text\n", cte="quoted-printable")
    message.add_attachment(payload, maintype="application", subtype="octet-stream", filename="../../outside.bin")
    nested = EmailMessage()
    nested.set_content("nested body")
    message.add_attachment(nested)
    decoded = subprocess.run([binary, "reformime", "-x", str(root / "prefix-")],
                              input=message.as_bytes(), cwd=root, capture_output=True, timeout=10)
    assert decoded.returncode == 0, decoded
    assert (root / "prefix-part1").read_text() == "quoted = text\n"
    assert (root / "prefix-outside.bin").read_bytes() == payload
    assert not (root.parent / "outside.bin").exists()
    raw_binary = (b'Content-Type: multipart/mixed; boundary="binary-test"\r\n\r\n'
                  b'--binary-test\r\nContent-Type: application/octet-stream\r\n'
                  b'Content-Transfer-Encoding: binary\r\n\r\nab\x00cd\r\nef\r\n--binary-test--\r\n')
    filtered = subprocess.run([binary, "reformime", "-X", "cat"], input=raw_binary,
                              cwd=root, capture_output=True, timeout=10)
    assert filtered.returncode == 0 and filtered.stdout == b"ab\x00cd\r\nef", filtered
    for data in (b"Content-Type: text/plain\nContent-Transfer-Encoding: base64\n\n@@@",
                 b'Content-Type: multipart/mixed; boundary="not-closed"\n\n--not-closed\n\nbody'):
        bad = subprocess.run([binary, "reformime", "-X", "cat"], input=data,
                             cwd=root, capture_output=True, timeout=10)
        assert bad.returncode == 1, bad
print("MIME composition/extraction/filter, quoted-printable and filename checks passed")
