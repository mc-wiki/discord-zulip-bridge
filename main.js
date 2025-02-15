import 'dotenv/config';
import {zulip, discord} from './src/clients.js';

import './src/discord.js';
import './src/zulip.js';

/**
 * End the process gracefully.
 * @param {NodeJS.Signals} signal - The signal received.
 */
function graceful(signal) {
	zulip.queueList.forEach( (queueData, queue_id) => {
		zulip.queueList.delete( queue_id );
		clearTimeout( queueData.timeout );
		queueData.request?.cancel?.(`${signal}`);
	} );
	console.log( '- ' + signal + ': Clearing Zulip queues...' );
	discord.destroy();
	console.log( '- ' + signal + ': Destroying Discord client...' );
	process.exit(0);
}

process.on( 'SIGHUP', graceful );
process.on( 'SIGINT', graceful );
process.on( 'SIGTERM', graceful );
process.on( 'SIGINT SIGTERM', graceful );
