#!/bin/bash
# Copies the build-log photos and portrait from the current airkords.com into the site.
# Runs automatically on Vercel at build time; safe to run again (skips what's already there).
cd "$(dirname "$0")/../public" && mkdir -p media
get(){ [ -s "media/$2" ] && { echo "  = $2"; return; }; curl -fsSL --max-time 20 "$1" -o "media/$2.tmp" && mv "media/$2.tmp" "media/$2" && echo "  ✓ $2" || { rm -f "media/$2.tmp"; echo "  ✗ $2 (skipped)"; }; }
echo "Fetching photos…"
get https://airkords.com/device-hero.jpg device-hero.jpg
get https://airkords.com/builder-portrait.jpg builder-portrait.jpg
get https://airkords.com/log-first-test.png log-first-test.jpg
get https://airkords.com/log-expo-demo.png log-expo-demo.jpg
exit 0
