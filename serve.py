"""Local dev server for VFX Playground.

Plain `python -m http.server` calls socket.getfqdn() on every request to
resolve the client's hostname for logging. On machines where DNS lookups
are slow or blocked (VPN, corporate network, no internet), that reverse
lookup stalls every single file request, making page loads with many
script/css files feel like they hang. This server skips that lookup.
"""
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler


class FastRequestHandler(SimpleHTTPRequestHandler):
    def address_string(self):
        return self.client_address[0]

    def end_headers(self):
        # Never let the browser reuse a cached copy.
        #
        # SimpleHTTPRequestHandler sends Last-Modified and honours
        # If-Modified-Since, but Chrome is free to skip revalidation entirely on
        # a normal navigation (heuristic freshness). That already cost us a full
        # round of shader-compile measurements: the diagnostics page had been
        # rewritten -- longer timeout, extra instrumentation, a different probe
        # plan -- and the browser quietly kept serving the previous version, so
        # the numbers described code that was no longer on disk.
        #
        # For a diagnostics dev server, "always fetch what is actually on disk"
        # matters far more than saving a few kilobytes.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = ThreadingHTTPServer(("", port), FastRequestHandler)
    print(f"Serving on http://localhost:{port}/ (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
