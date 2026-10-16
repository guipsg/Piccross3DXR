"""Baixa o three.js e os assets de input do WebXR para vendor/, para o jogo rodar sem CDN.

Uso:  py scripts/vendor_deps.py
Os addons são resolvidos recursivamente a partir dos imports relativos.
"""
import json
import os
import re
import urllib.request

THREE = "0.180.0"
PROFILES = "1.0.20"  # @webxr-input-profiles/assets
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "vendor")
CDN = "https://cdn.jsdelivr.net/npm"

BUILD = ["three.webgpu.js", "three.tsl.js"]
ADDONS = ["webxr/XRControllerModelFactory.js", "webxr/XRHandModelFactory.js"]
# perfis de controle reportados pelo Quest 3/3S (+ fallbacks genéricos) e o modelo de mão
PROFILE_DIRS = ["meta-quest-touch-plus", "oculus-touch-v3", "generic-trigger-squeeze-thumbstick", "generic-trigger"]

IMPORT_RE = re.compile(r"""(?:from|import)\s*['"](\.{1,2}/[^'"]+)['"]""")


def fetch(url):
    with urllib.request.urlopen(url) as r:
        return r.read()


def save(rel, data):
    path = os.path.normpath(os.path.join(ROOT, rel))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    print(f"  {rel} ({len(data) // 1024} KB)")


def vendor_js(base_url, base_dir, entries):
    seen, queue = set(), list(entries)
    while queue:
        rel = queue.pop()
        if rel in seen:
            continue
        seen.add(rel)
        data = fetch(f"{base_url}/{rel}")
        save(f"{base_dir}/{rel}", data)
        for imp in IMPORT_RE.findall(data.decode("utf-8")):
            queue.append(os.path.normpath(os.path.join(os.path.dirname(rel), imp)).replace("\\", "/"))


def main():
    print(f"three@{THREE}")
    vendor_js(f"{CDN}/three@{THREE}/build", "three/build", BUILD)
    vendor_js(f"{CDN}/three@{THREE}/examples/jsm", "three/addons", ADDONS)

    print(f"@webxr-input-profiles/assets@{PROFILES}")
    pbase = f"{CDN}/@webxr-input-profiles/assets@{PROFILES}/dist/profiles"
    plist = json.loads(fetch(f"{pbase}/profilesList.json"))
    keep = {k: v for k, v in plist.items() if k in PROFILE_DIRS}
    save("webxr-input-profiles/profilesList.json", json.dumps(keep, indent=2).encode())
    for pid in PROFILE_DIRS:
        prof = fetch(f"{pbase}/{pid}/profile.json")
        save(f"webxr-input-profiles/{pid}/profile.json", prof)
        assets = {lay.get("assetPath") for lay in json.loads(prof)["layouts"].values()}
        for asset in filter(None, assets):
            save(f"webxr-input-profiles/{pid}/{asset}", fetch(f"{pbase}/{pid}/{asset}"))
    for hand in ("left.glb", "right.glb"):
        save(f"webxr-input-profiles/generic-hand/{hand}", fetch(f"{pbase}/generic-hand/{hand}"))


if __name__ == "__main__":
    main()
