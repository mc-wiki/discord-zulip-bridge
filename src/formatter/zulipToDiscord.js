import * as url_template_lib from 'url-template';
import { messageLink } from 'discord.js';
import { zulipLimits } from '../classes.js';
import { zulip, discord } from '../clients.js';
import { discord_username_prefix, discord_username_suffix, mentionable_discord_roles, zulipToDiscordReplacements } from '../config.js';
import { db, messagesTable, channelsTable } from '../db.js';
import { and, eq, isNull } from 'drizzle-orm';

/** @type {Map<RegExp, {url_template: url_template_lib.Template; group_number_to_name: Record<number, string>}>} */
const linkifier_map = new Map();

/**
 * Format Zulip messages into Discord messages
 * @param {Object} msg 
 * @param {String} msg.sender_full_name
 * @param {String} msg.avatar_url
 * @param {String} msg.content
 * @param {Boolean} msg.is_me_message
 * @param {Object} msgData
 * @param {Number} msgData.zulipMessageId
 * @param {Number} msgData.zulipStream
 * @param {String} msgData.zulipSubject
 * @param {import('discord.js').GuildTextBasedChannel} msgData.discordChannel
 * @returns {Promise<import('discord.js').WebhookMessageCreateOptions>}
 */
export default async function formatter( msg, msgData ) {
	/** @type {import('discord.js').WebhookMessageCreateOptions} */
	let message = {
		username: discord_username_prefix + msg.sender_full_name + discord_username_suffix,
		avatarURL: msg.avatar_url,
		content: ( msg.is_me_message ? '_' + msg.content.replace( /^\/me /, '' ) + '_' : msg.content ),
	};

	// Text replacements
	zulipToDiscordReplacements.forEach( (value, key) => {
		message.content = message.content.replaceAll(key, value);
	} );

	// Discord role mentions
	if ( mentionable_discord_roles.length ) {
		let roles = msgData.discordChannel.guild.roles.cache.filter( role => mentionable_discord_roles.includes( role.id ) );
		let contentWithoutQuotes = message.content.replace( /(```+)quote\n(.*?)\n\1(?!`)\n*/gs, '' );
		roles.forEach( role => {
			if ( !contentWithoutQuotes.includes( `@*${role.name}*` ) ) return;
			message.content = message.content.replaceAll( `@*${role.name}*`, role.toString() );
		} );
	}

	// Silent mentions
	if ( message.content.includes( '@_' ) ) {
		message.content = message.content.replaceAll( '@_', '@' );
	}

	// Message links
	const linkRegex = /\/#narrow\/(?:stream|channel)\/([^\/\) ]+)\/topic\/([^\/\) ]+)\/near\/(\d+)/g;
	let linkMatch;
	while ( ( linkMatch = linkRegex.exec( message.content ) ) !== null ) {
		let [link, channel, topic, msgId] = linkMatch;

		const discordMessages = await db.select().from(messagesTable).where(eq(messagesTable.zulipMessageId, msgId));
		let replacement = `](<${zulip.realm}${link}>)`;
		if ( discordMessages.length > 0 ) {
			/** @type {import('discord.js').GuildChannel} */
			const discordChannel = await discord.channels.fetch(discordMessages[0].discordChannelId).catch( async error => {
				if ( error?.code !== 10003 ) return console.error( error );
		
				await db.delete(channelsTable).where(eq(channelsTable.discordChannelId, discordMessages[0].discordChannelId));
				await db.delete(messagesTable).where(eq(messagesTable.discordChannelId, discordMessages[0].discordChannelId));
				console.log( `- Deleted connection between #${discordMessages[0].discordChannelId} and ${discordMessages[0].zulipStream}>${discordMessages[0].zulipSubject}` );
				return null;
			} );
			if ( discordChannel ) {
				replacement = `](<${messageLink(discordChannel.id, discordMessages[0].discordMessageId, discordChannel.guildId)}>)`;
			}
		}
		message.content = message.content.replaceAll( `](${zulip.realm}${link})`, replacement );
	}

	// Message mentions
	const msgMentionRegex = /#\*\*([^>*]+)>([^@*]+)@(\d+)\*\*/g;
	let msgMentionMatch;
	while ( ( msgMentionMatch = msgMentionRegex.exec( message.content ) ) !== null ) {
		let [mention, channel, topic, msgId] = msgMentionMatch;

		const discordMessages = await db.select().from(messagesTable).where(eq(messagesTable.zulipMessageId, msgId));
		let replacement = `**[#${channel}>${topic}@${msgId}](<${zulip.realm}/#narrow/channel/${encodeURIComponent(channel)}/topic/${encodeURIComponent(topic)}/near/${msgId}>)**`;
		if ( discordMessages.length > 0 ) {
			/** @type {import('discord.js').GuildChannel} */
			const discordChannel = await discord.channels.fetch(discordMessages[0].discordChannelId).catch( async error => {
				if ( error?.code !== 10003 ) return console.error( error );
		
				await db.delete(channelsTable).where(eq(channelsTable.discordChannelId, discordMessages[0].discordChannelId));
				await db.delete(messagesTable).where(eq(messagesTable.discordChannelId, discordMessages[0].discordChannelId));
				console.log( `- Deleted connection between #${discordMessages[0].discordChannelId} and ${discordMessages[0].zulipStream}>${discordMessages[0].zulipSubject}` );
				return null;
			} );
			if ( discordChannel ) {
				replacement = messageLink(discordChannel.id, discordMessages[0].discordMessageId, discordChannel.guildId);
			}
		}
		message.content = message.content.replaceAll( mention, replacement );
	}

	// Topic mentions
	const topicMentionRegex = /#\*\*([^>*]+)>([^@*]+)\*\*/g;
	let topicMentionMatch;
	while ( ( topicMentionMatch = topicMentionRegex.exec( message.content ) ) !== null ) {
		let [mention, channel, topic] = topicMentionMatch;

		const zulipStream = ( await zulip.getStreamId( channel ) );
		if ( !zulipStream ) continue;
		const discordChannels = await db.select().from(channelsTable).where(and(eq(channelsTable.zulipStream, zulipStream),eq(channelsTable.zulipSubject, topic)));
		let replacement = `**[#${channel}>${topic}](<${zulip.realm}/#narrow/channel/${encodeURIComponent(channel)}/topic/${encodeURIComponent(topic)}>)**`;
		if ( discordChannels.length > 0 ) {
			replacement = `<#${discordChannels[0].discordChannelId}>`;
		}
		message.content = message.content.replaceAll( mention, replacement );
	}

	// Channel mentions
	const channelMentionRegex = /#\*\*([^>*]+)\*\*/g;
	let channelMentionMatch;
	while ( ( channelMentionMatch = channelMentionRegex.exec( message.content ) ) !== null ) {
		let [mention, channel] = channelMentionMatch;

		const zulipStream = ( await zulip.getStreamId( channel ) );
		if ( !zulipStream ) continue;
		const discordChannels = await db.select().from(channelsTable).where(and(eq(channelsTable.zulipStream, zulipStream),isNull(channelsTable.zulipSubject)));
		let replacement = `**[#${channel}](<${zulip.realm}/#narrow/channel/${encodeURIComponent(channel)}>)**`;
		if ( discordChannels.length > 0 ) {
			replacement = `<#${discordChannels[0].discordChannelId}>`;
		}
		message.content = message.content.replaceAll( mention, replacement );
	}

	// User mentions
	message.content = message.content.replace( /@\*\*([^|*]+)\|\d+\*\*/g, '@**$1**' );

	// File uploads
	if ( message.content.includes( '](/user_uploads/' ) ) {
		message.content = message.content.replaceAll( '](/user_uploads/', `](${zulip.realm}/user_uploads/` );
	}

	// Quotes
	if ( message.content.includes( '```quote\n' ) ) {
		message.content = replaceQuote( message.content );
	}

	// Default code blocks
	if ( zulipLimits.default_code_block_language && message.content.includes( '```\n' ) ) {
		message.content = replaceDefaultCodeBlocks( message.content );
	}

	// Timestamps
	message.content = message.content.replace( /<time:([^>]+)>/g, (src, time) => {
		let date = Date.parse(time);
		if ( Number.isNaN( date ) ) return src;
		return `<t:${date.toString().slice(0, -3)}:F>`;
	} );

	// Linkifiers
	// Based on: https://github.com/zulip/zulip/blob/main/web/third/marked/lib/marked.cjs#L650
	const regexes = [...linkifier_map.keys()];
	let escapedContent = message.content.replace( /(`+)(.*?)\1(?!`)/gs, '<codeReplacement>' );
	regexes.forEach(function (regex) {
		let linkifierMatch;
		while ( ( linkifierMatch = regex.exec( escapedContent ) ) !== null ) {
			let [match, ...groups] = linkifierMatch;
			// Insert the created URL
			let href = handleLinkifier(regex, groups, match);
			if (href !== undefined) {
				escapedContent = escapedContent.replaceAll( match, '<linkifierReplacement>' );
				message.content = message.content.replaceAll( match, `[${match}](<${href}>)` );
			}
		}
	});

	// Don't exceed message length limit
	if ( message.content.length > 2_000 ) {
		let lines = message.content.split('\n');
		// Remove stacked quotes
		lines = lines.filter( line => !line.startsWith( '> >' ) );
		if ( lines.reduce( (length, line) => length + line.length, 0 ) > 2_000 ) {
			// Remove all quotes
			lines = lines.filter( line => !line.startsWith( '> ' ) );
			if ( lines.reduce( (length, line) => length + line.length, 0 ) > 2_000 ) {
				let msgLink = `[[…]](<${zulip.realm}/#narrow/channel/${msgData.zulipStream}/topic/${encodeURIComponent(msgData.zulipSubject)}/near/${msgData.zulipMessageId}>)`;
				let length = msgLink.length + 1;
				if ( lines[0].length + length >= 2_000 ) lines = [ lines[0].slice(0, 2_000 - length ) + ' ' + msgLink ];
				else {
					lines = lines.filter( line => ( length += line.length + 1 ) <= 2_000 );
					lines.push( msgLink );
				}
			}
		}
		message.content = lines.join('\n');
	}

	return message;
}

