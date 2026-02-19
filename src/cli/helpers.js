'use strict';

/**
 * Shared CLI utilities for obsidian-curator.
 * No external dependencies — ANSI codes only.
 */

// ─────────────────────────────────────────────
// ANSI colour helpers
// ─────────────────────────────────────────────

const ANSI = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  // Foreground colours
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
  grey:   '\x1b[90m',
};

/** Is stdout a TTY? If not, strip colours. */
const isTTY = process.stdout.isTTY;

/**
 * Wrap text in ANSI codes only if stdout is a TTY.
 * @param {string} code
 * @param {string} text
 * @returns {string}
 */
function coloured(code, text) {
  if (!isTTY) return text;
  return `${code}${text}${ANSI.reset}`;
}

/**
 * Print an info message (blue).
 * @param {string} msg
 */
function info(msg) {
  console.log(coloured(ANSI.blue, 'ℹ') + ' ' + msg);
}

/**
 * Print a success message (green).
 * @param {string} msg
 */
function success(msg) {
  console.log(coloured(ANSI.green, '✓') + ' ' + msg);
}

/**
 * Print a warning message (yellow).
 * @param {string} msg
 */
function warn(msg) {
  console.warn(coloured(ANSI.yellow, '⚠') + ' ' + msg);
}

/**
 * Print an error message (red) to stderr.
 * @param {string} msg
 */
function error(msg) {
  console.error(coloured(ANSI.red, '✗') + ' ' + msg);
}

/**
 * Print a bold header line.
 * @param {string} msg
 */
function header(msg) {
  console.log(coloured(ANSI.bold, msg));
}

/**
 * Print a dim/muted line.
 * @param {string} msg
 */
function muted(msg) {
  console.log(coloured(ANSI.grey, msg));
}

// ─────────────────────────────────────────────
// Spinner
// ─────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Create a simple spinner for async operations.
 * Only animates on TTY; falls back to a plain message otherwise.
 *
 * @param {string} message - Text shown next to the spinner
 * @returns {{ stop: function(string=) }} Object with stop(finalMsg) method
 */
function spinner(message) {
  if (!isTTY) {
    process.stdout.write(message + '...\n');
    return {
      stop(finalMsg) {
        if (finalMsg) console.log(finalMsg);
      }
    };
  }

  let i = 0;
  const interval = setInterval(() => {
    const frame = coloured(ANSI.cyan, SPINNER_FRAMES[i % SPINNER_FRAMES.length]);
    process.stdout.write(`\r${frame} ${message}   `);
    i++;
  }, 80);

  return {
    stop(finalMsg) {
      clearInterval(interval);
      process.stdout.write('\r\x1b[K'); // clear line
      if (finalMsg) console.log(finalMsg);
    }
  };
}

// ─────────────────────────────────────────────
// Table formatter
// ─────────────────────────────────────────────

/**
 * Format an array of row arrays as a padded text table.
 * @param {string[][]} rows - Array of rows; first row is the header.
 * @param {Object} [opts]
 * @param {string} [opts.separator='  '] - Column separator
 * @returns {string} Formatted table string
 */
function table(rows, opts = {}) {
  if (!rows.length) return '';
  const sep = opts.separator || '  ';
  const cols = rows[0].length;
  const widths = Array.from({ length: cols }, (_, ci) =>
    Math.max(...rows.map(r => (r[ci] || '').length))
  );

  return rows.map((row, ri) => {
    const line = row.map((cell, ci) =>
      (cell || '').padEnd(widths[ci])
    ).join(sep).trimEnd();
    // Bold the header row
    return (ri === 0 && isTTY) ? coloured(ANSI.bold, line) : line;
  }).join('\n');
}

// ─────────────────────────────────────────────
// Argument parser
// ─────────────────────────────────────────────

/**
 * Minimal process.argv parser. Handles:
 *   --flag          → { flag: true }
 *   --key value     → { key: 'value' }
 *   --key=value     → { key: 'value' }
 *   positional args → result._ array
 *
 * @param {string[]} argv - Typically process.argv.slice(2)
 * @returns {{ _: string[], [key: string]: string|boolean }}
 */
function parseArgs(argv) {
  const result = { _: [] };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eqPos = arg.indexOf('=');
      if (eqPos !== -1) {
        // --key=value
        const key = arg.slice(2, eqPos);
        result[key] = arg.slice(eqPos + 1);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          result[key] = next;
          i++;
        } else {
          result[key] = true;
        }
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      // -f shorthand flag
      result[arg.slice(1)] = true;
    } else {
      result._.push(arg);
    }
    i++;
  }
  return result;
}

/**
 * Mask a string for display (show only last 4 chars).
 * @param {string|null} value
 * @returns {string}
 */
function maskSecret(value) {
  if (!value) return '(not set)';
  if (value.length <= 4) return '****';
  return '****' + value.slice(-4);
}

module.exports = {
  ANSI,
  coloured,
  info,
  success,
  warn,
  error,
  header,
  muted,
  spinner,
  table,
  parseArgs,
  maskSecret,
};
