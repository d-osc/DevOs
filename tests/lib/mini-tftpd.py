#!/usr/bin/env python3
"""A tiny TFTP server for tests: mini-tftpd.py PORT DIRECTORY (serves one read or write request, then exits)."""
import os
import socket
import struct
import sys

port = int(sys.argv[1])
root = sys.argv[2]
listener = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
listener.bind(("127.0.0.1", port))
request, client = listener.recvfrom(1024)
opcode = struct.unpack("!H", request[:2])[0]
name = request[2:].split(b"\0")[0].decode()
transfer = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
transfer.bind(("127.0.0.1", 0))
transfer.settimeout(5)
path = os.path.join(root, name)
if opcode == 1:
    with open(path, "rb") as handle:
        data = handle.read()
    block = 1
    position = 0
    while True:
        chunk = data[position:position + 512]
        transfer.sendto(struct.pack("!HH", 3, block) + chunk, client)
        transfer.recvfrom(1024)
        position += 512
        block += 1
        if len(chunk) < 512:
            break
elif opcode == 2:
    transfer.sendto(struct.pack("!HH", 4, 0), client)
    received = b""
    while True:
        packet, _ = transfer.recvfrom(1024)
        number = struct.unpack("!H", packet[2:4])[0]
        received += packet[4:]
        transfer.sendto(struct.pack("!HH", 4, number), client)
        if len(packet) - 4 < 512:
            break
    with open(path, "wb") as handle:
        handle.write(received)
