#!/usr/bin/env node
// Cross-platform launcher: starts the overlay detached from the terminal.
// Clears ELECTRON_RUN_AS_NODE, which editors such as VS Code set and which
// would make Electron run as plain Node instead of opening the window.
'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron'); // path to the Electron binary

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;

const args = [path.join(__dirname, '..'), ...process.argv.slice(2)];
if (process.platform === 'linux') args.push('--ozone-platform=x11');

const child = spawn(electron, args, { env, detached: true, stdio: 'ignore' });
child.unref();
