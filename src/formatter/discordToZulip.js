import { EmbedType, FormattingPatterns, MessageFlags, MessageReferenceType, MessageType } from 'discord.js';
import { zulip } from '../clients.js';
import { upload_files_to_zulip } from '../config.js';
import { db, messagesTable } from '../db.js';
import { eq } from 'drizzle-orm';

/**
 * Format Discord messages into Zulip messages
 * @param {import('discord.js').Message} msg 
 * @returns {Promise<{content: String}>}
 */
export default async function formatter( msg ) {
	/** @type {{content: String}} */
	let message = {
		content: '@\u200b' + ( msg.member || msg.author ).displayName + ': ' + msg.cleanContent,
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
		let sourceContent = discordMessage.cleanContent;
		if ( zulipMessages.length > 0 ) {
			sourceLink = `[Reply to](${process.env.ZULIP_REALM}/#narrow/channel/${zulipMessages[0].zulipStream}/topic/${encodeURIComponent(zulipMessages[0].zulipSubject)}/near/${zulipMessages[0].zulipMessageId})`;
			if ( zulipMessages[0].source === 'zulip' ) {
				const zulipSource = ( await zulip.messages.getById( {
					message_id: zulipMessages[0].zulipMessageId,
					apply_markdown: false,
				} ) ).message;
				if ( zulipSource ) {
					sourceContent = zulipSource.content;
					sourceUser = `@**${zulipSource.sender_full_name}|${zulipSource.sender_id}**`;
				}
			}
		};
		let text = `> ${sourceLink} ${sourceUser}: `;
		if ( discordMessage.attachments.size ) text += '🖼️ ';
		if ( sourceContent ) {
			text += sourceContent.replaceAll( '\n', ' ' ).slice(0, 100);
			if ( sourceContent.length > 100 ) text += '…';
		}
		message.content = text + '\n\n' + message.content;
	}

	// Message forwarding
	if ( msg.reference?.type === MessageReferenceType.Forward ) {
		message.content = ( await Promise.all( msg.messageSnapshots.map( async snapshot => {
			const zulipMessages = await db.select().from(messagesTable).where(eq(messagesTable.discordMessageId, snapshot.id));
			let sourceLink = 'Message';
			if ( zulipMessages.length > 0 ) {
				sourceLink = `[Message](${process.env.ZULIP_REALM}/#narrow/channel/${zulipMessages[0].zulipStream}/topic/${zulipMessages[0].zulipSubject}/near/${zulipMessages[0].zulipMessageId})`;
			};
			let text = sourceLink + ' forwarded by @\u200b' + ( msg.member || msg.author ).displayName + ':\n``````quote\n';
			text += ( snapshot.cleanContent || '' );
			text += msgEmbeds( msg );
			text += await msgAttachmentLinks( snapshot );
			text += '\n``````';
			return text;
		} ) ) ).join('\n') + ( msg.content.length || msg.attachments.size ? '\n' + message.content : '' );
	}

	// Discord embeds
	message.content += msgEmbeds( msg );

	// Message links


	// Timestamps
	message.content = message.content.replace( new RegExp(FormattingPatterns.Timestamp, 'g'), (src, time) => {
		return `<time:${new Date( +(time + '000') ).toISOString()}>`;
	} );

	// File uploads
	message.content += await msgAttachmentLinks( msg );

	// Wildcard mentions
	message.content = message.content.replace( /@\*\*(all|everyone|channel|topic)\*\*/g, '@\u200b**$1**' );

	return message;
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
			// TODO: Upload files to Zulip
		}
		return `[${description}${attachment.name}](${url})`;
	} ) ) ).join('\n');
}

/**
 * Convert Discord embeds
 * @param {import('discord.js').Message|import('discord.js').MessageSnapshot} msg 
 * @returns {String}
 */
function msgEmbeds( msg ) {
	if ( !msg.embeds.filter( embed => embed.data.type === EmbedType.Rich ).length ) return '';
	return '\n' + msg.embeds.filter( embed => embed.data.type === EmbedType.Rich ).map( msgRichEmbed ).join('\n');
}

/**
 * Convert a Discord rich embed
 * @param {import('discord.js').Embed} embed 
 * @returns {String}
 */
function msgRichEmbed( embed ) {
	if ( embed.data.type !== EmbedType.Rich ) return '';
	let text = '';
	if ( embed.author?.name ) {
		let author = embed.author.name;
		if ( embed.author.url ) author = `[${embed.author.name}](${embed.author.url})`;
		text += `${author}:\n`;
	}
	if ( embed.title ) {
		let title = embed.title;
		if ( embed.url ) title = `[${embed.title}](${embed.url})`;
		let thumbnail = '';
		if ( embed.thumbnail?.url ) thumbnail = ` [thumbnail](${embed.thumbnail.url})`;
		text += `**${title}**${thumbnail}\n`;
	}
	else if ( embed.thumbnail?.url ) {
		text += `[thumbnail](${embed.thumbnail.url})\n`;
	}
	if ( embed.description ) {
		text += `${embed.description}\n`;
	}
	if ( embed.fields.length ) {
		text += embed.fields.map( ({name, value}) => {
			return `- **${name}**\n` + '````quote\n' + value + '\n````';
		} ).join('\n') + '\n';
	}
	if ( embed.image?.url ) {
		text += `[image](${embed.image.url})\n`;
	}
	if ( embed.footer?.text ) {
		let timestamp = '';
		if ( embed.timestamp ) timestamp = ` • <time:${embed.timestamp}>`;
		text += `${embed.footer.text}${timestamp}\n`;
	}
	else if ( embed.timestamp ) {
		text += `<time:${embed.timestamp}>\n`;
	}
	return '`````quote\n' + text + '`````';
}