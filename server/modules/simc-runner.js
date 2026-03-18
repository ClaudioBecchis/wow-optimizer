'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const db = require('./db');

// --------------- State ---------------

const queue = [];
let isRunning = false;
let currentProcess = null;
let currentJobId = null;

const TMP_DIR = '/tmp/wow-optimizer';
const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

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
    try {
      if (fs.existsSync(jsonFile)) {
        const raw = fs.readFileSync(jsonFile, 'utf-8');
        const resultData = JSON.parse(raw);

        let dps = 0;
        let statWeights = null;
        let duration = 0;

        // Extract DPS
        try {
          if (resultData.sim && resultData.sim.players && resultData.sim.players.length > 0) {
            const player = resultData.sim.players[0];

            dps = player.collected_data && player.collected_data.dps
              ? player.collected_data.dps.mean || 0
              : 0;

            // Stat weights (only for stat_weights sims)
            if (job.type === 'stat_weights' && player.scale_factors) {
              statWeights = player.scale_factors;
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

        db.updateSimulation(job.simId, {
          status: 'done',
          progress: 100,
          dps: dps,
          result_json: resultData,
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

function runSimcProcess(simId, type, options) {
  return new Promise((resolve, reject) => {
    try {
      const threads = getThreads(options);
      const iterations = getIterations(options);

      const args = [
        'run', '--rm',
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
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: TIMEOUT_MS
        });
      } catch (spawnErr) {
        return reject(new Error('Failed to spawn Docker process: ' + spawnErr.message));
      }

      // Store reference so the process can be killed externally
      currentProcess = proc;
      currentJobId = simId;

      let stdout = '';
      let stderr = '';
      let killed = false;

      // Timeout
      const timer = setTimeout(() => {
        try {
          killed = true;
          proc.kill('SIGKILL');
          db.updateSimulation(simId, {
            status: 'error',
            error_message: 'Simulation timed out after 10 minutes'
          });
        } catch (killErr) {
          console.error('[simc-runner] Error killing timed-out process:', killErr);
        }
      }, TIMEOUT_MS);

      proc.stdout.on('data', (data) => {
        try {
          const text = data.toString();
          stdout += text;

          // Parse progress percentage from SimC output
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

          // Also check for percentage format
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
          currentProcess = null;
          currentJobId = null;
          console.error('[simc-runner] Process error:', err);
          reject(new Error('Docker process error: ' + err.message));
        } catch (_) {
          reject(err);
        }
      });

      proc.on('close', (code) => {
        try {
          clearTimeout(timer);
          currentProcess = null;
          currentJobId = null;

          if (killed) {
            return reject(new Error('Simulation timed out'));
          }

          if (code !== 0) {
            const errMsg = stderr.trim() || `Docker/SimC exited with code ${code}`;
            console.error(`[simc-runner] Docker/SimC exited with code ${code}:`, errMsg);
            return reject(new Error(errMsg));
          }

          resolve();
        } catch (closeErr) {
          console.error('[simc-runner] Error in close handler:', closeErr);
          reject(closeErr);
        }
      });

    } catch (err) {
      console.error('[simc-runner] Error in runSimcProcess:', err);
      reject(err);
    }
  });
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
    if (currentProcess && currentJobId !== null && Number(currentJobId) === numId) {
      console.log(`[simc-runner] Killing running simulation ${simId}`);
      try {
        currentProcess.kill('SIGKILL');
      } catch (killErr) {
        console.error('[simc-runner] Error killing process:', killErr);
      }
      currentProcess = null;
      currentJobId = null;
      try {
        db.updateSimulation(simId, { status: 'cancelled' });
      } catch (dbErr) {
        console.error('[simc-runner] Error updating cancelled simulation:', dbErr);
      }
      return { ok: true, message: 'Cancelled' };
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

    // Kill the currently running process
    if (currentProcess) {
      console.log(`[simc-runner] Killing running simulation ${currentJobId}`);
      const runningId = currentJobId;
      try {
        currentProcess.kill('SIGKILL');
      } catch (killErr) {
        console.error('[simc-runner] Error killing process:', killErr);
      }
      currentProcess = null;
      currentJobId = null;
      if (runningId !== null) {
        try {
          db.updateSimulation(runningId, { status: 'cancelled' });
        } catch (dbErr) {
          console.error('[simc-runner] Error updating cancelled simulation:', dbErr);
        }
        count++;
      }
    }

    console.log(`[simc-runner] cancelAll: cancelled ${count} simulations`);
    return { ok: true, cancelled: count };
  } catch (err) {
    console.error('[simc-runner] Error in cancelAll:', err);
    return { ok: false, cancelled: 0, message: 'Error: ' + err.message };
  }
}

// --------------- Exports ---------------

module.exports = {
  queueSimulation,
  processQueue,
  runSimcProcess,
  testSimc,
  getQueueStatus,
  cancelSimulation,
  cancelAll
};
