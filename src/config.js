import config from '../config.json' with { type: 'json' };

export const {
	ignored_discord_users = [],
	ignored_zulip_users = [],
	mentionable_discord_roles = [],
	mentionable_zulip_groups = [],
	upload_files_to_zulip = false
} = config;