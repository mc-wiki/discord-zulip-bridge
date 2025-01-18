import { Events } from 'discord.js';
import { zulip, discord } from './clients.js';
import formatToZulip from './formatter/discordToZulip.js';
import { ignored_discord_users } from './config.js';
import { db, channelsTable, messagesTable } from './db.js';
import { eq } from 'drizzle-orm';

discord.on( Events.MessageCreate, async msg => {
	if ( !msg.guildId || !msg.channel.isTextBased() || msg.system ) return;
	if ( msg.applicationId === process.env.DISCORD_ID ) return;
	if ( ignored_discord_users.includes( msg.author.id ) ) return;
	if ( msg.applicationId && ignored_discord_users.includes( msg.applicationId ) ) return;

	const zulipChannels = await db.select().from(channelsTable).where(eq(channelsTable.discordChannelId, msg.channelId));
	if ( zulipChannels.length === 0 ) return;

	const zulipMsg = await zulip.messages.send( Object.assign( await formatToZulip(msg), {
		type: 'stream',
		to: zulipChannels[0].zulipStream,
		topic: zulipChannels[0].zulipSubject,
	} ) );

	await db.insert(messagesTable).values( {
		discordMessageId: msg.id,
		discordChannelId: msg.channelId,
		zulipMessageId: zulipMsg.id,
		zulipStream: zulipChannels[0].zulipStream,
		zulipSubject: zulipChannels[0].zulipSubject,
		source: 'discord',
	} );
} );

discord.on( Events.MessageUpdate, async (oldmsg, msg) => {
	if ( !msg.guildId || !msg.channel.isTextBased() || msg.system ) return;
	if ( msg.applicationId === process.env.DISCORD_ID ) return;
	if ( ignored_discord_users.includes( msg.author.id ) ) return;
	if ( msg.applicationId && ignored_discord_users.includes( msg.applicationId ) ) return;

	if ( oldmsg.content === msg.content ) return;

	const zulipMessages = await db.select().from(messagesTable).where(eq(messagesTable.discordMessageId, msg.id));

	if ( zulipMessages.length === 0 ) return;

	await zulip.messages.update( Object.assign( await formatToZulip( msg ), {
		message_id: zulipMessages[0].zulipMessageId
	} ) );
} );

discord.on( Events.MessageDelete, async msg => {
	if ( !msg.guildId || !msg.channel.isTextBased() || msg.system ) return;
	if ( ignored_discord_users.includes( msg.author.id ) ) return;
	if ( msg.applicationId && ignored_discord_users.includes( msg.applicationId ) ) return;

	const zulipMessages = await db.delete(messagesTable).where(eq(messagesTable.discordMessageId, msg.id)).returning();

	if ( zulipMessages.length === 0 ) return;

	await zulip.messages.deleteById( {
		message_id: zulipMessages[0].zulipMessageId
	} );
} );

discord.on( Events.ThreadCreate, async (thread, isNew) => {
	if ( !isNew ) return;
	if ( thread.ownerId === process.env.DISCORD_ID ) return;

	let msg = await thread.fetchStarterMessage().catch( error => {
		if ( error?.code === 10008 ) return null;
		throw error;
	} );

	if ( !msg ) return;
	if ( msg.applicationId === process.env.DISCORD_ID ) return;
	if ( ignored_discord_users.includes( msg.author.id ) ) return;
	if ( msg.applicationId && ignored_discord_users.includes( msg.applicationId ) ) return;

	const channels = await db.select().from(channelsTable).where(eq(channelsTable.discordChannelId, thread.parentId));
	if ( channels.length === 0 ) return;
	if ( !channels[0].includeThreads ) return;

	const zulipChannels = await db.insert(channelsTable).values( {
		zulipStream: channels[0].zulipStream,
		zulipSubject: ( channels[0].zulipSubject ? channels[0].zulipSubject + '/' : '' ) + thread.name,
		discordChannelId: thread.id
	} ).returning();

	const zulipMsg = await zulip.messages.send( Object.assign( await formatToZulip(msg), {
		type: 'stream',
		to: zulipChannels[0].zulipStream,
		topic: zulipChannels[0].zulipSubject,
	} ) );

	await db.insert(messagesTable).values( {
		discordMessageId: msg.id,
		discordChannelId: msg.channelId,
		zulipMessageId: zulipMsg.id,
		zulipStream: zulipChannels[0].zulipStream,
		zulipSubject: zulipChannels[0].zulipSubject,
		source: 'discord',
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
