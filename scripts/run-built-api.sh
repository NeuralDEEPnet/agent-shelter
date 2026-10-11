#!/bin/sh
# Run under the existing managed nodemon child, not as a separate supervisor.
# Vite's frontend build removes dist/ before the API bundle is recreated.
while [ ! -f dist/api/server.js ]; do
  sleep 1
done
exec node dist/api/server.js
