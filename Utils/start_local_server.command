#!/bin/bash
cd "$(dirname "$0")/.."
echo "Starting Physics QBank local server..."
echo "Press Ctrl+C in this terminal window to stop the server."

# Open the browser in the background
(sleep 1 && open "http://localhost:8000") &

# Start the python HTTP server
python3 -m http.server 8000
