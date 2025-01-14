import { integer } from 'drizzle-orm/pg-core'
import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { drizzle } from 'drizzle-orm/libsql'

export const db = drizzle({ connection: { url: 'file:messages.db' } })

export const messagesTable = sqliteTable(
	'messages',
	{
		discordMessageId: text().unique(),
		discordChannelId: text(),
		zulipMessageId: text().unique(),
		zulipStream: integer(),
		zulipSubject: text().unique(),
		source: text().notNull(),
	},
	(table) => [
		uniqueIndex('discord_id_idx').on(table.discordMessageId),
		uniqueIndex('zulip_message_id_idx').on(table.zulipMessageId),
	]
);
