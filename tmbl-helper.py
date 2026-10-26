#!/usr/bin/env python3
"""Local AVIF/JPEG XL encoder for Tumbal Proyek.

Uses system FFmpeg with libaom-av1 for AVIF. For JPEG XL, it prefers cjxl
and falls back to FFmpeg built with the libjxl encoder. No Python packages are
required. Start this helper once; the reader calls it on localhost:7332.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from pathlib import Path
import json
import os
import shutil
import subprocess
import tempfile

HOST = "127.0.0.1"
PORT = 7332
MAX_INPUT = 64 * 1024 * 1024
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")


def clamp_int(value, lo, hi, default):
    try:
        return max(lo, min(hi, int(value)))
    except (TypeError, ValueError):
        return default


def build_command(fmt, src, dst, crf, speed, quality, effort):
    if fmt == "avif":
        return [
            FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(src), "-frames:v", "1", "-c:v", "libaom-av1",
            "-still-picture", "1", "-cpu-used", str(speed), "-crf", str(crf),
            "-pix_fmt", "yuv420p", "-f", "avif", str(dst),
        ]
    if fmt == "jxl":
        cjxl = shutil.which("cjxl")
        if cjxl:
            return [cjxl, str(src), str(dst), "-q", str(quality), "-e", str(effort)]
        distance = max(0.0, min(15.0, (100 - quality) * 0.15))
        return [
            FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(src), "-frames:v", "1", "-c:v", "libjxl",
            "-distance", f"{distance:.3f}", "-effort", str(effort),
            "-f", "image2", "-update", "1", str(dst),
        ]
    raise ValueError("Unsupported format. Use format=avif or format=jxl.")


class Handler(BaseHTTPRequestHandler):
    server_version = "TumbalHelper/2.0"

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def send_bytes(self, status, data, content_type):
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            payload = {"ok": True, "host": HOST, "port": PORT,
                       "formats": {"avif": "FFmpeg with libaom-av1",
                                   "jxl": "cjxl, or FFmpeg with libjxl"}}
            self.send_bytes(200, json.dumps(payload).encode("utf-8"), "application/json")
            return
        self.send_bytes(404, b'{"error":"not found"}', "application/json")

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/encode":
            self.send_bytes(404, b'{"error":"not found"}', "application/json")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0:
            self.send_bytes(400, b'{"error":"empty request"}', "application/json")
            return
        if length > MAX_INPUT:
            self.send_bytes(413, b'{"error":"input image is too large"}', "application/json")
            return
        body = self.rfile.read(length)
        if not body:
            self.send_bytes(400, b'{"error":"empty request"}', "application/json")
            return

        qs = parse_qs(parsed.query)
        fmt = (qs.get("format", ["avif"])[0] or "avif").lower()
        if fmt not in ("avif", "jxl"):
            self.send_bytes(400, b'{"error":"unsupported format; use avif or jxl"}', "application/json")
            return
        crf = clamp_int(qs.get("crf", [42])[0], 1, 63, 42)
        speed = clamp_int(qs.get("speed", [4])[0], 0, 8, 4)
        quality = clamp_int(qs.get("quality", [90])[0], 1, 100, 90)
        effort = clamp_int(qs.get("effort", [7])[0], 1, 9, 7)
        mime = "image/avif" if fmt == "avif" else "image/jxl"
        try:
            with tempfile.TemporaryDirectory(prefix="tumbal-helper-") as td:
                td = Path(td)
                src = td / "input.png"
                dst = td / ("output.avif" if fmt == "avif" else "output.jxl")
                src.write_bytes(body)
                cmd = build_command(fmt, src, dst, crf, speed, quality, effort)
                proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
                if proc.returncode != 0:
                    err = proc.stderr.strip() or f"Encoder exited with code {proc.returncode}"
                    if fmt == "jxl" and "libjxl" in err.lower():
                        err += ". Install cjxl or use an FFmpeg build with the libjxl encoder."
                    elif fmt == "avif" and "libaom" in err.lower():
                        err += ". Use an FFmpeg build with the libaom-av1 encoder."
                    raise RuntimeError(err)
                if not dst.exists():
                    raise RuntimeError("Encoder reported success but did not create an output file")
                data = dst.read_bytes()
                if not data:
                    raise RuntimeError(f"Encoder produced an empty {fmt.upper()} image")
            self.send_bytes(200, data, mime)
        except subprocess.TimeoutExpired:
            self.send_bytes(504, b'{"error":"Encoder timed out"}', "application/json")
        except FileNotFoundError:
            message = "Could not run JXL encoder. Install cjxl or use FFmpeg with libjxl." if fmt == "jxl" else "FFmpeg was not found. Install FFmpeg and ensure it is in PATH."
            self.send_bytes(500, json.dumps({"error": message}).encode("utf-8"), "application/json")
        except Exception as exc:
            payload = json.dumps({"error": str(exc)}, ensure_ascii=False).encode("utf-8")
            self.send_bytes(500, payload, "application/json")


if __name__ == "__main__":
    print(f"Tumbal AVIF/JXL helper listening on http://{HOST}:{PORT}")
    print("AVIF requires FFmpeg/libaom-av1; JXL requires cjxl or FFmpeg/libjxl.")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
