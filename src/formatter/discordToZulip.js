import { FormattingPatterns, MessageFlags, MessageReferenceType, MessageType } from 'discord.js';
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
		content: '@\u200b' + msg.author.displayName + ': ' + msg.cleanContent,
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
		let sourceUser = '@\u200b' + discordMessage.author.displayName;
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
			let text = sourceLink + ' forwarded by @\u200b' + msg.author.displayName + ':\n````quote\n';
			text += ( snapshot.cleanContent || '' ) + await msgAttachmentLinks( snapshot );
			text += '\n````';
			return text;
		} ) ) ).join('\n') + ( msg.content.length || msg.attachments.size ? '\n' + message.content : '' );
	}

	// Message links


	// Wildcard mentions
	message.content = message.content.replace( /@\*\*(all|everyone|channel|topic)\*\*/g, '@\u200b**$1**' );

	// Timestamps
	message.content = message.content.replace( new RegExp(FormattingPatterns.Timestamp, 'g'), (src, time) => {
		return `<time:${new Date( +(time + '000') ).toISOString()}>`;
	} );

	// File uploads
	message.content += await msgAttachmentLinks( msg );

	return message;
}

/**
 * Recursively replace quote blocks
 * @param {import('discord.js').Message|import('discord.js').MessageSnapshot} msg 
 * @returns {Promise<String>}
 */
async function msgAttachmentLinks( msg ) {
	if ( !msg.attachments.size ) return '';
	let text = '';
	if ( msg.content.length ) text += '\n';
	text += ( await Promise.all( msg.attachments.map( async attachment => {
		let description = attachment.description ? attachment.description + ': ' : '';
		let url = attachment.url;
		if ( upload_files_to_zulip ) {
			// TODO: Upload files to Zulip
		}
		return `[${description}${attachment.name}](${url})`;
	} ) ) ).join('\n');
	return text;
}