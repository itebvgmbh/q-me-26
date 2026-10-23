#!/usr/bin/env bash
# Einen Schlüssel in /etc/q-me.env setzen und das Backend neu starten. Als root ausführen.
# Der Wert kommt über die Standardeingabe – so steht er weder in einer Befehlszeile noch in einer History:
#   ... | bash /opt/q-me/deploy/set-secret.sh GOOGLE_MAPS_API_KEY
# Den passenden PowerShell-Block (fragt verdeckt ab) gibt es in deploy/README.md, "Schlüssel eintragen".
set -euo pipefail

NAME=${1:-}
case "$NAME" in
	GOOGLE_MAPS_API_KEY | ANTHROPIC_API_KEY | ANTHROPIC_WORKSPACE_ID | RESEND_API_KEY | STRIPE_SECRET_KEY | STRIPE_WEBHOOK_SECRET | QME_TELEFON_TOKEN) ;;
	*)
		echo "Unbekannter Name '$NAME'. Erlaubt: GOOGLE_MAPS_API_KEY, ANTHROPIC_API_KEY, ANTHROPIC_WORKSPACE_ID, RESEND_API_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, QME_TELEFON_TOKEN" >&2
		exit 2
		;;
esac
ENV_FILE=${QME_ENV_FILE:-/etc/q-me.env}

IFS= read -r VALUE || true
VALUE=$(printf '%s' "$VALUE" | tr -d '\r\n\t ')
if [ -z "$VALUE" ]; then
	echo "Kein Wert angekommen – nichts geändert." >&2
	exit 3
fi
case "$VALUE" in
	*[!A-Za-z0-9_-]*)
		echo "Der Wert enthält Zeichen, die in keinem Schlüssel vorkommen – nichts geändert." >&2
		exit 4
		;;
esac

tmp=$(mktemp "$ENV_FILE.XXXXXX")
trap 'rm -f "$tmp"' EXIT
grep -v "^$NAME=" "$ENV_FILE" >"$tmp" || true
printf '%s=%s\n' "$NAME" "$VALUE" >>"$tmp"
chmod --reference="$ENV_FILE" "$tmp"
chown --reference="$ENV_FILE" "$tmp"
mv "$tmp" "$ENV_FILE"
trap - EXIT

systemctl restart q-me
echo "$NAME gesetzt (${#VALUE} Zeichen), Backend neu gestartet."
