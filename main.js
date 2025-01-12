import 'dotenv/config';
import * as Discord from 'discord.js';
import zulipInit from 'zulip-js';

globalThis.isDebug = ( process.argv[2] === 'debug' );

const client = new Discord.Client( {
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

const zulip = await zulipInit({
	username: process.env.ZULIP_USERNAME,
	apiKey: process.env.ZULIP_API_KEY,
	realm: process.env.ZULIP_REALM,
});

/** @type {Map<String, Discord.Webhook>} */
const webhookMap = new Map();

zulip.callOnEachEvent( async msg => {
	if ( msg.type !== 'message' ) return;
	if ( msg.message.sender_id === +process.env.ZULIP_ID ) return;

	// TEMP RESTRICTION TO SINGLE CHANNEL
	if ( msg.message.stream_id !== 462695 || msg.message.subject !== 'Test topic' ) return;
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

	webhook.send( { threadId,
		username: msg.message.sender_full_name,
		avatarURL: msg.message.avatar_url,
		content: msg.message.content,
	} );
}, ['message'] );

client.on( Discord.Events.ClientReady, () => {
	console.log( '\n- Successfully logged in on Discord as ' + client.user.username + '!\n' );
} );

client.on( Discord.Events.MessageCreate, async msg => {
	if ( !msg.channel.isTextBased() || msg.system ) return;
	if ( msg.applicationId === process.env.DISCORD_ID ) return;

	// TEMP RESTRICTION TO SINGLE CHANNEL
	if ( msg.channelId !== '1328127929112334346' ) return;
	const zulipChannel = {
		type: 'stream',
		to: 462695,
		topic: 'Test topic',
	};

	zulip.messages.send( Object.assign( {
		content: '@' + msg.author.displayName + ': ' + msg.content,
	}, zulipChannel ) )
} );

client.on( Discord.Events.MessageUpdate, (oldmsg, msg) => {
	if ( !msg.channel.isTextBased() || msg.system ) return;
} );

client.on( Discord.Events.GuildCreate, guild => {
	console.log( '- ' + guild.name + ': I\'ve been added to the server.' );
} );

client.on( Discord.Events.GuildDelete, guild => {
	if ( !guild.available ) {
		console.log( '- ' + guild.name + ': This server isn\'t responding.' );
		return;
	}
	console.log( '- ' + guild.name + ': I\'ve been removed from the server.' );
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

/**
 * End the process gracefully.
 * @param {NodeJS.Signals} signal - The signal received.
 */
function graceful(signal) {
	client.destroy();
	console.log( '- ' + signal + ': Destroying client...' );
	process.exit(0);
}

process.on( 'SIGHUP', graceful );
process.on( 'SIGINT', graceful );
process.on( 'SIGTERM', graceful );
process.on( 'SIGINT SIGTERM', graceful );