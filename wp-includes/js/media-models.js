/* global _wpMediaModelsL10n:false */
window.wp = window.wp || {};

(function($){
	var Attachment, Attachments, Query, PostImage, compare, l10n, media;

	/**
	 * wp.media( attributes )
	 *
	 * Handles the default media experience. Automatically creates
	 * and opens a media frame, and returns the result.
	 * Does nothing if the controllers do not exist.
	 *
	 * @param  {object} attributes The properties passed to the main media controller.
	 * @return {wp.media.view.MediaFrame} A media workflow.
	 */
	media = wp.media = function( attributes ) {
		var MediaFrame = media.view.MediaFrame,
			frame;

		if ( ! MediaFrame ) {
			return;
		}

		attributes = _.defaults( attributes || {}, {
			frame: 'select'
		});

		if ( 'select' === attributes.frame && MediaFrame.Select ) {
			frame = new MediaFrame.Select( attributes );
		} else if ( 'post' === attributes.frame && MediaFrame.Post ) {
			frame = new MediaFrame.Post( attributes );
		} else if ( 'image' === attributes.frame && MediaFrame.ImageDetails ) {
			frame = new MediaFrame.ImageDetails( attributes );
		}

		delete attributes.frame;

		return frame;
	};

	_.extend( media, { model: {}, view: {}, controller: {}, frames: {} });

	// Link any localized strings.
	l10n = media.model.l10n = typeof _wpMediaModelsL10n === 'undefined' ? {} : _wpMediaModelsL10n;

	// Link any settings.
	media.model.settings = l10n.settings || {};
	delete l10n.settings;

	/**
	 * ========================================================================
	 * UTILITIES
	 * ========================================================================
	 */

	/**
	 * A basic comparator.
	 *
	 * @param  {mixed}  a  The primary parameter to compare.
	 * @param  {mixed}  b  The primary parameter to compare.
	 * @param  {string} ac The fallback parameter to compare, a's cid.
	 * @param  {string} bc The fallback parameter to compare, b's cid.
	 * @return {number}    -1: a should come before b.
	 *                      0: a and b are of the same rank.
	 *                      1: b should come before a.
	 */
	compare = function( a, b, ac, bc ) {
		if ( _.isEqual( a, b ) ) {
			return ac === bc ? 0 : (ac > bc ? -1 : 1);
		} else {
			return a > b ? -1 : 1;
		}
	};

	_.extend( media, {
		/**
		 * media.template( id )
		 *
		 * Fetches a template by id.
		 * See wp.template() in `wp-includes/js/wp-util.js`.
		 *
		 * @borrows wp.template as template
		 */
		template: wp.template,

		/**
		 * media.post( [action], [data] )
		 *
		 * Sends a POST request to WordPress.
		 * See wp.ajax.post() in `wp-includes/js/wp-util.js`.
		 *
		 * @borrows wp.ajax.post as post
		 */
		post: wp.ajax.post,

		/**
		 * media.ajax( [action], [options] )
		 *
		 * Sends an XHR request to WordPress.
		 * See wp.ajax.send() in `wp-includes/js/wp-util.js`.
		 *
		 * @borrows wp.ajax.send as ajax
		 */
		ajax: wp.ajax.send,

		/**
		 * Scales a set of dimensions to fit within bounding dimensions.
		 *
		 * @param {Object} dimensions
		 * @returns {Object}
		 */
		fit: function( dimensions ) {
			var width     = dimensions.width,
				height    = dimensions.height,
				maxWidth  = dimensions.maxWidth,
				maxHeight = dimensions.maxHeight,
				constraint;

			// Compare ratios between the two values to determine which
			// max to constrain by. If a max value doesn't exist, then the
			// opposite side is the constraint.
			if ( ! _.isUndefined( maxWidth ) && ! _.isUndefined( maxHeight ) ) {
				constraint = ( width / height > maxWidth / maxHeight ) ? 'width' : 'height';
			} else if ( _.isUndefined( maxHeight ) ) {
				constraint = 'width';
			} else if (  _.isUndefined( maxWidth ) && height > maxHeight ) {
				constraint = 'height';
			}

			// If the value of the constrained side is larger than the max,
			// then scale the values. Otherwise return the originals; they fit.
			if ( 'width' === constraint && width > maxWidth ) {
				return {
					width : maxWidth,
					height: Math.round( maxWidth * height / width )
				};
			} else if ( 'height' === constraint && height > maxHeight ) {
				return {
					width : Math.round( maxHeight * width / height ),
					height: maxHeight
				};
			} else {
				return {
					width : width,
					height: height
				};
			}
		},
		/**
		 * Truncates a string by injecting an ellipsis into the middle.
		 * Useful for filenames.
		 *
		 * @param {String} string
		 * @param {Number} [length=30]
		 * @param {String} [replacement=&hellip;]
		 * @returns {String} The string, unless length is greater than string.length.
		 */
		truncate: function( string, length, replacement ) {
			length = length || 30;
			replacement = replacement || '&hellip;';

			if ( string.length <= length ) {
				return string;
			}

			return string.substr( 0, length / 2 ) + replacement + string.substr( -1 * length / 2 );
		}
	});

	/**
	 * ========================================================================
	 * MODELS
	 * ========================================================================
	 */
	/**
	 * wp.media.attachment
	 *
	 * @static
	 * @param {String} id A string used to identify a model.
	 * @returns {wp.media.model.Attachment}
	 */
	media.attachment = function( id ) {
		return Attachment.get( id );
	};

	/**
	 * wp.media.model.Attachment
	 *
	 * @constructor
	 * @augments Backbone.Model
	 */
	Attachment = media.model.Attachment = Backbone.Model.extend({
		/**
		 * Triggered when attachment details change
		 * Overrides Backbone.Model.sync
		 *
		 * @param {string} method
		 * @param {wp.media.model.Attachment} model
		 * @param {Object} [options={}]
		 *
		 * @returns {Promise}
		 */
		sync: function( method, model, options ) {
			// If the attachment does not yet have an `id`, return an instantly
			// rejected promise. Otherwise, all of our requests will fail.
			if ( _.isUndefined( this.id ) ) {
				return $.Deferred().rejectWith( this ).promise();
			}

			// Overload the `read` request so Attachment.fetch() functions correctly.
			if ( 'read' === method ) {
				options = options || {};
				options.context = this;
				options.data = _.extend( options.data || {}, {
					action: 'get-attachment',
					id: this.id
				});
				return media.ajax( options );

			// Overload the `update` request so properties can be saved.
			} else if ( 'update' === method ) {
				// If we do not have the necessary nonce, fail immeditately.
				if ( ! this.get('nonces') || ! this.get('nonces').update ) {
					return $.Deferred().rejectWith( this ).promise();
				}

				options = options || {};
				options.context = this;

				// Set the action and ID.
				options.data = _.extend( options.data || {}, {
					action:  'save-attachment',
					id:      this.id,
					nonce:   this.get('nonces').update,
					post_id: media.model.settings.post.id
				});

				// Record the values of the changed attributes.
				if ( model.hasChanged() ) {
					options.data.changes = {};

					_.each( model.changed, function( value, key ) {
						options.data.changes[ key ] = this.get( key );
					}, this );
				}

				return media.ajax( options );

			// Overload the `delete` request so attachments can be removed.
			// This will permanently delete an attachment.
			} else if ( 'delete' === method ) {
				options = options || {};

				if ( ! options.wait ) {
					this.destroyed = true;
				}

				options.context = this;
				options.data = _.extend( options.data || {}, {
					action:   'delete-post',
					id:       this.id,
					_wpnonce: this.get('nonces')['delete']
				});

				return media.ajax( options ).done( function() {
					this.destroyed = true;
				}).fail( function() {
					this.destroyed = false;
				});

			// Otherwise, fall back to `Backbone.sync()`.
			} else {
				/**
				 * Call `sync` directly on Backbone.Model
				 */
				return Backbone.Model.prototype.sync.apply( this, arguments );
			}
		},
		/**
		 * Convert date strings into Date objects.
		 *
		 * @param {Object} resp The raw response object, typically returned by fetch()
		 * @returns {Object} The modified response object, which is the attributes hash
		 *    to be set on the model.
		 */
		parse: function( resp ) {
			if ( ! resp ) {
				return resp;
			}

			resp.date = new Date( resp.date );
			resp.modified = new Date( resp.modified );
			return resp;
		},
		/**
		 * @param {Object} data The properties to be saved.
		 * @param {Object} options Sync options. e.g. patch, wait, success, error.
		 *
		 * @this Backbone.Model
		 *
		 * @returns {Promise}
		 */
		saveCompat: function( data, options ) {
			var model = this;

			// If we do not have the necessary nonce, fail immeditately.
			if ( ! this.get('nonces') || ! this.get('nonces').update ) {
				return $.Deferred().rejectWith( this ).promise();
			}

			return media.post( 'save-attachment-compat', _.defaults({
				id:      this.id,
				nonce:   this.get('nonces').update,
				post_id: media.model.settings.post.id
			}, data ) ).done( function( resp, status, xhr ) {
				model.set( model.parse( resp, xhr ), options );
			});
		}
	}, {
		/**
		 * Add a model to the end of the static 'all' collection and return it.
		 *
		 * @static
		 * @param {Object} attrs
		 * @returns {wp.media.model.Attachment}
		 */
		create: function( attrs ) {
			return Attachments.all.push( attrs );
		},
		/**
		 * Retrieve a model, or add it to the end of the static 'all' collection before returning it.
		 *
		 * @static
		 * @param {string} id A string used to identify a model.
		 * @param {Backbone.Model|undefined} attachment
		 * @returns {wp.media.model.Attachment}
		 */
		get: _.memoize( function( id, attachment ) {
			return Attachments.all.push( attachment || { id: id } );
		})
	});

	/**
	 * wp.media.model.Attachment
	 *
	 * @constructor
	 * @augments Backbone.Model
	 *
	 **/
	PostImage = media.model.PostImage = Backbone.Model.extend({

		initialize: function( attributes ) {
			this.attachment = false;

			if ( attributes.attachment_id ) {
				this.attachment = media.model.Attachment.get( attributes.attachment_id );
				this.dfd = this.attachment.fetch();
				this.bindAttachmentListeners();
			}

			// keep url in sync with changes to the type of link
			this.on( 'change:link', this.updateLinkUrl, this );
			this.on( 'change:size', this.updateSize, this );

			this.setLinkTypeFromUrl();

		},

		bindAttachmentListeners: function() {
			this.listenTo( this.attachment, 'sync', this.setLinkTypeFromUrl );
		},

		changeAttachment: function( attachment, props ) {
			this.stopListening( this.attachment );
			this.attachment = attachment;
			this.bindAttachmentListeners();

			this.set( 'attachment_id', this.attachment.get( 'id' ) );
			this.set( 'caption', this.attachment.get( 'caption' ) );
			this.set( 'alt', this.attachment.get( 'alt' ) );
			this.set( 'size', props.get( 'size' ) );
			this.set( 'align', props.get( 'align' ) );
			this.set( 'link', props.get( 'link' ) );
			this.updateLinkUrl();
			this.updateSize();
		},

		setLinkTypeFromUrl: function() {
			var linkUrl = this.get( 'linkUrl' ),
				type;

			if ( ! linkUrl ) {
				this.set( 'link', 'none' );
				return;
			}

			// default to custom if there is a linkUrl
			type = 'custom';

			if ( this.attachment ) {
				if ( this.attachment.get( 'url' ) === linkUrl ) {
					type = 'file';
				} else if ( this.attachment.get( 'link' ) === linkUrl ) {
					type = 'post';
				}
			} else {
				if ( this.get( 'url' ) === linkUrl ) {
					type = 'file';
				}
			}

			this.set( 'link', type );

		},


		updateLinkUrl: function() {
			var link = this.get( 'link' ),
				url;

			switch( link ) {
				case 'file':
					if ( this.attachment ) {
						url = this.attachment.get( 'url' );
					} else {
						url = this.get( 'url' );
					}
					this.set( 'linkUrl', url );
					break;
				case 'post':
					this.set( 'linkUrl', this.attachment.get( 'link' ) );
					break;
				case 'none':
					this.set( 'linkUrl', '' );
					break;

			}

		},

		updateSize: function() {
			var size;

			if ( ! this.attachment ) {
				return;
			}

			size = this.attachment.get( 'sizes' )[ this.get( 'size' ) ];
			this.set( 'url', size.url );
			this.set( 'width', size.width );
			this.set( 'height', size.height );

		}


	});

	/**
	 * wp.media.model.Attachments
	 *
	 * @constructor
	 * @augments Backbone.Collection
	 */
	Attachments = media.model.Attachments = Backbone.Collection.extend({
		/**
		 * @type {wp.media.model.Attachment}
		 */
		model: Attachment,
		/**
		 * @param {Array} [models=[]] Array of models used to populate the collection.
		 * @param {Object} [options={}]
		 */
		initialize: function( models, options ) {
			options = options || {};

			this.props   = new Backbone.Model();
			this.filters = options.filters || {};

			// Bind default `change` events to the `props` model.
			this.props.on( 'change', this._changeFilteredProps, this );

			this.props.on( 'change:order',   this._changeOrder,   this );
			this.props.on( 'change:orderby', this._changeOrderby, this );
			this.props.on( 'change:query',   this._changeQuery,   this );

			// Set the `props` model and fill the default property values.
			this.props.set( _.defaults( options.props || {} ) );

			// Observe another `Attachments` collection if one is provided.
			if ( options.observe ) {
				this.observe( options.observe );
			}
		},
		/**
		 * Automatically sort the collection when the order changes.
		 *
		 * @access private
		 */
		_changeOrder: function() {
			if ( this.comparator ) {
				this.sort();
			}
		},
		/**
		 * Set the default comparator only when the `orderby` property is set.
		 *
		 * @access private
		 *
		 * @param {Backbone.Model} model
		 * @param {string} orderby
		 */
		_changeOrderby: function( model, orderby ) {
			// If a different comparator is defined, bail.
			if ( this.comparator && this.comparator !== Attachments.comparator ) {
				return;
			}

			if ( orderby && 'post__in' !== orderby ) {
				this.comparator = Attachments.comparator;
			} else {
				delete this.comparator;
			}
		},
		/**
		 * If the `query` property is set to true, query the server using
		 * the `props` values, and sync the results to this collection.
		 *
		 * @access private
		 *
		 * @param {Backbone.Model} model
		 * @param {Boolean} query
		 */
		_changeQuery: function( model, query ) {
			if ( query ) {
				this.props.on( 'change', this._requery, this );
				this._requery();
			} else {
				this.props.off( 'change', this._requery, this );
			}
		},
		/**
		 * @access private
		 *
		 * @param {Backbone.Model} model
		 */
		_changeFilteredProps: function( model ) {
			// If this is a query, updating the collection will be handled by
			// `this._requery()`.
			if ( this.props.get('query') ) {
				return;
			}

			var changed = _.chain( model.changed ).map( function( t, prop ) {
				var filter = Attachments.filters[ prop ],
					term = model.get( prop );

				if ( ! filter ) {
					return;
				}

				if ( term && ! this.filters[ prop ] ) {
					this.filters[ prop ] = filter;
				} else if ( ! term && this.filters[ prop ] === filter ) {
					delete this.filters[ prop ];
				} else {
					return;
				}

				// Record the change.
				return true;
			}, this ).any().value();

			if ( ! changed ) {
				return;
			}

			// If no `Attachments` model is provided to source the searches
			// from, then automatically generate a source from the existing
			// models.
			if ( ! this._source ) {
				this._source = new Attachments( this.models );
			}

			this.reset( this._source.filter( this.validator, this ) );
		},

		validateDestroyed: false,
		/**
		 * @param {wp.media.model.Attachment} attachment
		 * @returns {Boolean}
		 */
		validator: function( attachment ) {
			if ( ! this.validateDestroyed && attachment.destroyed ) {
				return false;
			}
			return _.all( this.filters, function( filter ) {
				return !! filter.call( this, attachment );
			}, this );
		},
		/**
		 * @param {wp.media.model.Attachment} attachment
		 * @param {Object} options
		 * @returns {wp.media.model.Attachments} Returns itself to allow chaining
		 */
		validate: function( attachment, options ) {
			var valid = this.validator( attachment ),
				hasAttachment = !! this.get( attachment.cid );

			if ( ! valid && hasAttachment ) {
				this.remove( attachment, options );
			} else if ( valid && ! hasAttachment ) {
				this.add( attachment, options );
			}

			return this;
		},

		/**
		 * @param {wp.media.model.Attachments} attachments
		 * @param {object} [options={}]
		 *
		 * @fires wp.media.model.Attachments#reset
		 *
		 * @returns {wp.media.model.Attachments} Returns itself to allow chaining
		 */
		validateAll: function( attachments, options ) {
			options = options || {};

			_.each( attachments.models, function( attachment ) {
				this.validate( attachment, { silent: true });
			}, this );

			if ( ! options.silent ) {
				this.trigger( 'reset', this, options );
			}
			return this;
		},
		/**
		 * @param {wp.media.model.Attachments} attachments
		 * @returns {wp.media.model.Attachments} Returns itself to allow chaining
		 */
		observe: function( attachments ) {
			this.observers = this.observers || [];
			this.observers.push( attachments );

			attachments.on( 'add change remove', this._validateHandler, this );
			attachments.on( 'reset', this._validateAllHandler, this );
			this.validateAll( attachments );
			return this;
		},
		/**
		 * @param {wp.media.model.Attachments} attachments
		 * @returns {wp.media.model.Attachments} Returns itself to allow chaining
		 */
		unobserve: function( attachments ) {
			if ( attachments ) {
				attachments.off( null, null, this );
				this.observers = _.without( this.observers, attachments );

			} else {
				_.each( this.observers, function( attachments ) {
					attachments.off( null, null, this );
				}, this );
				delete this.observers;
			}

			return this;
		},
		/**
		 * @access private
		 *
		 * @param {wp.media.model.Attachments} attachment
		 * @param {wp.media.model.Attachments} attachments
		 * @param {Object} options
		 *
		 * @returns {wp.media.model.Attachments} Returns itself to allow chaining
		 */
		_validateHandler: function( attachment, attachments, options ) {
			// If we're not mirroring this `attachments` collection,
			// only retain the `silent` option.
			options = attachments === this.mirroring ? options : {
				silent: options && options.silent
			};

			return this.validate( attachment, options );
		},
		/**
		 * @access private
		 *
		 * @param {wp.media.model.Attachments} attachments
		 * @param {Object} options
		 * @returns {wp.media.model.Attachments} Returns itself to allow chaining
		 */
		_validateAllHandler: function( attachments, options ) {
			return this.validateAll( attachments, options );
		},
		/**
		 * @param {wp.media.model.Attachments} attachments
		 * @returns {wp.media.model.Attachments} Returns itself to allow chaining
		 */
		mirror: function( attachments ) {
			if ( this.mirroring && this.mirroring === attachments ) {
				return this;
			}

			this.unmirror();
			this.mirroring = attachments;

			// Clear the collection silently. A `reset` event will be fired
			// when `observe()` calls `validateAll()`.
			this.reset( [], { silent: true } );
			this.observe( attachments );

			return this;
		},
		unmirror: function() {
			if ( ! this.mirroring ) {
				return;
			}

			this.unobserve( this.mirroring );
			delete this.mirroring;
		},
		/**
		 * @param {Object} options
		 * @returns {Promise}
		 */
		more: function( options ) {
			var deferred = $.Deferred(),
				mirroring = this.mirroring,
				attachments = this;

			if ( ! mirroring || ! mirroring.more ) {
				return deferred.resolveWith( this ).promise();
			}
			// If we're mirroring another collection, forward `more` to
			// the mirrored collection. Account for a race condition by
			// checking if we're still mirroring that collection when
			// the request resolves.
			mirroring.more( options ).done( function() {
				if ( this === attachments.mirroring )
					deferred.resolveWith( this );
			});

			return deferred.promise();
		},
		/**
		 * @returns {Boolean}
		 */
		hasMore: function() {
			return this.mirroring ? this.mirroring.hasMore() : false;
		},
		/**
		 * Overrides Backbone.Collection.parse
		 *
		 * @param {Object|Array} resp The raw response Object/Array.
		 * @param {Object} xhr
		 * @returns {Array} The array of model attributes to be added to the collection
		 */
		parse: function( resp, xhr ) {
			if ( ! _.isArray( resp ) ) {
				resp = [resp];
			}

			return _.map( resp, function( attrs ) {
				var id, attachment, newAttributes;

				if ( attrs instanceof Backbone.Model ) {
					id = attrs.get( 'id' );
					attrs = attrs.attributes;
				} else {
					id = attrs.id;
				}

				attachment = Attachment.get( id );
				newAttributes = attachment.parse( attrs, xhr );

				if ( ! _.isEqual( attachment.attributes, newAttributes ) ) {
					attachment.set( newAttributes );
				}

				return attachment;
			});
		},
		/**
		 * @access private
		 */
		_requery: function() {
			if ( this.props.get('query') ) {
				this.mirror( Query.get( this.props.toJSON() ) );
			}
		},
		/**
		 * If this collection is sorted by `menuOrder`, recalculates and saves
		 * the menu order to the database.
		 *
		 * @returns {undefined|Promise}
		 */
		saveMenuOrder: function() {
			if ( 'menuOrder' !== this.props.get('orderby') ) {
				return;
			}

			// Removes any uploading attachments, updates each attachment's
			// menu order, and returns an object with an { id: menuOrder }
			// mapping to pass to the request.
			var attachments = this.chain().filter( function( attachment ) {
				return ! _.isUndefined( attachment.id );
			}).map( function( attachment, index ) {
				// Indices start at 1.
				index = index + 1;
				attachment.set( 'menuOrder', index );
				return [ attachment.id, index ];
			}).object().value();

			if ( _.isEmpty( attachments ) ) {
				return;
			}

			return media.post( 'save-attachment-order', {
				nonce:       media.model.settings.post.nonce,
				post_id:     media.model.settings.post.id,
				attachments: attachments
			});
		}
	}, {
		/**
		 * @static
		 * Overrides Backbone.Collection.comparator
		 *
		 * @param {Backbone.Model} a
		 * @param {Backbone.Model} b
		 * @param {Object} options
		 * @returns {Number} -1 if the first model should come before the second,
		 *    0 if they are of the same rank and
		 *    1 if the first model should come after.
		 */
		comparator: function( a, b, options ) {
			var key   = this.props.get('orderby'),
				order = this.props.get('order') || 'DESC',
				ac    = a.cid,
				bc    = b.cid;

			a = a.get( key );
			b = b.get( key );

			if ( 'date' === key || 'modified' === key ) {
				a = a || new Date();
				b = b || new Date();
			}

			// If `options.ties` is set, don't enforce the `cid` tiebreaker.
			if ( options && options.ties ) {
				ac = bc = null;
			}

			return ( 'DESC' === order ) ? compare( a, b, ac, bc ) : compare( b, a, bc, ac );
		},
		/**
		 * @namespace
		 */
		filters: {
			/**
			 * @static
			 * Note that this client-side searching is *not* equivalent
			 * to our server-side searching.
			 *
			 * @param {wp.media.model.Attachment} attachment
			 *
			 * @this wp.media.model.Attachments
			 *
			 * @returns {Boolean}
			 */
			search: function( attachment ) {
				if ( ! this.props.get('search') ) {
					return true;
				}

				return _.any(['title','filename','description','caption','name'], function( key ) {
					var value = attachment.get( key );
					return value && -1 !== value.search( this.props.get('search') );
				}, this );
			},
			/**
			 * @static
			 * @param {wp.media.model.Attachment} attachment
			 *
			 * @this wp.media.model.Attachments
			 *
			 * @returns {Boolean}
			 */
			type: function( attachment ) {
				var type = this.props.get('type');
				return ! type || -1 !== type.indexOf( attachment.get('type') );
			},
			/**
			 * @static
			 * @param {wp.media.model.Attachment} attachment
			 *
			 * @this wp.media.model.Attachments
			 *
			 * @returns {Boolean}
			 */
			uploadedTo: function( attachment ) {
				var uploadedTo = this.props.get('uploadedTo');
				if ( _.isUndefined( uploadedTo ) ) {
					return true;
				}

				return uploadedTo === attachment.get('uploadedTo');
			}
		}
	});

	/**
	 * @static
	 * @member {wp.media.model.Attachments}
	 */
	Attachments.all = new Attachments();

	/**
	 * wp.media.query
	 *
	 * @static
	 * @returns {wp.media.model.Attachments}
	 */
	media.query = function( props ) {
		return new Attachments( null, {
			props: _.extend( _.defaults( props || {}, { orderby: 'date' } ), { query: true } )
		});
	};

	/**
	 * wp.media.model.Query
	 *
	 * A set of attachments that corresponds to a set of consecutively paged
	 * queries on the server.
	 *
	 * Note: Do NOT change this.args after the query has been initialized.
	 *       Things will break.
	 *
	 * @constructor
	 * @augments wp.media.model.Attachments
	 * @augments Backbone.Collection
	 */
	Query = media.model.Query = Attachments.extend({
		/**
		 * @global wp.Uploader
		 *
		 * @param {Array} [models=[]] Array of models used to populate the collection.
		 * @param {Object} [options={}]
		 */
		initialize: function( models, options ) {
			var allowed;

			options = options || {};
			Attachments.prototype.initialize.apply( this, arguments );

			this.args     = options.args;
			this._hasMore = true;
			this.created  = new Date();

			this.filters.order = function( attachment ) {
				var orderby = this.props.get('orderby'),
					order = this.props.get('order');

				if ( ! this.comparator ) {
					return true;
				}

				// We want any items that can be placed before the last
				// item in the set. If we add any items after the last
				// item, then we can't guarantee the set is complete.
				if ( this.length ) {
					return 1 !== this.comparator( attachment, this.last(), { ties: true });

				// Handle the case where there are no items yet and
				// we're sorting for recent items. In that case, we want
				// changes that occurred after we created the query.
				} else if ( 'DESC' === order && ( 'date' === orderby || 'modified' === orderby ) ) {
					return attachment.get( orderby ) >= this.created;

				// If we're sorting by menu order and we have no items,
				// accept any items that have the default menu order (0).
				} else if ( 'ASC' === order && 'menuOrder' === orderby ) {
					return attachment.get( orderby ) === 0;
				}

				// Otherwise, we don't want any items yet.
				return false;
			};

			// Observe the central `wp.Uploader.queue` collection to watch for
			// new matches for the query.
			//
			// Only observe when a limited number of query args are set. There
			// are no filters for other properties, so observing will result in
			// false positives in those queries.
			allowed = [ 's', 'order', 'orderby', 'posts_per_page', 'post_mime_type', 'post_parent' ];
			if ( wp.Uploader && _( this.args ).chain().keys().difference( allowed ).isEmpty().value() ) {
				this.observe( wp.Uploader.queue );
			}
		},
		/**
		 * @returns {Boolean}
		 */
		hasMore: function() {
			return this._hasMore;
		},
		/**
		 * @param {Object} [options={}]
		 * @returns {Promise}
		 */
		more: function( options ) {
			var query = this;

			if ( this._more && 'pending' === this._more.state() ) {
				return this._more;
			}

			if ( ! this.hasMore() ) {
				return $.Deferred().resolveWith( this ).promise();
			}

			options = options || {};
			options.remove = false;

			return this._more = this.fetch( options ).done( function( resp ) {
				if ( _.isEmpty( resp ) || -1 === this.args.posts_per_page || resp.length < this.args.posts_per_page ) {
					query._hasMore = false;
				}
			});
		},
		/**
		 * Overrides Backbone.Collection.sync
		 * Overrides wp.media.model.Attachments.sync
		 *
		 * @param {String} method
		 * @param {Backbone.Model} model
		 * @param {Object} [options={}]
		 * @returns {Promise}
		 */
		sync: function( method, model, options ) {
			var args, fallback;

			// Overload the read method so Attachment.fetch() functions correctly.
			if ( 'read' === method ) {
				options = options || {};
				options.context = this;
				options.data = _.extend( options.data || {}, {
					action:  'query-attachments',
					post_id: media.model.settings.post.id
				});

				// Clone the args so manipulation is non-destructive.
				args = _.clone( this.args );

				// Determine which page to query.
				if ( -1 !== args.posts_per_page ) {
					args.paged = Math.floor( this.length / args.posts_per_page ) + 1;
				}

				options.data.query = args;
				return media.ajax( options );

			// Otherwise, fall back to Backbone.sync()
			} else {
				/**
				 * Call wp.media.model.Attachments.sync or Backbone.sync
				 */
				fallback = Attachments.prototype.sync ? Attachments.prototype : Backbone;
				return fallback.sync.apply( this, arguments );
			}
		}
	}, {
		/**
		 * @readonly
		 */
		defaultProps: {
			orderby: 'date',
			order:   'DESC'
		},
		/**
		 * @readonly
		 */
		defaultArgs: {
			posts_per_page: 40
		},
		/**
		 * @readonly
		 */
		orderby: {
			allowed:  [ 'name', 'author', 'date', 'title', 'modified', 'uploadedTo', 'id', 'post__in', 'menuOrder' ],
			valuemap: {
				'id':         'ID',
				'uploadedTo': 'parent',
				'menuOrder':  'menu_order ID'
			}
		},
		/**
		 * @readonly
		 */
		propmap: {
			'search':    's',
			'type':      'post_mime_type',
			'perPage':   'posts_per_page',
			'menuOrder': 'menu_order',
			'uploadedTo': 'post_parent'
		},
		/**
		 * @static
		 * @method
		 *
		 * @returns {wp.media.model.Query} A new query.
		 */
		// Caches query objects so queries can be easily reused.
		get: (function(){
			/**
			 * @static
			 * @type Array
			 */
			var queries = [];

			/**
			 * @param {Object} props
			 * @param {Object} options
			 * @returns {Query}
			 */
			return function( props, options ) {
				var args     = {},
					orderby  = Query.orderby,
					defaults = Query.defaultProps,
					query;

				// Remove the `query` property. This isn't linked to a query,
				// this *is* the query.
				delete props.query;

				// Fill default args.
				_.defaults( props, defaults );

				// Normalize the order.
				props.order = props.order.toUpperCase();
				if ( 'DESC' !== props.order && 'ASC' !== props.order ) {
					props.order = defaults.order.toUpperCase();
				}

				// Ensure we have a valid orderby value.
				if ( ! _.contains( orderby.allowed, props.orderby ) ) {
					props.orderby = defaults.orderby;
				}

				// Generate the query `args` object.
				// Correct any differing property names.
				_.each( props, function( value, prop ) {
					if ( _.isNull( value ) ) {
						return;
					}

					args[ Query.propmap[ prop ] || prop ] = value;
				});

				// Fill any other default query args.
				_.defaults( args, Query.defaultArgs );

				// `props.orderby` does not always map directly to `args.orderby`.
				// Substitute exceptions specified in orderby.keymap.
				args.orderby = orderby.valuemap[ props.orderby ] || props.orderby;

				// Search the query cache for matches.
				query = _.find( queries, function( query ) {
					return _.isEqual( query.args, args );
				});

				// Otherwise, create a new query and add it to the cache.
				if ( ! query ) {
					query = new Query( [], _.extend( options || {}, {
						props: props,
						args:  args
					} ) );
					queries.push( query );
				}

				return query;
			};
		}())
	});

	/**
	 * wp.media.model.Selection
	 *
	 * Used to manage a selection of attachments in the views.
	 *
	 * @constructor
	 * @augments wp.media.model.Attachments
	 * @augments Backbone.Collection
	 */
	media.model.Selection = Attachments.extend({
		/**
		 * Refresh the `single` model whenever the selection changes.
		 * Binds `single` instead of using the context argument to ensure
		 * it receives no parameters.
		 *
		 * @param {Array} [models=[]] Array of models used to populate the collection.
		 * @param {Object} [options={}]
		 */
		initialize: function( models, options ) {
			/**
			 * call 'initialize' directly on the parent class
			 */
			Attachments.prototype.initialize.apply( this, arguments );
			this.multiple = options && options.multiple;

			this.on( 'add remove reset', _.bind( this.single, this, false ) );
		},

		/**
		 * Override the selection's add method.
		 * If the workflow does not support multiple
		 * selected attachments, reset the selection.
		 *
		 * Overrides Backbone.Collection.add
		 * Overrides wp.media.model.Attachments.add
		 *
		 * @param {Array} models
		 * @param {Object} options
		 * @returns {wp.media.model.Attachment[]}
		 */
		add: function( models, options ) {
			if ( ! this.multiple ) {
				this.remove( this.models );
			}
			/**
			 * call 'add' directly on the parent class
			 */
			return Attachments.prototype.add.call( this, models, options );
		},

		/**
		 * Triggered when toggling (clicking on) an attachment in the modal
		 *
		 * @param {undefined|boolean|wp.media.model.Attachment} model
		 *
		 * @fires wp.media.model.Selection#selection:single
		 * @fires wp.media.model.Selection#selection:unsingle
		 *
		 * @returns {Backbone.Model}
		 */
		single: function( model ) {
			var previous = this._single;

			// If a `model` is provided, use it as the single model.
			if ( model ) {
				this._single = model;
			}
			// If the single model isn't in the selection, remove it.
			if ( this._single && ! this.get( this._single.cid ) ) {
				delete this._single;
			}

			this._single = this._single || this.last();

			// If single has changed, fire an event.
			if ( this._single !== previous ) {
				if ( previous ) {
					previous.trigger( 'selection:unsingle', previous, this );

					// If the model was already removed, trigger the collection
					// event manually.
					if ( ! this.get( previous.cid ) ) {
						this.trigger( 'selection:unsingle', previous, this );
					}
				}
				if ( this._single ) {
					this._single.trigger( 'selection:single', this._single, this );
				}
			}

			// Return the single model, or the last model as a fallback.
			return this._single;
		}
	});

	// Clean up. Prevents mobile browsers caching
	$(window).on('unload', function(){
		window.wp = null;
	});

}(jQuery));
