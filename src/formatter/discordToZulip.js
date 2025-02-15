import { cleanContent, channelLink, EmbedType, FormattingPatterns, MessageFlags, MessageReferenceType, MessageType, StickerFormatType } from 'discord.js';
import { zulipLimits, got, ZulipError } from '../classes.js';
import { zulip } from '../clients.js';
import { mentionable_zulip_groups, upload_files_to_zulip, discordToZulipReplacements } from '../config.js';
import { db, messagesTable, channelsTable, uploadsTable } from '../db.js';
import { eq } from 'drizzle-orm';

/**
 * Format Discord messages into Zulip messages
 * @param {import('discord.js').Message} msg 
 * @returns {Promise<{content: String}>}
 */
export default async function formatter( msg ) {
	/** @type {{content: String}} */
	let message = {
		content: '@\u200b' + ( msg.member || msg.author ).displayName + ': ' + await msgCleanContent( msg.content, msg.channel, true ),
	};

	// Loading bot response
	if ( msg.flags.has( MessageFlags.Loading ) ) {
		message.content += '*Loading…*';
		return message;
	}

	// Message reply
	if ( msg.type === MessageType.Reply && msg.reference?.type === MessageReferenceType.Default ) {
		const discordMessage = await msg.fetchReference();
		const zulipMessages = await db.select().from(messagesTable).where(eq(messagesTable.discordMessageId, discordMessage.id));
		let sourceLink = 'Reply to';
		let sourceUser = '@\u200b' + ( discordMessage.member || discordMessage.author ).displayName;
		let sourceContent = await msgCleanContent( discordMessage.content, discordMessage.channel );
		if ( zulipMessages.length > 0 ) {
			sourceLink = `[Reply to](${zulip.realm}/#narrow/channel/${zulipMessages[0].zulipStream}/topic/${encodeURIComponent(zulipMessages[0].zulipSubject)}/near/${zulipMessages[0].zulipMessageId})`;
			if ( zulipMessages[0].source === 'zulip' ) {
				const zulipSource = await zulip.getMessage( zulipMessages[0].zulipMessageId );
				if ( zulipSource ) {
					sourceContent = zulipSource.content;
					sourceUser = `@**${zulipSource.sender_full_name}|${zulipSource.sender_id}**`;
				}
			}
		};
		let text = `> ${sourceLink} ${sourceUser}: `;
		if ( discordMessage.attachments.size ) text += '🖼️ ';
		if ( sourceContent ) {
			sourceContent = sourceContent.replace( /(?:@_\*\*[^\n|*]+\|\d+\*\* \[[^\n ]+\/near\/\d+\):\n)?(```+)quote\n(.*?)\n\1(?!`)\n?/gs, '' );
			sourceContent = sourceContent.split('\n').filter( line => !line.startsWith('> ') ).join(' ');
			text += sourceContent.slice(0, 200);
			if ( sourceContent.length > 200 ) text += '…';
		}
		message.content = text + '\n\n' + message.content;
	}

	// Message forwarding
	if ( msg.reference?.type === MessageReferenceType.Forward ) {
		message.content = ( await Promise.all( msg.messageSnapshots.map( async snapshot => {
			const zulipMessages = await db.select().from(messagesTable).where(eq(messagesTable.discordMessageId, snapshot.id));
			let sourceLink = 'Message';
			if ( zulipMessages.length > 0 ) {
				sourceLink = `[Message](${zulip.realm}/#narrow/channel/${zulipMessages[0].zulipStream}/topic/${zulipMessages[0].zulipSubject}/near/${zulipMessages[0].zulipMessageId})`;
			};
			let text = sourceLink + ' forwarded by @\u200b' + ( msg.member || msg.author ).displayName + ':\n``````quote\n';
			text += await msgCleanContent( snapshot.content, snapshot.channel || msg.channel );
			text += await msgEmbeds( snapshot, msg.channel );
			text += await msgStickerLinks( snapshot );
			text += await msgAttachmentLinks( snapshot );
			text += '\n``````';
			return text;
		} ) ) ).join('\n') + ( msg.content.length || msg.attachments.size ? '\n' + message.content : '' );
	}

	// Discord embeds
	message.content += await msgEmbeds( msg );

	// Message links
	const linkRegex = /(\]\()?<?https:\/\/(?:canary\.|ptb\.)?discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)>?(\))?/g;
	let linkMatch;
	while ( ( linkMatch = linkRegex.exec( message.content ) ) !== null ) {
		let [link, prefix, guildId, channelId, msgId, suffix] = linkMatch;
		prefix ??= '';
		suffix ??= '';

		const zulipMessages = await db.select().from(messagesTable).where(eq(messagesTable.discordMessageId, msgId));
		if ( zulipMessages.length === 0 ) continue;
		let replacement = `${prefix}${zulip.realm}/#narrow/channel/${zulipMessages[0].zulipStream}/topic/${encodeURIComponent(zulipMessages[0].zulipSubject)}/near/${zulipMessages[0].zulipMessageId}${suffix}`;
		if ( !prefix && !suffix ) {
			try {
				const zulipChannel = await zulip.getChannel( zulipMessages[0].zulipStream );
				replacement = `#**${zulipChannel.name}>${zulipMessages[0].zulipSubject}@${zulipMessages[0].zulipMessageId}**`;
			}
			catch ( error ) {
				if ( error instanceof ZulipError && error.message === 'Invalid channel ID' ) {
					await db.delete(channelsTable).where(eq(channelsTable.zulipStream, zulipMessages[0].zulipStream));
					await db.delete(messagesTable).where(eq(messagesTable.zulipStream, zulipMessages[0].zulipStream));
					console.log( `- Deleted connection between #${zulipMessages[0].discordChannelId} and ${zulipMessages[0].zulipStream}>${zulipMessages[0].zulipSubject}` );
				}
				else throw error;
			}
		}
		message.content = message.content.replaceAll( link, replacement );
	}

	// Discord file links
	if ( upload_files_to_zulip ) {
		const cdnLinkRegex = /(\]\()?<?(https:\/\/cdn.discordapp\.com\/([a-z-]+)\/([^\s?]+)(\?[&a-z=\d]+)?)>?(\))?/g;
		let cdnLinkMatch;
		while ( ( cdnLinkMatch = cdnLinkRegex.exec( message.content ) ) !== null ) {
			let [link, prefix, fileUrl, endpoint, path, query, suffix] = cdnLinkMatch;
			prefix ??= '';
			suffix ??= '';
			query ??= '';
	
			if ( endpoint !== 'attachments' ) continue;
			const fileUrlKey = ( endpoint === 'attachments' ? fileUrl.split('?')[0] : fileUrl );
			let replacement;
			const zulipUploads = await db.select().from(uploadsTable).where(eq(uploadsTable.discordFileUrl, fileUrlKey));
			if ( zulipUploads.length > 0 ) replacement = `${prefix}${zulip.realm}/user_uploads/${zulipUploads[0].zulipFileUrl}${suffix}`;
			else {
				try {
					let file = new File( [await got.get( fileUrl ).buffer()], path.split('/').pop() );
					let zulipFile = await zulip.uploadFile( file );
					replacement = `${prefix}${zulip.realm}${zulipFile.url}${suffix}`;
					await db.insert(uploadsTable).values( {
						discordFileUrl: fileUrlKey,
						zulipFileUrl: zulipFile.url.replace( '/user_uploads/', '' ),
					} );
				}
				catch ( error ) {
					console.log( '- Failed to upload linked file to Zulip:', error );
				}
			}
			if ( replacement ) message.content = message.content.replaceAll( link, replacement );
		}
	}

	// Timestamps
	message.content = message.content.replace( new RegExp(FormattingPatterns.Timestamp, 'g'), (src, time) => {
		return `<time:${new Date( +(time + '000') ).toISOString()}>`;
	} );

	// Stickers
	message.content += await msgStickerLinks( msg );

	// File uploads
	message.content += await msgAttachmentLinks( msg );

	// User group mentions
	message.content = message.content.replace( /@\*([^*]+)\*/g, (src, group) => {
		if ( group.startsWith( 'role:' ) ) return `@_*${group}*`;
		if ( mentionable_zulip_groups.includes( group ) ) return src;
		return `@_*${group}*`;
	} );

	// Wildcard mentions
	message.content = message.content.replace( /@\*\*(all|everyone|channel|topic)\*\*/g, '@_**$1**' );

	// Don't exceed message length limit
	if ( message.content.length > zulipLimits.max_message_length ) {
		let lines = message.content.split('\n');
		let msgLink = `[[…]](${msg.url})`;
		let length = msgLink.length + 1;
		if ( lines[0].length + length >= zulipLimits.max_message_length ) lines = [
			lines[0].slice(0, zulipLimits.max_message_length - length ) + ' ' + msgLink
		];
		else {
			lines = lines.filter( line => ( length += line.length + 1 ) <= zulipLimits.max_message_length );
			lines.push( msgLink );
		}
		message.content = lines.join('\n');
	}

	return message;
}

