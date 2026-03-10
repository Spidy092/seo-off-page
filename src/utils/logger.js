const pino = require('pino');
const config = require('../config');
const path = require('path');

const targets = [
    {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:yyyy-mm-dd HH:MM:ss' },
        level: config.logLevel,
    },
];

// File logging in production
if (process.env.NODE_ENV === 'production') {
    targets.push({
        target: 'pino/file',
        options: { destination: path.join(__dirname, '../../logs/app.log'), mkdir: true },
        level: config.logLevel,
    });
}

const logger = pino({
    level: config.logLevel,
    transport: { targets },
});

/**
 * Create a child logger scoped to a worker/module
 * @param {string} name - Worker or module name
 */
function createLogger(name) {
    return logger.child({ module: name });
}

module.exports = { logger, createLogger };
