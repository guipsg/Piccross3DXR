"""Servidor estático local para o Picross 3D XR.

Uso:  py serve.py [porta]            (padrão 8080, só localhost)
      py serve.py 8080 --lan         (expõe na rede local)

WebXR exige contexto seguro: http://localhost conta como seguro.
Para testar no Quest via USB:  adb reverse tcp:8080 tcp:8080
e abra http://localhost:8080 no Quest Browser.
"""
import http.server
import os
import sys


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".wasm": "application/wasm",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    port = int(args[0]) if args else 8080
    host = "0.0.0.0" if "--lan" in sys.argv else "127.0.0.1"
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f"Picross 3D XR em http://localhost:{port}  (Ctrl+C para sair)")
    http.server.ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
