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


class DevServer(ThreadingHTTPServer):
    # socketserver defaults this to 5, i.e. listen(5), and ThreadingHTTPServer
    # never raises it. bubble/index.html pulls forty-odd module scripts, so the
    # browser opens connections in bursts; once more than five are waiting to be
    # accepted the kernel refuses the rest outright and Chrome reports
    # ERR_CONNECTION_REFUSED.
    #
    # A refused module script is close to invisible: it fires no pageerror, so
    # the page just sits there half-booted. That is what made
    # home_effect_registry look like a slow shader compile -- bubble.js had
    # never arrived, THREE was undefined, and the test waited out its full 90s
    # on a condition nothing was ever going to satisfy. Roughly one load in
    # twenty was hit, which is exactly often enough to look like flakiness in
    # the app rather than a five-deep accept queue.
    request_queue_size = 128


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = DevServer(("", port), FastRequestHandler)
    print(f"Serving on http://localhost:{port}/ (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