/**
 * Recursively replace quote blocks
 * @param {String} text 
 * @returns {String}
 */
function replaceQuote( text ) {
	return text.replace( /(```+)quote\n(.*?)\n\1(?!`)\n*/gs, (src, block, quote) => {
		quote = quote.replace( /(<)?\b(https?:\/\/[^\s<>]+[^\s"'),.:;<>\]])(>)?/g, (link, prefix, url, suffix) => {
			if ( prefix && suffix ) return link;
			return `<${url}>`;
		} ).replace( /^(> .*\n)\n+/gm, '$1' );
		if ( quote.includes( '```quote\n' ) ) quote = replaceQuote( quote );
		return '> ' + quote.replaceAll( '\n', '\n> ' ) + '\n';
	} );
}

/**
 * Replace default code blocks
 * @param {String} text 
 * @returns {String}
 */
function replaceDefaultCodeBlocks( text ) {
	if ( !zulipLimits.default_code_block_language ) return text;
	return text.replace( /(```+)(\w*?)\n(.*?)\n\1(?!`)\n*/gs, (src, block, lang, code) => {
		if ( lang ) return src;
		return `${block}${zulipLimits.default_code_block_language}\n${code}\n${block}\n`;
	} );
}

/**
 * Source: https://github.com/zulip/zulip/blob/main/web/src/markdown.ts#L553
 * @param {RegExp} pattern 
 * @param {String[]} matches 
 * @returns {String}
 */
function handleLinkifier( pattern, matches ) {
	const item = linkifier_map.get(pattern);
	if ( !item ) return;
	const {url_template, group_number_to_name} = item;
	const template_context = Object.fromEntries(
		matches.map((match, i) => [group_number_to_name[i + 1], match]),
	);
	return url_template.expand(template_context);
}

/**
 * Source: https://github.com/zulip/zulip/blob/main/web/src/linkifiers.ts#L19
 * @param {String} pattern 
 * @param {String} url 
 * @returns {[RegExp | null, url_template_lib.Template, Record<number, string>][]}
 */
function python_to_js_linkifier( pattern, url ) {
	// Converts a python named-group regex to a javascript-compatible numbered
	// group regex... with a regex!
	const named_group_re = /\(?P<([^>]+?)>/g;
	let match = named_group_re.exec(pattern);
	let current_group = 1;
	/** @type {Record<number, string>} */
	const group_number_to_name = {};
	while (match) {
		const name = match[1];
		// Replace named group with regular matching group
		pattern = pattern.replace("(?P<" + name + ">", "(");
		// Map numbered reference to named reference for template expansion
		group_number_to_name[current_group] = name;

		// Reset the RegExp state
		named_group_re.lastIndex = 0;
		match = named_group_re.exec(pattern);

		current_group += 1;
	}
	// Convert any python in-regex flags to RegExp flags
	let js_flags = "g";
	const inline_flag_re = /\(\?([Limsux]+)\)/;
	match = inline_flag_re.exec(pattern);

	// JS regexes only support i (case insensitivity) and m (multiline)
	// flags, so keep those and ignore the rest
	if (match) {
		const py_flags = match[1];

		for (const flag of py_flags) {
			if ("im".includes(flag)) {
				js_flags += flag;
			}
		}

		pattern = pattern.replace(inline_flag_re, "");
	}
	// Ideally we should have been checking that linkifiers
	// begin with certain characters but since there is no
	// support for negative lookbehind in javascript, we check
	// for this condition in `contains_backend_only_syntax()`
	// function. If the condition is satisfied then the message
	// is rendered locally, otherwise, we return false there and
	// message is rendered on the backend which has proper support
	// for negative lookbehind.
	pattern = pattern + /(?!\w)/.source;
	let final_regex = null;
	try {
		final_regex = new RegExp(pattern, js_flags);
	} catch (error) {
		// We have an error computing the generated regex syntax.
		// We'll ignore this linkifier for now, but log this
		// failure for debugging later.
		if (error instanceof SyntaxError) {
			console.log("python_to_js_linkifier failure!", {pattern}, error);
		} else {
			// Don't swallow any other (unexpected) exceptions.
			/* istanbul ignore next */
			throw error;
		}
	}
	const url_template = url_template_lib.parseTemplate(url);
	return [final_regex, url_template, group_number_to_name];
}

/**
 * Source: https://github.com/zulip/zulip/blob/main/web/src/linkifiers.ts#L88
 * @param {{pattern: String, url_template: String}[]} linkifiers 
 */
export function update_linkifier_rules( linkifiers ) {
	linkifier_map.clear();

	for (const linkifier of linkifiers) {
		const [regex, url_template, group_number_to_name] = python_to_js_linkifier(
			linkifier.pattern,
			linkifier.url_template,
		);
		if (!regex) {
			// Skip any linkifiers that could not be converted
			continue;
		}

		linkifier_map.set(regex, {
			url_template,
			group_number_to_name,
		});
	}
}