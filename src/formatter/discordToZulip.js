import {FormattingPatterns} from 'discord.js';

/**
 * Format Discord messages into Zulip messages
 * @param {import('discord.js').Message} msg 
 * @returns {{content: String}}
 */
export default function formatter( msg ) {
	/** @type {{content: String}} */
	let message = {
		content: '@' + msg.author.displayName + ': ' + msg.cleanContent,
	};

	// Wildcard mentions
	message.content = message.content.replace( /@\*\*(all|everyone|channel|topic)\*\*/g, '@\u200b**$1**' );

	// Timestamps
	message.content = message.content.replace( new RegExp(FormattingPatterns.Timestamp, 'g'), (src, time) => {
		return `<time:${new Date( +(time + '000') ).toISOString()}>`;
	} );

	// File uploads
	if ( msg.attachments.size ) {
		if ( msg.content.length ) message.content += '\n';
		message.content += msg.attachments.map( attachment => {
			let description = attachment.description ? attachment.description + ': ' : '';
			return `[${description}${attachment.name}](${attachment.url})`;
		} ).join('\n');
	}

	return message;
}