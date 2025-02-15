import { EventEmitter } from 'node:events';
import gotDefault from 'got';
import { gotSsrf } from 'got-ssrf';

globalThis.isDebug = ( process.argv[2] === 'debug' );

export const zulipLimits = {
	max_stream_name_length: 60,
	max_topic_length: 60,
	max_message_length: 10000,
	max_file_upload_size_mib: 10,
	default_code_block_language: ''
};

export const got = gotDefault.extend( {
	timeout: {
		request: 5_000
	},
	headers: {
		'user-agent': 'Discord Zulip Bridge/' + ( isDebug ? 'testing' : process.env.npm_package_version ) + ' (Discord; ' + process.env.npm_package_name + ')'
	}
}, gotSsrf );

/** @extends {EventEmitter<ZulipEvents>} */
export class Zulip extends EventEmitter {
	#got;
	/** @type {Map<String, {options: {event_types: String[]}, timeout: NodeJS.Timeout?, request: import('got').CancelableRequest?}>} */
	queueList = new Map();

	/**
	 * Create a Zulip client
	 * @param {Object} options The client options
	 * @param {String} options.username The email of the Zulip bot
	 * @param {String} options.apiKey The api key of the Zulip bot
	 * @param {String} options.realm The url of the Zulip server
	 * @param {String} options.userId The user id of the Zulip bot
	 */
	constructor( { username, apiKey, realm, userId } ) {
		super( { captureRejections: true } );
		this.realm = realm;
		this.apiURL = `${realm}/api/v1`;
		this.#got = gotDefault.extend( {
			throwHttpErrors: false,
			timeout: {
				request: 5_000
			},
			headers: {
				Authorization: 'Basic ' + Buffer.from(`${username}:${apiKey}`).toString('base64'),
				'user-agent': 'Discord Zulip Bridge/' + ( isDebug ? 'testing' : process.env.npm_package_version ) + ' (Zulip; ' + process.env.npm_package_name + ')'
			}
		} );
		this.userId = +userId;
	}

	/**
	 * Send a GET request to Zulip
	 * @param {String} endpoint The API endpoint
	 * @param {{[key: String]: String}} params The URL search parameters
	 */
	async get( endpoint, params = {} ) {
		if ( !endpoint.startsWith( '/' ) ) endpoint = `/${endpoint}`;
		let url = new URL( this.apiURL + endpoint );
		Object.entries( params ).forEach( ([key, value]) => {
			if ( ( value ?? null ) === null ) return;
			url.searchParams.append( key, value );
		} );
		let body = await this.#got.get( url ).json();
		if ( body?.result === 'success' ) return body;
		throw new ZulipError( body );
	}

	/**
	 * Send a POST request to Zulip
	 * @param {String} endpoint The API endpoint
	 * @param {{[key: String]: String | Blob | String[]}} params The data to send in the body
	 */
	async post( endpoint, params = {} ) {
		if ( !endpoint.startsWith( '/' ) ) endpoint = `/${endpoint}`;
		let form = new FormData();
		Object.entries( params ).forEach( ([key, value]) => {
			if ( ( value ?? null ) === null ) return;
			if ( value instanceof File ) form.append( key, value, value.name );
			else if ( Array.isArray( value ) ) form.append( key, JSON.stringify( value ) );
			else form.append( key, value );
		} );
		let body = await this.#got.post( this.apiURL + endpoint, {
			body: form
		} ).json();
		if ( body?.result === 'success' ) return body;
		throw new ZulipError( body );
	}

	/**
	 * Send a PATCH request to Zulip
	 * @param {String} endpoint The API endpoint
	 * @param {{[key: String]: String}} params The data to send in the body
	 */
	async patch( endpoint, params = {} ) {
		if ( !endpoint.startsWith( '/' ) ) endpoint = `/${endpoint}`;
		let body = await this.#got.patch( this.apiURL + endpoint, {
			form: params
		} ).json();
		if ( body?.result === 'success' ) return body;
		throw new ZulipError( body );
	}

	/**
	 * Send a DELETE request to Zulip
	 * @param {String} endpoint The API endpoint
	 * @param {{[key: String]: String}} params The URL search parameters
	 */
	async delete( endpoint, params = {} ) {
		if ( !endpoint.startsWith( '/' ) ) endpoint = `/${endpoint}`;
		let url = new URL( this.apiURL + endpoint );
		Object.entries( params ).forEach( ([key, value]) => {
			if ( ( value ?? null ) === null ) return;
			url.searchParams.append( key, value );
		} );
		let body = await this.#got.delete( url ).json();
		if ( body?.result === 'success' ) return body;
		throw new ZulipError( body );
	}

	/**
	 * Send a message
	 * @param {Object} msg The message
	 * @param {'stream'|'direct'} msg.type The message type
	 * @param {String|Number|Number[]} msg.to The channel name, channel id or list of user ids
	 * @param {String} msg.content The message content
	 * @param {String} [msg.topic] The message topic
	 * @returns {Promise<Number>} The message id
	 */
	async sendMessage( msg ) {
		let body = await this.post( 'messages', msg );
		return body.id;
	}

	/**
	 * Edit a message
	 * @param {Number} msgId The message id
	 * @param {Object} msg The message
	 * @param {String} msg.content The message content
	 * @returns {Promise<{id: Number}[]>} No longer referenced uploads
	 */
	async editMessage( msgId, msg ) {
		let body = await this.patch( `messages/${msgId}`, msg );
		return body.detached_uploads;
	}

	/**
	 * Delete a message
	 * @param {Number} msgId The message id
	 */
	async deleteMessage( msgId ) {
		await this.delete( `messages/${msgId}` );
	}

	/**
	 * Get a message by id
	 * @param {Number} msgId The message id
	 * @param {Object} [options] 
	 * @param {Boolean} options.apply_markdown 
	 * @returns {Promise<{content: String, sender_full_name: String, sender_id: Number}>} The message
	 */
	async getMessage( msgId, options = {} ) {
		options.apply_markdown ??= false;
		let body = await this.get( `messages/${msgId}`, options );
		return body.message;
	}

	/**
	 * Upload a file
	 * @param {File} file The file
	 * @returns {Promise<{filename: String, url: String}>} The file info
	 */
	async uploadFile( file ) {
		return await this.post( 'user_uploads', {file} );
	}

	/**
	 * Get a stream id by channel name
	 * @param {String} stream The channel name
	 * @returns {Promise<Number>} The stream id
	 */
	async getStreamId( stream ) {
		let body = await this.get( 'get_stream_id', {stream} );
		return body.stream_id;
	}

	/**
	 * Get a channel by stream id
	 * @param {Number} stream The stream id
	 * @returns {Promise<{stream_id: Number, name: String}>} The channel
	 */
	async getChannel( stream ) {
		let body = await this.get( `streams/${stream}` );
		return body.stream;
	}

	/**
	 * Get a user by user id
	 * @param {Number} user The user id
	 * @param {Object} [options] 
	 * @param {Boolean} options.include_custom_profile_fields 
	 * @returns {Promise<{user_id: Number, full_name: String, role: Number}>} The user
	 */
	async getUser( user, options = {} ) {
		let body = await this.get( `users/${user}`, options );
		return body.user;
	}

	/**
	 * Update a user
	 * @param {Number} user The user id
	 * @param {Object} options 
	 * @param {String} [options.full_name] 
	 * @param {Number} [options.role] 
	 * @param {{id: Number, value: String}[]} [options.profile_data] 
	 * @param {String} [options.new_email] 
	 * @returns {Promise<{user_id: Number, full_name: String, role: Number}>} The user
	 */
	async updateUser( user, options = {} ) {
		await this.patch( `users/${user}`, options );
	}

	/**
	 * Register an event queue
	 * @param {String[]|String|null} [event_types] The event types
	 * @param {Object} [options] Other request options
	 * @param {String[]} [options.event_types]
	 * @param {String[]} [options.fetch_event_types]
	 * @param {Object} [options.client_capabilities]
	 * @param {Boolean} [options.notification_settings_null]
	 * @param {Boolean} [options.bulk_message_deletion]
	 * @param {Boolean} [options.client_capabilities.linkifier_url_template]
	 * @param {zulipEventCallback} [callback] The event callback
	 * @returns {Promise<{queue_id: String, last_event_id: Number}>}
	 */
	async registerQueue( event_types = null, options = {}, callback ) {
		if ( ( event_types ?? null ) === null ) event_types = null;
		else if ( !Array.isArray( event_types ) ) event_types = [event_types];
		options ??= {};
		options.event_types ??= event_types;
		if ( options.client_capabilities ) {
			options.client_capabilities.notification_settings_null ??= true;
			options.client_capabilities = JSON.stringify( options.client_capabilities );
		}
		let body = await this.post( 'register', options );
		this.queueList.set( body.queue_id, {options, timeout: null, request: null} );
		if ( callback ) this.#eventLoop( callback, body.queue_id, body.last_event_id, body.event_queue_longpoll_timeout_seconds );
		return body;
	}

	/**
	 * Register the main event queue
	 * @param {String[]|String|null} [event_types] The event types
	 * @param {Object} [options] Other request options
	 * @param {String[]} [options.event_types]
	 * @param {String[]} [options.fetch_event_types]
	 * @param {Object} [options.client_capabilities]
	 * @param {Boolean} [options.notification_settings_null]
	 * @param {Boolean} [options.bulk_message_deletion]
	 * @param {Boolean} [options.client_capabilities.linkifier_url_template]
	 * @returns {Promise<{queue_id: String, last_event_id: Number}>}
	 */
	async registerMainQueue( event_types = null, options = {} ) {
		let body = await this.registerQueue( event_types, options );
		this.#eventLoop( null, body.queue_id, body.last_event_id, body.event_queue_longpoll_timeout_seconds );
		return body;
	}

	/**
	 * Delete an event queue
	 * @param {String} queue_id The queue id
	 */
	async deleteQueue( queue_id ) {
		let queueData = this.queueList.get( queue_id );
		try {
			if ( queueData ) {
				this.queueList.delete( queue_id );
				clearTimeout( queueData.timeout );
				queueData.request?.cancel?.('Zulip event deleted');
			}
			await this.delete( 'events', {queue_id} );
		}
		catch ( error ) {
			if ( error instanceof ZulipError && error.code === 'BAD_EVENT_QUEUE_ID' ) return;
			else throw error;
		}
	}

	/**
	 * Get events from a queue
	 * @param {Object} options 
	 * @param {String} options.queue_id The queue id
	 * @param {Number} [options.last_event_id] The last seen event id
	 * @param {Boolean} [options.dont_block] Don't block until a new event is available
	 * @param {Number} [timeout] event_queue_longpoll_timeout_seconds
	 * @returns {Promise<ZulipEvent[]>} List of new events
	 */
	async getEvents( options = {}, timeout = 90 ) {
		if ( !timeout ) timeout = 90;
		let request = this.#got.get( this.apiURL + '/events', {
			searchParams: options,
			timeout: {
				request: timeout * 1000
			}
		} ).json();
		let queueData = this.queueList.get( options.queue_id );
		if ( queueData ) queueData.request = request;
		let body = await request.catch( error => {
			if ( request.isCanceled ) return {
				code: 'BAD_EVENT_QUEUE_ID',
				msg: `Bad event queue ID: ${options.queue_id}`,
				queue_id: options.queue_id,
				result: 'error'
			};
			throw error;
		} );
		if ( body?.result === 'success' ) return body.events;
		throw new ZulipError( body );
	}

	/**
	 * Get events in a loop
	 * @param {zulipEventCallback} callback The event callback
	 * @param {String} queue_id The queue id
	 * @param {Number} last_event_id The last seen event id
	 * @param {Number} [event_queue_longpoll_timeout_seconds] 
	 */
	async #eventLoop( callback, queue_id, last_event_id, event_queue_longpoll_timeout_seconds ) {
		let queueData = this.queueList.get( queue_id );
		try {
			let events = await this.getEvents( {
				queue_id, last_event_id,
				dont_block: false
			}, event_queue_longpoll_timeout_seconds );
			events.map( (event) => {
				last_event_id = Math.max(last_event_id, event.id);
				if ( callback ) return callback( event );
				this.emit( 'ANY', event );
				switch ( event.type ) {
					case 'message': {
						this.emit( 'message', event.message, event.flags );
						break;
					}
					case 'attachment': {
						this.emit( 'attachment', event );
						if ( event.op === 'remove' ) this.emit( `attachment:remove`, event.attachment.id, event.upload_space_used );
						else this.emit( `attachment:${event.op}`, event.attachment, event.upload_space_used );
						break;
					}
					case 'realm': {
						this.emit( 'realm', event );
						if ( event.op === 'deactivated' ) this.emit( 'realm:deactivated', event.realm_id );
						if ( event.op === 'update' ) {
							this.emit( 'realm:update', event );
							this.emit( 'realm:update_dict', { [event.property]: event.value } );
						}
						if ( event.op === 'update_dict' ) this.emit( 'realm:update_dict', event.data );
						break;
					}
					case 'realm_linkifiers': {
						this.emit( 'realm_linkifiers', event.realm_linkifiers );
						break;
					}
					case 'heartbeat': {
						this.emit( 'heartbeat' );
						break;
					}
					default: {
						this.emit( event.type, event );
						if ( event.op ) this.emit( `${event.type}:${event.op}`, event );
					}
				}
			} );
		}
		catch ( error ) {
			if ( error instanceof ZulipError && error.code === 'BAD_EVENT_QUEUE_ID' ) {
				if ( queueData ) {
					let registerAgain = this.queueList.delete( queue_id );
					if ( registerAgain ) this.registerQueue( null, queueData.options, callback );
				}
				return;
			}
			else this.emit( 'error', error );
		}
		let timeout = setTimeout( () => {
			this.#eventLoop( callback, queue_id, last_event_id, event_queue_longpoll_timeout_seconds );
		}, 1_000 );
		if ( queueData ) queueData.timeout = timeout;
	}
}

