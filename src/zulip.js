import { zulip, discord } from './clients.js';
import formatToDiscord from './formatter/zulipToDiscord.js';
import { db, channelsTable, messagesTable } from './db.js';
import { and, eq } from 'drizzle-orm';

/** @type {Map<String, import('discord.js').Webhook>} */
const webhookMap = new Map();

zulip.callOnEachEvent( async zulipEvent => {
	if ( zulipEvent.type === 'message' ) {
		if ( zulipEvent.message.type === 'stream' ) return onZulipMessage( zulipEvent.message );
		if ( zulipEvent.message.type === 'private' ) return onZulipCommand( zulipEvent.message );
	}
	if ( zulipEvent.type === 'update_message' ) return onZulipMessageUpdate( zulipEvent );
	if ( zulipEvent.type === 'delete_message' ) return onZulipMessageDelete( zulipEvent );
}, ['message', 'update_message', 'delete_message'] );

async function onZulipMessage( msg ) {
	if ( msg.type !== 'stream' ) return;
	if ( msg.sender_id === +process.env.ZULIP_ID ) return;

	const discordChannels = await db.select().from(channelsTable).where(and(eq(channelsTable.zulipStream, msg.stream_id),eq(channelsTable.zulipSubject, msg.subject)));
	if ( discordChannels.length === 0 ) return;
	/** @type {import('discord.js').TextBasedChannel} */
	const discordChannel = await discord.channels.fetch(discordChannels[0].discordChannelId);

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

async function onZulipCommand( msg ) {
	if ( msg.sender_id === +process.env.ZULIP_ID ) return;

	if ( !msg.content.startsWith( '!bridge' ) ) return;

	const zulipUser = ( await zulip.callEndpoint('/users/' + msg.sender_id) ).user;

	// Check for Zulip admin
	if ( zulipUser.role > 200 ) return;

	/** @type {[Number, String | null, String, Boolean]} */
	let [
		zulipStream,
		zulipSubject,
		discordChannelId,
		includeThreads = 'true'
	] = msg.content.match( /^!bridge #\*\*([^>*]+)>([^@*]+)\*\* (\d+)(?: (true|false))?/ )?.slice(1) ?? [];

	if ( !zulipStream || !discordChannelId ) {
		return await zulip.messages.send( {
			type: 'direct',
			to: [msg.sender_id],
			content: '`!bridge <zulipChannelMention> <discordChannelId> <includeThreads>`\n> `!bridge #**Channel>Topic** 123456789012345 true`'
		} );
	}

	zulipStream = ( await zulip.streams.getStreamId( zulipStream ) ).stream_id;
	includeThreads = ( includeThreads === 'true' );
	zulipSubject ??= null;

	if ( !zulipStream ) {
		return await zulip.messages.send( {
			type: 'direct',
			to: [msg.sender_id],
			content: "Zulip channel doesn't exist or I'm not a subscriber yet!"
		} );
	}

	await db.insert(channelsTable).values( {
		zulipStream,
		zulipSubject,
		discordChannelId,
		includeThreads
	} );
	return await zulip.messages.send( {
		type: 'direct',
		to: [msg.sender_id],
		content: 'Bridge added!'
	} );
}
