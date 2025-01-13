import * as url_template_lib from 'url-template';
import {zulip} from '../clients.js';

/** @type {Map<RegExp, {url_template: url_template_lib.Template; group_number_to_name: Record<number, string>}>} */
const linkifier_map = new Map();

zulip.callEndpoint('/realm/linkifiers').then( result => {
	update_linkifier_rules( result.linkifiers );
} );

/**
 * Format Zulip messages into Discord messages
 * @param {Object} msg 
 * @param {String} msg.sender_full_name
 * @param {String} msg.avatar_url
 * @param {String} msg.content
 * @returns {import('discord.js').WebhookMessageCreateOptions}
 */
export default function formatter( msg ) {
	/** @type {import('discord.js').WebhookMessageCreateOptions} */
	let message = {
		username: msg.sender_full_name,
		avatarURL: msg.avatar_url,
		content: msg.content,
	};

	// File uploads
	if ( message.content.includes( '](/user_uploads/' ) ) {
		message.content = message.content.replaceAll( '](/user_uploads/', `](${process.env.ZULIP_REALM}/user_uploads/` );
	}

	// Timestamps
	message.content = message.content.replace( /<time:([^>]+)>/g, (src, time) => {
		let date = Date.parse(time);
		if ( Number.isNaN( date ) ) return src;
		return `<t:${date.toString().slice(0, -3)}:F>`;
	} );

	// Linkifiers
	// Source: https://github.com/zulip/zulip/blob/main/web/third/marked/lib/marked.cjs#L650
	const regexes = [...linkifier_map.keys()];
	regexes.forEach(function (regex) {
		var ret = inlineReplacement(regex, message.content, function(regex, groups, match) {
			// Insert the created URL
			let href = handleLinkifier(regex, groups, match);
			if (href !== undefined) {
				return `[${match}](<${href}>)`;
			} else {
				return match;
			}
		});

		message.content = ret[0] + ret[1];
	});

	return message;
}

/**
 * Source: https://github.com/zulip/zulip/blob/main/web/third/marked/lib/marked.cjs#L613
 * @param {RegExp} regex 
 * @param {String} src 
 * @param {Function} replace_func 
 * @returns {[String, String]}
 */
function inlineReplacement( regex, src, replace_func ) {
	var cap, out = "";
	regex.lastIndex = 0;
	if (cap = regex.exec(src)) {
		// Split before-match into its own segment and handle it separately
		var match_idx = regex.lastIndex;
		var before = src.substring(0, match_idx - cap[0].length);
		// before = this.output(before);
		out += before;
	
		// Consume all of the matched text
		src = src.substring(match_idx);
	
		out += replace_func(regex, cap.slice(1), cap[0]);
	}

	return [src, out];
};

/**
 * Source: https://github.com/zulip/zulip/blob/main/web/src/markdown.ts#L553
 * @param {RegExp} pattern 
 * @param {String[]} matches 
 * @returns {String}
 */
function handleLinkifier( pattern, matches ) {
	const item = linkifier_map.get(pattern);
	if ( !item ) return;
	const {url_template, group_number_to_name} = item;
	const template_context = Object.fromEntries(
		matches.map((match, i) => [group_number_to_name[i + 1], match]),
	);
	return url_template.expand(template_context);
}

/**
 * Source: https://github.com/zulip/zulip/blob/main/web/src/linkifiers.ts#L19
 * @param {String} pattern 
 * @param {String} url 
 * @returns {[RegExp | null, url_template_lib.Template, Record<number, string>][]}
 */
function python_to_js_linkifier( pattern, url ) {
	// Converts a python named-group regex to a javascript-compatible numbered
	// group regex... with a regex!
	const named_group_re = /\(?P<([^>]+?)>/g;
	let match = named_group_re.exec(pattern);
	let current_group = 1;
	/** @type {Record<number, string>} */
	const group_number_to_name = {};
	while (match) {
		const name = match[1];
		// Replace named group with regular matching group
		pattern = pattern.replace("(?P<" + name + ">", "(");
		// Map numbered reference to named reference for template expansion
		group_number_to_name[current_group] = name;

		// Reset the RegExp state
		named_group_re.lastIndex = 0;
		match = named_group_re.exec(pattern);

		current_group += 1;
	}
	// Convert any python in-regex flags to RegExp flags
	let js_flags = "g";
	const inline_flag_re = /\(\?([Limsux]+)\)/;
	match = inline_flag_re.exec(pattern);

	// JS regexes only support i (case insensitivity) and m (multiline)
	// flags, so keep those and ignore the rest
	if (match) {
		const py_flags = match[1];

		for (const flag of py_flags) {
			if ("im".includes(flag)) {
				js_flags += flag;
			}
		}

		pattern = pattern.replace(inline_flag_re, "");
	}
	// Ideally we should have been checking that linkifiers
	// begin with certain characters but since there is no
	// support for negative lookbehind in javascript, we check
	// for this condition in `contains_backend_only_syntax()`
	// function. If the condition is satisfied then the message
	// is rendered locally, otherwise, we return false there and
	// message is rendered on the backend which has proper support
	// for negative lookbehind.
	pattern = pattern + /(?!\w)/.source;
	let final_regex = null;
	try {
		final_regex = new RegExp(pattern, js_flags);
	} catch (error) {
		// We have an error computing the generated regex syntax.
		// We'll ignore this linkifier for now, but log this
		// failure for debugging later.
		if (error instanceof SyntaxError) {
			console.log("python_to_js_linkifier failure!", {pattern}, error);
		} else {
			// Don't swallow any other (unexpected) exceptions.
			/* istanbul ignore next */
			throw error;
		}
	}
	const url_template = url_template_lib.parseTemplate(url);
	return [final_regex, url_template, group_number_to_name];
}

/**
 * Source: https://github.com/zulip/zulip/blob/main/web/src/linkifiers.ts#L88
 * @param {{pattern: String, url_template: String}[]} linkifiers 
 */
function update_linkifier_rules( linkifiers ) {
	linkifier_map.clear();

	for (const linkifier of linkifiers) {
		const [regex, url_template, group_number_to_name] = python_to_js_linkifier(
			linkifier.pattern,
			linkifier.url_template,
		);
		if (!regex) {
			// Skip any linkifiers that could not be converted
			continue;
		}

		linkifier_map.set(regex, {
			url_template,
			group_number_to_name,
		});
	}
}