/**
 * Zulip event
 * @typedef {Object} ZulipEvent The event
 * @property {Number} id The event id
 * @property {String} type The event type
 * @property {String} [op] The event sub type
 */

/**
 * @typedef {{
 * 	newListener: [eventName: String | Symbol, listener: Function],
 * 	removeListener: [eventName: String | Symbol, listener: Function],
 * 	error: [error: Error],
 * 	ANY: [event: ZulipEvent],
 * 	heartbeat: [],
 * 	message: [msg: {
 * 		type: "stream" | "private",
 * 		id: Number,
 * 		content: String,
 * 		content_type: "text/html" | "text/x-markdown",
 * 		is_me_message: Boolean,
 * 		avatar_url: String | null,
 * 		client: String,
 * 		display_recipient: String | Object[],
 * 		edit_history?: {
 * 			timestamp: Number,
 * 			user_id: Number | null,
 * 			prev_content?: String,
 * 			prev_rendered_content?: String,
 * 			prev_stream?: Number,
 * 			prev_topic?: String,
 * 			stream?: Number,
 * 			topic?: String,
 * 		}[],
 * 		last_edit_timestamp?: Number,
 * 		reactions: {
 * 			emoji_name: String,
 * 			emoji_code: String,
 * 			reaction_type: "unicode_emoji" | "realm_emoji" | "zulip_extra_emoji",
 * 		}[],
 * 		recipient_id: Number,
 * 		sender_email: String,
 * 		sender_full_name: String,
 * 		sender_id: Number,
 * 		sender_realm_str: String,
 * 		stream_id?: Number,
 * 		subject: String,
 * 		timestamp: Number,
 * 		topic_links: {text: String, url: String}[],
 * 	}, flags: String[]],
 * 	update_message: [msg: ZulipEvent & {
 * 		type: "update_message",
 * 		user_id: Number | null,
 * 		rendering_only: Boolean,
 * 		message_id: Number,
 * 		message_ids: Number[],
 * 		flags: String[],
 * 		edit_timestamp: Number,
 * 		orig_content?: String,
 * 		orig_rendered_content?: String,
 * 		content?: String,
 * 		rendered_content?: String,
 * 		is_me_message?: Boolean,
 * 		stream_name?: String,
 * 		stream_id?: Number,
 * 		new_stream_id?: Number,
 * 		propagate_mode?: "change_one" | "change_later" | "change_all",
 * 		orig_subject?: String,
 * 		subject?: String,
 * 		topic_links?: {text: String, url: String}[],
 * 	}],
 * 	delete_message: [msg: ZulipEvent & {
 * 		type: "delete_message",
 * 		message_ids?: Number[],
 * 		message_id?: Number,
 * 		message_type: "stream" | "private",
 * 		stream_id?: Number,
 * 		topic?: String,
 * 	}],
 * 	attachment: [event: ZulipEvent & {type: "attachment", upload_space_used: Number} & ( {
 * 		op: "add" | "update",
 * 		attachment: {
 * 			id: Number,
 * 			name: String,
 * 			path_id: String,
 * 			size: Number,
 * 			create_time: Number,
 * 			messages: {id: Number, date_sent: Number}[],
 * 		}
 * 	} | {op: "remove", attachment: {id: Number}} )],
 * 	"attachment:add": [attachment: {
 * 		id: Number,
 * 		name: String,
 * 		path_id: String,
 * 		size: Number,
 * 		create_time: Number,
 * 		messages: {id: Number, date_sent: Number}[],
 * 	}, upload_space_used: Number],
 * 	"attachment:update": [attachment: {
 * 		id: Number,
 * 		name: String,
 * 		path_id: String,
 * 		size: Number,
 * 		create_time: Number,
 * 		messages: {id: Number, date_sent: Number}[],
 * 	}, upload_space_used: Number],
 * 	"attachment:remove": [attachment_id: Number, upload_space_used: Number],
 * 	realm_linkifiers: [linkifiers: {id: Number, pattern: String, url_template: String}[]],
 * 	realm: [event: ZulipEvent & {type: "realm"} & ( {op: "deactivated", realm_id: Number} | {
 * 		op: "update",
 * 		property: String,
 * 		value: String | Boolean | Number,
 * 	} | {op: "update_dict", data: {[setting: String]: any}} )],
 * 	"realm:deactivated": [realm_id: Number],
 * 	"realm:update": [event: ZulipEvent & {
 * 		type: "realm",
 * 		op: "update",
 * 		property: String,
 * 		value: String | Boolean | Number,
 * 	}],
 * 	"realm:update_dict": [settings: {[setting: String]: any}],
 * }} ZulipEvents
 */

/**
 * Zulip event callback
 * @callback zulipEventCallback
 * @param {ZulipEvent} event The event
 */

export class ZulipError extends Error {
	/**
	 * Create a Zulip error
	 * @param {Object} body 
	 * @param {String} body.msg 
	 * @param {String} body.code 
	 * @param {'error'} body.result 
	 */
	constructor( body ) {
		super( body?.msg );
		this.code = body?.code;
		this.body = body;
	}
}