import { sqliteTable, integer, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { drizzle } from 'drizzle-orm/libsql';

export const db = drizzle({ connection: { url: 'file:messages.db' } });

export const channelsTable = sqliteTable(
	'channels',
	{
		discordChannelId: text().unique().notNull(),
		zulipStream: integer().notNull(),
		zulipSubject: text(),
		includeThreads: integer({ mode: 'boolean' }).default(true),
	},
	(table) => [
		uniqueIndex('discord_channel_idx').on(table.discordChannelId),
		uniqueIndex('zulip_stream_topic_idx').on(table.zulipStream, table.zulipSubject),
	]
);

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

export const uploadsTable = sqliteTable(
	'uploads',
	{
		discordFileUrl: text().unique().notNull(),
		zulipFileUrl: text().unique().notNull(),
		zulipFileId: integer().unique(),
	},
	(table) => [
		uniqueIndex('discord_url_idx').on(table.discordFileUrl),
		uniqueIndex('zulip_file_url_idx').on(table.zulipFileUrl),
		uniqueIndex('zulip_file_id_idx').on(table.zulipFileId),
	]
);
