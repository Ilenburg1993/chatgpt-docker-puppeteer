#!/usr/bin/env node
/* ==========================================================================
   index.js
   Entry Point Proxy - Delegates to src/main.js
   
   This file exists for compatibility with:
   - package.json "main" field
   - Docker CMD
   - PM2 ecosystem.config.js
   - Legacy scripts
========================================================================== */

// Delegate to actual entry point
require('./src/main');
