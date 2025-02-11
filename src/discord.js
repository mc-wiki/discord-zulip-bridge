import { Events } from 'discord.js';
import { zulipLimits } from './classes.js';
import { zulip, discord } from './clients.js';
import formatToZulip from './formatter/discordToZulip.js';
import { ignored_discord_users } from './config.js';
import { db, channelsTable, messagesTable } from './db.js';
import { eq } from 'drizzle-orm';

discord.on( ...catchEventError( Events.MessageCreate, async msg => {
	if ( !msg.guildId || !msg.channel.isTextBased() || msg.system ) return;
	if ( msg.applicationId === msg.client.user.id ) return;
	if ( ignored_discord_users.includes( msg.author.id ) ) return;
	if ( msg.applicationId && ignored_discord_users.includes( msg.applicationId ) ) return;

	const zulipChannels = await db.select().from(channelsTable).where(eq(channelsTable.discordChannelId, msg.channelId));
	if ( zulipChannels.length === 0 ) return;

	const zulipMsg = await zulip.sendMessage( Object.assign( await formatToZulip( msg ), {
		type: 'stream',
		to: zulipChannels[0].zulipStream,
		topic: zulipChannels[0].zulipSubject,
	} ) );

	await db.insert(messagesTable).values( {
		discordMessageId: msg.id,
		discordChannelId: msg.channelId,
		zulipMessageId: zulipMsg,
		zulipStream: zulipChannels[0].zulipStream,
		zulipSubject: zulipChannels[0].zulipSubject,
		source: 'discord',
	} );
} ) );

discord.on( ...catchEventError( Events.MessageUpdate, async (oldmsg, msg) => {
	if ( !msg.guildId || !msg.channel.isTextBased() || msg.system ) return;
	if ( msg.applicationId === msg.client.user.id ) return;
	if ( ignored_discord_users.includes( msg.author.id ) ) return;
	if ( msg.applicationId && ignored_discord_users.includes( msg.applicationId ) ) return;

	if ( !oldmsg.partial && msg.equals( oldmsg ) ) return;

	const zulipMessages = await db.select().from(messagesTable).where(eq(messagesTable.discordMessageId, msg.id));

	if ( zulipMessages.length === 0 ) return;

	await zulip.editMessage( zulipMessages[0].zulipMessageId, await formatToZulip( msg ) );
} ) );

discord.on( ...catchEventError( Events.MessageDelete, async msg => {
	const zulipMessages = await db.delete(messagesTable).where(eq(messagesTable.discordMessageId, msg.id)).returning();

	if ( zulipMessages.length === 0 ) return;

	await zulip.deleteMessage( zulipMessages[0].zulipMessageId );
} ) );

discord.on( ...catchEventError( Events.ThreadCreate, async (thread, isNew) => {
	if ( !isNew ) return;
	if ( thread.ownerId === thread.client.user.id ) return;

	let msg = await thread.fetchStarterMessage().catch( error => {
		if ( error?.code === 10008 ) return null;
		throw error;
	} );

	if ( !msg ) return;
	if ( msg.applicationId === thread.client.user.id ) return;
	if ( ignored_discord_users.includes( msg.author.id ) ) return;
	if ( msg.applicationId && ignored_discord_users.includes( msg.applicationId ) ) return;

	const channels = await db.select().from(channelsTable).where(eq(channelsTable.discordChannelId, thread.parentId));
	if ( channels.length === 0 ) return;
	if ( !channels[0].includeThreads ) return;

	let subject = ( channels[0].zulipSubject ? channels[0].zulipSubject + '/' : '' ) + thread.name;
	if ( subject.length > zulipLimits.max_topic_length ) subject = subject.slice(0, zulipLimits.max_topic_length - 1) + '…';

	const zulipChannels = await db.insert(channelsTable).values( {
		zulipStream: channels[0].zulipStream,
		zulipSubject: subject,
		discordChannelId: thread.id
	} ).returning();

	const zulipMsg = await zulip.sendMessage( Object.assign( await formatToZulip(msg), {
		type: 'stream',
		to: zulipChannels[0].zulipStream,
		topic: zulipChannels[0].zulipSubject,
	} ) );

	await db.insert(messagesTable).values( {
		discordMessageId: msg.id,
		discordChannelId: msg.channelId,
		zulipMessageId: zulipMsg,
		zulipStream: zulipChannels[0].zulipStream,
		zulipSubject: zulipChannels[0].zulipSubject,
		source: 'discord',
	} );
} ) );

discord.on( ...catchEventError( Events.ChannelDelete, async channel => {
	const zulipChannels = await db.delete(channelsTable).where(eq(channelsTable.discordChannelId, channel.id)).returning();

	if ( zulipChannels.length === 0 ) return;

	await db.delete(messagesTable).where(eq(messagesTable.discordChannelId, channel.id));
	console.log( `- Deleted connection between #${channel.name} and ${zulipChannels[0].zulipStream}>${zulipChannels[0].zulipSubject}` );
} ) );

discord.on( ...catchEventError( Events.ThreadDelete, async thread => {
	const zulipChannels = await db.delete(channelsTable).where(eq(channelsTable.discordChannelId, thread.id)).returning();

	if ( zulipChannels.length === 0 ) return;

	await db.delete(messagesTable).where(eq(messagesTable.discordChannelId, thread.id));
	console.log( `- Deleted connection between #${thread.name} and ${zulipChannels[0].zulipStream}>${zulipChannels[0].zulipSubject}` );
} ) );

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


/**
 * Wrapper function for Discord events to catch unhandled errors.
 * @template {Events} E 
 * @template {Promise} T
 * @param {E} event 
 * @param {(...args: import('discord.js').ClientEvents[E]) => T} callback 
 * @returns {[E, callback]}
 */
function catchEventError( event, callback ) {
	return [event, async ( ...args ) => {
		try {
			return await callback( ...args );
		}
		catch ( error ) {
			console.error( `- Unhandled error while handling Discord event ${event}:`, error );
		}
	}];
}