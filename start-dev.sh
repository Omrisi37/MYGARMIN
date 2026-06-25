#!/bin/bash
echo "🏃 Starting Running Coach dev server..."
echo "   Open the browser preview and navigate to /frontend/dev.html"
echo ""
cd "$(dirname "$0")"
python3 -m http.server 8080
