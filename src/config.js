import config from '../config.json' with { type: 'json' };

export const {
	ignored_discord_users = [],
	ignored_zulip_users = [],
	mentionable_discord_roles = [],
	mentionable_zulip_groups = [],
	text_replacements = {
		":zulip:": "<:zulip:1334889309089562675>"
	},
	upload_files_to_zulip = false,
	discord_username_prefix = "",
	discord_username_suffix = ""
} = config;

export const zulipToDiscordReplacements = new Map( Object.entries( text_replacements ).map( replacement => [replacement[0], String(replacement[1])] ) );
export const discordToZulipReplacements = new Map( Object.entries( text_replacements ).map( replacement => [String(replacement[1]), replacement[0]] ) );