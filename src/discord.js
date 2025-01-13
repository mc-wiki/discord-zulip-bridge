import {Events} from 'discord.js';
import {zulip, client} from './clients.js';
import formatToZulip from './formatter/discordToZulip.js';

client.on( Events.MessageCreate, async msg => {
	if ( !msg.channel.isTextBased() || msg.system ) return;
	if ( msg.applicationId === process.env.DISCORD_ID ) return;

	// TEMP RESTRICTION TO SINGLE CHANNEL
	if ( msg.channelId !== '1328127929112334346' ) return;
	const zulipChannel = {
		type: 'stream',
		to: 462695,
		topic: 'Test topic',
	};

	zulip.messages.send( Object.assign( formatToZulip( msg ), zulipChannel ) )
} );

client.on( Events.MessageUpdate, (oldmsg, msg) => {
	if ( !msg.channel.isTextBased() || msg.system ) return;
	if ( msg.applicationId === process.env.DISCORD_ID ) return;

	// TEMP RESTRICTION TO SINGLE CHANNEL
	if ( msg.channelId !== '1328127929112334346' ) return;
	const zulipChannel = {
		type: 'stream',
		to: 462695,
		topic: 'Test topic',
	};
} );

client.on( Events.GuildCreate, guild => {
	console.log( '- ' + guild.name + ': I\'ve been added to the server.' );
} );

client.on( Events.GuildDelete, guild => {
	if ( !guild.available ) {
		console.log( '- ' + guild.name + ': This server isn\'t responding.' );
		return;
	}
	console.log( '- ' + guild.name + ': I\'ve been removed from the server.' );
} );