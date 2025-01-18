import { zulip, discord } from './clients.js';
import formatToDiscord from './formatter/zulipToDiscord.js';
import { ignored_zulip_users } from './config.js';
import { db, channelsTable, messagesTable } from './db.js';
import { and, eq, isNull } from 'drizzle-orm';

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
	if ( ignored_zulip_users.includes( msg.sender_id ) ) return;

	let threadName = null;
	/** @type {null|import('discord.js').TextChannel} */
	let parentChannel = null;
	const discordChannels = await db.select().from(channelsTable).where(and(eq(channelsTable.zulipStream, msg.stream_id),eq(channelsTable.zulipSubject, msg.subject)));
	if ( discordChannels.length === 0 ) {
		let parent = msg.subject.includes( '/' ) ? msg.subject.split('/')[0] : null;
		const parentChannels = await db.select().from(channelsTable).where(and(
			eq(channelsTable.zulipStream, msg.stream_id),
			parent ? eq(channelsTable.zulipSubject, parent) : isNull(channelsTable.zulipSubject)
		));
		if ( parentChannels.length === 0 ) return;

		if ( !parentChannels[0].includeThreads ) return;
		threadName = msg.subject.includes( '/' ) ? msg.subject.split('/').slice(1).join('/') : msg.subject;
		parentChannel = await discord.channels.fetch(parentChannels[0].discordChannelId);
		if ( !parentChannel.isThreadOnly() ) {
			let thread = await parentChannel.threads.create( {
				name: threadName,
				reason: 'New topic created on Zulip'
			} );
			await db.insert(channelsTable).values( {
				zulipStream: msg.stream_id,
				zulipSubject: msg.subject,
				discordChannelId: thread.id
			} );
			parentChannel = thread;
			threadName = null;
		}
	}
	/** @type {import('discord.js').TextBasedChannel} */
	const discordChannel = parentChannel || await discord.channels.fetch(discordChannels[0].discordChannelId);

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

	const discordMsg = await webhook.send( Object.assign( await formatToDiscord( msg ), { threadId, threadName } ) );
	if ( threadName ) {
		await db.insert(channelsTable).values( {
			zulipStream: msg.stream_id,
			zulipSubject: msg.subject,
			discordChannelId: discordMsg.channelId
		} );
	}
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
	if ( ignored_zulip_users.includes( msg.user_id ) ) return;

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
	if ( msg.message_type !== 'stream' ) return;

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
	] = msg.content.match( /^!bridge #\*\*([^>*]+)(?:>([^@*]+))?\*\* (\d+)(?: (true|false))?/ )?.slice(1) ?? [];

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
