import * as Discord from 'discord.js';
import zulipInit from 'zulip-js';

globalThis.isDebug = ( process.argv[2] === 'debug' );

export const zulip = await zulipInit( {
	username: process.env.ZULIP_USERNAME,
	apiKey: process.env.ZULIP_API_KEY,
	realm: process.env.ZULIP_REALM,
} );

export const client = new Discord.Client( {
	makeCache: Discord.Options.cacheWithLimits( {
		MessageManager: 200,
		PresenceManager: 0
	} ),
	allowedMentions: {
		parse: ['users'],
		repliedUser: true
	},
	failIfNotExists: false,
	presence: {
		status: Discord.PresenceUpdateStatus.Online,
		activities: [
			{
				type: Discord.ActivityType.Competing,
				name: 'KEKSE',
				state: 'I LOVE COOKIES!!!'
			}
		]
	},
	intents: [
		Discord.GatewayIntentBits.Guilds,
		Discord.GatewayIntentBits.GuildMessages,
		Discord.GatewayIntentBits.GuildMessageReactions,
		Discord.GatewayIntentBits.GuildMembers,
		Discord.GatewayIntentBits.GuildModeration,
		Discord.GatewayIntentBits.DirectMessages,
		Discord.GatewayIntentBits.MessageContent
	]
} );

client.on( Discord.Events.ClientReady, () => {
	console.log( '\n- Successfully logged in on Discord as ' + client.user.username + '!\n' );
} );

client.on( Discord.Events.Error, console.error );
client.on( Discord.Events.Warn, console.warn );

client.login(process.env.DISCORD_TOKEN).catch( error => {
	console.log( '- Error while logging in:', error );
	client.login(process.env.DISCORD_TOKEN).catch( error => {
		console.warn( '- Error while logging in:', error );
		client.login(process.env.DISCORD_TOKEN).catch( error => {
			console.error( '- Error while logging in:', error );
			process.exit(1);
		} );
	} );
} );

if ( isDebug ) client.on( Discord.Events.Debug, debug => {
	if ( isDebug ) console.log( '- Debug: ' + debug );
} );