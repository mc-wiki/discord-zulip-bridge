import { Events, MessageFlags } from 'discord.js';
import { zulip, discord } from './clients.js';
import formatToZulip from './formatter/discordToZulip.js';
import { db, messagesTable } from './db.js';
import { eq } from 'drizzle-orm';

discord.on( Events.MessageCreate, async msg => {
	if ( !msg.channel.isTextBased() || msg.system ) return;
	if ( msg.applicationId === process.env.DISCORD_ID ) return;
	if ( msg.flags.has( MessageFlags.Loading ) ) return;

	// TEMP RESTRICTION TO SINGLE CHANNEL
	if ( msg.channelId !== '1328127929112334346' ) return;
	const zulipChannel = {
		type: 'stream',
		to: 462695,
		topic: 'Test topic',
	};

	const zulipMsg = await zulip.messages.send( Object.assign( await formatToZulip(msg), zulipChannel ) );

	await db.insert(messagesTable).values( {
		discordMessageId: msg.id,
		discordChannelId: msg.channelId,
		zulipMessageId: zulipMsg.id,
		zulipStream: 462695,
		zulipSubject: 'Test topic',
		source: 'discord',
	} );
} );

discord.on( Events.MessageUpdate, async (oldmsg, msg) => {
	if ( !msg.channel.isTextBased() || msg.system ) return;
	if ( msg.applicationId === process.env.DISCORD_ID ) return;

	// TEMP RESTRICTION TO SINGLE CHANNEL
	if ( msg.channelId !== '1328127929112334346' ) return;
	const zulipChannel = {
		type: 'stream',
		to: 462695,
		topic: 'Test topic',
	};

	if ( oldmsg.flags.has( MessageFlags.Loading ) && !msg.flags.has( MessageFlags.Loading ) ) {
		const zulipMsg = await zulip.messages.send( Object.assign( await formatToZulip( msg ), zulipChannel ) );

		await db.insert(messagesTable).values( {
			discordMessageId: msg.id,
			discordChannelId: msg.channelId,
			zulipMessageId: zulipMsg.id,
			zulipStream: 462695,
			zulipSubject: 'Test topic',
			source: 'discord',
		} );
	}

	if ( oldmsg.content === msg.content ) return;

	const zulipMessages = await db.select().from(messagesTable).where(eq(messagesTable.discordMessageId, msg.id));

	if ( zulipMessages.length === 0 ) return;

	await zulip.messages.update( Object.assign( await formatToZulip( msg ), {
		message_id: zulipMessages[0].zulipMessageId
	} ) );
} );

discord.on( Events.MessageDelete, async msg => {
	if ( !msg.channel.isTextBased() || msg.system ) return;

	const zulipMessages = await db.delete(messagesTable).where(eq(messagesTable.discordMessageId, msg.id)).returning();

	if ( zulipMessages.length === 0 ) return;

	await zulip.messages.deleteById( {
		message_id: zulipMessages[0].zulipMessageId
	} );
} );

discord.on( Events.GuildCreate, guild => {
	console.log( '- ' + guild.name + ': I\'ve been added to the server.' );
} );

discord.on( Events.GuildDelete, guild => {
	if ( !guild.available ) {
		console.log( '- ' + guild.name + ': This server isn\'t responding.' );
		return;
	}
	console.log( '- ' + guild.name + ': I\'ve been removed from the server.' );
} );
