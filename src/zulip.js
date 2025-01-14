import { zulip, client } from './clients.js';
import formatToDiscord from './formatter/zulipToDiscord.js';
import { db, messagesTable } from './db.js';

/** @type {Map<String, Discord.Webhook>} */
const webhookMap = new Map();

zulip.callOnEachEvent( async zulipEvent => {
	if ( zulipEvent.type === 'message' ) return onZulipMessage( zulipEvent.message );
	if ( zulipEvent.type === 'message' ) return onZulipMessage( zulipEvent );
}, ['message'] );

async function onZulipMessage( msg ) {
	if ( msg.sender_id === +process.env.ZULIP_ID ) return;

	// TEMP RESTRICTION TO SINGLE CHANNEL
	if ( msg.stream_id !== 462695 || msg.subject !== 'Test topic' ) return;
	const discordChannel = client.channels.cache.get('1328127929112334346');

	let threadId = null;
	/** @type {Discord.BaseGuildTextChannel} */
	let webhookChannel = discordChannel;
	if ( discordChannel.isThread() ) {
		webhookChannel = discordChannel.parent;
		threadId = discordChannel.id;
	}
	if ( !webhookMap.has( webhookChannel.id ) ) {
		let webhooks = await webhookChannel.fetchWebhooks();
		let newWebhook = webhooks.filter( webhook => webhook.applicationId === process.env.DISCORD_ID ).first();
		if ( !newWebhook ) newWebhook = await webhookChannel.createWebhook({name: 'Zulip Bridge Webhook'});
		webhookMap.set( webhookChannel.id, newWebhook );
	}
	let webhook = webhookMap.get( webhookChannel.id );

	const discordMsg = await webhook.send(Object.assign(formatToDiscord(msg), { threadId }));
	await db.insert(messagesTable).values({
		discordMessageId: discordMsg.id,
		discordChannelId: discordMsg.channelId,
		zulipMessageId: msg.id,
		zulipStream: msg.stream_id,
		zulipSubject: msg.subject,
		source: 'zulip',
	});
}