/**
 * Return Discord message content with all mentions replaced
 * @param {String} content 
 * @param {import('discord.js').TextBasedChannel} channel 
 * @param {Boolean} [notAtStartOfLine] 
 * @returns {Promise<String>}
 */
async function msgCleanContent( content = '', channel, notAtStartOfLine ) {
	if ( notAtStartOfLine && /^(>|>>>|#{1,3}|-#|```) /.test( content ) ) content = '\n' + content;

	// Quote blocks
	if ( content.includes( '\n>>> ' ) ) {
		let quoteParts = content.split('\n>>> ');
		content = quoteParts[0] + '\n````quote\n' + quoteParts.slice(1).join( '\n>>> ' ) + '\n````';
	}

	// Text replacements
	discordToZulipReplacements.forEach( (value, key) => {
		content = content.replaceAll(key, value);
	} );

	// No mentions
	if ( !content.includes( '<' ) ) return content;

	// Channel mentions
	const regex = new RegExp(FormattingPatterns.Channel, 'g');
	let match;
	while ( ( match = regex.exec( content ) ) !== null ) {
		let [mention, id] = match;

		const discordChannel = channel.client.channels.cache.get(id);
		const zulipChannels = await db.select().from(channelsTable).where(eq(channelsTable.discordChannelId, id));
		let replacement = mention;
		if ( discordChannel?.guildId ) replacement = `**[${mention}](${channelLink(id, discordChannel.guildId)})**`;
		if ( zulipChannels.length > 0 ) {
			try {
				const zulipChannel = await zulip.getChannel( zulipChannels[0].zulipStream );
				if ( !zulipChannels[0].zulipSubject ) replacement = `#**${zulipChannel.name}**`;
				else replacement = `#**${zulipChannel.name}>${zulipChannels[0].zulipSubject}**`;
			}
			catch ( error ) {
				if ( error instanceof ZulipError && error.message === 'Invalid channel ID' ) {
					await db.delete(channelsTable).where(eq(channelsTable.zulipStream, zulipChannels[0].zulipStream));
					await db.delete(messagesTable).where(eq(messagesTable.zulipStream, zulipChannels[0].zulipStream));
					console.log( `- Deleted connection between #${zulipChannels[0].discordChannelId} and ${zulipChannels[0].zulipStream}>${zulipChannels[0].zulipSubject}` );
				}
				else throw error;
			}
		}
		content = content.replaceAll( mention, replacement );
	}

	return cleanContent( content, channel );
}

/**
 * Convert Discord attachment links
 * @param {import('discord.js').Message|import('discord.js').MessageSnapshot} msg 
 * @returns {Promise<String>}
 */
async function msgAttachmentLinks( msg ) {
	if ( !msg.attachments.size ) return '';
	return '\n' + ( await Promise.all( msg.attachments.map( async attachment => {
		let description = attachment.description ? attachment.description + ': ' : '';
		let url = attachment.url;
		if ( upload_files_to_zulip ) {
			const zulipUploads = await db.select().from(uploadsTable).where(eq(uploadsTable.discordFileUrl, attachment.url.split('?')[0]));
			if ( zulipUploads.length > 0 ) url = `/user_uploads/${zulipUploads[0].zulipFileUrl}`;
			else if ( attachment.size < zulipLimits.max_file_upload_size_mib * 1024 * 1024 ) {
				try {
					let file = new File( [await got.get( attachment.url ).buffer()], attachment.name, {type: attachment.contentType} );
					let zulipFile = await zulip.uploadFile( file );
					url = zulipFile.url;
					await db.insert(uploadsTable).values( {
						discordFileUrl: attachment.url.split('?')[0],
						zulipFileUrl: zulipFile.url.replace( '/user_uploads/', '' ),
					} );
				}
				catch ( error ) {
					console.log( '- Failed to upload file to Zulip:', error );
				}
			}
		}
		return `[${description}${attachment.name}](${url})`;
	} ) ) ).join('\n');
}

/**
 * Convert Discord stickers
 * @param {import('discord.js').Message|import('discord.js').MessageSnapshot} msg 
 * @returns {Promise<String>}
 */
async function msgStickerLinks( msg ) {
	if ( !msg.stickers.size ) return '';
	return '\n' + ( await Promise.all( msg.stickers.map( async sticker => {
		let text = `Sticker: ${sticker.name}` + ( sticker.description ? ` - ${sticker.description}` : '' );
		if ( sticker.format !== StickerFormatType.Lottie ) {
			let url = sticker.url;
			if ( upload_files_to_zulip ) {
				const zulipUploads = await db.select().from(uploadsTable).where(eq(uploadsTable.discordFileUrl, sticker.url));
				if ( zulipUploads.length > 0 ) url = `/user_uploads/${zulipUploads[0].zulipFileUrl}`;
				else {
					try {
						let contentType;
						if ( sticker.format === StickerFormatType.PNG ) contentType = 'image/png';
						if ( sticker.format === StickerFormatType.APNG ) contentType = 'image/apng';
						if ( sticker.format === StickerFormatType.GIF ) contentType = 'image/gif';
						let file = new File( [await got.get( sticker.url ).buffer()], sticker.name, {type: contentType} );
						let zulipFile = await zulip.uploadFile( file );
						url = zulipFile.url;
						await db.insert(uploadsTable).values( {
							discordFileUrl: sticker.url,
							zulipFileUrl: zulipFile.url.replace( '/user_uploads/', '' ),
						} );
					}
					catch ( error ) {
						console.log( '- Failed to upload sticker to Zulip:', error );
					}
				}
			}
			text = `[${text}](${url})`
		}
		return text;
	} ) ) ).join('\n');
}

/**
 * Convert Discord embeds
 * @param {import('discord.js').Message|import('discord.js').MessageSnapshot} msg 
 * @param {import('discord.js').TextBasedChannel} [channel] 
 * @returns {Promise<String>}
 */
async function msgEmbeds( msg, channel ) {
	if ( !msg.embeds.filter( embed => embed.data.type === EmbedType.Rich ).length ) return '';
	return '\n' + ( await Promise.all( msg.embeds.filter( embed => embed.data.type === EmbedType.Rich ).map( embed => {
		return msgRichEmbed( embed, msg.channel || channel );
	} ) ) ).join('\n');
}

/**
 * Convert a Discord rich embed
 * @param {import('discord.js').Embed} embed 
 * @param {import('discord.js').TextBasedChannel} channel 
 * @returns {Promise<String>}
 */
async function msgRichEmbed( embed, channel ) {
	if ( embed.data.type !== EmbedType.Rich ) return '';
	let text = '';
	let images = [];
	if ( embed.author?.name ) {
		let author = embed.author.name;
		if ( embed.author.url ) author = `[${embed.author.name}](${embed.author.url})`;
		text += `${author}:\n`;
	}
	if ( embed.title ) {
		let title = embed.title;
		if ( embed.url ) title = `[${embed.title}](${embed.url})`;
		let thumbnail = '';
		if ( embed.thumbnail?.url ) {
			thumbnail = ` [thumbnail](${embed.thumbnail.url})`;
			images.push( `[^](${embed.thumbnail.url})` );
		}
		text += `**${title}**${thumbnail}\n`;
	}
	else if ( embed.thumbnail?.url ) {
		text += `[thumbnail](${embed.thumbnail.url})\n`;
		images.push( `[^](${embed.thumbnail.url})` );
	}
	if ( embed.description ) {
		text += await msgCleanContent( embed.description, channel ) + '\n';
	}
	if ( embed.fields.length ) {
		text += ( await Promise.all( embed.fields.map( async ({name, value}) => {
			return `- **${name}**\n` + '````quote\n' + await msgCleanContent( value, channel ) + '\n````';
		} ) ) ).join('\n') + '\n';
	}
	if ( embed.image?.url ) {
		text += `**[image](${embed.image.url})**\n`;
		images.push( `**[^](${embed.image.url})**` );
	}
	if ( embed.footer?.text ) {
		let timestamp = '';
		if ( embed.timestamp ) timestamp = ` • <time:${embed.timestamp}>`;
		text += `${embed.footer.text}${timestamp}\n`;
	}
	else if ( embed.timestamp ) {
		text += `<time:${embed.timestamp}>\n`;
	}
	return '`````quote\n' + text + '`````' + ( images.length ? '\n' + images.join(' ') : '' );
}