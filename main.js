import 'dotenv/config';
import {zulip, client} from './src/clients.js';

import './src/discord.js';
import './src/zulip.js';

/**
 * End the process gracefully.
 * @param {NodeJS.Signals} signal - The signal received.
 */
function graceful(signal) {
	client.destroy();
	console.log( '- ' + signal + ': Destroying client...' );
	process.exit(0);
}

process.on( 'SIGHUP', graceful );
process.on( 'SIGINT', graceful );
process.on( 'SIGTERM', graceful );
process.on( 'SIGINT SIGTERM', graceful );
