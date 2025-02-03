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

export class Zulip {
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
		this.realm = realm;
		this.apiURL = `${realm}/api/v1`;
		this.#got = gotDefault.extend( {
			username: username,
			password: apiKey,
			throwHttpErrors: false,
			timeout: {
				request: 5_000
			},
			headers: {
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
	 * Register an event queue
	 * @param {String[]|String} event_types The event types
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
	async registerQueue( event_types = [], options = {}, callback ) {
		if ( !Array.isArray( event_types ) ) event_types = [event_types];
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
	 * @returns {Promise<Object[]>} List of new events
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
			events.forEach( (event) => {
				last_event_id = Math.max(last_event_id, event.id);
				callback( event );
			} )
		}
		catch ( error ) {
			if ( error instanceof ZulipError && error.code === 'BAD_EVENT_QUEUE_ID' ) {
				if ( queueData ) {
					this.queueList.delete( queue_id );
					this.registerQueue( null, queueData.options, callback );
				}
				return;
			}
			else throw error;
		}
		let timeout = setTimeout( () => {
			this.#eventLoop( callback, queue_id, last_event_id, event_queue_longpoll_timeout_seconds );
		}, 1_000 );
		if ( queueData ) queueData.timeout = timeout;
	}
}

/**
 * Zulip event callback
 * @callback zulipEventCallback
 * @param {Object} event The event
 * @param {Number} event.id The event id
 * @param {String} event.type The event type
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