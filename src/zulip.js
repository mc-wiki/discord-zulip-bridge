import { zulip, discord } from './clients.js';
import formatToDiscord from './formatter/zulipToDiscord.js';
import { db, messagesTable } from './db.js';
import { eq } from 'drizzle-orm';

/** @type {Map<String, import('discord.js').Webhook>} */
const webhookMap = new Map();

zulip.callOnEachEvent( async zulipEvent => {
	if ( zulipEvent.type === 'message' ) return onZulipMessage( zulipEvent.message );
	if ( zulipEvent.type === 'update_message' ) return onZulipMessageUpdate( zulipEvent );
	if ( zulipEvent.type === 'delete_message' ) return onZulipMessageDelete( zulipEvent );
}, ['message', 'update_message', 'delete_message'] );

async function onZulipMessage( msg ) {
	if ( msg.sender_id === +process.env.ZULIP_ID ) return;

	// TEMP RESTRICTION TO SINGLE CHANNEL
	if ( msg.stream_id !== 462695 || msg.subject !== 'Test topic' ) return;
	/** @type {import('discord.js').TextBasedChannel} */
	const discordChannel = await discord.channels.fetch('1328127929112334346');

	let threadId = null;
	/** @type {import('discord.js').BaseGuildTextChannel} */
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

	const discordMsg = await webhook.send( Object.assign( await formatToDiscord( msg ), { threadId } ) );
	await db.insert(messagesTable).values( {
		discordMessageId: discordMsg.id,
		discordChannelId: discordMsg.channelId,
		zulipMessageId: msg.id,
		zulipStream: msg.stream_id,
		zulipSubject: msg.subject,
		source: 'zulip',
	} );
}

async function onZulipMessageUpdate( msg ) {
	if ( msg.rendering_only ) return;
	if ( msg.user_id === +process.env.ZULIP_ID ) return;

	if ( msg.orig_content === msg.content ) return;
	
	const discordMessages = await db.select().from(messagesTable).where(eq(messagesTable.zulipMessageId, msg.message_id));

	if ( discordMessages.length === 0 ) return;
	
	/** @type {import('discord.js').TextBasedChannel} */
	const discordChannel = await discord.channels.fetch(discordMessages[0].discordChannelId);

	if ( !discordChannel ) return;

	let threadId = null;
	/** @type {import('discord.js').BaseGuildTextChannel} */
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

	await webhook.editMessage( discordMessages[0].discordMessageId, { threadId,
		content: ( await formatToDiscord( msg ) ).content
	} );
}

async function onZulipMessageDelete( msg ) {
	const discordMessages = await db.delete(messagesTable).where(eq(messagesTable.zulipMessageId, msg.message_id)).returning();

	if ( discordMessages.length === 0 ) return;
	
	/** @type {import('discord.js').TextBasedChannel} */
	const discordChannel = await discord.channels.fetch(discordMessages[0].discordChannelId);

	if ( !discordChannel ) return;

	await discordChannel.messages.delete(discordMessages[0].discordMessageId);
}
