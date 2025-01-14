import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	out: './drizzle',
	schema: './src/db.js',
	dialect: 'sqlite',
	dbCredentials: {
		url: 'file:messages.db',
	},
});
