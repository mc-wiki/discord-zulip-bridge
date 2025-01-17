# discord-zulip-bridge

## Features

- [x] Two-way Discord-Zulip message relay
- [x] Supports message edit/delete/reply with SQLite
- [x] Converts Discord/Zulip specific message format
  - [x] Reply (except ping)
  - [x] Quote block
  - [x] Message link
  - [x] Channel mention
  - [x] Discord message forwarding
  - [x] Wildcard mention
  - [x] Timestamp
  - [ ] File
  - [x] Silent mention
  - [x] Zulip linkifier

## Setup

1. Install latest LTS Node.js
2. Run `npm install` and `npm build`
3. Create `.env` file with:
```env
DISCORD_TOKEN=""
DISCORD_ID="(Discord user id of the bot)"
ZULIP_ID="(Zulip user id of the bot)"
ZULIP_USERNAME="(This is the bot email)"
ZULIP_API_KEY=""
ZULIP_REALM="https://mc-wiki.zulipchat.com"
```
4. Run `npm start` to start the bridge
5. See [Commands](#commands) to set up channel links

## Commands

The `!bridge` command is available to configure channel links. You can use this command by DMing the bot on Zulip. Note that you must be an admin to perform this.

- Syntax: `!bridge <zulipChannelMention> <discordChannelId> <includeThreads>`
- Options:
  - `zulipChannelMention`: Mention the channel on Zulip
  - `discordChannelId`: You can obtain this by turning on User Settings > Advanced > Developer Mode and right click the channel to copy its ID
  - If `includeThreads` is `true`, threads created on the Zulip/Discord channel will be synced to the respective Discord/Zulip channel.
- Example: ``!bridge #**Channel>Topic** 123456789012345 true`
