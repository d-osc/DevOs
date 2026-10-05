"""Shared cleanup for isolated native smoke sessions."""
import os
import shutil
import signal
import subprocess


def cleanup_session(session, pointer, document_mount):
    if pointer:
        pointer.stdin.close()
        try:
            pointer.wait(timeout=3)
        except subprocess.TimeoutExpired:
            pointer.kill()
            pointer.wait()
    if session.poll() is None:
        os.killpg(session.pid, signal.SIGTERM)
        try:
            session.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(session.pid, signal.SIGKILL)
            session.wait()
    fusermount = shutil.which('fusermount3') or shutil.which('fusermount')
    if fusermount:
        subprocess.run([fusermount, '-uz', str(document_mount)], capture_output=True, timeout=5)
