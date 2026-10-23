#!/usr/bin/env python3
"""Dranzeit-Block in der gemeinsamen Caddyfile setzen: Hauptadresse, Weiterleitungen, Stadtseiten ans Backend.

Als root auf dem Server (Block "Umzug auf dranzeit.de" in deploy/README.md):
    python3 /opt/q-me/deploy/caddy-domain.py dranzeit.de --redirect-from www.dranzeit.de q-me.spielmacherei.de
    python3 /opt/q-me/deploy/caddy-domain.py q-me.spielmacherei.de          # nur Stadtseiten, ohne Umzug

Die Caddyfile gehört allen Projekten auf dem Server. Das Skript
- ersetzt nur Blöcke dieser Adressen und den markierten Dranzeit-Block, alles andere bleibt unberührt,
- prüft vorher, dass die Adressen per DNS auf diesen Server zeigen (sonst bekäme Caddy kein Zertifikat),
- prüft die neue Datei mit "caddy validate", sichert die alte und lädt Caddy erst dann neu.
Nur Standardbibliothek.
"""

import argparse
import datetime as dt
import re
import shutil
import socket
import subprocess
import sys
import tempfile

CADDYFILE = "/etc/caddy/Caddyfile"
ENV_FILE = "/etc/q-me.env"
WEB_ROOT = "/opt/q-me-web"
BEGIN, END = "# >>> dranzeit", "# <<< dranzeit"

BACKEND_PATHS = (
    "/routes/* /friseur-ohne-termin /friseur-ohne-termin/* /barbershop-ohne-termin /barbershop-ohne-termin/* /sitemap.xml /hilfe /hilfe/*"
    " /friseur /friseur/* /barbershop /barbershop/*"  # Salon-Verzeichnis (backend/app/verzeichnis_seiten.py)
    " /einbau/*"  # Kasten für Webseiten der Läden (backend/app/einbau.py)
)
# Nur diese Pfade dürfen fremde Seiten einbetten (iframe); alles andere nur Dranzeit selbst (Schutz vor Clickjacking)
EMBEDDABLE_PATHS = "/einbau/* /routes/seo/einbau/*"


def block(domain: str, port: str, redirects: list[str]) -> str:
    redirect_blocks = "".join(f"\n{r} {{\n\tredir https://{domain}{{uri}} permanent\n}}\n" for r in redirects)
    return f"""{BEGIN} (deploy/caddy-domain.py – nicht von Hand ändern)
{domain} {{
	encode zstd gzip

	# API, Stadtseiten, Salon-Verzeichnis, Hilfe, Einbau-Kasten und Sitemap ans Backend (uvicorn, nur lokal erreichbar)
	@backend path {BACKEND_PATHS}
	handle @backend {{
		reverse_proxy 127.0.0.1:{port}
	}}

	# Alles andere ist die gebaute React-App
	handle {{
		root * {WEB_ROOT}
		header /assets/* Cache-Control "public, max-age=31536000, immutable"
		header /sw.js Cache-Control "no-cache"
		try_files {{path}} /index.html
		file_server
	}}

	header {{
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}}

	# Einbetten nur für den Kasten auf Webseiten der Läden
	@nicht_einbettbar not path {EMBEDDABLE_PATHS}
	header @nicht_einbettbar {{
		Content-Security-Policy "frame-ancestors 'self'"
		X-Frame-Options "SAMEORIGIN"
	}}

	log {{
		output file /var/log/caddy/q-me.log {{
			roll_size 20mb
			roll_keep 5
			roll_keep_for 336h
		}}
	}}
}}
{redirect_blocks}{END}
"""


def addresses_of(line: str) -> set[str]:
    head = line.split("{", 1)[0]
    result = set()
    for part in re.split(r"[\s,]+", head.strip()):
        part = re.sub(r"^https?://", "", part).split(":", 1)[0].strip().lower()
        if part:
            result.add(part)
    return result


