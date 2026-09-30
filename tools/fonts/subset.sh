#!/bin/sh
# Cuts the UI fonts (src/app/ui/fonts/) from the upstream files in tools/fonts/upstream/:
#   PaperMono-Variable.woff2  Paper Mono v0.310 (OFL-1.1), github.com/paper-design/paper-mono
#   PublicSans.woff2          Public Sans v2.001 (OFL-1.1), github.com/uswds/public-sans
#   Archivo-Italic-Variable.woff2  Archivo v2.001 italic (OFL-1.1), github.com/Omnibus-Type/Archivo
#                             (google/fonts ofl/archivo, the variable TTF compressed to woff2)
# Each keeps only the weights the UI sets (Paper Mono 400-700: code, UI 500, display 600, bold;
# Public Sans 400-700: body and bold; Archivo italic 700-900 at 116% width: the SF Kart name, titles
# and buttons) and Latin plus the punctuation, arrows and key symbols the
# game shows. Paper Mono keeps Latin Extended-A too, for player names.
#
# Usage: sh tools/fonts/subset.sh   (makes a throwaway venv with pinned fontTools; needs python3)

set -eu
cd "$(dirname "$0")/../.."
UP=tools/fonts/upstream
OUT=src/app/ui/fonts
VENV="${TMPDIR:-/tmp}/sfkart-fonttools-4.60.1"
if [ ! -x "$VENV/bin/fonttools" ]; then
    python3 -m venv "$VENV"
    "$VENV/bin/pip" install -q "fonttools==4.60.1" "brotli==1.2.0"
fi
FT="$VENV/bin/fonttools"
# (fontTools stamps head.modified with this, so a re-run is byte-identical.)
export SOURCE_DATE_EPOCH=1767225600

# Punctuation, quotes, bullets, arrows, math and keyboard symbols (⇧ ⌘ ⌥ ⌫ ⎋ ⏎).
COMMON="U+0020-007E,U+00A0-00FF,U+2013-2014,U+2018-201E,U+2022,U+2026,U+2039-203A,U+20AC,U+2122,U+2212"
MONO="$COMMON,U+0100-017F,U+2032-2033,U+2190-2195,U+21E7,U+2248,U+2260,U+2264-2265,U+2318,U+2325,U+232B,U+238B,U+23CE"
SANS="$COMMON,U+0131,U+0152-0153"

cut() { # <in> <axes, e.g. wght=400:700> <unicodes> <out>
    "$FT" varLib.instancer "$UP/$1" $2 -q -o "$OUT/.tmp.ttf"
    "$FT" subset "$OUT/.tmp.ttf" --unicodes="$3" --layout-features+=case,zero,tnum \
        --name-IDs="*" --no-hinting --desubroutinize --flavor=woff2 --output-file="$OUT/$4"
    rm "$OUT/.tmp.ttf"
    echo "$OUT/$4: $(wc -c < "$OUT/$4" | tr -d ' ') bytes"
}

cut PaperMono-Variable.woff2 wght=400:700 "$MONO" PaperMono.woff2
cut PublicSans.woff2 wght=400:700 "$SANS" PublicSans.woff2
cut Archivo-Italic-Variable.woff2 "wght=700:900 wdth=116" "$SANS" ArchivoItalic.woff2
