import { sqliteTable, integer, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { drizzle } from 'drizzle-orm/libsql';

export const db = drizzle({ connection: { url: 'file:messages.db' } });

export const messagesTable = sqliteTable(
	'messages',
	{
		discordMessageId: text().unique(),
		discordChannelId: text(),
		zulipMessageId: integer().unique(),
		zulipStream: integer(),
		zulipSubject: text(),
		source: text({enum:['discord', 'zulip']}).notNull(),
	},
	(table) => [
		uniqueIndex('discord_id_idx').on(table.discordMessageId),
		uniqueIndex('zulip_message_id_idx').on(table.zulipMessageId),
	]
);