def strip_blocks(text: str, domains: set[str]) -> str:
    """Markierten Dranzeit-Block und Blöcke der eigenen Adressen entfernen; Rest unverändert."""
    text = re.sub(rf"{re.escape(BEGIN)}.*?{re.escape(END)}\n?", "", text, flags=re.S)
    out, skip_depth, depth = [], None, 0
    for line in text.splitlines(keepends=True):
        code = line.split("#", 1)[0]
        if depth == 0 and skip_depth is None and code.strip().endswith("{") and addresses_of(code) & domains:
            skip_depth = 0
        opens, closes = code.count("{"), code.count("}")
        depth += opens - closes
        if skip_depth is not None:
            if depth <= 0:
                skip_depth, depth = None, 0
            continue
        out.append(line)
    return re.sub(r"\n{3,}", "\n\n", "".join(out)).rstrip() + "\n"


def server_ips() -> set[str]:
    out = subprocess.run(["hostname", "-I"], capture_output=True, text=True).stdout
    return set(out.split())


def check_dns(names: list[str]) -> list[str]:
    mine = server_ips()
    problems = []
    for name in names:
        try:
            ips = {ai[4][0] for ai in socket.getaddrinfo(name, 443)}
        except socket.gaierror:
            problems.append(f"{name}: kein DNS-Eintrag")
            continue
        if not ips & mine:
            problems.append(f"{name}: zeigt auf {', '.join(sorted(ips))}, nicht auf diesen Server")
    return problems


def write_keeping_permissions(path: str, text: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def env_value(name: str) -> str:
    with open(ENV_FILE, encoding="utf-8") as f:
        for line in f:
            if line.startswith(f"{name}="):
                return line.split("=", 1)[1].strip()
    return ""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("domain")
    parser.add_argument("--redirect-from", nargs="*", default=[])
    parser.add_argument("--skip-dns-check", action="store_true")
    args = parser.parse_args()
    domain = args.domain.lower()
    redirects = [r.lower() for r in args.redirect_from if r.lower() != domain]

    if not args.skip_dns_check:
        problems = check_dns([domain, *redirects])
        if problems:
            sys.exit("Abbruch, DNS stimmt noch nicht:\n  " + "\n  ".join(problems))

    port = env_value("PORT")
    if not port.isdigit():
        sys.exit(f"Abbruch: PORT fehlt in {ENV_FILE}")

    with open(CADDYFILE, encoding="utf-8") as f:
        original = f.read()
    new = strip_blocks(original, {domain, *redirects}) + "\n" + block(domain, port, redirects)

    with tempfile.NamedTemporaryFile("w", suffix=".Caddyfile", delete=False, encoding="utf-8") as tmp:
        tmp.write(new)
    check = subprocess.run(["caddy", "validate", "--config", tmp.name, "--adapter", "caddyfile"], capture_output=True, text=True)
    if check.returncode != 0:
        sys.exit("Abbruch: Die neue Caddyfile ist ungültig, nichts geändert.\n" + check.stderr[-2000:])

    backup = f"{CADDYFILE}.bak-{dt.datetime.now():%Y%m%d-%H%M%S}"
    shutil.copy2(CADDYFILE, backup)
    # In die bestehende Datei schreiben: Besitzer und Rechte bleiben (Caddy läuft als eigener Benutzer;
    # eine kopierte Temp-Datei hätte nur root-Leserechte)
    write_keeping_permissions(CADDYFILE, new)
    reload = subprocess.run(["systemctl", "reload", "caddy"], capture_output=True, text=True)
    if reload.returncode != 0:
        with open(backup, encoding="utf-8") as f:
            write_keeping_permissions(CADDYFILE, f.read())
        subprocess.run(["systemctl", "reload", "caddy"])
        sys.exit("Abbruch: Caddy hat die neue Datei nicht geladen, alte wiederhergestellt.\n" + reload.stderr[-2000:])
    print(f"Caddy: {domain} aktiv" + (f", Weiterleitung von {', '.join(redirects)}" if redirects else "") + f". Sicherung: {backup}")


if __name__ == "__main__":
    main()
