'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');

const characterRoutes = require('./routes/character');
const simulateRoutes = require('./routes/simulate');
const configRoutes = require('./routes/config');
const optimizeRoutes = require('./routes/optimize');

const app = express();
const PORT = process.env.PORT || 80;

// --------------- Middleware ---------------

try {
  app.use(cors());
} catch (err) {
  console.error('[app] Failed to initialise CORS:', err);
}

try {
  app.use(express.json({ limit: '5mb' }));
} catch (err) {
  console.error('[app] Failed to initialise JSON body parser:', err);
}

try {
  app.use(express.urlencoded({ extended: true }));
} catch (err) {
  console.error('[app] Failed to initialise URL-encoded parser:', err);
}

// --------------- Static files ---------------

try {
  const clientDir = path.join(__dirname, '..', 'client');
  app.use(express.static(clientDir));
} catch (err) {
  console.error('[app] Failed to set up static file serving:', err);
}

// --------------- API Routes ---------------

try {
  app.use('/api/characters', characterRoutes);
} catch (err) {
  console.error('[app] Failed to mount character routes:', err);
}

try {
  app.use('/api/simulate', simulateRoutes);
} catch (err) {
  console.error('[app] Failed to mount simulate routes:', err);
}

try {
  app.use('/api/config', configRoutes);
} catch (err) {
  console.error('[app] Failed to mount config routes:', err);
}

try {
  app.use('/api/optimize', optimizeRoutes);
} catch (err) {
  console.error('[app] Failed to mount optimize routes:', err);
}

// --------------- SPA Fallback ---------------

app.get('*', (req, res) => {
  try {
    const clientDir = path.join(__dirname, '..', 'client');
    res.sendFile(path.join(clientDir, 'index.html'), (err) => {
      if (err) {
        res.status(404).json({ error: 'Not found' });
      }
    });
  } catch (err) {
    console.error('[app] SPA fallback error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --------------- Global Error Handler ---------------

app.use((err, req, res, _next) => {
  try {
    console.error('[app] Unhandled error:', err);
    const status = err.status || 500;
    const message = err.message || 'Internal server error';
    res.status(status).json({ error: message });
  } catch (fatalErr) {
    console.error('[app] Fatal error in error handler:', fatalErr);
    try {
      res.status(500).json({ error: 'Internal server error' });
    } catch (_) {
      // response already sent or connection lost – nothing more we can do
    }
  }
});

// --------------- Uncaught / Unhandled ---------------

process.on('uncaughtException', (err) => {
  console.error('[app] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[app] Unhandled rejection:', reason);
});

// --------------- Start ---------------

function startServer() {
  try {
    app.listen(PORT, () => {
      try {
        console.log(`[app] WoW Optimizer server running on port ${PORT}`);
      } catch (_) { /* ignore */ }
    });
  } catch (err) {
    console.error('[app] Failed to start server:', err);
  }
}

startServer();

module.exports = app;
