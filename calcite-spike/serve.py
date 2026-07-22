#!/usr/bin/env python3
"""Static file server with HTTP Range support — for running the CheerpJ spike.

Python's built-in ``python -m http.server`` ignores the ``Range`` header, but
CheerpJ streams the jar with byte-range requests and refuses to run without
206 Partial Content responses ("HTTP server does not support the 'Range'
header"). This is a drop-in replacement that adds Range support.

Usage (from this ``calcite-spike/`` directory)::

    python serve.py            # serves this dir on http://localhost:8000/
    python serve.py 8080       # custom port

Then open http://localhost:8000/ and the page tests itself. (Run it from the
repo root instead and the page lives at /calcite-spike/ — both work.)
"""
import http.server
import os
import re
import sys


class RangeRequestHandler(http.server.SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler that honours a single ``bytes=`` range."""

    def send_head(self):
        self._range_remaining = None
        range_header = self.headers.get("Range")
        if range_header is None:
            return super().send_head()

        m = re.match(r"bytes=(\d*)-(\d*)\s*$", range_header.strip())
        if not m:
            return super().send_head()

        path = self.translate_path(self.path)
        try:
            f = open(path, "rb")
        except OSError:
            self.send_error(404, "File not found")
            return None

        try:
            size = os.fstat(f.fileno()).st_size
            start_s, end_s = m.group(1), m.group(2)
            if start_s == "":
                # suffix form: bytes=-N  → last N bytes
                length = int(end_s)
                start = max(0, size - length)
                end = size - 1
            else:
                start = int(start_s)
                end = int(end_s) if end_s else size - 1

            if start >= size:
                self.send_error(416, "Requested Range Not Satisfiable")
                f.close()
                return None

            end = min(end, size - 1)
            length = end - start + 1

            self.send_response(206)
            self.send_header("Content-Type", self.guess_type(path))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Content-Length", str(length))
            self.end_headers()

            f.seek(start)
            self._range_remaining = length
            return f
        except Exception:
            f.close()
            raise

    def copyfile(self, source, outputfile):
        remaining = self._range_remaining
        if remaining is None:
            return super().copyfile(source, outputfile)
        while remaining > 0:
            chunk = source.read(min(64 * 1024, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)

    def end_headers(self):
        # Advertise range support on plain 200 responses too.
        if "Accept-Ranges" not in self._headers_buffer_keys():
            self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def _headers_buffer_keys(self):
        keys = []
        for raw in getattr(self, "_headers_buffer", []) or []:
            text = raw.decode("latin-1", "replace")
            if ":" in text:
                keys.append(text.split(":", 1)[0])
        return keys


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    with http.server.ThreadingHTTPServer(("", port), RangeRequestHandler) as httpd:
        print(f"Serving {os.getcwd()} with Range support on http://localhost:{port}/")
        print("Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
