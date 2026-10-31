#!/usr/bin/env python3
"""A tiny passive-mode FTP server for tests: mini-ftpd.py PORT DIRECTORY (serves one session, then exits)."""
import os
import socket
import sys

port = int(sys.argv[1])
root = sys.argv[2]
server = socket.socket()
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind(("127.0.0.1", port))
server.listen(1)
control, _ = server.accept()
reader = control.makefile("rb")


def reply(text):
    control.sendall((text + "\r\n").encode())


reply("220 mini ftpd")
data_server = None
while True:
    line = reader.readline().decode().strip()
    if not line:
        break
    command, _, argument = line.partition(" ")
    command = command.upper()
    if command == "USER":
        reply("331 password please")
    elif command == "PASS":
        reply("230 logged in")
    elif command == "TYPE":
        reply("200 type set")
    elif command == "PASV":
        data_server = socket.socket()
        data_server.bind(("127.0.0.1", 0))
        data_server.listen(1)
        p = data_server.getsockname()[1]
        reply("227 Entering Passive Mode (127,0,0,1,%d,%d)" % (p // 256, p % 256))
    elif command == "RETR":
        path = os.path.join(root, argument)
        if not os.path.isfile(path):
            reply("550 no such file")
            continue
        reply("150 opening data connection")
        connection, _ = data_server.accept()
        with open(path, "rb") as handle:
            connection.sendall(handle.read())
        connection.close()
        reply("226 transfer complete")
    elif command == "STOR":
        reply("150 ok to send")
        connection, _ = data_server.accept()
        chunks = []
        while True:
            block = connection.recv(65536)
            if not block:
                break
            chunks.append(block)
        connection.close()
        with open(os.path.join(root, argument), "wb") as handle:
            handle.write(b"".join(chunks))
        reply("226 transfer complete")
    elif command == "QUIT":
        reply("221 bye")
        break
    else:
        reply("502 not implemented")
control.close()
