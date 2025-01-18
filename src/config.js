import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const config = require('../config.json');

export const {
	ignored_discord_users = [],
	ignored_zulip_users = [],
	upload_files_to_zulip = false
} = config;
export default config;