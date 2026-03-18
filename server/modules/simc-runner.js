'use strict';

const { spawn, execSync, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const db = require('./db');

// --------------- State ---------------

const queue = [];
let isRunning = false;
let currentProcess = null;      // Reference to the `docker run` child process (may die on restart)
let currentJobId = null;
let currentContainerName = null; // Name of the running Docker container (survives restart)

const TMP_DIR = '/tmp/wow-optimizer';
const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const PROGRESS_POLL_INTERVAL = 3000; // 3 seconds

// Ensure temp dir exists
function ensureTempDir() {
  try {
    if (!fs.existsSync(TMP_DIR)) {
      fs.mkdirSync(TMP_DIR, { recursive: true });
    }
  } catch (err) {
    console.error('[simc-runner] Error creating temp directory:', err);
  }
}

// --------------- Helpers ---------------

function getThreads(options) {
  try {
    const config = db.getAllConfig();
    return options.threads || config.simc_threads || '4';
  } catch (err) {
    console.error('[simc-runner] Error getting threads config:', err);
    return '4';
  }
}

function getIterations(options) {
  try {
    const config = db.getAllConfig();
    return options.iterations || config.simc_iterations || '10000';
  } catch (err) {
    console.error('[simc-runner] Error getting iterations config:', err);
    return '10000';
  }
}

/**
 * Build the container name for a given simId.
 */
function containerName(simId) {
  return 'simc_' + simId;
}

/**
 * Run a docker command synchronously and return trimmed stdout.
 * Returns null on error.
 */
function dockerExecSync(args, timeoutMs) {
  try {
    const result = execSync('docker ' + args.join(' '), {
      encoding: 'utf-8',
      timeout: timeoutMs || 15000,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return (result || '').trim();
  } catch (err) {
    return null;
  }
}

/**
 * Remove a Docker container by name (best-effort, ignores errors).
 */
function removeContainer(name) {
  try {
    execSync(`docker rm -f ${name}`, {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    console.log(`[simc-runner] Removed container ${name}`);
  } catch (err) {
    // Container may already be gone – that's fine
  }
}

/**
 * Poll docker logs --tail 1 to extract progress for a running container.
 * Returns a progress number (0-99) or null if unparseable.
 */
function pollProgressFromContainer(name) {
  try {
    const lastLine = dockerExecSync(['logs', '--tail', '1', name], 5000);
    if (!lastLine) return null;

    // Try N/M format first (e.g. "1234/10000")
    const fracMatch = lastLine.match(/(\d+)\/(\d+)/);
    if (fracMatch) {
      const current = parseInt(fracMatch[1], 10);
      const total = parseInt(fracMatch[2], 10);
      if (total > 0) {
        return Math.min(99, Math.round((current / total) * 100));
      }
    }

    // Try percentage format (e.g. "45%")
    const pctMatch = lastLine.match(/(\d+)%/);
    if (pctMatch) {
      return Math.min(99, parseInt(pctMatch[1], 10));
    }

    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Check if a Docker container exists (any state) by name.
 */
function containerExists(name) {
  const result = dockerExecSync(['ps', '-a', '--filter', `name=^${name}$`, '--format', '{{.Names}}']);
  return result === name;
}

/**
 * Get the status of a Docker container ('running', 'exited', etc.) or null if not found.
 */
function getContainerStatus(name) {
  return dockerExecSync(['inspect', '--format', '{{.State.Status}}', name]);
}

/**
 * Get the exit code of a Docker container, or null if not available.
 */
function getContainerExitCode(name) {
  const code = dockerExecSync(['inspect', '--format', '{{.State.ExitCode}}', name]);
  if (code === null) return null;
  return parseInt(code, 10);
}

// --------------- Queue ---------------

function queueSimulation(simId, simcInput, type, options) {
  try {
    if (!simId || !simcInput) {
      throw new Error('simId and simcInput are required');
    }

    const job = {
      simId,
      simcInput,
      type: type || 'dps',
      options: options || {}
    };

    queue.push(job);
    console.log(`[simc-runner] Queued simulation ${simId} (type=${job.type}), queue size=${queue.length}`);

    // Update status in DB
    try {
      db.updateSimulation(simId, { status: 'queued', progress: 0 });
    } catch (dbErr) {
      console.error('[simc-runner] Error updating simulation status to queued:', dbErr);
    }

    processQueue();
    return true;
  } catch (err) {
    console.error('[simc-runner] Error queuing simulation:', err);
    try {
      db.updateSimulation(simId, { status: 'error', error_message: err.message });
    } catch (_) { /* ignore */ }
    return false;
  }
}

function processQueue() {
  try {
    if (isRunning) {
      return;
    }
    if (queue.length === 0) {
      return;
    }

    isRunning = true;
    const job = queue.shift();

    console.log(`[simc-runner] Processing simulation ${job.simId}`);

    runJob(job)
      .then(() => {
        try {
          isRunning = false;
          processQueue();
        } catch (err) {
          console.error('[simc-runner] Error after job completion:', err);
          isRunning = false;
        }
      })
      .catch((err) => {
        try {
          console.error(`[simc-runner] Job ${job.simId} failed:`, err);
          db.updateSimulation(job.simId, {
            status: 'error',
            error_message: err.message || 'Unknown error'
          });
        } catch (dbErr) {
          console.error('[simc-runner] Error updating failed simulation:', dbErr);
        }
        isRunning = false;
        try {
          processQueue();
        } catch (_) { /* ignore */ }
      });
  } catch (err) {
    console.error('[simc-runner] Error in processQueue:', err);
    isRunning = false;
  }
}

async function runJob(job) {
  try {
    ensureTempDir();

    const inputFile = path.join(TMP_DIR, `sim_${job.simId}.simc`);
    const jsonFile = path.join(TMP_DIR, `sim_${job.simId}.json`);

    // Write the raw simcInput to the file (threads/iterations/json2 are passed as Docker args)
    try {
      fs.writeFileSync(inputFile, job.simcInput, 'utf-8');
    } catch (writeErr) {
      throw new Error('Failed to write SimC input file: ' + writeErr.message);
    }

    // Update status
    try {
      db.updateSimulation(job.simId, { status: 'running', progress: 0 });
    } catch (_) { /* ignore */ }

    // Run SimC via Docker
    await runSimcProcess(job.simId, job.type, job.options);

    // Parse results
    parseAndStoreResults(job);

    // Cleanup temp files (keep HTML report for viewing)
    try {
      if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile);
      if (fs.existsSync(jsonFile)) fs.unlinkSync(jsonFile);
    } catch (cleanupErr) {
      console.error('[simc-runner] Error cleaning up temp files:', cleanupErr);
    }

  } catch (err) {
    console.error(`[simc-runner] Error running job ${job.simId}:`, err);
    try {
      db.updateSimulation(job.simId, {
        status: 'error',
        error_message: err.message || 'Unknown error during simulation'
      });
    } catch (_) { /* ignore */ }
  }
}

/**
 * Parse SimC JSON output and store results in the database.
 * Extracted to a helper so it can be reused for orphan recovery.
 */
function parseAndStoreResults(job) {
  const jsonFile = path.join(TMP_DIR, `sim_${job.simId}.json`);

  try {
    console.log(`[simc-runner] parseAndStoreResults: sim ${job.simId}, type=${job.type}, jsonFile=${jsonFile}`);
    console.log(`[simc-runner] File exists: ${fs.existsSync(jsonFile)}`);

    if (fs.existsSync(jsonFile)) {
      const raw = fs.readFileSync(jsonFile, 'utf-8');
      console.log(`[simc-runner] JSON file size: ${raw.length} bytes`);
      const resultData = JSON.parse(raw);

      let dps = 0;
      let statWeights = null;
      let duration = 0;

      // Extract DPS
      try {
        const hasSim = !!(resultData.sim);
        const hasPlayers = !!(resultData.sim && resultData.sim.players);
        const playerCount = hasPlayers ? resultData.sim.players.length : 0;
        console.log(`[simc-runner] hasSim=${hasSim}, hasPlayers=${hasPlayers}, playerCount=${playerCount}`);

        if (playerCount > 0) {
          const player = resultData.sim.players[0];
          console.log(`[simc-runner] Player name: ${player.name}, has collected_data: ${!!player.collected_data}`);

          dps = player.collected_data && player.collected_data.dps
            ? player.collected_data.dps.mean || 0
            : 0;
          console.log(`[simc-runner] Extracted DPS: ${dps}`);

          // Stat weights (only for stat_weights sims)
          console.log(`[simc-runner] job.type='${job.type}', has scale_factors: ${!!player.scale_factors}`);
          if (job.type === 'stat_weights' && player.scale_factors) {
            statWeights = player.scale_factors;
            console.log(`[simc-runner] Extracted stat weights: ${JSON.stringify(statWeights)}`);
          }
        }
      } catch (extractErr) {
        console.error('[simc-runner] Error extracting results:', extractErr);
      }

      // Simulation metadata - elapsed time as duration
      try {
        if (resultData.sim && resultData.sim.statistics) {
          duration = resultData.sim.statistics.elapsed_cpu_seconds || 0;
        }
      } catch (metaErr) {
        console.error('[simc-runner] Error extracting metadata:', metaErr);
      }

      console.log(`[simc-runner] Saving to DB: dps=${dps}, statWeights=${!!statWeights}, duration=${duration}`);
      db.updateSimulation(job.simId, {
        status: 'done',
        progress: 100,
        dps: dps,
        stat_weights_json: statWeights,
        duration_seconds: duration,
        html_report: '/reports/sim_' + job.simId + '.html'
      });
    } else {
      db.updateSimulation(job.simId, {
        status: 'error',
        error_message: 'SimC produced no output file'
      });
    }
  } catch (parseErr) {
    console.error('[simc-runner] Error parsing SimC results:', parseErr);
    db.updateSimulation(job.simId, {
      status: 'error',
      error_message: 'Failed to parse SimC output: ' + parseErr.message
    });
  }
}

// --------------- Docker Process (Named Container, No --rm) ---------------

function runSimcProcess(simId, type, options) {
  return new Promise((resolve, reject) => {
    try {
      const threads = getThreads(options);
      const iterations = getIterations(options);
      const cName = containerName(simId);

      // Remove any leftover container with the same name (from a previous failed run)
      removeContainer(cName);

      const args = [
        'run',
        '--name', cName,
        '--security-opt', 'apparmor=unconfined',
        '-v', `${TMP_DIR}:/sim`,
        'simulationcraftorg/simc',
        `/sim/sim_${simId}.simc`,
        `json2=/sim/sim_${simId}.json`,
        `html=/sim/sim_${simId}.html`,
        `threads=${threads}`,
        `iterations=${iterations}`
      ];

      if (type === 'stat_weights') {
        args.push('calculate_scale_factors=1');
        args.push('scale_only=strength,agility,intellect,crit_rating,haste_rating,mastery_rating,versatility_rating');
      }

      console.log(`[simc-runner] Spawning: docker ${args.join(' ')}`);

      let proc;
      try {
        proc = spawn('docker', args, {
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch (spawnErr) {
        return reject(new Error('Failed to spawn Docker process: ' + spawnErr.message));
      }

      // Store references for external cancellation
      currentProcess = proc;
      currentJobId = simId;
      currentContainerName = cName;

      let stdout = '';
      let stderr = '';
      let killed = false;
      let progressTimer = null;

      // Timeout – kill the container (not just the child process)
      const timer = setTimeout(() => {
        try {
          killed = true;
          console.log(`[simc-runner] Timeout reached for ${cName}, killing container`);
          // Kill the Docker container directly – this survives even if the child process is gone
          try { execSync(`docker kill ${cName}`, { timeout: 10000, stdio: 'ignore' }); } catch (_) { /* ignore */ }
          try { proc.kill('SIGKILL'); } catch (_) { /* ignore */ }
          db.updateSimulation(simId, {
            status: 'error',
            error_message: 'Simulation timed out after 10 minutes'
          });
        } catch (killErr) {
          console.error('[simc-runner] Error killing timed-out container:', killErr);
        }
      }, TIMEOUT_MS);

      // Progress polling via docker logs --tail 1
      progressTimer = setInterval(() => {
        try {
          const progress = pollProgressFromContainer(cName);
          if (progress !== null) {
            db.updateSimulation(simId, { progress });
          }
        } catch (_) { /* ignore progress poll error */ }
      }, PROGRESS_POLL_INTERVAL);

      proc.stdout.on('data', (data) => {
        try {
          const text = data.toString();
          stdout += text;

          // Also parse progress directly from stdout (faster than polling)
          const progressMatch = text.match(/(\d+)\/(\d+)/);
          if (progressMatch) {
            try {
              const current = parseInt(progressMatch[1], 10);
              const total = parseInt(progressMatch[2], 10);
              if (total > 0) {
                const progress = Math.min(99, Math.round((current / total) * 100));
                db.updateSimulation(simId, { progress });
              }
            } catch (_) { /* ignore progress parse error */ }
          }

          const pctMatch = text.match(/(\d+)%/);
          if (pctMatch) {
            try {
              const progress = Math.min(99, parseInt(pctMatch[1], 10));
              db.updateSimulation(simId, { progress });
            } catch (_) { /* ignore */ }
          }
        } catch (dataErr) {
          console.error('[simc-runner] Error processing stdout:', dataErr);
        }
      });

      proc.stderr.on('data', (data) => {
        try {
          stderr += data.toString();
        } catch (_) { /* ignore */ }
      });

      proc.on('error', (err) => {
        try {
          clearTimeout(timer);
          if (progressTimer) clearInterval(progressTimer);
          currentProcess = null;
          currentJobId = null;
          currentContainerName = null;
          console.error('[simc-runner] Process error:', err);

          // The child process errored, but the container may still be running.
          // Check if the container is still alive and if so, start monitoring it.
          if (containerExists(cName)) {
            const status = getContainerStatus(cName);
            if (status === 'running') {
              console.log(`[simc-runner] Child process died but container ${cName} is still running. Monitoring...`);
              monitorContainer(cName, simId)
                .then(() => {
                  removeContainer(cName);
                  resolve();
                })
                .catch((monErr) => {
                  removeContainer(cName);
                  reject(monErr);
                });
              return;
            }
          }

          removeContainer(cName);
          reject(new Error('Docker process error: ' + err.message));
        } catch (_) {
          reject(err);
        }
      });

      proc.on('close', (code) => {
        try {
          clearTimeout(timer);
          if (progressTimer) clearInterval(progressTimer);
          currentProcess = null;
          currentJobId = null;
          currentContainerName = null;

          if (killed) {
            removeContainer(cName);
            return reject(new Error('Simulation timed out'));
          }

          if (code !== 0) {
            const errMsg = stderr.trim() || `Docker/SimC exited with code ${code}`;
            console.error(`[simc-runner] Docker/SimC exited with code ${code}:`, errMsg);
            removeContainer(cName);
            return reject(new Error(errMsg));
          }

          // Success – remove the container
          removeContainer(cName);
          resolve();
        } catch (closeErr) {
          console.error('[simc-runner] Error in close handler:', closeErr);
          removeContainer(cName);
          reject(closeErr);
        }
      });

    } catch (err) {
      console.error('[simc-runner] Error in runSimcProcess:', err);
      reject(err);
    }
  });
}

// --------------- Container Monitoring (for orphan recovery & child-process-died) ---------------

/**
 * Monitor a running Docker container by polling its status.
 * Resolves when the container exits with code 0, rejects otherwise.
 * Also polls progress from docker logs.
 */
function monitorContainer(cName, simId) {
  return new Promise((resolve, reject) => {
    console.log(`[simc-runner] Monitoring container ${cName} for sim ${simId}`);

    const startTime = Date.now();
    let resolved = false;

    const pollInterval = setInterval(() => {
      try {
        // Check timeout
        if (Date.now() - startTime > TIMEOUT_MS) {
          clearInterval(pollInterval);
          if (resolved) return;
          resolved = true;
          console.log(`[simc-runner] Timeout monitoring container ${cName}`);
          try { execSync(`docker kill ${cName}`, { timeout: 10000, stdio: 'ignore' }); } catch (_) { /* ignore */ }
          try {
            db.updateSimulation(simId, {
              status: 'error',
              error_message: 'Simulation timed out after 10 minutes'
            });
          } catch (_) { /* ignore */ }
          return reject(new Error('Simulation timed out'));
        }

        const status = getContainerStatus(cName);

        if (status === null) {
          // Container gone – might have been removed externally
          clearInterval(pollInterval);
          if (resolved) return;
          resolved = true;
          return reject(new Error('Container disappeared unexpectedly'));
        }

        if (status === 'running') {
          // Still running – poll progress
          const progress = pollProgressFromContainer(cName);
          if (progress !== null) {
            try { db.updateSimulation(simId, { progress }); } catch (_) { /* ignore */ }
          }
          return; // Keep polling
        }

        if (status === 'exited') {
          clearInterval(pollInterval);
          if (resolved) return;
          resolved = true;

          const exitCode = getContainerExitCode(cName);
          console.log(`[simc-runner] Container ${cName} exited with code ${exitCode}`);

          if (exitCode !== 0) {
            // Grab stderr from docker logs
            const logs = dockerExecSync(['logs', '--tail', '50', cName], 10000) || '';
            return reject(new Error(`Docker/SimC exited with code ${exitCode}: ${logs.substring(0, 1000)}`));
          }

          resolve();
          return;
        }

        // Other states (created, paused, restarting, dead, etc.) – just keep polling
        // unless it's 'dead' which is terminal
        if (status === 'dead') {
          clearInterval(pollInterval);
          if (resolved) return;
          resolved = true;
          return reject(new Error('Container entered dead state'));
        }

      } catch (pollErr) {
        console.error('[simc-runner] Error polling container status:', pollErr);
        // Don't stop polling on transient errors
      }
    }, PROGRESS_POLL_INTERVAL);
  });
}

// --------------- Orphan Recovery ---------------

/**
 * On module load / server startup, check for any running simc_* containers
 * that are leftovers from a previous Node.js process. Resume monitoring them
 * and collect results when they finish.
 */
function recoverOrphanedSims() {
  try {
    const output = dockerExecSync([
      'ps', '--filter', 'name=simc_', '--format', '{{.Names}}'
    ], 10000);

    if (!output) {
      console.log('[simc-runner] No orphaned simc containers found');
      return;
    }

    const containers = output.split('\n').filter(Boolean);
    if (containers.length === 0) {
      console.log('[simc-runner] No orphaned simc containers found');
      return;
    }

    console.log(`[simc-runner] Found ${containers.length} orphaned container(s): ${containers.join(', ')}`);

    containers.forEach((cName) => {
      try {
        // Extract simId from container name "simc_<id>"
        const match = cName.match(/^simc_(.+)$/);
        if (!match) {
          console.warn(`[simc-runner] Container ${cName} does not match expected name pattern, removing`);
          removeContainer(cName);
          return;
        }

        const simId = match[1];
        console.log(`[simc-runner] Recovering orphaned sim ${simId} from container ${cName}`);

        // Mark as running in DB (it might already be, but make sure)
        try {
          db.updateSimulation(simId, { status: 'running' });
        } catch (_) { /* ignore – sim might not exist in DB */ }

        // Monitor the container asynchronously
        monitorContainer(cName, simId)
          .then(() => {
            console.log(`[simc-runner] Orphaned sim ${simId} completed successfully`);
            // Parse results – construct a minimal job object
            parseAndStoreResults({ simId, type: 'dps' });
            removeContainer(cName);
          })
          .catch((err) => {
            console.error(`[simc-runner] Orphaned sim ${simId} failed:`, err.message);
            try {
              db.updateSimulation(simId, {
                status: 'error',
                error_message: 'Orphaned sim failed: ' + err.message
              });
            } catch (_) { /* ignore */ }
            removeContainer(cName);
          });

      } catch (containerErr) {
        console.error(`[simc-runner] Error recovering container ${cName}:`, containerErr);
        removeContainer(cName);
      }
    });

    // Also check for exited simc_ containers that never got cleaned up
    try {
      const exitedOutput = dockerExecSync([
        'ps', '-a', '--filter', 'name=simc_', '--filter', 'status=exited',
        '--format', '{{.Names}}'
      ], 10000);

      if (exitedOutput) {
        const exitedContainers = exitedOutput.split('\n').filter(Boolean);
        exitedContainers.forEach((cName) => {
          // These are already handled by the running check above if they were running,
          // but if they were already exited, we should try to collect results and clean up
          const match = cName.match(/^simc_(.+)$/);
          if (!match) {
            removeContainer(cName);
            return;
          }

          const simId = match[1];
          const exitCode = getContainerExitCode(cName);

          console.log(`[simc-runner] Found exited orphan container ${cName} (exit code: ${exitCode})`);

          if (exitCode === 0) {
            // Try to parse results
            try {
              parseAndStoreResults({ simId, type: 'dps' });
            } catch (_) { /* ignore */ }
          } else {
            try {
              const logs = dockerExecSync(['logs', '--tail', '20', cName], 10000) || '';
              db.updateSimulation(simId, {
                status: 'error',
                error_message: `SimC exited with code ${exitCode}: ${logs.substring(0, 500)}`
              });
            } catch (_) { /* ignore */ }
          }

          removeContainer(cName);
        });
      }
    } catch (exitedErr) {
      console.error('[simc-runner] Error checking exited orphan containers:', exitedErr);
    }

  } catch (err) {
    console.error('[simc-runner] Error in recoverOrphanedSims:', err);
  }
}

// --------------- Test SimC ---------------

function testSimc() {
  return new Promise((resolve) => {
    try {
      const args = [
        'run', '--rm',
        '--security-opt', 'apparmor=unconfined',
        'simulationcraftorg/simc'
      ];

      let proc;
      try {
        proc = spawn('docker', args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 30000
        });
      } catch (spawnErr) {
        return resolve({
          ok: false,
          message: 'Failed to spawn Docker: ' + spawnErr.message
        });
      }

      let stdout = '';
      let stderr = '';

      const timer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch (_) { /* ignore */ }
        resolve({ ok: false, message: 'SimC Docker test timed out after 30 seconds' });
      }, 30000);

      proc.stdout.on('data', (data) => {
        try {
          stdout += data.toString();
        } catch (_) { /* ignore */ }
      });

      proc.stderr.on('data', (data) => {
        try {
          stderr += data.toString();
        } catch (_) { /* ignore */ }
      });

      proc.on('error', (err) => {
        try {
          clearTimeout(timer);
          resolve({
            ok: false,
            message: 'Docker not found or not executable: ' + err.message
          });
        } catch (_) {
          resolve({ ok: false, message: 'Unknown error' });
        }
      });

      proc.on('close', (code) => {
        try {
          clearTimeout(timer);

          // SimC with no args prints version info and exits with non-zero,
          // but we can still extract the version line from stdout/stderr
          const output = (stdout + '\n' + stderr).trim();
          const versionMatch = output.match(/SimulationCraft\s+[\d\w.\-]+/i);

          if (versionMatch) {
            resolve({
              ok: true,
              message: `SimC (Docker) is working: ${versionMatch[0]}`
            });
          } else if (code === 0) {
            resolve({ ok: true, message: 'SimC (Docker) is working correctly' });
          } else {
            resolve({
              ok: false,
              message: `SimC Docker exited with code ${code}: ${output.substring(0, 500)}`
            });
          }
        } catch (closeErr) {
          resolve({ ok: false, message: 'Error processing SimC Docker test result' });
        }
      });

    } catch (err) {
      console.error('[simc-runner] Error testing SimC:', err);
      resolve({ ok: false, message: 'Error testing SimC: ' + err.message });
    }
  });
}

// --------------- Queue Status ---------------

function getQueueStatus() {
  try {
    return {
      running: isRunning,
      queued: queue.length
    };
  } catch (err) {
    console.error('[simc-runner] Error getting queue status:', err);
    return { running: false, queued: 0 };
  }
}

// --------------- Cancel ---------------

function cancelSimulation(simId) {
  try {
    if (!simId) {
      return { ok: false, message: 'No simId provided' };
    }

    const numId = Number(simId);

    // Check if it's in the queue
    const queueIdx = queue.findIndex(function (job) {
      return Number(job.simId) === numId;
    });

    if (queueIdx !== -1) {
      queue.splice(queueIdx, 1);
      console.log(`[simc-runner] Cancelled queued simulation ${simId}`);
      try {
        db.updateSimulation(simId, { status: 'cancelled' });
      } catch (dbErr) {
        console.error('[simc-runner] Error updating cancelled simulation:', dbErr);
      }
      return { ok: true, message: 'Cancelled' };
    }

    // Check if it's the currently running job
    if (currentJobId !== null && Number(currentJobId) === numId) {
      console.log(`[simc-runner] Killing running simulation ${simId}`);

      // Kill the Docker container directly (survives child process death)
      const cName = currentContainerName || containerName(simId);
      try {
        execSync(`docker kill ${cName}`, { timeout: 10000, stdio: 'ignore' });
      } catch (_) { /* container might already be stopped */ }

      // Also kill the child process if it's still around
      if (currentProcess) {
        try {
          currentProcess.kill('SIGKILL');
        } catch (killErr) {
          console.error('[simc-runner] Error killing child process:', killErr);
        }
      }

      currentProcess = null;
      currentJobId = null;
      currentContainerName = null;

      // Clean up the container
      removeContainer(cName);

      try {
        db.updateSimulation(simId, { status: 'cancelled' });
      } catch (dbErr) {
        console.error('[simc-runner] Error updating cancelled simulation:', dbErr);
      }
      return { ok: true, message: 'Cancelled' };
    }

    // Check if there's a container running for this simId even though we don't track it
    // (e.g. orphan from a previous process)
    const cName = containerName(simId);
    if (containerExists(cName)) {
      console.log(`[simc-runner] Found orphan container ${cName}, killing it`);
      try {
        execSync(`docker kill ${cName}`, { timeout: 10000, stdio: 'ignore' });
      } catch (_) { /* ignore */ }
      removeContainer(cName);
      try {
        db.updateSimulation(simId, { status: 'cancelled' });
      } catch (_) { /* ignore */ }
      return { ok: true, message: 'Cancelled (orphan container)' };
    }

    return { ok: false, message: 'Not found' };
  } catch (err) {
    console.error('[simc-runner] Error in cancelSimulation:', err);
    return { ok: false, message: 'Error: ' + err.message };
  }
}

function cancelAll() {
  try {
    let count = 0;

    // Cancel all queued jobs
    while (queue.length > 0) {
      const job = queue.shift();
      try {
        db.updateSimulation(job.simId, { status: 'cancelled' });
      } catch (dbErr) {
        console.error('[simc-runner] Error updating cancelled simulation:', dbErr);
      }
      count++;
    }

    // Kill the currently running container
    if (currentContainerName || currentJobId !== null) {
      const cName = currentContainerName || containerName(currentJobId);
      const runningId = currentJobId;

      console.log(`[simc-runner] Killing running container ${cName}`);

      try {
        execSync(`docker kill ${cName}`, { timeout: 10000, stdio: 'ignore' });
      } catch (_) { /* ignore */ }

      if (currentProcess) {
        try {
          currentProcess.kill('SIGKILL');
        } catch (killErr) {
          console.error('[simc-runner] Error killing process:', killErr);
        }
      }

      currentProcess = null;
      currentJobId = null;
      currentContainerName = null;

      removeContainer(cName);

      if (runningId !== null) {
        try {
          db.updateSimulation(runningId, { status: 'cancelled' });
        } catch (dbErr) {
          console.error('[simc-runner] Error updating cancelled simulation:', dbErr);
        }
        count++;
      }
    }

    // Also kill any orphan simc_ containers
    try {
      const output = dockerExecSync([
        'ps', '--filter', 'name=simc_', '--format', '{{.Names}}'
      ], 10000);

      if (output) {
        const orphans = output.split('\n').filter(Boolean);
        orphans.forEach((cName) => {
          try {
            execSync(`docker kill ${cName}`, { timeout: 10000, stdio: 'ignore' });
          } catch (_) { /* ignore */ }
          removeContainer(cName);

          const match = cName.match(/^simc_(.+)$/);
          if (match) {
            try {
              db.updateSimulation(match[1], { status: 'cancelled' });
            } catch (_) { /* ignore */ }
            count++;
          }
        });
      }
    } catch (_) { /* ignore */ }

    console.log(`[simc-runner] cancelAll: cancelled ${count} simulations`);
    return { ok: true, cancelled: count };
  } catch (err) {
    console.error('[simc-runner] Error in cancelAll:', err);
    return { ok: false, cancelled: 0, message: 'Error: ' + err.message };
  }
}

// --------------- Startup Recovery ---------------

// Run orphan recovery on module load (when server starts/restarts)
try {
  // Delay slightly to let the DB module initialize
  setTimeout(() => {
    recoverOrphanedSims();
  }, 2000);
} catch (err) {
  console.error('[simc-runner] Error scheduling orphan recovery:', err);
}

// --------------- Exports ---------------

module.exports = {
  queueSimulation,
  processQueue,
  runSimcProcess,
  testSimc,
  getQueueStatus,
  cancelSimulation,
  cancelAll,
  recoverOrphanedSims
};
