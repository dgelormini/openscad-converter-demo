#!/usr/bin/env bash
set -euo pipefail

SITE_DIR="${SITE_DIR:-$HOME/personal/dgelormini.com}"
APP_TARGET="${SITE_DIR}/apps/openscad-converter"

echo "📦 Syncing OpenSCAD Studio into ${APP_TARGET}..."
mkdir -p "${APP_TARGET}"

cp -v index.html "${APP_TARGET}/index.html"
cp -v app.js "${APP_TARGET}/app.js"
cp -v scad-worker.js "${APP_TARGET}/scad-worker.js"
if [ -f screenshot.png ]; then
  cp -v screenshot.png "${APP_TARGET}/screenshot.png"
fi

echo "✅ Files successfully copied to ${APP_TARGET}"

# If --deploy or -d flag passed, run deploy.sh from personal site
if [ "${1:-}" = "--deploy" ] || [ "${1:-}" = "-d" ]; then
  echo ""
  echo "🚀 Triggering AWS S3 deployment via ${SITE_DIR}/deploy.sh..."
  (cd "${SITE_DIR}" && ./deploy.sh)
else
  echo ""
  echo "👉 To publish to your personal site on S3, run:"
  echo "   ./deploy-to-site.sh --deploy"
  echo "   or run ./deploy.sh from ${SITE_DIR}"
fi
