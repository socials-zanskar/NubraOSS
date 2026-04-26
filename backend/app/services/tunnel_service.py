from __future__ import annotations

import re
import subprocess
import threading
import time
from collections import deque

from fastapi import HTTPException

from app.config import settings
from app.schemas import TunnelStatusResponse


class TunnelService:
    def __init__(self) -> None:
        self._process: subprocess.Popen[str] | None = None
        self._public_url: str | None = None
        self._last_error: str | None = None
        self._logs: deque[str] = deque(maxlen=40)
        self._lock = threading.RLock()
        self._url_pattern = re.compile(r"https://[a-zA-Z0-9.-]+")

    def _append_log(self, line: str) -> None:
        message = line.strip()
        if not message:
            return
        with self._lock:
            self._logs.append(message)
            if self._public_url is None and "trycloudflare.com" in message:
                match = self._url_pattern.search(message)
                if match:
                    self._public_url = match.group(0)

    def _stream_reader(self, stream: object) -> None:
        if stream is None:
            return
        try:
            for line in stream:
                self._append_log(str(line))
        finally:
            try:
                stream.close()
            except Exception:
                pass

    def _process_running(self) -> bool:
        return self._process is not None and self._process.poll() is None

    def _ensure_binary(self) -> None:
        try:
            subprocess.run(
                [settings.cloudflared_path, "--version"],
                check=True,
                capture_output=True,
                text=True,
                timeout=10,
            )
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Unable to run cloudflared from '{settings.cloudflared_path}': {exc}",
            ) from exc

    def status(self) -> TunnelStatusResponse:
        with self._lock:
            running = self._process_running()
            if not running and self._process is not None and self._last_error is None:
                self._last_error = "Cloudflare tunnel process is not running."
            return TunnelStatusResponse(
                running=running,
                public_url=self._public_url,
                target_url=settings.cloudflare_tunnel_target_url,
                last_error=self._last_error,
                logs=list(self._logs),
            )

    def start(self) -> TunnelStatusResponse:
        self._ensure_binary()
        with self._lock:
            if self._process_running():
                return self.status()

            self._public_url = None
            self._last_error = None
            self._logs.clear()

            try:
                self._process = subprocess.Popen(
                    [
                        settings.cloudflared_path,
                        "tunnel",
                        "--url",
                        settings.cloudflare_tunnel_target_url,
                        "--no-autoupdate",
                    ],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    bufsize=1,
                )
            except Exception as exc:
                self._last_error = f"Unable to start cloudflared: {exc}"
                raise HTTPException(status_code=500, detail=self._last_error) from exc

            assert self._process is not None
            threading.Thread(target=self._stream_reader, args=(self._process.stdout,), daemon=True).start()
            threading.Thread(target=self._stream_reader, args=(self._process.stderr,), daemon=True).start()

        deadline = time.time() + 20
        while time.time() < deadline:
            with self._lock:
                if self._public_url:
                    return self.status()
                if not self._process_running():
                    self._last_error = self._last_error or "cloudflared exited before a public URL was assigned."
                    break
            time.sleep(0.25)

        with self._lock:
            self._last_error = self._last_error or "Timed out while waiting for a Cloudflare public URL."
        return self.status()

    def stop(self) -> TunnelStatusResponse:
        with self._lock:
            process = self._process
            self._process = None
            self._public_url = None
            if process is None or process.poll() is not None:
                self._last_error = None
                return TunnelStatusResponse(
                    running=False,
                    public_url=None,
                    target_url=settings.cloudflare_tunnel_target_url,
                    last_error=None,
                    logs=list(self._logs),
                )

        try:
            process.terminate()
            process.wait(timeout=5)
        except Exception:
            try:
                process.kill()
            except Exception:
                pass

        with self._lock:
            self._last_error = None
            self._logs.append("Cloudflare tunnel stopped.")
        return self.status()


tunnel_service = TunnelService()
