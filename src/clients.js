import * as Discord from 'discord.js';
import { Zulip } from './classes.js';
import { mentionable_discord_roles } from './config.js';

export const zulip = new Zulip( {
	username: process.env.ZULIP_USERNAME,
	apiKey: process.env.ZULIP_API_KEY,
	realm: process.env.ZULIP_REALM,
	userId: process.env.ZULIP_ID,
} );

export const discord = new Discord.Client( {
	makeCache: Discord.Options.cacheWithLimits( {
		MessageManager: 200,
		PresenceManager: 0
	} ),
	allowedMentions: {
		parse: ['users'],
		roles: mentionable_discord_roles,
		repliedUser: true
	},
	failIfNotExists: false,
	presence: {
		status: Discord.PresenceUpdateStatus.Online,
		activities: [
			{
				type: Discord.ActivityType.Custom,
				name: zulip.realm,
			}
		]
	},
	intents: [
		Discord.GatewayIntentBits.Guilds,
		Discord.GatewayIntentBits.GuildMessages,
		Discord.GatewayIntentBits.GuildMessageReactions,
		Discord.GatewayIntentBits.MessageContent
	],
	partials: [
		Discord.Partials.Message
	]
} );

discord.on( Discord.Events.ClientReady, () => {
	console.log( `\n- Successfully logged in on Discord as ${discord.user.username}!\n` );
} );

discord.on( Discord.Events.Error, console.error );
discord.on( Discord.Events.Warn, console.warn );

discord.login(process.env.DISCORD_TOKEN).catch( error => {
	console.log( '- Error while logging in:', error );
	discord.login(process.env.DISCORD_TOKEN).catch( error => {
		console.warn( '- Error while logging in:', error );
		discord.login(process.env.DISCORD_TOKEN).catch( error => {
			console.error( '- Error while logging in:', error );
			process.exit(1);
		} );
	} );
} );

if ( isDebug ) discord.on( Discord.Events.Debug, debug => {
	if ( isDebug ) console.log( '- Debug: ' + debug );
} );