"""
Tests für deploy/caddy-domain.py: nur der Dranzeit-Teil der gemeinsamen Caddyfile wird ersetzt.

    cd backend && .venv/bin/python tests/test_caddy_domain.py
"""
import importlib.util
import os

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "deploy", "caddy-domain.py")
spec = importlib.util.spec_from_file_location("caddy_domain", PATH)
cd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cd)

SHARED = """{
	email admin@example.com
}

spielmacherei.de {
	root * /var/www/spiel
	file_server
}

# Q-ME
q-me.spielmacherei.de {
	encode zstd gzip
	handle /routes/* {
		reverse_proxy 127.0.0.1:8091
	}
	handle {
		try_files {path} /index.html
	}
}

mamie.spielmacherei.de {
	reverse_proxy 127.0.0.1:8090
}
"""


def test_nur_eigene_bloecke_werden_entfernt():
    out = cd.strip_blocks(SHARED, {"q-me.spielmacherei.de", "dranzeit.de"})
    assert "q-me.spielmacherei.de {" not in out
    assert "spielmacherei.de {" in out and "mamie.spielmacherei.de {" in out
    assert "email admin@example.com" in out
    assert out.count("{") == out.count("}")


def test_zweiter_lauf_ersetzt_markierten_block():
    first = cd.strip_blocks(SHARED, {"dranzeit.de", "q-me.spielmacherei.de"}) + "\n" + cd.block("dranzeit.de", "8091", ["q-me.spielmacherei.de"])
    second = cd.strip_blocks(first, {"dranzeit.de", "q-me.spielmacherei.de"}) + "\n" + cd.block("dranzeit.de", "8091", ["q-me.spielmacherei.de"])
    assert second.count(cd.BEGIN) == 1
    assert "mamie.spielmacherei.de {" in second


def test_block_leitet_stadtseiten_ans_backend():
    b = cd.block("dranzeit.de", "8091", ["www.dranzeit.de"])
    assert "@backend path /routes/* /friseur-ohne-termin" in b and "/sitemap.xml" in b
    assert "reverse_proxy 127.0.0.1:8091" in b
    assert "www.dranzeit.de {\n\tredir https://dranzeit.de{uri} permanent" in b
    assert b.count("{") == b.count("}")


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print("ok ", t.__name__)
    print(f"{len(tests)} Tests bestanden")
