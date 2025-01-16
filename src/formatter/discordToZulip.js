import { FormattingPatterns, MessageReferenceType, MessageType } from 'discord.js';
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
		content: '@' + msg.author.displayName + ': ' + msg.cleanContent,
	};

	// Message forwarding
	if ( msg.reference?.type === MessageReferenceType.Forward ) {
		message.content = ( await Promise.all( msg.messageSnapshots.map( async snapshot => {
			const zulipMessages = await db.select().from(messagesTable).where(eq(messagesTable.discordMessageId, snapshot.id));
			let sourceLink = 'Message';
			if ( zulipMessages.length > 0 ) {
				sourceLink = `[Message](${process.env.ZULIP_REALM}/#narrow/channel/${zulipMessages[0].zulipStream}/topic/${zulipMessages[0].zulipSubject}/near/${zulipMessages[0].zulipMessageId})`;
			};
			let text = sourceLink + ' forwarded by @' + msg.author.displayName + ':\n````quote\n';
			text += ( snapshot.cleanContent || '' ) + msgAttachmentLinks( snapshot );
			text += '\n````';
			return text;
		} ) ) ).join('\n');
		if ( msg.content.length || msg.attachments.size ) {
			message.content += '\n@' + msg.author.displayName + ': ' + msg.cleanContent;
		}
	}

	// Message reply
	if ( msg.type === MessageType.Reply ) {
		
	}

	// Wildcard mentions
	message.content = message.content.replace( /@\*\*(all|everyone|channel|topic)\*\*/g, '@\u200b**$1**' );

	// Timestamps
	message.content = message.content.replace( new RegExp(FormattingPatterns.Timestamp, 'g'), (src, time) => {
		return `<time:${new Date( +(time + '000') ).toISOString()}>`;
	} );

	// File uploads
	message.content += msgAttachmentLinks( msg );

	return message;
}

/**
 * Recursively replace quote blocks
 * @param {import('discord.js').Message|import('discord.js').MessageSnapshot} msg 
 * @returns {String}
 */
function msgAttachmentLinks( msg ) {
	if ( !msg.attachments.size ) return '';
	let text = '';
	if ( msg.content.length ) text += '\n';
	text += msg.attachments.map( attachment => {
		let description = attachment.description ? attachment.description + ': ' : '';
		return `[${description}${attachment.name}](${attachment.url})`;
	} ).join('\n');
	return text;
}