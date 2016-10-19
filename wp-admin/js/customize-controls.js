/* global _wpCustomizeHeader, _wpCustomizeBackground, _wpMediaViewsL10n, MediaElementPlayer, console */
(function( exports, $ ){
	var Container, focus, normalizedTransitionendEventName, api = wp.customize;

	/**
	 * A Customizer Setting.
	 *
	 * A setting is WordPress data (theme mod, option, menu, etc.) that the user can
	 * draft changes to in the Customizer.
	 *
	 * @see PHP class WP_Customize_Setting.
	 *
	 * @class
	 * @augments wp.customize.Value
	 * @augments wp.customize.Class
	 *
	 * @param {object} id                The Setting ID.
	 * @param {object} value             The initial value of the setting.
	 * @param {object} options.previewer The Previewer instance to sync with.
	 * @param {object} options.transport The transport to use for previewing. Supports 'refresh' and 'postMessage'.
	 * @param {object} options.dirty
	 */
	api.Setting = api.Value.extend({
		initialize: function( id, value, options ) {
			var setting = this;
			api.Value.prototype.initialize.call( setting, value, options );

			setting.id = id;
			setting.transport = setting.transport || 'refresh';
			setting._dirty = options.dirty || false;
			setting.notifications = new api.Values({ defaultConstructor: api.Notification });

			// Whenever the setting's value changes, refresh the preview.
			setting.bind( setting.preview );
		},

		/**
		 * Refresh the preview, respective of the setting's refresh policy.
		 *
		 * If the preview hasn't sent a keep-alive message and is likely
		 * disconnected by having navigated to a non-allowed URL, then the
		 * refresh transport will be forced when postMessage is the transport.
		 * Note that postMessage does not throw an error when the recipient window
		 * fails to match the origin window, so using try/catch around the
		 * previewer.send() call to then fallback to refresh will not work.
		 *
		 * @since 3.4.0
		 */
		preview: function() {
			var setting = this, transport;
			transport = setting.transport;

			if ( 'postMessage' === transport && ! api.state( 'previewerAlive' ).get() ) {
				transport = 'refresh';
			}

			if ( 'postMessage' === transport ) {
				return setting.previewer.send( 'setting', [ setting.id, setting() ] );
			} else if ( 'refresh' === transport ) {
				return setting.previewer.refresh();
			}
		},

		/**
		 * Find controls associated with this setting.
		 *
		 * @since 4.6.0
		 * @returns {wp.customize.Control[]} Controls associated with setting.
		 */
		findControls: function() {
			var setting = this, controls = [];
			api.control.each( function( control ) {
				_.each( control.settings, function( controlSetting ) {
					if ( controlSetting.id === setting.id ) {
						controls.push( control );
					}
				} );
			} );
			return controls;
		}
	});

	/**
	 * Current change count.
	 *
	 * @since 4.7.0
	 * @type {number}
	 * @protected
	 */
	api._latestRevision = 0;

	/**
	 * Last revision that was saved.
	 *
	 * @since 4.7.0
	 * @type {number}
	 * @protected
	 */
	api._lastSavedRevision = 0;

	/**
	 * Latest revisions associated with the updated setting.
	 *
	 * @since 4.7.0
	 * @type {object}
	 * @protected
	 */
	api._latestSettingRevisions = {};

	/*
	 * Keep track of the revision associated with each updated setting so that
	 * requestChangesetUpdate knows which dirty settings to include. Also, once
	 * ready is triggered and all initial settings have been added, increment
	 * revision for each newly-created initially-dirty setting so that it will
	 * also be included in changeset update requests.
	 */
	api.bind( 'change', function incrementChangedSettingRevision( setting ) {
		api._latestRevision += 1;
		api._latestSettingRevisions[ setting.id ] = api._latestRevision;
	} );
	api.bind( 'ready', function() {
		api.bind( 'add', function incrementCreatedSettingRevision( setting ) {
			if ( setting._dirty ) {
				api._latestRevision += 1;
				api._latestSettingRevisions[ setting.id ] = api._latestRevision;
			}
		} );
	} );

	/**
	 * Get the dirty setting values.
	 *
	 * @param {object} [options] Options.
	 * @param {boolean} [options.unsaved=false] Whether only values not saved yet into a changeset will be returned (differential changes).
	 * @returns {object} Dirty setting values.
	 */
	api.dirtyValues = function dirtyValues( options ) {
		var values = {};
		api.each( function( setting ) {
			var settingRevision;

			if ( ! setting._dirty ) {
				return;
			}

			settingRevision = api._latestSettingRevisions[ setting.id ];

			// Skip including settings that have already been included in the changeset, if only requesting unsaved.
			if ( ( options && options.unsaved ) && ( _.isUndefined( settingRevision ) || settingRevision <= api._lastSavedRevision ) ) {
				return;
			}

			values[ setting.id ] = setting.get();
		} );
		return values;
	};

	/**
	 * Request updates to the changeset.
	 *
	 * @param {object} [changes] Mapping of setting IDs to setting params each normally including a value property, or mapping to null.
	 *                           If not provided, then the changes will still be obtained from unsaved dirty settings.
	 * @returns {jQuery.Promise}
	 */
	api.requestChangesetUpdate = function requestChangesetUpdate( changes ) {
		var deferred, request, submittedChanges = {}, data;
		deferred = new $.Deferred();

		if ( changes ) {
			_.extend( submittedChanges, changes );
		}

		// Ensure all revised settings (changes pending save) are also included, but not if marked for deletion in changes.
		_.each( api.dirtyValues( { unsaved: true } ), function( dirtyValue, settingId ) {
			if ( ! changes || null !== changes[ settingId ] ) {
				submittedChanges[ settingId ] = _.extend(
					{},
					submittedChanges[ settingId ] || {},
					{ value: dirtyValue }
				);
			}
		} );

		// Short-circuit when there are no pending changes.
		if ( _.isEmpty( submittedChanges ) ) {
			deferred.resolve( {} );
			return deferred.promise();
		}

		// Make sure that publishing a changeset waits for all changeset update requests to complete.
		api.state( 'processing' ).set( api.state( 'processing' ).get() + 1 );
		deferred.always( function() {
			api.state( 'processing' ).set( api.state( 'processing' ).get() - 1 );
		} );

		// Allow plugins to attach additional params to the settings.
		api.trigger( 'changeset-save', submittedChanges );

		// Ensure that if any plugins add data to save requests by extending query() that they get included here.
		data = api.previewer.query( { excludeCustomizedSaved: true } );
		delete data.customized; // Being sent in customize_changeset_data instead.
		_.extend( data, {
			nonce: api.settings.nonce.save,
			customize_theme: api.settings.theme.stylesheet,
			customize_changeset_data: JSON.stringify( submittedChanges )
		} );

		request = wp.ajax.post( 'customize_save', data );

		request.done( function requestChangesetUpdateDone( data ) {
			var savedChangesetValues = {};

			// Ensure that all settings updated subsequently will be included in the next changeset update request.
			api._lastSavedRevision = Math.max( api._latestRevision, api._lastSavedRevision );

			api.state( 'changesetStatus' ).set( data.changeset_status );
			deferred.resolve( data );
			api.trigger( 'changeset-saved', data );

			if ( data.setting_validities ) {
				_.each( data.setting_validities, function( validity, settingId ) {
					if ( true === validity && _.isObject( submittedChanges[ settingId ] ) && ! _.isUndefined( submittedChanges[ settingId ].value ) ) {
						savedChangesetValues[ settingId ] = submittedChanges[ settingId ].value;
					}
				} );
			}

			api.previewer.send( 'changeset-saved', _.extend( {}, data, { saved_changeset_values: savedChangesetValues } ) );
		} );
		request.fail( function requestChangesetUpdateFail( data ) {
			deferred.reject( data );
			api.trigger( 'changeset-error', data );
		} );
		request.always( function( data ) {
			if ( data.setting_validities ) {
				api._handleSettingValidities( {
					settingValidities: data.setting_validities
				} );
			}
		} );

		return deferred.promise();
	};

	/**
	 * Watch all changes to Value properties, and bubble changes to parent Values instance
	 *
	 * @since 4.1.0
	 *
	 * @param {wp.customize.Class} instance
	 * @param {Array}              properties  The names of the Value instances to watch.
	 */
	api.utils.bubbleChildValueChanges = function ( instance, properties ) {
		$.each( properties, function ( i, key ) {
			instance[ key ].bind( function ( to, from ) {
				if ( instance.parent && to !== from ) {
					instance.parent.trigger( 'change', instance );
				}
			} );
		} );
	};

	/**
	 * Expand a panel, section, or control and focus on the first focusable element.
	 *
	 * @since 4.1.0
	 *
	 * @param {Object}   [params]
	 * @param {Function} [params.completeCallback]
	 */
	focus = function ( params ) {
		var construct, completeCallback, focus, focusElement;
		construct = this;
		params = params || {};
		focus = function () {
			var focusContainer;
			if ( ( construct.extended( api.Panel ) || construct.extended( api.Section ) ) && construct.expanded && construct.expanded() ) {
				focusContainer = construct.contentContainer;
			} else {
				focusContainer = construct.container;
			}

			focusElement = focusContainer.find( '.control-focus:first' );
			if ( 0 === focusElement.length ) {
				// Note that we can't use :focusable due to a jQuery UI issue. See: https://github.com/jquery/jquery-ui/pull/1583
				focusElement = focusContainer.find( 'input, select, textarea, button, object, a[href], [tabindex]' ).filter( ':visible' ).first();
			}
			focusElement.focus();
		};
		if ( params.completeCallback ) {
			completeCallback = params.completeCallback;
			params.completeCallback = function () {
				focus();
				completeCallback();
			};
		} else {
			params.completeCallback = focus;
		}

		api.state( 'paneVisible' ).set( true );
		if ( construct.expand ) {
			construct.expand( params );
		} else {
			params.completeCallback();
		}
	};

	/**
	 * Stable sort for Panels, Sections, and Controls.
	 *
	 * If a.priority() === b.priority(), then sort by their respective params.instanceNumber.
	 *
	 * @since 4.1.0
	 *
	 * @param {(wp.customize.Panel|wp.customize.Section|wp.customize.Control)} a
	 * @param {(wp.customize.Panel|wp.customize.Section|wp.customize.Control)} b
	 * @returns {Number}
	 */
	api.utils.prioritySort = function ( a, b ) {
		if ( a.priority() === b.priority() && typeof a.params.instanceNumber === 'number' && typeof b.params.instanceNumber === 'number' ) {
			return a.params.instanceNumber - b.params.instanceNumber;
		} else {
			return a.priority() - b.priority();
		}
	};

	/**
	 * Return whether the supplied Event object is for a keydown event but not the Enter key.
	 *
	 * @since 4.1.0
	 *
	 * @param {jQuery.Event} event
	 * @returns {boolean}
	 */
	api.utils.isKeydownButNotEnterEvent = function ( event ) {
		return ( 'keydown' === event.type && 13 !== event.which );
	};

	/**
	 * Return whether the two lists of elements are the same and are in the same order.
	 *
	 * @since 4.1.0
	 *
	 * @param {Array|jQuery} listA
	 * @param {Array|jQuery} listB
	 * @returns {boolean}
	 */
	api.utils.areElementListsEqual = function ( listA, listB ) {
		var equal = (
			listA.length === listB.length && // if lists are different lengths, then naturally they are not equal
			-1 === _.indexOf( _.map( // are there any false values in the list returned by map?
				_.zip( listA, listB ), // pair up each element between the two lists
				function ( pair ) {
					return $( pair[0] ).is( pair[1] ); // compare to see if each pair are equal
				}
			), false ) // check for presence of false in map's return value
		);
		return equal;
	};

	/**
	 * Return browser supported `transitionend` event name.
	 *
	 * @since 4.7.0
	 *
	 * @returns {string|null} Normalized `transitionend` event name or null if CSS transitions are not supported.
	 */
	normalizedTransitionendEventName = (function () {
		var el, transitions, prop;
		el = document.createElement( 'div' );
		transitions = {
			'transition'      : 'transitionend',
			'OTransition'     : 'oTransitionEnd',
			'MozTransition'   : 'transitionend',
			'WebkitTransition': 'webkitTransitionEnd'
		};
		prop = _.find( _.keys( transitions ), function( prop ) {
			return ! _.isUndefined( el.style[ prop ] );
		} );
		if ( prop ) {
			return transitions[ prop ];
		} else {
			return null;
		}
	})();

	/**
	 * Base class for Panel and Section.
	 *
	 * @since 4.1.0
	 *
	 * @class
	 * @augments wp.customize.Class
	 */
	Container = api.Class.extend({
		defaultActiveArguments: { duration: 'fast', completeCallback: $.noop },
		defaultExpandedArguments: { duration: 'fast', completeCallback: $.noop },
		containerType: 'container',
		defaults: {
			title: '',
			description: '',
			priority: 100,
			type: 'default',
			content: null,
			active: true,
			instanceNumber: null
		},

		/**
		 * @since 4.1.0
		 *
		 * @param {string}         id - The ID for the container.
		 * @param {object}         options - Object containing one property: params.
		 * @param {object}         options.params - Object containing the following properties.
		 * @param {string}         options.params.title - Title shown when panel is collapsed and expanded.
		 * @param {string=}        [options.params.description] - Description shown at the top of the panel.
		 * @param {number=100}     [options.params.priority] - The sort priority for the panel.
		 * @param {string=default} [options.params.type] - The type of the panel. See wp.customize.panelConstructor.
		 * @param {string=}        [options.params.content] - The markup to be used for the panel container. If empty, a JS template is used.
		 * @param {boolean=true}   [options.params.active] - Whether the panel is active or not.
		 */
		initialize: function ( id, options ) {
			var container = this;
			container.id = id;
			options = options || {};

			options.params = _.defaults(
				options.params || {},
				container.defaults
			);

			$.extend( container, options );
			container.templateSelector = 'customize-' + container.containerType + '-' + container.params.type;
			container.container = $( container.params.content );
			if ( 0 === container.container.length ) {
				container.container = $( container.getContainer() );
			}
			container.headContainer = container.container;
			container.contentContainer = container.getContent();
			container.container = container.container.add( container.contentContainer );

			container.deferred = {
				embedded: new $.Deferred()
			};
			container.priority = new api.Value();
			container.active = new api.Value();
			container.activeArgumentsQueue = [];
			container.expanded = new api.Value();
			container.expandedArgumentsQueue = [];

			container.active.bind( function ( active ) {
				var args = container.activeArgumentsQueue.shift();
				args = $.extend( {}, container.defaultActiveArguments, args );
				active = ( active && container.isContextuallyActive() );
				container.onChangeActive( active, args );
			});
			container.expanded.bind( function ( expanded ) {
				var args = container.expandedArgumentsQueue.shift();
				args = $.extend( {}, container.defaultExpandedArguments, args );
				container.onChangeExpanded( expanded, args );
			});

			container.deferred.embedded.done( function () {
				container.attachEvents();
			});

			api.utils.bubbleChildValueChanges( container, [ 'priority', 'active' ] );

			container.priority.set( container.params.priority );
			container.active.set( container.params.active );
			container.expanded.set( false );
		},

		/**
		 * @since 4.1.0
		 *
		 * @abstract
		 */
		ready: function() {},

		/**
		 * Get the child models associated with this parent, sorting them by their priority Value.
		 *
		 * @since 4.1.0
		 *
		 * @param {String} parentType
		 * @param {String} childType
		 * @returns {Array}
		 */
		_children: function ( parentType, childType ) {
			var parent = this,
				children = [];
			api[ childType ].each( function ( child ) {
				if ( child[ parentType ].get() === parent.id ) {
					children.push( child );
				}
			} );
			children.sort( api.utils.prioritySort );
			return children;
		},

		/**
		 * To override by subclass, to return whether the container has active children.
		 *
		 * @since 4.1.0
		 *
		 * @abstract
		 */
		isContextuallyActive: function () {
			throw new Error( 'Container.isContextuallyActive() must be overridden in a subclass.' );
		},

		/**
		 * Active state change handler.
		 *
		 * Shows the container if it is active, hides it if not.
		 *
		 * To override by subclass, update the container's UI to reflect the provided active state.
		 *
		 * @since 4.1.0
		 *
		 * @param {Boolean} active
		 * @param {Object}  args
		 * @param {Object}  args.duration
		 * @param {Object}  args.completeCallback
		 */
		onChangeActive: function( active, args ) {
			var construct = this,
				headContainer = construct.headContainer,
				duration, expandedOtherPanel;

			if ( args.unchanged ) {
				if ( args.completeCallback ) {
					args.completeCallback();
				}
				return;
			}

			duration = ( 'resolved' === api.previewer.deferred.active.state() ? args.duration : 0 );

			if ( construct.extended( api.Panel ) ) {
				// If this is a panel is not currently expanded but another panel is expanded, do not animate.
				api.panel.each(function ( panel ) {
					if ( panel !== construct && panel.expanded() ) {
						expandedOtherPanel = panel;
						duration = 0;
					}
				});

				// Collapse any expanded sections inside of this panel first before deactivating.
				if ( ! active ) {
					_.each( construct.sections(), function( section ) {
						section.collapse( { duration: 0 } );
					} );
				}
			}

			if ( ! $.contains( document, headContainer ) ) {
				// jQuery.fn.slideUp is not hiding an element if it is not in the DOM
				headContainer.toggle( active );
				if ( args.completeCallback ) {
					args.completeCallback();
				}
			} else if ( active ) {
				headContainer.stop( true, true ).slideDown( duration, args.completeCallback );
			} else {
				if ( construct.expanded() ) {
					construct.collapse({
						duration: duration,
						completeCallback: function() {
							headContainer.stop( true, true ).slideUp( duration, args.completeCallback );
						}
					});
				} else {
					headContainer.stop( true, true ).slideUp( duration, args.completeCallback );
				}
			}
		},

		/**
		 * @since 4.1.0
		 *
		 * @params {Boolean} active
		 * @param {Object}   [params]
		 * @returns {Boolean} false if state already applied
		 */
		_toggleActive: function ( active, params ) {
			var self = this;
			params = params || {};
			if ( ( active && this.active.get() ) || ( ! active && ! this.active.get() ) ) {
				params.unchanged = true;
				self.onChangeActive( self.active.get(), params );
				return false;
			} else {
				params.unchanged = false;
				this.activeArgumentsQueue.push( params );
				this.active.set( active );
				return true;
			}
		},

		/**
		 * @param {Object} [params]
		 * @returns {Boolean} false if already active
		 */
		activate: function ( params ) {
			return this._toggleActive( true, params );
		},

		/**
		 * @param {Object} [params]
		 * @returns {Boolean} false if already inactive
		 */
		deactivate: function ( params ) {
			return this._toggleActive( false, params );
		},

		/**
		 * To override by subclass, update the container's UI to reflect the provided active state.
		 * @abstract
		 */
		onChangeExpanded: function () {
			throw new Error( 'Must override with subclass.' );
		},

		/**
		 * Handle the toggle logic for expand/collapse.
		 *
		 * @param {Boolean}  expanded - The new state to apply.
		 * @param {Object}   [params] - Object containing options for expand/collapse.
		 * @param {Function} [params.completeCallback] - Function to call when expansion/collapse is complete.
		 * @returns {Boolean} false if state already applied or active state is false
		 */
		_toggleExpanded: function( expanded, params ) {
			var instance = this, previousCompleteCallback;
			params = params || {};
			previousCompleteCallback = params.completeCallback;

			// Short-circuit expand() if the instance is not active.
			if ( expanded && ! instance.active() ) {
				return false;
			}

			api.state( 'paneVisible' ).set( true );
			params.completeCallback = function() {
				if ( previousCompleteCallback ) {
					previousCompleteCallback.apply( instance, arguments );
				}
				if ( expanded ) {
					instance.container.trigger( 'expanded' );
				} else {
					instance.container.trigger( 'collapsed' );
				}
			};
			if ( ( expanded && instance.expanded.get() ) || ( ! expanded && ! instance.expanded.get() ) ) {
				params.unchanged = true;
				instance.onChangeExpanded( instance.expanded.get(), params );
				return false;
			} else {
				params.unchanged = false;
				instance.expandedArgumentsQueue.push( params );
				instance.expanded.set( expanded );
				return true;
			}
		},

		/**
		 * @param {Object} [params]
		 * @returns {Boolean} false if already expanded or if inactive.
		 */
		expand: function ( params ) {
			return this._toggleExpanded( true, params );
		},

		/**
		 * @param {Object} [params]
		 * @returns {Boolean} false if already collapsed.
		 */
		collapse: function ( params ) {
			return this._toggleExpanded( false, params );
		},

		/**
		 * Animate container state change if transitions are supported by the browser.
		 *
		 * @since 4.7.0
		 *
		 * @param {function} completeCallback Function to be called after transition is completed.
		 * @returns {void}
		 * @private
		 */
		_animateChangeExpanded: function( completeCallback ) {
			// Return if CSS transitions are not supported.
			if ( ! normalizedTransitionendEventName ) {
				if ( completeCallback ) {
					completeCallback();
				}
				return;
			}

			var construct = this,
				content = construct.contentContainer,
				overlay = content.closest( '.wp-full-overlay' ),
				elements, transitionEndCallback;

			// Determine set of elements that are affected by the animation.
			elements = overlay.add( content );
			if ( _.isUndefined( construct.panel ) || '' === construct.panel() ) {
				elements = elements.add( '#customize-info, .customize-pane-parent' );
			}

			// Handle `transitionEnd` event.
			transitionEndCallback = function( e ) {
				if ( 2 !== e.eventPhase || ! $( e.target ).is( content ) ) {
					return;
				}
				content.off( normalizedTransitionendEventName, transitionEndCallback );
				elements.removeClass( 'busy' );
				if ( completeCallback ) {
					completeCallback();
				}
			};
			content.on( normalizedTransitionendEventName, transitionEndCallback );
			elements.addClass( 'busy' );

			// Prevent screen flicker when pane has been scrolled before expanding.
			_.defer( function() {
				var container = content.closest( '.wp-full-overlay-sidebar-content' ),
					currentScrollTop = container.scrollTop(),
					previousScrollTop = content.data( 'previous-scrollTop' ) || 0,
					expanded = construct.expanded();

				if ( expanded && 0 < currentScrollTop ) {
					content.css( 'top', currentScrollTop + 'px' );
					content.data( 'previous-scrollTop', currentScrollTop );
				} else if ( ! expanded && 0 < currentScrollTop + previousScrollTop ) {
					content.css( 'top', previousScrollTop - currentScrollTop + 'px' );
					container.scrollTop( previousScrollTop );
				}
			} );
		},

		/**
		 * Bring the container into view and then expand this and bring it into view
		 * @param {Object} [params]
		 */
		focus: focus,

		/**
		 * Return the container html, generated from its JS template, if it exists.
		 *
		 * @since 4.3.0
		 */
		getContainer: function () {
			var template,
				container = this;

			if ( 0 !== $( '#tmpl-' + container.templateSelector ).length ) {
				template = wp.template( container.templateSelector );
			} else {
				template = wp.template( 'customize-' + container.containerType + '-default' );
			}
			if ( template && container.container ) {
				return $.trim( template( container.params ) );
			}

			return '<li></li>';
		},

		/**
		 * Find content element which is displayed when the section is expanded.
		 *
		 * After a construct is initialized, the return value will be available via the `contentContainer` property.
		 * By default the element will be related it to the parent container with `aria-owns` and detached.
		 * Custom panels and sections (such as the `NewMenuSection`) that do not have a sliding pane should
		 * just return the content element without needing to add the `aria-owns` element or detach it from
		 * the container. Such non-sliding pane custom sections also need to override the `onChangeExpanded`
		 * method to handle animating the panel/section into and out of view.
		 *
		 * @since 4.7.0
		 *
		 * @returns {jQuery} Detached content element.
		 */
		getContent: function() {
			var construct = this,
				container = construct.container,
				content = container.find( '.accordion-section-content, .control-panel-content' ).first(),
				contentId = 'sub-' + container.attr( 'id' ),
				ownedElements = contentId,
				alreadyOwnedElements = container.attr( 'aria-owns' );

			if ( alreadyOwnedElements ) {
				ownedElements = ownedElements + ' ' + alreadyOwnedElements;
			}
			container.attr( 'aria-owns', ownedElements );

			return content.detach().attr( {
				'id': contentId,
				'class': 'customize-pane-child ' + content.attr( 'class' ) + ' ' + container.attr( 'class' )
			} );
		}
	});

	/**
	 * @since 4.1.0
	 *
	 * @class
	 * @augments wp.customize.Class
	 */
	api.Section = Container.extend({
		containerType: 'section',
		defaults: {
			title: '',
			description: '',
			priority: 100,
			type: 'default',
			content: null,
			active: true,
			instanceNumber: null,
			panel: null,
			customizeAction: ''
		},

		/**
		 * @since 4.1.0
		 *
		 * @param {string}         id - The ID for the section.
		 * @param {object}         options - Object containing one property: params.
		 * @param {object}         options.params - Object containing the following properties.
		 * @param {string}         options.params.title - Title shown when section is collapsed and expanded.
		 * @param {string=}        [options.params.description] - Description shown at the top of the section.
		 * @param {number=100}     [options.params.priority] - The sort priority for the section.
		 * @param {string=default} [options.params.type] - The type of the section. See wp.customize.sectionConstructor.
		 * @param {string=}        [options.params.content] - The markup to be used for the section container. If empty, a JS template is used.
		 * @param {boolean=true}   [options.params.active] - Whether the section is active or not.
		 * @param {string}         options.params.panel - The ID for the panel this section is associated with.
		 * @param {string=}        [options.params.customizeAction] - Additional context information shown before the section title when expanded.
		 */
		initialize: function ( id, options ) {
			var section = this;
			Container.prototype.initialize.call( section, id, options );

			section.id = id;
			section.panel = new api.Value();
			section.panel.bind( function ( id ) {
				$( section.headContainer ).toggleClass( 'control-subsection', !! id );
			});
			section.panel.set( section.params.panel || '' );
			api.utils.bubbleChildValueChanges( section, [ 'panel' ] );

			section.embed();
			section.deferred.embedded.done( function () {
				section.ready();
			});
		},

		/**
		 * Embed the container in the DOM when any parent panel is ready.
		 *
		 * @since 4.1.0
		 */
		embed: function () {
			var inject,
				section = this,
				container = $( '#customize-theme-controls' );

			// Watch for changes to the panel state.
			inject = function ( panelId ) {
				var parentContainer;
				if ( panelId ) {
					// The panel has been supplied, so wait until the panel object is registered.
					api.panel( panelId, function ( panel ) {
						// The panel has been registered, wait for it to become ready/initialized.
						panel.deferred.embedded.done( function () {
							parentContainer = panel.contentContainer;
							if ( ! section.headContainer.parent().is( parentContainer ) ) {
								parentContainer.append( section.headContainer );
							}
							if ( ! section.contentContainer.parent().is( section.headContainer ) ) {
								container.append( section.contentContainer );
							}
							section.deferred.embedded.resolve();
						});
					} );
				} else {
					// There is no panel, so embed the section in the root of the customizer
					parentContainer = $( '.customize-pane-parent' ); // @todo This should be defined elsewhere, and to be configurable
					if ( ! section.headContainer.parent().is( parentContainer ) ) {
						parentContainer.append( section.headContainer );
					}
					if ( ! section.contentContainer.parent().is( section.headContainer ) ) {
						container.append( section.contentContainer );
					}
					section.deferred.embedded.resolve();
				}
			};
			section.panel.bind( inject );
			inject( section.panel.get() ); // Since a section may never get a panel, assume that it won't ever get one.
		},

		/**
		 * Add behaviors for the accordion section.
		 *
		 * @since 4.1.0
		 */
		attachEvents: function () {
			var meta, content, section = this;

			// Expand/Collapse accordion sections on click.
			section.container.find( '.accordion-section-title, .customize-section-back' ).on( 'click keydown', function( event ) {
				if ( api.utils.isKeydownButNotEnterEvent( event ) ) {
					return;
				}
				event.preventDefault(); // Keep this AFTER the key filter above

				if ( section.expanded() ) {
					section.collapse();
				} else {
					section.expand();
				}
			});

			// This is very similar to what is found for api.Panel.attachEvents().
			section.container.find( '.customize-section-title .customize-help-toggle' ).on( 'click', function() {

				meta = section.container.find( '.section-meta' );
				if ( meta.hasClass( 'cannot-expand' ) ) {
					return;
				}
				content = meta.find( '.customize-section-description:first' );
				content.toggleClass( 'open' );
				content.slideToggle();
				content.attr( 'aria-expanded', function ( i, attr ) {
					return attr === 'true' ? 'false' : 'true';
				});
			});
		},

		/**
		 * Return whether this section has any active controls.
		 *
		 * @since 4.1.0
		 *
		 * @returns {Boolean}
		 */
		isContextuallyActive: function () {
			var section = this,
				controls = section.controls(),
				activeCount = 0;
			_( controls ).each( function ( control ) {
				if ( control.active() ) {
					activeCount += 1;
				}
			} );
			return ( activeCount !== 0 );
		},

		/**
		 * Get the controls that are associated with this section, sorted by their priority Value.
		 *
		 * @since 4.1.0
		 *
		 * @returns {Array}
		 */
		controls: function () {
			return this._children( 'section', 'control' );
		},

		/**
		 * Update UI to reflect expanded state.
		 *
		 * @since 4.1.0
		 *
		 * @param {Boolean} expanded
		 * @param {Object}  args
		 */
		onChangeExpanded: function ( expanded, args ) {
			var section = this,
				container = section.headContainer.closest( '.wp-full-overlay-sidebar-content' ),
				content = section.contentContainer,
				overlay = section.headContainer.closest( '.wp-full-overlay' ),
				backBtn = content.find( '.customize-section-back' ),
				sectionTitle = section.headContainer.find( '.accordion-section-title' ).first(),
				expand;

			if ( expanded && ! content.hasClass( 'open' ) ) {

				if ( args.unchanged ) {
					expand = args.completeCallback;
				} else {
					expand = $.proxy( function() {
						section._animateChangeExpanded( function() {
							sectionTitle.attr( 'tabindex', '-1' );
							backBtn.attr( 'tabindex', '0' );

							backBtn.focus();
							content.css( 'top', '' );
							container.scrollTop( 0 );

							if ( args.completeCallback ) {
								args.completeCallback();
							}
						} );

						content.addClass( 'open' );
						overlay.addClass( 'section-open' );
					}, this );
				}

				if ( ! args.allowMultiple ) {
					api.section.each( function ( otherSection ) {
						if ( otherSection !== section ) {
							otherSection.collapse( { duration: args.duration } );
						}
					});
				}

				if ( section.panel() ) {
					api.panel( section.panel() ).expand({
						duration: args.duration,
						completeCallback: expand
					});
				} else {
					api.panel.each( function( panel ) {
						panel.collapse();
					});
					expand();
				}

			} else if ( ! expanded && content.hasClass( 'open' ) ) {
				section._animateChangeExpanded( function() {
					backBtn.attr( 'tabindex', '-1' );
					sectionTitle.attr( 'tabindex', '0' );

					sectionTitle.focus();
					content.css( 'top', '' );

					if ( args.completeCallback ) {
						args.completeCallback();
					}
				} );

				content.removeClass( 'open' );
				overlay.removeClass( 'section-open' );

			} else {
				if ( args.completeCallback ) {
					args.completeCallback();
				}
			}
		}
	});

	/**
	 * wp.customize.ThemesSection
	 *
	 * Custom section for themes that loads themes by category, and also
	 * handles the theme-details view rendering and navigation.
	 *
	 * @constructor
	 * @augments wp.customize.Section
	 * @augments wp.customize.Container
	 */
	api.ThemesSection = api.Section.extend({
		currentTheme: '',
		overlay: '',
		template: '',
		screenshotQueue: null,
		$window: $( window ),
		loaded: 0,
		loading: false,
		fullyLoaded: false,
		term: '',
		filterContainer: $(),

		/**
		 * Embed the section in the DOM when the themes panel is ready.
		 *
		 * Insert the section before the themes container. Assume that a themes section is within a panel, but not necessarily the themes panel.
		 *
		 * @since 4.7.0
		 */
		embed: function () {
			var inject,
				section = this,
				container = $( '#customize-theme-controls' );

			// Watch for changes to the panel state
			inject = function ( panelId ) {
				var parentContainer;
				api.panel( panelId, function ( panel ) {
					// The panel has been registered, wait for it to become ready/initialized
					panel.deferred.embedded.done( function () {
						parentContainer = panel.contentContainer;
						if ( ! section.headContainer.parent().is( parentContainer ) ) {
							parentContainer.find( '.customize-themes-full-container-container' ).before( section.headContainer );
						}
						if ( ! section.contentContainer.parent().is( section.headContainer ) ) {
							container.append( section.contentContainer );
						}
						section.deferred.embedded.resolve();
					});
				} );
			};
			section.panel.bind( inject );
			inject( section.panel.get() ); // Since a section may never get a panel, assume that it won't ever get one
		},

		/**
		 * @since 4.2.0
		 */
		ready: function () {
			var section = this;
			section.overlay = section.container.find( '.theme-overlay' );
			section.template = wp.template( 'customize-themes-details-view' );

			// Bind global keyboard events.
			$( 'body' ).on( 'keyup', function( event ) {
				if ( ! section.overlay.find( '.theme-wrap' ).is( ':visible' ) ) {
					return;
				}

				// Pressing the right arrow key fires a theme:next event
				if ( 39 === event.keyCode ) {
					section.nextTheme();
				}

				// Pressing the left arrow key fires a theme:previous event
				if ( 37 === event.keyCode ) {
					section.previousTheme();
				}

				// Pressing the escape key fires a theme:collapse event
				if ( 27 === event.keyCode ) {
					section.closeDetails();
				}
			});

			_.bindAll( this, 'renderScreenshots', 'loadMore', 'checkTerm', 'filtersChecked' );
		},

		/**
		 * Override Section.isContextuallyActive method.
		 *
		 * Ignore the active states' of the contained theme controls, and just
		 * use the section's own active state instead. This prevents empty search
		 * results for theme sections from causing the section to become inactive.
		 *
		 * @since 4.2.0
		 *
		 * @returns {Boolean}
		 */
		isContextuallyActive: function () {
			return this.active();
		},

		/**
		 * @since 4.2.0
		 */
		attachEvents: function () {
			var section = this;

			section.filterContainer = $( '#accordion-section-' + section.id );

			// Expand section/panel. Only collapse when opening another section.
			section.filterContainer.on( 'click', '.customize-themes-section-title', function() {
				// Open the section.
				if ( ! section.expanded() ) {
					section.expand();
				}

				// Toggle filters.
				if ( section.filterContainer.find( '.filter-details' ).length ) {
					section.filterContainer.find( '.customize-themes-section-title' )
						.toggleClass( 'details-open' )
						.attr('aria-expanded', function ( i, attr ) {
							return attr === 'true' ? 'false' : 'true';
						});
					section.filterContainer.find( '.filter-details' ).slideToggle( 180 );
				}
			});

			// Preview installed themes.
			section.container.on( 'click', '.theme-actions .preview-theme', function() {
				var themeId = $( this ).data( 'themeId' );

				$( '.wp-full-overlay' ).addClass( 'customize-loading' );
				api.panel( 'themes' ).loadThemePreview( themeId ).fail( function() {
					$( '.wp-full-overlay' ).removeClass( 'customize-loading' );
				} );
			});

			// Theme navigation in details view.
			section.container.on( 'click', '.left', function() {
				section.previousTheme();
			});

			section.container.on( 'click', '.right', function() {
				section.nextTheme();
			});

			section.container.on( 'click', '.theme-backdrop, .close', function() {
				section.closeDetails();
			});

			var renderScreenshots = _.throttle( _.bind( section.renderScreenshots, this ), 100 );

			// Only used when there is only one section - installed themes.
			$( '.control-panel-themes' ).on( 'input', '#themes-filter', function( event ) {
				var count,
					term = event.currentTarget.value.toLowerCase().trim().replace( '-', ' ' ),
					controls = section.controls();

				_.each( controls, function( control ) {
					control.filter( term );
				});

				renderScreenshots();

				// Update theme count.
				count = section.contentContainer.find( 'li.customize-control:visible' ).length;
				$( '.control-panel-themes' ).find( '.theme-count' ).text( count );
			});

			// Event listeners for queries with user-entered terms.
			if ( 'search' === section.params.action ) {
				var debounced = _.debounce( section.checkTerm, 500 ); // Wait until there is no input for 500 milliseconds to initiate a search.
				$( '.control-panel-themes' ).on( 'input', '#wp-filter-search-input', function() {
					debounced( section );
					if ( ! section.expanded() ) {
						section.expand();
					}
				});

				// Focus the input if the icon is clicked.
				section.filterContainer.find( '.search-form' ).on( 'click', function( e ) {
					if ( ! $( e.currentTarget ).hasClass( 'wp-filter-search' ) ) {
						$( e.currentTarget ).find( '.wp-filter-search' ).focus();
					}
				});
			} else if ( 'favorites' === section.params.action ) {
				section.container.on( 'click', '.favorites-form-submit', function() {
					section.checkTerm( section );
				});
				section.container.on( 'keydown', '#wporg-username-input', function( e ) {
					if ( api.utils.isKeydownButNotEnterEvent( e ) ) {
						return;
					}
					section.checkTerm( section );
				});
			} else if ( 'feature_filter' === section.params.action ) {
				section.container.on( 'click', '.filter-group input', function() {
					section.filtersChecked();
					section.checkTerm( section );
				});

				// Toggle feature filter sections.
				section.container.on( 'click', '.filter-group legend button', function( e ) {
					$( e.currentTarget )
						.toggleClass( 'open' )
						.attr('aria-expanded', function ( i, attr ) {
							return attr === 'true' ? 'false' : 'true';
						})
						.parent().next( '.filter-group-feature' ).slideToggle( 180 );
				});
			}

			// Move section controls to the themes area.
			api.bind( 'ready', function () {
				section.contentContainer = section.container.find( '.customize-themes-section' );
				section.contentContainer.appendTo( $( '.customize-themes-full-container' ) );
				section.container.add( section.filterContainer );
			});
		},

		/**
		 * Update UI to reflect expanded state
		 *
		 * @since 4.2.0
		 *
		 * @param {Boolean}  expanded
		 * @param {Object}   args
		 * @param {Boolean}  args.unchanged
		 * @param {Function} args.completeCallback
		 */
		onChangeExpanded: function ( expanded, args ) {

			// Immediately call the complete callback if there were no changes
			if ( args.unchanged ) {
				if ( args.completeCallback ) {
					args.completeCallback();
				}
				return;
			}

			// Note: there is a second argument 'args' passed
			var section = this,
				container = section.contentContainer.closest( '.customize-themes-full-container' );

			if ( expanded ) {

				if ( -1 !== $.inArray( section.params.action, [ 'search', 'favorites', 'feature_filter' ] ) && '' === section.term ) {
					section.collapse(); // Note that the current section hasn't been collapsed yet, so this is all we need to do to do nothing.
					return; // Don't expand to an empty section that can't load any themes.
				}

				// Load controls if none are loaded yet.
				if ( 0 === section.loaded ) {
					section.loadControls();
				}

				// Collapse any sibling sections/panels
				api.section.each( function ( otherSection ) {
					if ( otherSection !== section ) {
						otherSection.collapse( { duration: args.duration } );
					}
				});

				section.contentContainer.addClass( 'current-section' );
				container.scrollTop();
				section.filterContainer.find( '.customize-themes-section-title' ).addClass( 'selected' );

				container.on( 'scroll', _.throttle( section.renderScreenshots, 300 ) );
				container.on( 'scroll', _.throttle( section.loadMore, 300 ) );

				if ( args.completeCallback ) {
					args.completeCallback();
				}
				section.updateCount(); // Show this section's count.
			} else {
				section.contentContainer.removeClass( 'current-section' );

				// Always hide, even if they don't exist or are already hidden.
				section.filterContainer.find( '.customize-themes-section-title' ).removeClass( 'selected details-open' ).attr( 'aria-expanded', 'false' );
				section.filterContainer.find( '.filter-details' ).slideUp( 180 );

				container.off( 'scroll' );

				if ( args.completeCallback ) {
					args.completeCallback();
				}
			}
		},

		/**
		 * Return the section's content element without detachng from the parent.
		 *
		 * @since 4.7.0
		 */
		getContent: function() {
			return this.container.find( '.control-section-content' );
		},

		/**
		 * Load theme data via ajax and add themes to the section as controls.
		 *
		 * @since 4.7.0
		 */
		loadControls: function() {
			var section = this, params, page, request;

			if ( section.loading ) {
				return; // We're already loading a batch of themes.
			}

			// Parameters for every API query. Additional params are set in PHP.
			page = Math.ceil( section.loaded / 100 ) + 1;
			params = {
				'switch-themes-nonce': api.settings.nonce['switch-themes'],
				'wp_customize': 'on',
				'theme_action': section.params.action,
				'customized_theme': api.settings.theme.stylesheet,
				'page': page
			};

			// Add fields for special request actions.
			if ( 'search' === section.params.action ) {
				if ( '' === section.term ) {
					return;
				} else {
					params.search = section.term;
				}
			} else if ( 'favorites' === section.params.action ) {
				if ( '' === section.term ) {
					return;
				} else {
					params.user = section.term;
				}
			} else if ( 'feature_filter' === section.params.action ) {
				if ( '' === section.term ) {
					return;
				} else {
					params.tags = section.term;
				}
			}

			// Load themes.
			section.headContainer.closest( '.wp-full-overlay' ).addClass( 'loading' );
			section.loading = true;
			section.container.find( '.no-themes' ).hide();
			request = wp.ajax.post( 'customize-load-themes', params );
			request.done(function( data ) {
				var themes = data.themes,
				    themeControl, newThemeControls;
				if ( 0 !== themes.length ) {
					newThemeControls = [];
					// Add controls for each theme.
					_.each( themes, function ( theme ) {
						var customizeId = section.params.action + '_theme_' + theme.id;
						themeControl = new api.controlConstructor.theme( customizeId, {
							params: {
								type: 'theme',
								content: '<li id="customize-control-theme-' + section.params.action + '_' + theme.id + '" class="customize-control customize-control-theme"></li>',
								section: section.params.id,
								active: true,
								theme: theme,
								priority: section.loaded + 1
							},
							previewer: api.previewer
						} );

						api.control.add( customizeId, themeControl );
						newThemeControls.push( themeControl );
						section.loaded = section.loaded + 1;
					});

					if ( 1 === page ) {
						// Pre-load the first 3 theme screenshots.
						_.each( section.controls().slice( 0, 3 ), function ( control ) {
							var img, src = control.params.theme.screenshot[0];
							if ( src ) {
								img = new Image();
								img.src = src;
							}
						});
						if ( 'search' === section.params.action ) {
							wp.a11y.speak( api.settings.l10n.themeSearchResults.replace( '%d', data.info.results ) );
						}
					} else {
						Array.prototype.push.apply( section.screenshotQueue, newThemeControls ); // Add new themes to the screenshot queue.
					}
					_.delay( section.renderScreenshots, 100 ); // Wait for the controls to become visible.

					if ( 'installed' === section.action || 100 > themes.length ) { // If we have less than the requested 100 themes, it's the end of the list.
						section.fullyLoaded = true;
					}
				} else {
					if ( 0 === section.loaded ) {
						section.container.find( '.no-themes' ).show();
						wp.a11y.speak( section.container.find( '.no-themes' ).text() );
					} else {
						section.fullyLoaded = true;
					}
				}
				if ( 'installed' === section.params.action ) {
					section.updateCount();
				} else {
					section.updateCount( data.info.results );
				}
				section.container.find( '.unexpected-error' ).hide(); // Hide error notice in case it was previously shown.

				// This cannot run on request.always, as section.loading may turn false before the new controls load in the success case.
				section.headContainer.closest( '.wp-full-overlay' ).removeClass( 'loading' );
				section.loading = false;
			});
			request.fail(function( data ) {
				if ( 'undefined' === typeof data ) {
					section.container.find( '.unexpected-error' ).show();
					wp.a11y.speak( section.container.find( '.unexpected-error' ).text() );
				} else if ( typeof console !== 'undefined' && console.error ) {
					console.error( data );
				}

				// This cannot run on request.always, as section.loading may turn false before the new controls load in the success case.
				section.headContainer.closest( '.wp-full-overlay' ).removeClass( 'loading' );
				section.loading = false;
			});
		},

		/**
		 * Determines whether more themes should be loaded, and loads them.
		 *
		 * @since 4.7.0
		 */
		loadMore: function() {
			var section = this, container, bottom, threshold;
			if ( ! section.fullyLoaded && ! section.loading ) {
				container = section.container.closest( '.customize-themes-full-container' );

				bottom = container.scrollTop() + container.height();
				threshold = container.prop( 'scrollHeight' ) - 3000; // Use a fixed distance to the bottom of loaded results to avoid unnecessarily loading results sooner when using a percentage of scroll distance.

				if ( bottom > threshold ) {
					section.loadControls();
				}
			}
		},

		/**
		 * Event handler for search, feature filter, and favorites input that determines if the term has changed and loads new controls as needed.
		 *
		 * @since 4.7.0
		 *
		 * @param {wp.customize.ThemesSection} section The current theme section, passed through the debouncer.
		 */
		checkTerm: function( section ) {
			var newTerm;

			// Find term.
			if ( 'search' === section.params.action ) {
				newTerm = $( '#wp-filter-search-input' ).val();
			} else if ( 'favorites' === section.params.action ) {
				newTerm = $( '#wporg-username-input' ).val();
			} else if ( 'feature_filter' === section.params.action ) {
				newTerm = section.term; // Set separately by filtersChecked(), as they're changed.
				if ( '' === newTerm ) {
					return;
				}
			} else {
				return;
			}

			if ( section.term === newTerm && 'feature_filter' !== section.params.action ) {
				return;
			}

			// Clear the controls in the section.
			_.each( section.controls(), function( control ) {
				control.container.remove();
				api.control.remove( control.id );
			});
			section.loaded = 0;
			section.fullyLoaded = false;
			section.screenshotQueue = null;

			if ( '' !== newTerm ) { // Empty term should not show any results.
				// Run a new query, with loadControls handling paging, etc.
				section.term = newTerm;
				section.loadControls();
				if ( ! section.expanded() ) {
					section.expand(); // Expand the section if it isn't expanded.
				}
			}
		},

		/**
		 * Check for filters checked in the feature filter list.
		 *
		 * @since 4.7.0
		 */
		filtersChecked: function() {
			var section = this,
			    items = section.container.find( '.filter-group' ).find( ':checkbox' ),
			    tags = [];

			if ( 'feature_filter' !== section.params.action ) {
				return false;
			}

			_.each( items.filter( ':checked' ), function( item ) {
				tags.push( $( item ).prop( 'value' ) );
			});

			// When no filters are checked, restore initial state and return
			if ( tags.length === 0 ) {
				section.term = '';
			} else {
				section.term = tags;
			}
		},

		/**
		 * Render control's screenshot if the control comes into view.
		 *
		 * @since 4.2.0
		 */
		renderScreenshots: function( ) {
			var section = this;

			// Fill queue initially, or check for more if empty.
			if ( section.screenshotQueue === null || 0 === section.screenshotQueue.length ) {
				// Add controls that haven't had their screenshots rendered.
				section.screenshotQueue = _.filter( section.controls(), function( control ) {
					return ! control.screenshotRendered;
				});
			}

			// Are all screenshots rendered (for now)?
			if ( ! section.screenshotQueue.length ) {
				return;
			}

			section.screenshotQueue = _.filter( section.screenshotQueue, function( control ) {
				var $imageWrapper = control.container.find( '.theme-screenshot' ),
					$image = $imageWrapper.find( 'img' );

				if ( ! $image.length ) {
					return false;
				}

				if ( $image.is( ':hidden' ) ) {
					return true;
				}

				// Based on unveil.js.
				var wt = section.$window.scrollTop(),
					wb = wt + section.$window.height(),
					et = $image.offset().top,
					ih = $imageWrapper.height(),
					eb = et + ih,
					threshold = ih * 3,
					inView = eb >= wt - threshold && et <= wb + threshold;

				if ( inView ) {
					control.container.trigger( 'render-screenshot' );
				}

				// If the image is in view return false so it's cleared from the queue.
				return ! inView;
			} );
		},

		/**
		 * Update the number of themes in the section.
		 *
		 * @since 4.7.0
		 */
		updateCount: function ( count ) {
			if ( ! count ) {
				count = this.loaded;
			}

			var displayed = this.container.closest( '.control-panel-content' ).find( '.themes-displayed' ),
			    countEl = this.container.closest( '.control-panel-content' ).find( '.theme-count' );

			if ( 0 === count ) {
				countEl.text( count );
			} else {
				// Animate the count change for emphasis.
				displayed.fadeOut( 180, function() {
					countEl.text( count );
					displayed.fadeIn( 180 );
				} );
				wp.a11y.speak( api.settings.l10n.announceThemeCount.replace( '%d', count ) );
			}
		},

		/**
		 * Advance the modal to the next theme.
		 *
		 * @since 4.2.0
		 */
		nextTheme: function () {
			var section = this;
			if ( section.getNextTheme() ) {
				section.showDetails( section.getNextTheme(), function() {
					section.overlay.find( '.right' ).focus();
				} );
			}
		},

		/**
		 * Get the next theme model.
		 *
		 * @since 4.2.0
		 */
		getNextTheme: function () {
			var section = this, control, next;
			control = api.control( section.params.action + '_theme_' + this.currentTheme );
			next = control.container.next( 'li.customize-control-theme' );
			if ( ! next.length ) {
				return false;
			}
			next = next[0].id.replace( 'customize-control-theme-' + section.params.action, section.params.action + '_theme' );
			control = api.control( next );

			return control.params.theme;
		},

		/**
		 * Advance the modal to the previous theme.
		 *
		 * @since 4.2.0
		 */
		previousTheme: function () {
			var section = this;
			if ( section.getPreviousTheme() ) {
				section.showDetails( section.getPreviousTheme(), function() {
					section.overlay.find( '.left' ).focus();
				} );
			}
		},

		/**
		 * Get the previous theme model.
		 *
		 * @since 4.2.0
		 */
		getPreviousTheme: function () {
			var section = this, control, previous;
			control = api.control( section.params.action + '_theme_' + this.currentTheme );
			previous = control.container.prev( 'li.customize-control-theme' );
			if ( ! previous.length ) {
				return false;
			}
			previous = previous[0].id.replace( 'customize-control-theme-' + section.params.action, section.params.action + '_theme' );
			control = api.control( previous );

			return control.params.theme;
		},

		/**
		 * Disable buttons when we're viewing the first or last theme.
		 *
		 * @since 4.2.0
		 */
		updateLimits: function () {
			if ( ! this.getNextTheme() ) {
				this.overlay.find( '.right' ).addClass( 'disabled' );
			}
			if ( ! this.getPreviousTheme() ) {
				this.overlay.find( '.left' ).addClass( 'disabled' );
			}
		},

		/**
		 * Render & show the theme details for a given theme model.
		 *
		 * @since 4.2.0
		 *
		 * @param {Object}   theme
		 */
		showDetails: function ( theme, callback ) {
			var section = this, link;
			callback = callback || function(){};
			section.currentTheme = theme.id;
			section.overlay.html( section.template( theme ) )
				.fadeIn( 'fast' )
				.focus();
			$( 'body' ).addClass( 'modal-open' );
			section.containFocus( section.overlay );
			section.updateLimits();
			wp.a11y.speak( api.settings.l10n.announceThemeDetails.replace( '%s', theme.name ) );

			link = section.overlay.find( '.inactive-theme > a' );
			link.on( 'click', function( event ) {
				event.preventDefault();

				// Short-circuit if request is currently being made.
				if ( link.hasClass( 'disabled' ) ) {
					return;
				}
				link.addClass( 'disabled' );

				api.panel( 'themes' ).loadThemePreview( theme.id ).fail( function() {
					link.removeClass( 'disabled' );
				} );
			} );
			callback();
		},

		/**
		 * Close the theme details modal.
		 *
		 * @since 4.2.0
		 */
		closeDetails: function () {
			$( 'body' ).removeClass( 'modal-open' );
			this.overlay.fadeOut( 'fast' );
			api.control( this.params.action + '_theme_' + this.currentTheme ).container.find( '.theme' ).focus();
		},

		/**
		 * Keep tab focus within the theme details modal.
		 *
		 * @since 4.2.0
		 */
		containFocus: function( el ) {
			var tabbables;

			el.on( 'keydown', function( event ) {

				// Return if it's not the tab key
				// When navigating with prev/next focus is already handled
				if ( 9 !== event.keyCode ) {
					return;
				}

				// uses jQuery UI to get the tabbable elements
				tabbables = $( ':tabbable', el );

				// Keep focus within the overlay
				if ( tabbables.last()[0] === event.target && ! event.shiftKey ) {
					tabbables.first().focus();
					return false;
				} else if ( tabbables.first()[0] === event.target && event.shiftKey ) {
					tabbables.last().focus();
					return false;
				}
			});
		}
	});

	/**
	 * @since 4.1.0
	 *
	 * @class
	 * @augments wp.customize.Class
	 */
	api.Panel = Container.extend({
		containerType: 'panel',

		/**
		 * @since 4.1.0
		 *
		 * @param {string}         id - The ID for the panel.
		 * @param {object}         options - Object containing one property: params.
		 * @param {object}         options.params - Object containing the following properties.
		 * @param {string}         options.params.title - Title shown when panel is collapsed and expanded.
		 * @param {string=}        [options.params.description] - Description shown at the top of the panel.
		 * @param {number=100}     [options.params.priority] - The sort priority for the panel.
		 * @param {string=default} [options.params.type] - The type of the panel. See wp.customize.panelConstructor.
		 * @param {string=}        [options.params.content] - The markup to be used for the panel container. If empty, a JS template is used.
		 * @param {boolean=true}   [options.params.active] - Whether the panel is active or not.
		 */
		initialize: function ( id, options ) {
			var panel = this;
			Container.prototype.initialize.call( panel, id, options );
			panel.embed();
			panel.deferred.embedded.done( function () {
				panel.ready();
			});
		},

		/**
		 * Embed the container in the DOM when any parent panel is ready.
		 *
		 * @since 4.1.0
		 */
		embed: function () {
			var panel = this,
				container = $( '#customize-theme-controls' ),
				parentContainer = $( '.customize-pane-parent' ); // @todo This should be defined elsewhere, and to be configurable

			if ( ! panel.headContainer.parent().is( parentContainer ) ) {
				parentContainer.append( panel.headContainer );
			}
			if ( ! panel.contentContainer.parent().is( panel.headContainer ) ) {
				container.append( panel.contentContainer );
			}
			panel.renderContent();

			panel.deferred.embedded.resolve();
		},

		/**
		 * @since 4.1.0
		 */
		attachEvents: function () {
			var meta, panel = this;

			// Expand/Collapse accordion sections on click.
			panel.headContainer.find( '.accordion-section-title' ).on( 'click keydown', function( event ) {
				if ( api.utils.isKeydownButNotEnterEvent( event ) ) {
					return;
				}
				event.preventDefault(); // Keep this AFTER the key filter above

				if ( ! panel.expanded() ) {
					panel.expand();
				}
			});

			// Close panel.
			panel.container.find( '.customize-panel-back' ).on( 'click keydown', function( event ) {
				if ( api.utils.isKeydownButNotEnterEvent( event ) ) {
					return;
				}
				event.preventDefault(); // Keep this AFTER the key filter above

				if ( panel.expanded() ) {
					panel.collapse();
				}
			});

			meta = panel.container.find( '.panel-meta:first' );

			meta.find( '> .accordion-section-title .customize-help-toggle' ).on( 'click keydown', function( event ) {
				if ( api.utils.isKeydownButNotEnterEvent( event ) ) {
					return;
				}
				event.preventDefault(); // Keep this AFTER the key filter above

				if ( meta.hasClass( 'cannot-expand' ) ) {
					return;
				}

				var content = meta.find( '.customize-panel-description:first' );
				if ( meta.hasClass( 'open' ) ) {
					meta.toggleClass( 'open' );
					content.slideUp( panel.defaultExpandedArguments.duration );
					$( this ).attr( 'aria-expanded', false );
				} else {
					content.slideDown( panel.defaultExpandedArguments.duration );
					meta.toggleClass( 'open' );
					$( this ).attr( 'aria-expanded', true );
				}
			});

		},

		/**
		 * Get the sections that are associated with this panel, sorted by their priority Value.
		 *
		 * @since 4.1.0
		 *
		 * @returns {Array}
		 */
		sections: function () {
			return this._children( 'panel', 'section' );
		},

		/**
		 * Return whether this panel has any active sections.
		 *
		 * @since 4.1.0
		 *
		 * @returns {boolean}
		 */
		isContextuallyActive: function () {
			var panel = this,
				sections = panel.sections(),
				activeCount = 0;
			_( sections ).each( function ( section ) {
				if ( section.active() && section.isContextuallyActive() ) {
					activeCount += 1;
				}
			} );
			return ( activeCount !== 0 );
		},

		/**
		 * Update UI to reflect expanded state
		 *
		 * @since 4.1.0
		 *
		 * @param {Boolean}  expanded
		 * @param {Object}   args
		 * @param {Boolean}  args.unchanged
		 * @param {Function} args.completeCallback
		 */
		onChangeExpanded: function ( expanded, args ) {

			// Immediately call the complete callback if there were no changes
			if ( args.unchanged ) {
				if ( args.completeCallback ) {
					args.completeCallback();
				}
				return;
			}

			// Note: there is a second argument 'args' passed
			var panel = this,
				accordionSection = panel.contentContainer,
				overlay = accordionSection.closest( '.wp-full-overlay' ),
				container = accordionSection.closest( '.wp-full-overlay-sidebar-content' ),
				topPanel = panel.headContainer.find( '.accordion-section-title' ),
				backBtn = accordionSection.find( '.customize-panel-back' );

			if ( expanded && ! accordionSection.hasClass( 'current-panel' ) ) {
				// Collapse any sibling sections/panels
				api.section.each( function ( section ) {
					if ( panel.id !== section.panel() ) {
						section.collapse( { duration: 0 } );
					}
				});
				api.panel.each( function ( otherPanel ) {
					if ( panel !== otherPanel ) {
						otherPanel.collapse( { duration: 0 } );
					}
				});

				panel._animateChangeExpanded( function() {
					topPanel.attr( 'tabindex', '-1' );
					backBtn.attr( 'tabindex', '0' );

					backBtn.focus();
					accordionSection.css( 'top', '' );
					container.scrollTop( 0 );

					if ( args.completeCallback ) {
						args.completeCallback();
					}
				} );

				overlay.addClass( 'in-sub-panel' );
				accordionSection.addClass( 'current-panel' );

			} else if ( ! expanded && accordionSection.hasClass( 'current-panel' ) ) {
				panel._animateChangeExpanded( function() {
					topPanel.attr( 'tabindex', '0' );
					backBtn.attr( 'tabindex', '-1' );

					topPanel.focus();
					accordionSection.css( 'top', '' );

					if ( args.completeCallback ) {
						args.completeCallback();
					}
				} );

				overlay.removeClass( 'in-sub-panel' );
				accordionSection.removeClass( 'current-panel' );
			}
		},

		/**
		 * Render the panel from its JS template, if it exists.
		 *
		 * The panel's container must already exist in the DOM.
		 *
		 * @since 4.3.0
		 */
		renderContent: function () {
			var template,
				panel = this;

			// Add the content to the container.
			if ( 0 !== $( '#tmpl-' + panel.templateSelector + '-content' ).length ) {
				template = wp.template( panel.templateSelector + '-content' );
			} else {
				template = wp.template( 'customize-panel-default-content' );
			}
			if ( template && panel.headContainer ) {
				panel.contentContainer.html( template( panel.params ) );
			}
		}
	});


	/**
	 * wp.customize.ThemesPanel
	 *
	 * Custom section for themes that displays without the customize preview.
	 *
	 * @constructor
	 * @augments wp.customize.Panel
	 * @augments wp.customize.Container
	 */
	api.ThemesPanel = api.Panel.extend({
		installingThemes: [],

		/**
		 * @since 4.7.0
		 */
		attachEvents: function () {
			var panel = this;

			// Attach regular panel events.
			api.Panel.prototype.attachEvents.apply( this );

			// Collapse panel to customize the current theme.
			panel.contentContainer.on( 'click', '.customize-theme', function() {
				panel.collapse();
			});

			// Toggle between filtering and browsing themes on mobile.
			panel.contentContainer.on( 'click', '.see-themes, .filter-themes', function() {
				$( '.wp-full-overlay' ).toggleClass( 'showing-themes' );
			});

			// Install (and maybe preview) a theme.
			panel.contentContainer.on( 'click', '.theme-install', function( event ) {
				panel.installTheme( event );
			});

			// Update a theme. Theme cards have the class, the details modal has the id.
			panel.contentContainer.on( 'click', '.update-theme, #update-theme', function( event ) {
				// #update-theme is a link.
				event.preventDefault();
				event.stopPropagation();

				panel.updateTheme( event );
			});

			// Delete a theme.
			panel.contentContainer.on( 'click', '.delete-theme', function( event ) {
				panel.deleteTheme( event );
			});

			_.bindAll( this, 'installTheme', 'updateTheme' );
		},

		/**
		 * Update UI to reflect expanded state
		 *
		 * @since 4.7.0
		 *
		 * @param {Boolean}  expanded
		 * @param {Object}   args
		 * @param {Boolean}  args.unchanged
		 * @param {Function} args.completeCallback
		 */
		onChangeExpanded: function ( expanded, args ) {

			// Expand/collapse the panel normally.
			api.Panel.prototype.onChangeExpanded.apply( this, [ expanded, args ] );

			// Immediately call the complete callback if there were no changes
			if ( args.unchanged ) {
				if ( args.completeCallback ) {
					args.completeCallback();
				}
				return;
			}

			// Note: there is a second argument 'args' passed
			var panel = this,
				overlay = panel.headContainer.closest( '.wp-full-overlay' );

			if ( expanded ) {
				overlay
					.addClass( 'in-themes-panel' ).addClass( 'showing-themes' )
					.delay( 200 ).find( '.customize-themes-full-container' ).addClass( 'animate' );

				// Automatically open the installed themes section.
				api.section( 'installed_themes' ).expand();
			} else {
				overlay
					.removeClass( 'in-themes-panel' )
					.find( '.customize-themes-full-container' ).removeClass( 'animate' );
			}
		},

		/**
		 * Install a theme via wp.updates.
		 *
		 * @since 4.7.0
		 */
		installTheme: function( event ) {
			var panel = this, preview = false, slug = $( event.target ).data( 'slug' );

			if ( -1 !== $.inArray( this.installingThemes, slug ) ) {
				return; // Theme is already being installed.
			}

			wp.updates.maybeRequestFilesystemCredentials( event );

			$( document ).one( 'wp-theme-install-success', function( event, response ) {
				var theme = false, customizeId, themeControl;
				if ( preview ) {

					panel.loadThemePreview( slug ).fail( function() {
						$( '.wp-full-overlay' ).removeClass( 'customize-loading' );
					} );

				} else {
					api.control.each( function( control ) {
						if ( 'theme' === control.params.type && control.params.theme.id === response.slug ) {
							theme = control.params.theme; // Used below to add theme control.
							control.rerenderAsInstalled( true );
						}
					});

					// Don't add the same theme more than once.
					if ( ! theme || 'undefined' !== typeof api.control( 'installed_theme_' + theme.id ) ) {
						return;
					}

					// Add theme control to installed section.
					theme.type = 'installed';
					customizeId = 'installed_theme_' + theme.id;
					themeControl = new api.controlConstructor.theme( customizeId, {
						params: {
							type: 'theme',
							content: $( '<li class="customize-control customize-control-theme"></li>' ).attr( 'id', 'customize-control-theme-installed_' + theme.id ).prop( 'outerHTML' ),
							section: 'installed_themes',
							active: true,
							theme: theme,
							priority: 0 // Add all newly-installed themes to the top.
						},
						previewer: api.previewer
					} );

					api.control.add( customizeId, themeControl );
					api.control( customizeId ).container.trigger( 'render-screenshot' );

					// Close the details modal if it's open to the installed theme.
					api.section.each( function( section ) {
						if ( 'themes' === section.params.type ) {
							if ( theme.id === section.currentTheme ) { // Don't close the modal if the user has navigated elsewhere.
								section.closeDetails();
							}
						}
					});
				}
			} );

			this.installingThemes.push( $( event.target ).data( 'slug' ) ); // Note: we don't remove elements from installingThemes, since they shouldn't be installed again.
			wp.updates.installTheme( {
				slug: slug
			} );

			// Also preview the theme as the event is triggered on Install & Preview.
			if ( $( event.target ).hasClass( 'preview' ) ) {
				preview = true;
				$( '.wp-full-overlay' ).addClass( 'customize-loading' );
			}
		},

		/**
		 * Load theme preview.
		 *
		 * @since 4.7.0
		 *
		 * @param {string} themeId Theme ID.
		 * @returns {jQuery.promise} Promise.
		 */
		loadThemePreview: function( themeId ) {
			var deferred = $.Deferred(), onceProcessingComplete, overlay, urlParser;

			urlParser = document.createElement( 'a' );
			urlParser.href = location.href;
			urlParser.search = $.param( _.extend(
				api.utils.parseQueryString( urlParser.search.substr( 1 ) ),
				{
					theme: themeId,
					changeset_uuid: api.settings.changeset.uuid
				}
			) );

			overlay = $( '.wp-full-overlay' );
			overlay.addClass( 'customize-loading' );

			onceProcessingComplete = function() {
				var request;
				if ( api.state( 'processing' ).get() > 0 ) {
					return;
				}

				api.state( 'processing' ).unbind( onceProcessingComplete );

				request = api.requestChangesetUpdate();
				request.done( function() {
					$( window ).off( 'beforeunload.customize-confirm' );
					window.location.href = urlParser.href;
				} );
				request.fail( function() {
					overlay.removeClass( 'customize-loading' );
				} );
			};

			if ( 0 === api.state( 'processing' ).get() ) {
				onceProcessingComplete();
			} else {
				api.state( 'processing' ).bind( onceProcessingComplete );
			}

			return deferred.promise();
		},

		/**
		 * Update a theme via wp.updates.
		 *
		 * @since 4.7.0
		 */
		updateTheme: function( event ) {
			wp.updates.maybeRequestFilesystemCredentials( event );

			$( document ).one( 'wp-theme-update-success', function( event, response ) {
				// Rerender the control to reflect the update.
				api.control.each( function( control ) {
					if ( 'theme' === control.params.type && control.params.theme.id === response.slug ) {
						control.params.theme.hasUpdate = false;
						control.rerenderAsInstalled( true );
					}
				});
			} );

			wp.updates.updateTheme( {
				slug: $( event.target ).closest( '.notice' ).data( 'slug' )
			} );
		},

		/**
		 * Delete a theme via wp.updates.
		 *
		 * @since 4.7.0
		 */
		deleteTheme: function( event ) {
			var theme, section;
			theme = $( event.target ).data( 'slug' );
			section = api.section( 'installed_themes' );

			event.preventDefault();

			// Confirmation dialog for deleting a theme.
			if ( ! window.confirm( api.settings.l10n.confirmDeleteTheme ) ) {
				return;
			}

			wp.updates.maybeRequestFilesystemCredentials( event );

			$( document ).one( 'wp-theme-delete-success', function() {
				var control = api.control( 'installed_theme_' + theme );

				// Remove theme control.
				control.container.remove();
				api.control.remove( control.id );

				// Update installed count.
				section.loaded = section.loaded - 1;
				section.updateCount();

				// Rerender any other theme controls as uninstalled.
				api.control.each( function( control ) {
					if ( 'theme' === control.params.type && control.params.theme.id === theme ) {
						control.rerenderAsInstalled( false );
					}
				});
			} );

			wp.updates.deleteTheme( {
				slug: theme
			} );

			// Close modal and focus the section.
			section.closeDetails();
			section.focus();
		}

	});


	/**
	 * A Customizer Control.
	 *
	 * A control provides a UI element that allows a user to modify a Customizer Setting.
	 *
	 * @see PHP class WP_Customize_Control.
	 *
	 * @class
	 * @augments wp.customize.Class
	 *
	 * @param {string} id                              Unique identifier for the control instance.
	 * @param {object} options                         Options hash for the control instance.
	 * @param {object} options.params
	 * @param {object} options.params.type             Type of control (e.g. text, radio, dropdown-pages, etc.)
	 * @param {string} options.params.content          The HTML content for the control.
	 * @param {string} options.params.priority         Order of priority to show the control within the section.
	 * @param {string} options.params.active
	 * @param {string} options.params.section          The ID of the section the control belongs to.
	 * @param {string} options.params.settings.default The ID of the setting the control relates to.
	 * @param {string} options.params.settings.data
	 * @param {string} options.params.label
	 * @param {string} options.params.description
	 * @param {string} options.params.instanceNumber Order in which this instance was created in relation to other instances.
	 */
	api.Control = api.Class.extend({
		defaultActiveArguments: { duration: 'fast', completeCallback: $.noop },

		initialize: function( id, options ) {
			var control = this,
				nodes, radios, settings;

			control.params = {};
			$.extend( control, options || {} );
			control.id = id;
			control.selector = '#customize-control-' + id.replace( /\]/g, '' ).replace( /\[/g, '-' );
			control.templateSelector = 'customize-control-' + control.params.type + '-content';
			control.container = control.params.content ? $( control.params.content ) : $( control.selector );

			control.deferred = {
				embedded: new $.Deferred()
			};
			control.section = new api.Value();
			control.priority = new api.Value();
			control.active = new api.Value();
			control.activeArgumentsQueue = [];
			control.notifications = new api.Values({ defaultConstructor: api.Notification });

			control.elements = [];

			nodes  = control.container.find('[data-customize-setting-link]');
			radios = {};

			nodes.each( function() {
				var node = $( this ),
					name;

				if ( node.is( ':radio' ) ) {
					name = node.prop( 'name' );
					if ( radios[ name ] ) {
						return;
					}

					radios[ name ] = true;
					node = nodes.filter( '[name="' + name + '"]' );
				}

				api( node.data( 'customizeSettingLink' ), function( setting ) {
					var element = new api.Element( node );
					control.elements.push( element );
					element.sync( setting );
					element.set( setting() );
				});
			});

			control.active.bind( function ( active ) {
				var args = control.activeArgumentsQueue.shift();
				args = $.extend( {}, control.defaultActiveArguments, args );
				control.onChangeActive( active, args );
			} );

			control.section.set( control.params.section );
			control.priority.set( isNaN( control.params.priority ) ? 10 : control.params.priority );
			control.active.set( control.params.active );

			api.utils.bubbleChildValueChanges( control, [ 'section', 'priority', 'active' ] );

			/*
			 * After all settings related to the control are available,
			 * make them available on the control and embed the control into the page.
			 */
			settings = $.map( control.params.settings, function( value ) {
				return value;
			});

			if ( 0 === settings.length ) {
				control.setting = null;
				control.settings = {};
				control.embed();
			} else {
				api.apply( api, settings.concat( function() {
					var key;

					control.settings = {};
					for ( key in control.params.settings ) {
						control.settings[ key ] = api( control.params.settings[ key ] );
					}

					control.setting = control.settings['default'] || null;

					// Add setting notifications to the control notification.
					_.each( control.settings, function( setting ) {
						setting.notifications.bind( 'add', function( settingNotification ) {
							var controlNotification, code, params;
							code = setting.id + ':' + settingNotification.code;
							params = _.extend(
								{},
								settingNotification,
								{
									setting: setting.id
								}
							);
							controlNotification = new api.Notification( code, params );
							control.notifications.add( controlNotification.code, controlNotification );
						} );
						setting.notifications.bind( 'remove', function( settingNotification ) {
							control.notifications.remove( setting.id + ':' + settingNotification.code );
						} );
					} );

					control.embed();
				}) );
			}

			// After the control is embedded on the page, invoke the "ready" method.
			control.deferred.embedded.done( function () {
				/*
				 * Note that this debounced/deferred rendering is needed for two reasons:
				 * 1) The 'remove' event is triggered just _before_ the notification is actually removed.
				 * 2) Improve performance when adding/removing multiple notifications at a time.
				 */
				var debouncedRenderNotifications = _.debounce( function renderNotifications() {
					control.renderNotifications();
				} );
				control.notifications.bind( 'add', function( notification ) {
					wp.a11y.speak( notification.message, 'assertive' );
					debouncedRenderNotifications();
				} );
				control.notifications.bind( 'remove', debouncedRenderNotifications );
				control.renderNotifications();

				control.ready();
			});
		},

		/**
		 * Embed the control into the page.
		 */
		embed: function () {
			var control = this,
				inject;

			// Watch for changes to the section state
			inject = function ( sectionId ) {
				var parentContainer;
				if ( ! sectionId ) { // @todo allow a control to be embedded without a section, for instance a control embedded in the front end.
					return;
				}
				// Wait for the section to be registered
				api.section( sectionId, function ( section ) {
					// Wait for the section to be ready/initialized
					section.deferred.embedded.done( function () {
						parentContainer = ( section.contentContainer.is( 'ul' ) ) ? section.contentContainer : section.contentContainer.find( 'ul:first' );
						if ( ! control.container.parent().is( parentContainer ) ) {
							parentContainer.append( control.container );
							control.renderContent();
						}
						control.deferred.embedded.resolve();
					});
				});
			};
			control.section.bind( inject );
			inject( control.section.get() );
		},

		/**
		 * Triggered when the control's markup has been injected into the DOM.
		 *
		 * @abstract
		 */
		ready: function() {},

		/**
		 * Get the element inside of a control's container that contains the validation error message.
		 *
		 * Control subclasses may override this to return the proper container to render notifications into.
		 * Injects the notification container for existing controls that lack the necessary container,
		 * including special handling for nav menu items and widgets.
		 *
		 * @since 4.6.0
		 * @returns {jQuery} Setting validation message element.
		 * @this {wp.customize.Control}
		 */
		getNotificationsContainerElement: function() {
			var control = this, controlTitle, notificationsContainer;

			notificationsContainer = control.container.find( '.customize-control-notifications-container:first' );
			if ( notificationsContainer.length ) {
				return notificationsContainer;
			}

			notificationsContainer = $( '<div class="customize-control-notifications-container"></div>' );

			if ( control.container.hasClass( 'customize-control-nav_menu_item' ) ) {
				control.container.find( '.menu-item-settings:first' ).prepend( notificationsContainer );
			} else if ( control.container.hasClass( 'customize-control-widget_form' ) ) {
				control.container.find( '.widget-inside:first' ).prepend( notificationsContainer );
			} else {
				controlTitle = control.container.find( '.customize-control-title' );
				if ( controlTitle.length ) {
					controlTitle.after( notificationsContainer );
				} else {
					control.container.prepend( notificationsContainer );
				}
			}
			return notificationsContainer;
		},

		/**
		 * Render notifications.
		 *
		 * Renders the `control.notifications` into the control's container.
		 * Control subclasses may override this method to do their own handling
		 * of rendering notifications.
		 *
		 * @since 4.6.0
		 * @this {wp.customize.Control}
		 */
		renderNotifications: function() {
			var control = this, container, notifications, hasError = false;
			container = control.getNotificationsContainerElement();
			if ( ! container || ! container.length ) {
				return;
			}
			notifications = [];
			control.notifications.each( function( notification ) {
				notifications.push( notification );
				if ( 'error' === notification.type ) {
					hasError = true;
				}
			} );

			if ( 0 === notifications.length ) {
				container.stop().slideUp( 'fast' );
			} else {
				container.stop().slideDown( 'fast', null, function() {
					$( this ).css( 'height', 'auto' );
				} );
			}

			if ( ! control.notificationsTemplate ) {
				control.notificationsTemplate = wp.template( 'customize-control-notifications' );
			}

			control.container.toggleClass( 'has-notifications', 0 !== notifications.length );
			control.container.toggleClass( 'has-error', hasError );
			container.empty().append( $.trim(
				control.notificationsTemplate( { notifications: notifications, altNotice: Boolean( control.altNotice ) } )
			) );
		},

		/**
		 * Normal controls do not expand, so just expand its parent
		 *
		 * @param {Object} [params]
		 */
		expand: function ( params ) {
			api.section( this.section() ).expand( params );
		},

		/**
		 * Bring the containing section and panel into view and then
		 * this control into view, focusing on the first input.
		 */
		focus: focus,

		/**
		 * Update UI in response to a change in the control's active state.
		 * This does not change the active state, it merely handles the behavior
		 * for when it does change.
		 *
		 * @since 4.1.0
		 *
		 * @param {Boolean}  active
		 * @param {Object}   args
		 * @param {Number}   args.duration
		 * @param {Function} args.completeCallback
		 */
		onChangeActive: function ( active, args ) {
			if ( args.unchanged ) {
				if ( args.completeCallback ) {
					args.completeCallback();
				}
				return;
			}

			if ( ! $.contains( document, this.container[0] ) ) {
				// jQuery.fn.slideUp is not hiding an element if it is not in the DOM
				this.container.toggle( active );
				if ( args.completeCallback ) {
					args.completeCallback();
				}
			} else if ( active ) {
				this.container.slideDown( args.duration, args.completeCallback );
			} else {
				this.container.slideUp( args.duration, args.completeCallback );
			}
		},

		/**
		 * @deprecated 4.1.0 Use this.onChangeActive() instead.
		 */
		toggle: function ( active ) {
			return this.onChangeActive( active, this.defaultActiveArguments );
		},

		/**
		 * Shorthand way to enable the active state.
		 *
		 * @since 4.1.0
		 *
		 * @param {Object} [params]
		 * @returns {Boolean} false if already active
		 */
		activate: Container.prototype.activate,

		/**
		 * Shorthand way to disable the active state.
		 *
		 * @since 4.1.0
		 *
		 * @param {Object} [params]
		 * @returns {Boolean} false if already inactive
		 */
		deactivate: Container.prototype.deactivate,

		/**
		 * Re-use _toggleActive from Container class.
		 *
		 * @access private
		 */
		_toggleActive: Container.prototype._toggleActive,

		dropdownInit: function() {
			var control      = this,
				statuses     = this.container.find('.dropdown-status'),
				params       = this.params,
				toggleFreeze = false,
				update       = function( to ) {
					if ( typeof to === 'string' && params.statuses && params.statuses[ to ] )
						statuses.html( params.statuses[ to ] ).show();
					else
						statuses.hide();
				};

			// Support the .dropdown class to open/close complex elements
			this.container.on( 'click keydown', '.dropdown', function( event ) {
				if ( api.utils.isKeydownButNotEnterEvent( event ) ) {
					return;
				}

				event.preventDefault();

				if (!toggleFreeze)
					control.container.toggleClass('open');

				if ( control.container.hasClass('open') )
					control.container.parent().parent().find('li.library-selected').focus();

				// Don't want to fire focus and click at same time
				toggleFreeze = true;
				setTimeout(function () {
					toggleFreeze = false;
				}, 400);
			});

			this.setting.bind( update );
			update( this.setting() );
		},

		/**
		 * Render the control from its JS template, if it exists.
		 *
		 * The control's container must already exist in the DOM.
		 *
		 * @since 4.1.0
		 */
		renderContent: function () {
			var template,
				control = this;

			// Replace the container element's content with the control.
			if ( 0 !== $( '#tmpl-' + control.templateSelector ).length ) {
				template = wp.template( control.templateSelector );
				if ( template && control.container ) {
					control.container.html( template( control.params ) );
				}
			}
		}
	});

	/**
	 * A colorpicker control.
	 *
	 * @class
	 * @augments wp.customize.Control
	 * @augments wp.customize.Class
	 */
	api.ColorControl = api.Control.extend({
		ready: function() {
			var control = this,
				picker = this.container.find('.color-picker-hex');

			picker.val( control.setting() ).wpColorPicker({
				change: function() {
					control.setting.set( picker.wpColorPicker('color') );
				},
				clear: function() {
					control.setting.set( '' );
				}
			});

			this.setting.bind( function ( value ) {
				picker.val( value );
				picker.wpColorPicker( 'color', value );
			});
		}
	});

	/**
	 * A control that implements the media modal.
	 *
	 * @class
	 * @augments wp.customize.Control
	 * @augments wp.customize.Class
	 */
	api.MediaControl = api.Control.extend({

		/**
		 * When the control's DOM structure is ready,
		 * set up internal event bindings.
		 */
		ready: function() {
			var control = this;
			// Shortcut so that we don't have to use _.bind every time we add a callback.
			_.bindAll( control, 'restoreDefault', 'removeFile', 'openFrame', 'select', 'pausePlayer' );

			// Bind events, with delegation to facilitate re-rendering.
			control.container.on( 'click keydown', '.upload-button', control.openFrame );
			control.container.on( 'click keydown', '.upload-button', control.pausePlayer );
			control.container.on( 'click keydown', '.thumbnail-image img', control.openFrame );
			control.container.on( 'click keydown', '.default-button', control.restoreDefault );
			control.container.on( 'click keydown', '.remove-button', control.pausePlayer );
			control.container.on( 'click keydown', '.remove-button', control.removeFile );
			control.container.on( 'click keydown', '.remove-button', control.cleanupPlayer );

			// Resize the player controls when it becomes visible (ie when section is expanded)
			api.section( control.section() ).container
				.on( 'expanded', function() {
					if ( control.player ) {
						control.player.setControlsSize();
					}
				})
				.on( 'collapsed', function() {
					control.pausePlayer();
				});

			/**
			 * Set attachment data and render content.
			 *
			 * Note that BackgroundImage.prototype.ready applies this ready method
			 * to itself. Since BackgroundImage is an UploadControl, the value
			 * is the attachment URL instead of the attachment ID. In this case
			 * we skip fetching the attachment data because we have no ID available,
			 * and it is the responsibility of the UploadControl to set the control's
			 * attachmentData before calling the renderContent method.
			 *
			 * @param {number|string} value Attachment
			 */
			function setAttachmentDataAndRenderContent( value ) {
				var hasAttachmentData = $.Deferred();

				if ( control.extended( api.UploadControl ) ) {
					hasAttachmentData.resolve();
				} else {
					value = parseInt( value, 10 );
					if ( _.isNaN( value ) || value <= 0 ) {
						delete control.params.attachment;
						hasAttachmentData.resolve();
					} else if ( control.params.attachment && control.params.attachment.id === value ) {
						hasAttachmentData.resolve();
					}
				}

				// Fetch the attachment data.
				if ( 'pending' === hasAttachmentData.state() ) {
					wp.media.attachment( value ).fetch().done( function() {
						control.params.attachment = this.attributes;
						hasAttachmentData.resolve();

						// Send attachment information to the preview for possible use in `postMessage` transport.
						wp.customize.previewer.send( control.setting.id + '-attachment-data', this.attributes );
					} );
				}

				hasAttachmentData.done( function() {
					control.renderContent();
				} );
			}

			// Ensure attachment data is initially set (for dynamically-instantiated controls).
			setAttachmentDataAndRenderContent( control.setting() );

			// Update the attachment data and re-render the control when the setting changes.
			control.setting.bind( setAttachmentDataAndRenderContent );
		},

		pausePlayer: function () {
			this.player && this.player.pause();
		},

		cleanupPlayer: function () {
			this.player && wp.media.mixin.removePlayer( this.player );
		},

		/**
		 * Open the media modal.
		 */
		openFrame: function( event ) {
			if ( api.utils.isKeydownButNotEnterEvent( event ) ) {
				return;
			}

			event.preventDefault();

			if ( ! this.frame ) {
				this.initFrame();
			}

			this.frame.open();
		},

		/**
		 * Create a media modal select frame, and store it so the instance can be reused when needed.
		 */
		initFrame: function() {
			this.frame = wp.media({
				button: {
					text: this.params.button_labels.frame_button
				},
				states: [
					new wp.media.controller.Library({
						title:     this.params.button_labels.frame_title,
						library:   wp.media.query({ type: this.params.mime_type }),
						multiple:  false,
						date:      false
					})
				]
			});

			// When a file is selected, run a callback.
			this.frame.on( 'select', this.select );
		},

		/**
		 * Callback handler for when an attachment is selected in the media modal.
		 * Gets the selected image information, and sets it within the control.
		 */
		select: function() {
			// Get the attachment from the modal frame.
			var node,
				attachment = this.frame.state().get( 'selection' ).first().toJSON(),
				mejsSettings = window._wpmejsSettings || {};

			this.params.attachment = attachment;

			// Set the Customizer setting; the callback takes care of rendering.
			this.setting( attachment.id );
			node = this.container.find( 'audio, video' ).get(0);

			// Initialize audio/video previews.
			if ( node ) {
				this.player = new MediaElementPlayer( node, mejsSettings );
			} else {
				this.cleanupPlayer();
			}
		},

		/**
		 * Reset the setting to the default value.
		 */
		restoreDefault: function( event ) {
			if ( api.utils.isKeydownButNotEnterEvent( event ) ) {
				return;
			}
			event.preventDefault();

			this.params.attachment = this.params.defaultAttachment;
			this.setting( this.params.defaultAttachment.url );
		},

		/**
		 * Called when the "Remove" link is clicked. Empties the setting.
		 *
		 * @param {object} event jQuery Event object
		 */
		removeFile: function( event ) {
			if ( api.utils.isKeydownButNotEnterEvent( event ) ) {
				return;
			}
			event.preventDefault();

			this.params.attachment = {};
			this.setting( '' );
			this.renderContent(); // Not bound to setting change when emptying.
		}
	});

	/**
	 * An upload control, which utilizes the media modal.
	 *
	 * @class
	 * @augments wp.customize.MediaControl
	 * @augments wp.customize.Control
	 * @augments wp.customize.Class
	 */
	api.UploadControl = api.MediaControl.extend({

		/**
		 * Callback handler for when an attachment is selected in the media modal.
		 * Gets the selected image information, and sets it within the control.
		 */
		select: function() {
			// Get the attachment from the modal frame.
			var node,
				attachment = this.frame.state().get( 'selection' ).first().toJSON(),
				mejsSettings = window._wpmejsSettings || {};

			this.params.attachment = attachment;

			// Set the Customizer setting; the callback takes care of rendering.
			this.setting( attachment.url );
			node = this.container.find( 'audio, video' ).get(0);

			// Initialize audio/video previews.
			if ( node ) {
				this.player = new MediaElementPlayer( node, mejsSettings );
			} else {
				this.cleanupPlayer();
			}
		},

		// @deprecated
		success: function() {},

		// @deprecated
		removerVisibility: function() {}
	});

	/**
	 * A control for uploading images.
	 *
	 * This control no longer needs to do anything more
	 * than what the upload control does in JS.
	 *
	 * @class
	 * @augments wp.customize.UploadControl
	 * @augments wp.customize.MediaControl
	 * @augments wp.customize.Control
	 * @augments wp.customize.Class
	 */
	api.ImageControl = api.UploadControl.extend({
		// @deprecated
		thumbnailSrc: function() {}
	});

	/**
	 * A control for uploading background images.
	 *
	 * @class
	 * @augments wp.customize.UploadControl
	 * @augments wp.customize.MediaControl
	 * @augments wp.customize.Control
	 * @augments wp.customize.Class
	 */
	api.BackgroundControl = api.UploadControl.extend({

		/**
		 * When the control's DOM structure is ready,
		 * set up internal event bindings.
		 */
		ready: function() {
			api.UploadControl.prototype.ready.apply( this, arguments );
		},

		/**
		 * Callback handler for when an attachment is selected in the media modal.
		 * Does an additional AJAX request for setting the background context.
		 */
		select: function() {
			api.UploadControl.prototype.select.apply( this, arguments );

			wp.ajax.post( 'custom-background-add', {
				nonce: _wpCustomizeBackground.nonces.add,
				wp_customize: 'on',
				customize_theme: api.settings.theme.stylesheet,
				attachment_id: this.params.attachment.id
			} );
		}
	});

	/**
	 * A control for selecting and cropping an image.
	 *
	 * @class
	 * @augments wp.customize.MediaControl
	 * @augments wp.customize.Control
	 * @augments wp.customize.Class
	 */
	api.CroppedImageControl = api.MediaControl.extend({

		/**
		 * Open the media modal to the library state.
		 */
		openFrame: function( event ) {
			if ( api.utils.isKeydownButNotEnterEvent( event ) ) {
				return;
			}

			this.initFrame();
			this.frame.setState( 'library' ).open();
		},

		/**
		 * Create a media modal select frame, and store it so the instance can be reused when needed.
		 */
		initFrame: function() {
			var l10n = _wpMediaViewsL10n;

			this.frame = wp.media({
				button: {
					text: l10n.select,
					close: false
				},
				states: [
					new wp.media.controller.Library({
						title: this.params.button_labels.frame_title,
						library: wp.media.query({ type: 'image' }),
						multiple: false,
						date: false,
						priority: 20,
						suggestedWidth: this.params.width,
						suggestedHeight: this.params.height
					}),
					new wp.media.controller.CustomizeImageCropper({
						imgSelectOptions: this.calculateImageSelectOptions,
						control: this
					})
				]
			});

			this.frame.on( 'select', this.onSelect, this );
			this.frame.on( 'cropped', this.onCropped, this );
			this.frame.on( 'skippedcrop', this.onSkippedCrop, this );
		},

		/**
		 * After an image is selected in the media modal, switch to the cropper
		 * state if the image isn't the right size.
		 */
		onSelect: function() {
			var attachment = this.frame.state().get( 'selection' ).first().toJSON();

			if ( this.params.width === attachment.width && this.params.height === attachment.height && ! this.params.flex_width && ! this.params.flex_height ) {
				this.setImageFromAttachment( attachment );
				this.frame.close();
			} else {
				this.frame.setState( 'cropper' );
			}
		},

		/**
		 * After the image has been cropped, apply the cropped image data to the setting.
		 *
		 * @param {object} croppedImage Cropped attachment data.
		 */
		onCropped: function( croppedImage ) {
			this.setImageFromAttachment( croppedImage );
		},

		/**
		 * Returns a set of options, computed from the attached image data and
		 * control-specific data, to be fed to the imgAreaSelect plugin in
		 * wp.media.view.Cropper.
		 *
		 * @param {wp.media.model.Attachment} attachment
		 * @param {wp.media.controller.Cropper} controller
		 * @returns {Object} Options
		 */
		calculateImageSelectOptions: function( attachment, controller ) {
			var control    = controller.get( 'control' ),
				flexWidth  = !! parseInt( control.params.flex_width, 10 ),
				flexHeight = !! parseInt( control.params.flex_height, 10 ),
				realWidth  = attachment.get( 'width' ),
				realHeight = attachment.get( 'height' ),
				xInit = parseInt( control.params.width, 10 ),
				yInit = parseInt( control.params.height, 10 ),
				ratio = xInit / yInit,
				xImg  = xInit,
				yImg  = yInit,
				x1, y1, imgSelectOptions;

			controller.set( 'canSkipCrop', ! control.mustBeCropped( flexWidth, flexHeight, xInit, yInit, realWidth, realHeight ) );

			if ( realWidth / realHeight > ratio ) {
				yInit = realHeight;
				xInit = yInit * ratio;
			} else {
				xInit = realWidth;
				yInit = xInit / ratio;
			}

			x1 = ( realWidth - xInit ) / 2;
			y1 = ( realHeight - yInit ) / 2;

			imgSelectOptions = {
				handles: true,
				keys: true,
				instance: true,
				persistent: true,
				imageWidth: realWidth,
				imageHeight: realHeight,
				minWidth: xImg > xInit ? xInit : xImg,
				minHeight: yImg > yInit ? yInit : yImg,
				x1: x1,
				y1: y1,
				x2: xInit + x1,
				y2: yInit + y1
			};

			if ( flexHeight === false && flexWidth === false ) {
				imgSelectOptions.aspectRatio = xInit + ':' + yInit;
			}

			if ( true === flexHeight ) {
				delete imgSelectOptions.minHeight;
				imgSelectOptions.maxWidth = realWidth;
			}

			if ( true === flexWidth ) {
				delete imgSelectOptions.minWidth;
				imgSelectOptions.maxHeight = realHeight;
			}

			return imgSelectOptions;
		},

		/**
		 * Return whether the image must be cropped, based on required dimensions.
		 *
		 * @param {bool} flexW
		 * @param {bool} flexH
		 * @param {int}  dstW
		 * @param {int}  dstH
		 * @param {int}  imgW
		 * @param {int}  imgH
		 * @return {bool}
		 */
		mustBeCropped: function( flexW, flexH, dstW, dstH, imgW, imgH ) {
			if ( true === flexW && true === flexH ) {
				return false;
			}

			if ( true === flexW && dstH === imgH ) {
				return false;
			}

			if ( true === flexH && dstW === imgW ) {
				return false;
			}

			if ( dstW === imgW && dstH === imgH ) {
				return false;
			}

			if ( imgW <= dstW ) {
				return false;
			}

			return true;
		},

		/**
		 * If cropping was skipped, apply the image data directly to the setting.
		 */
		onSkippedCrop: function() {
			var attachment = this.frame.state().get( 'selection' ).first().toJSON();
			this.setImageFromAttachment( attachment );
		},

		/**
		 * Updates the setting and re-renders the control UI.
		 *
		 * @param {object} attachment
		 */
		setImageFromAttachment: function( attachment ) {
			this.params.attachment = attachment;

			// Set the Customizer setting; the callback takes care of rendering.
			this.setting( attachment.id );
		}
	});

	/**
	 * A control for selecting and cropping Site Icons.
	 *
	 * @class
	 * @augments wp.customize.CroppedImageControl
	 * @augments wp.customize.MediaControl
	 * @augments wp.customize.Control
	 * @augments wp.customize.Class
	 */
	api.SiteIconControl = api.CroppedImageControl.extend({

		/**
		 * Create a media modal select frame, and store it so the instance can be reused when needed.
		 */
		initFrame: function() {
			var l10n = _wpMediaViewsL10n;

			this.frame = wp.media({
				button: {
					text: l10n.select,
					close: false
				},
				states: [
					new wp.media.controller.Library({
						title: this.params.button_labels.frame_title,
						library: wp.media.query({ type: 'image' }),
						multiple: false,
						date: false,
						priority: 20,
						suggestedWidth: this.params.width,
						suggestedHeight: this.params.height
					}),
					new wp.media.controller.SiteIconCropper({
						imgSelectOptions: this.calculateImageSelectOptions,
						control: this
					})
				]
			});

			this.frame.on( 'select', this.onSelect, this );
			this.frame.on( 'cropped', this.onCropped, this );
			this.frame.on( 'skippedcrop', this.onSkippedCrop, this );
		},

		/**
		 * After an image is selected in the media modal, switch to the cropper
		 * state if the image isn't the right size.
		 */
		onSelect: function() {
			var attachment = this.frame.state().get( 'selection' ).first().toJSON(),
				controller = this;

			if ( this.params.width === attachment.width && this.params.height === attachment.height && ! this.params.flex_width && ! this.params.flex_height ) {
				wp.ajax.post( 'crop-image', {
					nonce: attachment.nonces.edit,
					id: attachment.id,
					context: 'site-icon',
					cropDetails: {
						x1: 0,
						y1: 0,
						width: this.params.width,
						height: this.params.height,
						dst_width: this.params.width,
						dst_height: this.params.height
					}
				} ).done( function( croppedImage ) {
					controller.setImageFromAttachment( croppedImage );
					controller.frame.close();
				} ).fail( function() {
					controller.frame.trigger('content:error:crop');
				} );
			} else {
				this.frame.setState( 'cropper' );
			}
		},

		/**
		 * Updates the setting and re-renders the control UI.
		 *
		 * @param {object} attachment
		 */
		setImageFromAttachment: function( attachment ) {
			var sizes = [ 'site_icon-32', 'thumbnail', 'full' ],
				icon;

			_.each( sizes, function( size ) {
				if ( ! icon && ! _.isUndefined ( attachment.sizes[ size ] ) ) {
					icon = attachment.sizes[ size ];
				}
			} );

			this.params.attachment = attachment;

			// Set the Customizer setting; the callback takes care of rendering.
			this.setting( attachment.id );

			// Update the icon in-browser.
			$( 'link[sizes="32x32"]' ).attr( 'href', icon.url );
		},

		/**
		 * Called when the "Remove" link is clicked. Empties the setting.
		 *
		 * @param {object} event jQuery Event object
		 */
		removeFile: function( event ) {
			if ( api.utils.isKeydownButNotEnterEvent( event ) ) {
				return;
			}
			event.preventDefault();

			this.params.attachment = {};
			this.setting( '' );
			this.renderContent(); // Not bound to setting change when emptying.
			$( 'link[rel="icon"]' ).attr( 'href', '' );
		}
	});

	/**
	 * @class
	 * @augments wp.customize.Control
	 * @augments wp.customize.Class
	 */
	api.HeaderControl = api.Control.extend({
		ready: function() {
			this.btnRemove = $('#customize-control-header_image .actions .remove');
			this.btnNew    = $('#customize-control-header_image .actions .new');

			_.bindAll(this, 'openMedia', 'removeImage');

			this.btnNew.on( 'click', this.openMedia );
			this.btnRemove.on( 'click', this.removeImage );

			api.HeaderTool.currentHeader = this.getInitialHeaderImage();

			new api.HeaderTool.CurrentView({
				model: api.HeaderTool.currentHeader,
				el: '#customize-control-header_image .current .container'
			});

			new api.HeaderTool.ChoiceListView({
				collection: api.HeaderTool.UploadsList = new api.HeaderTool.ChoiceList(),
				el: '#customize-control-header_image .choices .uploaded .list'
			});

			new api.HeaderTool.ChoiceListView({
				collection: api.HeaderTool.DefaultsList = new api.HeaderTool.DefaultsList(),
				el: '#customize-control-header_image .choices .default .list'
			});

			api.HeaderTool.combinedList = api.HeaderTool.CombinedList = new api.HeaderTool.CombinedList([
				api.HeaderTool.UploadsList,
				api.HeaderTool.DefaultsList
			]);

			// Ensure custom-header-crop Ajax requests bootstrap the Customizer to activate the previewed theme.
			wp.media.controller.Cropper.prototype.defaults.doCropArgs.wp_customize = 'on';
			wp.media.controller.Cropper.prototype.defaults.doCropArgs.customize_theme = api.settings.theme.stylesheet;
		},

		/**
		 * Returns a new instance of api.HeaderTool.ImageModel based on the currently
		 * saved header image (if any).
		 *
		 * @since 4.2.0
		 *
		 * @returns {Object} Options
		 */
		getInitialHeaderImage: function() {
			if ( ! api.get().header_image || ! api.get().header_image_data || _.contains( [ 'remove-header', 'random-default-image', 'random-uploaded-image' ], api.get().header_image ) ) {
				return new api.HeaderTool.ImageModel();
			}

			// Get the matching uploaded image object.
			var currentHeaderObject = _.find( _wpCustomizeHeader.uploads, function( imageObj ) {
				return ( imageObj.attachment_id === api.get().header_image_data.attachment_id );
			} );
			// Fall back to raw current header image.
			if ( ! currentHeaderObject ) {
				currentHeaderObject = {
					url: api.get().header_image,
					thumbnail_url: api.get().header_image,
					attachment_id: api.get().header_image_data.attachment_id
				};
			}

			return new api.HeaderTool.ImageModel({
				header: currentHeaderObject,
				choice: currentHeaderObject.url.split( '/' ).pop()
			});
		},

		/**
		 * Returns a set of options, computed from the attached image data and
		 * theme-specific data, to be fed to the imgAreaSelect plugin in
		 * wp.media.view.Cropper.
		 *
		 * @param {wp.media.model.Attachment} attachment
		 * @param {wp.media.controller.Cropper} controller
		 * @returns {Object} Options
		 */
		calculateImageSelectOptions: function(attachment, controller) {
			var xInit = parseInt(_wpCustomizeHeader.data.width, 10),
				yInit = parseInt(_wpCustomizeHeader.data.height, 10),
				flexWidth = !! parseInt(_wpCustomizeHeader.data['flex-width'], 10),
				flexHeight = !! parseInt(_wpCustomizeHeader.data['flex-height'], 10),
				ratio, xImg, yImg, realHeight, realWidth,
				imgSelectOptions;

			realWidth = attachment.get('width');
			realHeight = attachment.get('height');

			this.headerImage = new api.HeaderTool.ImageModel();
			this.headerImage.set({
				themeWidth: xInit,
				themeHeight: yInit,
				themeFlexWidth: flexWidth,
				themeFlexHeight: flexHeight,
				imageWidth: realWidth,
				imageHeight: realHeight
			});

			controller.set( 'canSkipCrop', ! this.headerImage.shouldBeCropped() );

			ratio = xInit / yInit;
			xImg = realWidth;
			yImg = realHeight;

			if ( xImg / yImg > ratio ) {
				yInit = yImg;
				xInit = yInit * ratio;
			} else {
				xInit = xImg;
				yInit = xInit / ratio;
			}

			imgSelectOptions = {
				handles: true,
				keys: true,
				instance: true,
				persistent: true,
				imageWidth: realWidth,
				imageHeight: realHeight,
				x1: 0,
				y1: 0,
				x2: xInit,
				y2: yInit
			};

			if (flexHeight === false && flexWidth === false) {
				imgSelectOptions.aspectRatio = xInit + ':' + yInit;
			}
			if (flexHeight === false ) {
				imgSelectOptions.maxHeight = yInit;
			}
			if (flexWidth === false ) {
				imgSelectOptions.maxWidth = xInit;
			}

			return imgSelectOptions;
		},

		/**
		 * Sets up and opens the Media Manager in order to select an image.
		 * Depending on both the size of the image and the properties of the
		 * current theme, a cropping step after selection may be required or
		 * skippable.
		 *
		 * @param {event} event
		 */
		openMedia: function(event) {
			var l10n = _wpMediaViewsL10n;

			event.preventDefault();

			this.frame = wp.media({
				button: {
					text: l10n.selectAndCrop,
					close: false
				},
				states: [
					new wp.media.controller.Library({
						title:     l10n.chooseImage,
						library:   wp.media.query({ type: 'image' }),
						multiple:  false,
						date:      false,
						priority:  20,
						suggestedWidth: _wpCustomizeHeader.data.width,
						suggestedHeight: _wpCustomizeHeader.data.height
					}),
					new wp.media.controller.Cropper({
						imgSelectOptions: this.calculateImageSelectOptions
					})
				]
			});

			this.frame.on('select', this.onSelect, this);
			this.frame.on('cropped', this.onCropped, this);
			this.frame.on('skippedcrop', this.onSkippedCrop, this);

			this.frame.open();
		},

		/**
		 * After an image is selected in the media modal,
		 * switch to the cropper state.
		 */
		onSelect: function() {
			this.frame.setState('cropper');
		},

		/**
		 * After the image has been cropped, apply the cropped image data to the setting.
		 *
		 * @param {object} croppedImage Cropped attachment data.
		 */
		onCropped: function(croppedImage) {
			var url = croppedImage.url,
				attachmentId = croppedImage.attachment_id,
				w = croppedImage.width,
				h = croppedImage.height;
			this.setImageFromURL(url, attachmentId, w, h);
		},

		/**
		 * If cropping was skipped, apply the image data directly to the setting.
		 *
		 * @param {object} selection
		 */
		onSkippedCrop: function(selection) {
			var url = selection.get('url'),
				w = selection.get('width'),
				h = selection.get('height');
			this.setImageFromURL(url, selection.id, w, h);
		},

		/**
		 * Creates a new wp.customize.HeaderTool.ImageModel from provided
		 * header image data and inserts it into the user-uploaded headers
		 * collection.
		 *
		 * @param {String} url
		 * @param {Number} attachmentId
		 * @param {Number} width
		 * @param {Number} height
		 */
		setImageFromURL: function(url, attachmentId, width, height) {
			var choice, data = {};

			data.url = url;
			data.thumbnail_url = url;
			data.timestamp = _.now();

			if (attachmentId) {
				data.attachment_id = attachmentId;
			}

			if (width) {
				data.width = width;
			}

			if (height) {
				data.height = height;
			}

			choice = new api.HeaderTool.ImageModel({
				header: data,
				choice: url.split('/').pop()
			});
			api.HeaderTool.UploadsList.add(choice);
			api.HeaderTool.currentHeader.set(choice.toJSON());
			choice.save();
			choice.importImage();
		},

		/**
		 * Triggers the necessary events to deselect an image which was set as
		 * the currently selected one.
		 */
		removeImage: function() {
			api.HeaderTool.currentHeader.trigger('hide');
			api.HeaderTool.CombinedList.trigger('control:removeImage');
		}

	});

	/**
	 * wp.customize.ThemeControl
	 *
	 * @constructor
	 * @augments wp.customize.Control
	 * @augments wp.customize.Class
	 */
	api.ThemeControl = api.Control.extend({

		touchDrag: false,
		screenshotRendered: false,

		/**
		 * @since 4.2.0
		 */
		ready: function() {
			var control = this;

			control.container.on( 'touchmove', '.theme', function() {
				control.touchDrag = true;
			});

			// Bind details view trigger.
			control.container.on( 'click keydown touchend', '.theme', function( event ) {
				if ( api.utils.isKeydownButNotEnterEvent( event ) ) {
					return;
				}

				// Bail if the user scrolled on a touch device.
				if ( control.touchDrag === true ) {
					return control.touchDrag = false;
				}

				// Prevent the modal from showing when the user clicks the action button.
				if ( $( event.target ).is( '.theme-actions .button, .update-theme' ) ) {
					return;
				}

				event.preventDefault(); // Keep this AFTER the key filter above
				api.section( control.section() ).showDetails( control.params.theme );
			});

			control.container.on( 'render-screenshot', function() {
				var $screenshot = $( this ).find( 'img' ),
					source = $screenshot.data( 'src' );

				if ( source ) {
					$screenshot.attr( 'src', source );
				}
				control.screenshotRendered = true;
			});
		},

		/**
		 * Show or hide the theme based on the presence of the term in the title, description, tags, and author.
		 *
		 * @since 4.2.0
		 */
		filter: function( term ) {
			var control = this,
				haystack = control.params.theme.name + ' ' +
					control.params.theme.description + ' ' +
					control.params.theme.tags + ' ' +
					control.params.theme.author;
			haystack = haystack.toLowerCase().replace( '-', ' ' );
			if ( -1 !== haystack.search( term ) ) {
				control.activate();
			} else {
				control.deactivate();
			}
		},

		/**
		 * Rerender the theme from its JS template with the installed type.
		 *
		 * @since 4.7.0
		 */
		rerenderAsInstalled: function( installed ) {
			var control = this, section;
			if ( installed ) {
				control.params.theme.type = 'installed';
			} else {
				section = api.section( control.params.section );
				control.params.theme.type = section.params.action;
			}
			control.renderContent(); // replaces existing content
			control.container.trigger( 'render-screenshot' );
		}
	});

	// Change objects contained within the main customize object to Settings.
	api.defaultConstructor = api.Setting;

	// Create the collections for Controls, Sections and Panels.
	api.control = new api.Values({ defaultConstructor: api.Control });
	api.section = new api.Values({ defaultConstructor: api.Section });
	api.panel = new api.Values({ defaultConstructor: api.Panel });

	/**
	 * An object that fetches a preview in the background of the document, which
	 * allows for seamless replacement of an existing preview.
	 *
	 * @class
	 * @augments wp.customize.Messenger
	 * @augments wp.customize.Class
	 * @mixes wp.customize.Events
	 */
	api.PreviewFrame = api.Messenger.extend({
		sensitivity: null, // Will get set to api.settings.timeouts.previewFrameSensitivity.

		/**
		 * Initialize the PreviewFrame.
		 *
		 * @param {object} params.container
		 * @param {object} params.previewUrl
		 * @param {object} params.query
		 * @param {object} options
		 */
		initialize: function( params, options ) {
			var deferred = $.Deferred();

			/*
			 * Make the instance of the PreviewFrame the promise object
			 * so other objects can easily interact with it.
			 */
			deferred.promise( this );

			this.container = params.container;

			$.extend( params, { channel: api.PreviewFrame.uuid() });

			api.Messenger.prototype.initialize.call( this, params, options );

			this.add( 'previewUrl', params.previewUrl );

			this.query = $.extend( params.query || {}, { customize_messenger_channel: this.channel() });

			this.run( deferred );
		},

		/**
		 * Run the preview request.
		 *
		 * @param {object} deferred jQuery Deferred object to be resolved with
		 *                          the request.
		 */
		run: function( deferred ) {
			var previewFrame = this,
				loaded = false,
				ready = false,
				readyData = null,
				hasPendingChangesetUpdate = '{}' !== previewFrame.query.customized,
				urlParser,
				params,
				form;

			if ( previewFrame._ready ) {
				previewFrame.unbind( 'ready', previewFrame._ready );
			}

			previewFrame._ready = function( data ) {
				ready = true;
				readyData = data;
				previewFrame.container.addClass( 'iframe-ready' );
				if ( ! data ) {
					return;
				}

				if ( loaded ) {
					deferred.resolveWith( previewFrame, [ data ] );
				}
			};

			previewFrame.bind( 'ready', previewFrame._ready );

			urlParser = document.createElement( 'a' );
			urlParser.href = previewFrame.previewUrl();

			params = _.extend(
				api.utils.parseQueryString( urlParser.search.substr( 1 ) ),
				{
					customize_changeset_uuid: previewFrame.query.customize_changeset_uuid,
					customize_theme: previewFrame.query.customize_theme,
					customize_messenger_channel: previewFrame.query.customize_messenger_channel
				}
			);

			urlParser.search = $.param( params );
			previewFrame.iframe = $( '<iframe />', {
				title: api.l10n.previewIframeTitle,
				name: 'customize-' + previewFrame.channel()
			} );
			previewFrame.iframe.attr( 'onmousewheel', '' ); // Workaround for Safari bug. See WP Trac #38149.

			if ( ! hasPendingChangesetUpdate ) {
				previewFrame.iframe.attr( 'src', urlParser.href );
			} else {
				previewFrame.iframe.attr( 'data-src', urlParser.href ); // For debugging purposes.
			}

			previewFrame.iframe.appendTo( previewFrame.container );
			previewFrame.targetWindow( previewFrame.iframe[0].contentWindow );

			/*
			 * Submit customized data in POST request to preview frame window since
			 * there are setting value changes not yet written to changeset.
			 */
			if ( hasPendingChangesetUpdate ) {
				form = $( '<form>', {
					action: urlParser.href,
					target: previewFrame.iframe.attr( 'name' ),
					method: 'post',
					hidden: 'hidden'
				} );
				form.append( $( '<input>', {
					type: 'hidden',
					name: '_method',
					value: 'GET'
				} ) );
				_.each( previewFrame.query, function( value, key ) {
					form.append( $( '<input>', {
						type: 'hidden',
						name: key,
						value: value
					} ) );
				} );
				previewFrame.container.append( form );
				form.submit();
				form.remove(); // No need to keep the form around after submitted.
			}

			previewFrame.bind( 'iframe-loading-error', function( error ) {
				previewFrame.iframe.remove();

				// Check if the user is not logged in.
				if ( 0 === error ) {
					previewFrame.login( deferred );
					return;
				}

				// Check for cheaters.
				if ( -1 === error ) {
					deferred.rejectWith( previewFrame, [ 'cheatin' ] );
					return;
				}

				deferred.rejectWith( previewFrame, [ 'request failure' ] );
			} );

			previewFrame.iframe.one( 'load', function() {
				loaded = true;

				if ( ready ) {
					deferred.resolveWith( previewFrame, [ readyData ] );
				} else {
					setTimeout( function() {
						deferred.rejectWith( previewFrame, [ 'ready timeout' ] );
					}, previewFrame.sensitivity );
				}
			});
		},

		login: function( deferred ) {
			var self = this,
				reject;

			reject = function() {
				deferred.rejectWith( self, [ 'logged out' ] );
			};

			if ( this.triedLogin ) {
				return reject();
			}

			// Check if we have an admin cookie.
			$.get( api.settings.url.ajax, {
				action: 'logged-in'
			}).fail( reject ).done( function( response ) {
				var iframe;

				if ( '1' !== response ) {
					reject();
				}

				iframe = $( '<iframe />', { 'src': self.previewUrl(), 'title': api.l10n.previewIframeTitle } ).hide();
				iframe.appendTo( self.container );
				iframe.on( 'load', function() {
					self.triedLogin = true;

					iframe.remove();
					self.run( deferred );
				});
			});
		},

		destroy: function() {
			api.Messenger.prototype.destroy.call( this );

			if ( this.iframe ) {
				this.iframe.remove();
			}

			delete this.iframe;
			delete this.targetWindow;
		}
	});

	(function(){
		var id = 0;
		/**
		 * Return an incremented ID for a preview messenger channel.
		 *
		 * This function is named "uuid" for historical reasons, but it is a
		 * misnomer as it is not an actual UUID, and it is not universally unique.
		 * This is not to be confused with `api.settings.changeset.uuid`.
		 *
		 * @return {string}
		 */
		api.PreviewFrame.uuid = function() {
			return 'preview-' + String( id++ );
		};
	}());

	/**
	 * Set the document title of the customizer.
	 *
	 * @since 4.1.0
	 *
	 * @param {string} documentTitle
	 */
	api.setDocumentTitle = function ( documentTitle ) {
		var tmpl, title;
		tmpl = api.settings.documentTitleTmpl;
		title = tmpl.replace( '%s', documentTitle );
		document.title = title;
		api.trigger( 'title', title );
	};

	/**
	 * @class
	 * @augments wp.customize.Messenger
	 * @augments wp.customize.Class
	 * @mixes wp.customize.Events
	 */
	api.Previewer = api.Messenger.extend({
		refreshBuffer: null, // Will get set to api.settings.timeouts.windowRefresh.

		/**
		 * @param {array}  params.allowedUrls
		 * @param {string} params.container   A selector or jQuery element for the preview
		 *                                    frame to be placed.
		 * @param {string} params.form
		 * @param {string} params.previewUrl  The URL to preview.
		 * @param {object} options
		 */
		initialize: function( params, options ) {
			var previewer = this,
				urlParser = document.createElement( 'a' );

			$.extend( previewer, options || {} );
			previewer.deferred = {
				active: $.Deferred()
			};

			// Debounce to prevent hammering server and then wait for any pending update requests.
			previewer.refresh = _.debounce(
				( function( originalRefresh ) {
					return function() {
						var isProcessingComplete, refreshOnceProcessingComplete;
						isProcessingComplete = function() {
							return 0 === api.state( 'processing' ).get();
						};
						if ( isProcessingComplete() ) {
							originalRefresh.call( previewer );
						} else {
							refreshOnceProcessingComplete = function() {
								if ( isProcessingComplete() ) {
									originalRefresh.call( previewer );
									api.state( 'processing' ).unbind( refreshOnceProcessingComplete );
								}
							};
							api.state( 'processing' ).bind( refreshOnceProcessingComplete );
						}
					};
				}( previewer.refresh ) ),
				previewer.refreshBuffer
			);

			previewer.container   = api.ensure( params.container );
			previewer.allowedUrls = params.allowedUrls;

			params.url = window.location.href;

			api.Messenger.prototype.initialize.call( previewer, params );

			urlParser.href = previewer.origin();
			previewer.add( 'scheme', urlParser.protocol.replace( /:$/, '' ) );

			// Limit the URL to internal, front-end links.
			//
			// If the front end and the admin are served from the same domain, load the
			// preview over ssl if the Customizer is being loaded over ssl. This avoids
			// insecure content warnings. This is not attempted if the admin and front end
			// are on different domains to avoid the case where the front end doesn't have
			// ssl certs.

			previewer.add( 'previewUrl', params.previewUrl ).setter( function( to ) {
				var result, urlParser, newPreviewUrl, schemeMatchingPreviewUrl, queryParams;
				urlParser = document.createElement( 'a' );
				urlParser.href = to;

				// Abort if URL is for admin or (static) files in wp-includes or wp-content.
				if ( /\/wp-(admin|includes|content)(\/|$)/.test( urlParser.pathname ) ) {
					return null;
				}

				// Remove state query params.
				if ( urlParser.search.length > 1 ) {
					queryParams = api.utils.parseQueryString( urlParser.search.substr( 1 ) );
					delete queryParams.customize_changeset_uuid;
					delete queryParams.customize_theme;
					delete queryParams.customize_messenger_channel;
					if ( _.isEmpty( queryParams ) ) {
						urlParser.search = '';
					} else {
						urlParser.search = $.param( queryParams );
					}
				}

				newPreviewUrl = urlParser.href;
				urlParser.protocol = previewer.scheme.get() + ':';
				schemeMatchingPreviewUrl = urlParser.href;

				// Attempt to match the URL to the control frame's scheme
				// and check if it's allowed. If not, try the original URL.
				$.each( [ schemeMatchingPreviewUrl, newPreviewUrl ], function( i, url ) {
					$.each( previewer.allowedUrls, function( i, allowed ) {
						var path;

						allowed = allowed.replace( /\/+$/, '' );
						path = url.replace( allowed, '' );

						if ( 0 === url.indexOf( allowed ) && /^([/#?]|$)/.test( path ) ) {
							result = url;
							return false;
						}
					});
					if ( result ) {
						return false;
					}
				});

				// If we found a matching result, return it. If not, bail.
				return result ? result : null;
			});

			previewer.bind( 'ready', previewer.ready );

			// Start listening for keep-alive messages when iframe first loads.
			previewer.deferred.active.done( _.bind( previewer.keepPreviewAlive, previewer ) );

			previewer.bind( 'synced', function() {
				previewer.send( 'active' );
			} );

			// Refresh the preview when the URL is changed (but not yet).
			previewer.previewUrl.bind( previewer.refresh );

			previewer.scroll = 0;
			previewer.bind( 'scroll', function( distance ) {
				previewer.scroll = distance;
			});

			// Update the URL when the iframe sends a URL message, resetting scroll position. If URL is unchanged, then refresh.
			previewer.bind( 'url', function( url ) {
				var onUrlChange, urlChanged = false;
				previewer.scroll = 0;
				onUrlChange = function() {
					urlChanged = true;
				};
				previewer.previewUrl.bind( onUrlChange );
				previewer.previewUrl.set( url );
				previewer.previewUrl.unbind( onUrlChange );
				if ( ! urlChanged ) {
					previewer.refresh();
				}
			} );

			// Update the document title when the preview changes.
			previewer.bind( 'documentTitle', function ( title ) {
				api.setDocumentTitle( title );
			} );
		},

		/**
		 * Handle the preview receiving the ready message.
		 *
		 * @since 4.7.0
		 *
		 * @param {object} data - Data from preview.
		 * @param {string} data.currentUrl - Current URL.
		 * @param {object} data.activePanels - Active panels.
		 * @param {object} data.activeSections Active sections.
		 * @param {object} data.activeControls Active controls.
		 * @returns {void}
		 */
		ready: function( data ) {
			var previewer = this, synced = {}, constructs;

			synced.settings = api.get();
			if ( 'resolved' !== previewer.deferred.active.state() || previewer.loading ) {
				synced.scroll = previewer.scroll;
			}
			previewer.send( 'sync', synced );

			// Set the previewUrl without causing the url to set the iframe.
			if ( data.currentUrl ) {
				previewer.previewUrl.unbind( previewer.refresh );
				previewer.previewUrl.set( data.currentUrl );
				previewer.previewUrl.bind( previewer.refresh );
			}

			/*
			 * Walk over all panels, sections, and controls and set their
			 * respective active states to true if the preview explicitly
			 * indicates as such.
			 */
			constructs = {
				panel: data.activePanels,
				section: data.activeSections,
				control: data.activeControls
			};
			_( constructs ).each( function ( activeConstructs, type ) {
				api[ type ].each( function ( construct, id ) {
					var isDynamicallyCreated = _.isUndefined( api.settings[ type + 's' ][ id ] );

					/*
					 * If the construct was created statically in PHP (not dynamically in JS)
					 * then consider a missing (undefined) value in the activeConstructs to
					 * mean it should be deactivated (since it is gone). But if it is
					 * dynamically created then only toggle activation if the value is defined,
					 * as this means that the construct was also then correspondingly
					 * created statically in PHP and the active callback is available.
					 * Otherwise, dynamically-created constructs should normally have
					 * their active states toggled in JS rather than from PHP.
					 */
					if ( ! isDynamicallyCreated || ! _.isUndefined( activeConstructs[ id ] ) ) {
						if ( activeConstructs[ id ] ) {
							construct.activate();
						} else {
							construct.deactivate();
						}
					}
				} );
			} );

			if ( data.settingValidities ) {
				api._handleSettingValidities( {
					settingValidities: data.settingValidities,
					focusInvalidControl: false
				} );
			}
		},

		/**
		 * Keep the preview alive by listening for ready and keep-alive messages.
		 *
		 * If a message is not received in the allotted time then the iframe will be set back to the last known valid URL.
		 *
		 * @since 4.7.0
		 *
		 * @returns {void}
		 */
		keepPreviewAlive: function keepPreviewAlive() {
			var previewer = this, keepAliveTick, timeoutId, handleMissingKeepAlive, scheduleKeepAliveCheck;

			/**
			 * Schedule a preview keep-alive check.
			 *
			 * Note that if a page load takes longer than keepAliveCheck milliseconds,
			 * the keep-alive messages will still be getting sent from the previous
			 * URL.
			 */
			scheduleKeepAliveCheck = function() {
				timeoutId = setTimeout( handleMissingKeepAlive, api.settings.timeouts.keepAliveCheck );
			};

			/**
			 * Set the previewerAlive state to true when receiving a message from the preview.
			 */
			keepAliveTick = function() {
				api.state( 'previewerAlive' ).set( true );
				clearTimeout( timeoutId );
				scheduleKeepAliveCheck();
			};

			/**
			 * Set the previewerAlive state to false if keepAliveCheck milliseconds have transpired without a message.
			 *
			 * This is most likely to happen in the case of a connectivity error, or if the theme causes the browser
			 * to navigate to a non-allowed URL. Setting this state to false will force settings with a postMessage
			 * transport to use refresh instead, causing the preview frame also to be replaced with the current
			 * allowed preview URL.
			 */
			handleMissingKeepAlive = function() {
				api.state( 'previewerAlive' ).set( false );
			};
			scheduleKeepAliveCheck();

			previewer.bind( 'ready', keepAliveTick );
			previewer.bind( 'keep-alive', keepAliveTick );
		},

		/**
		 * Query string data sent with each preview request.
		 *
		 * @abstract
		 */
		query: function() {},

		abort: function() {
			if ( this.loading ) {
				this.loading.destroy();
				delete this.loading;
			}
		},

		/**
		 * Refresh the preview seamlessly.
		 */
		refresh: function() {
			var previewer = this;

			// Display loading indicator
			previewer.send( 'loading-initiated' );

			previewer.abort();

			previewer.loading = new api.PreviewFrame({
				url:        previewer.url(),
				previewUrl: previewer.previewUrl(),
				query:      previewer.query( { excludeCustomizedSaved: true } ) || {},
				container:  previewer.container
			});

			previewer.loading.done( function( readyData ) {
				var loadingFrame = this, previousPreview, onceSynced;

				previousPreview = previewer.preview;
				previewer.preview = loadingFrame;
				previewer.targetWindow( loadingFrame.targetWindow() );
				previewer.channel( loadingFrame.channel() );

				onceSynced = function() {
					loadingFrame.unbind( 'synced', onceSynced );
					if ( previousPreview ) {
						previousPreview.destroy();
					}
					previewer.deferred.active.resolve();
					delete previewer.loading;
				};
				loadingFrame.bind( 'synced', onceSynced );

				// This event will be received directly by the previewer in normal navigation; this is only needed for seamless refresh.
				previewer.trigger( 'ready', readyData );
			});

			previewer.loading.fail( function( reason ) {
				previewer.send( 'loading-failed' );

				if ( 'logged out' === reason ) {
					if ( previewer.preview ) {
						previewer.preview.destroy();
						delete previewer.preview;
					}

					previewer.login().done( previewer.refresh );
				}

				if ( 'cheatin' === reason ) {
					previewer.cheatin();
				}
			});
		},

		login: function() {
			var previewer = this,
				deferred, messenger, iframe;

			if ( this._login )
				return this._login;

			deferred = $.Deferred();
			this._login = deferred.promise();

			messenger = new api.Messenger({
				channel: 'login',
				url:     api.settings.url.login
			});

			iframe = $( '<iframe />', { 'src': api.settings.url.login, 'title': api.l10n.loginIframeTitle } ).appendTo( this.container );

			messenger.targetWindow( iframe[0].contentWindow );

			messenger.bind( 'login', function () {
				var refreshNonces = previewer.refreshNonces();

				refreshNonces.always( function() {
					iframe.remove();
					messenger.destroy();
					delete previewer._login;
				});

				refreshNonces.done( function() {
					deferred.resolve();
				});

				refreshNonces.fail( function() {
					previewer.cheatin();
					deferred.reject();
				});
			});

			return this._login;
		},

		cheatin: function() {
			$( document.body ).empty().addClass( 'cheatin' ).append(
				'<h1>' + api.l10n.cheatin + '</h1>' +
				'<p>' + api.l10n.notAllowed + '</p>'
			);
		},

		refreshNonces: function() {
			var request, deferred = $.Deferred();

			deferred.promise();

			request = wp.ajax.post( 'customize_refresh_nonces', {
				wp_customize: 'on',
				customize_theme: api.settings.theme.stylesheet
			});

			request.done( function( response ) {
				api.trigger( 'nonce-refresh', response );
				deferred.resolve();
			});

			request.fail( function() {
				deferred.reject();
			});

			return deferred;
		}
	});

	api.settingConstructor = {};
	api.controlConstructor = {
		color:         api.ColorControl,
		media:         api.MediaControl,
		upload:        api.UploadControl,
		image:         api.ImageControl,
		cropped_image: api.CroppedImageControl,
		site_icon:     api.SiteIconControl,
		header:        api.HeaderControl,
		background:    api.BackgroundControl,
		theme:         api.ThemeControl
	};
	api.panelConstructor = {
		themes: api.ThemesPanel
	};
	api.sectionConstructor = {
		themes: api.ThemesSection
	};

	/**
	 * Handle setting_validities in an error response for the customize-save request.
	 *
	 * Add notifications to the settings and focus on the first control that has an invalid setting.
	 *
	 * @since 4.6.0
	 * @private
	 *
	 * @param {object}  args
	 * @param {object}  args.settingValidities
	 * @param {boolean} [args.focusInvalidControl=false]
	 * @returns {void}
	 */
	api._handleSettingValidities = function handleSettingValidities( args ) {
		var invalidSettingControls, invalidSettings = [], wasFocused = false;

		// Find the controls that correspond to each invalid setting.
		_.each( args.settingValidities, function( validity, settingId ) {
			var setting = api( settingId );
			if ( setting ) {

				// Add notifications for invalidities.
				if ( _.isObject( validity ) ) {
					_.each( validity, function( params, code ) {
						var notification, existingNotification, needsReplacement = false;
						notification = new api.Notification( code, _.extend( { fromServer: true }, params ) );

						// Remove existing notification if already exists for code but differs in parameters.
						existingNotification = setting.notifications( notification.code );
						if ( existingNotification ) {
							needsReplacement = notification.type !== existingNotification.type || notification.message !== existingNotification.message || ! _.isEqual( notification.data, existingNotification.data );
						}
						if ( needsReplacement ) {
							setting.notifications.remove( code );
						}

						if ( ! setting.notifications.has( notification.code ) ) {
							setting.notifications.add( code, notification );
						}
						invalidSettings.push( setting.id );
					} );
				}

				// Remove notification errors that are no longer valid.
				setting.notifications.each( function( notification ) {
					if ( 'error' === notification.type && ( true === validity || ! validity[ notification.code ] ) ) {
						setting.notifications.remove( notification.code );
					}
				} );
			}
		} );

		if ( args.focusInvalidControl ) {
			invalidSettingControls = api.findControlsForSettings( invalidSettings );

			// Focus on the first control that is inside of an expanded section (one that is visible).
			_( _.values( invalidSettingControls ) ).find( function( controls ) {
				return _( controls ).find( function( control ) {
					var isExpanded = control.section() && api.section.has( control.section() ) && api.section( control.section() ).expanded();
					if ( isExpanded && control.expanded ) {
						isExpanded = control.expanded();
					}
					if ( isExpanded ) {
						control.focus();
						wasFocused = true;
					}
					return wasFocused;
				} );
			} );

			// Focus on the first invalid control.
			if ( ! wasFocused && ! _.isEmpty( invalidSettingControls ) ) {
				_.values( invalidSettingControls )[0][0].focus();
			}
		}
	};

	/**
	 * Find all controls associated with the given settings.
	 *
	 * @since 4.6.0
	 * @param {string[]} settingIds Setting IDs.
	 * @returns {object<string, wp.customize.Control>} Mapping setting ids to arrays of controls.
	 */
	api.findControlsForSettings = function findControlsForSettings( settingIds ) {
		var controls = {}, settingControls;
		_.each( _.unique( settingIds ), function( settingId ) {
			var setting = api( settingId );
			if ( setting ) {
				settingControls = setting.findControls();
				if ( settingControls && settingControls.length > 0 ) {
					controls[ settingId ] = settingControls;
				}
			}
		} );
		return controls;
	};

	/**
	 * Sort panels, sections, controls by priorities. Hide empty sections and panels.
	 *
	 * @since 4.1.0
	 */
	api.reflowPaneContents = _.bind( function () {

		var appendContainer, activeElement, rootHeadContainers, rootNodes = [], wasReflowed = false;

		if ( document.activeElement ) {
			activeElement = $( document.activeElement );
		}

		// Sort the sections within each panel
		api.panel.each( function ( panel ) {
			if ( 'themes' === panel.id ) {
				return; // Don't reflow theme sections, as doing so moves them after the themes container.
			}
			
			var sections = panel.sections(),
				sectionHeadContainers = _.pluck( sections, 'headContainer' );
			rootNodes.push( panel );
			appendContainer = ( panel.contentContainer.is( 'ul' ) ) ? panel.contentContainer : panel.contentContainer.find( 'ul:first' );
			if ( ! api.utils.areElementListsEqual( sectionHeadContainers, appendContainer.children( '[id]' ) ) ) {
				_( sections ).each( function ( section ) {
					appendContainer.append( section.headContainer );
				} );
				wasReflowed = true;
			}
		} );

		// Sort the controls within each section
		api.section.each( function ( section ) {
			var controls = section.controls(),
				controlContainers = _.pluck( controls, 'container' );
			if ( ! section.panel() ) {
				rootNodes.push( section );
			}
			appendContainer = ( section.contentContainer.is( 'ul' ) ) ? section.contentContainer : section.contentContainer.find( 'ul:first' );
			if ( ! api.utils.areElementListsEqual( controlContainers, appendContainer.children( '[id]' ) ) ) {
				_( controls ).each( function ( control ) {
					appendContainer.append( control.container );
				} );
				wasReflowed = true;
			}
		} );

		// Sort the root panels and sections
		rootNodes.sort( api.utils.prioritySort );
		rootHeadContainers = _.pluck( rootNodes, 'headContainer' );
		appendContainer = $( '#customize-theme-controls .customize-pane-parent' ); // @todo This should be defined elsewhere, and to be configurable
		if ( ! api.utils.areElementListsEqual( rootHeadContainers, appendContainer.children() ) ) {
			_( rootNodes ).each( function ( rootNode ) {
				appendContainer.append( rootNode.headContainer );
			} );
			wasReflowed = true;
		}

		// Now re-trigger the active Value callbacks to that the panels and sections can decide whether they can be rendered
		api.panel.each( function ( panel ) {
			var value = panel.active();
			panel.active.callbacks.fireWith( panel.active, [ value, value ] );
		} );
		api.section.each( function ( section ) {
			var value = section.active();
			section.active.callbacks.fireWith( section.active, [ value, value ] );
		} );

		// Restore focus if there was a reflow and there was an active (focused) element
		if ( wasReflowed && activeElement ) {
			activeElement.focus();
		}
		api.trigger( 'pane-contents-reflowed' );
	}, api );

	$( function() {
		api.settings = window._wpCustomizeSettings;
		api.l10n = window._wpCustomizeControlsL10n;

		// Check if we can run the Customizer.
		if ( ! api.settings ) {
			return;
		}

		// Bail if any incompatibilities are found.
		if ( ! $.support.postMessage || ( ! $.support.cors && api.settings.isCrossDomain ) ) {
			return;
		}

		if ( null === api.PreviewFrame.prototype.sensitivity ) {
			api.PreviewFrame.prototype.sensitivity = api.settings.timeouts.previewFrameSensitivity;
		}
		if ( null === api.Previewer.prototype.refreshBuffer ) {
			api.Previewer.prototype.refreshBuffer = api.settings.timeouts.windowRefresh;
		}

		var parent,
			body = $( document.body ),
			overlay = body.children( '.wp-full-overlay' ),
			title = $( '#customize-info .panel-title.site-title' ),
			closeBtn = $( '.customize-controls-close' ),
			saveBtn = $( '#save' ),
			footerActions = $( '#customize-footer-actions' );

		// Prevent the form from saving when enter is pressed on an input or select element.
		$('#customize-controls').on( 'keydown', function( e ) {
			var isEnter = ( 13 === e.which ),
				$el = $( e.target );

			if ( isEnter && ( $el.is( 'input:not([type=button])' ) || $el.is( 'select' ) ) ) {
				e.preventDefault();
			}
		});

		// Expand/Collapse the main customizer customize info.
		$( '.customize-info' ).find( '> .accordion-section-title .customize-help-toggle' ).on( 'click', function() {
			var section = $( this ).closest( '.accordion-section' ),
				content = section.find( '.customize-panel-description:first' );

			if ( section.hasClass( 'cannot-expand' ) ) {
				return;
			}

			if ( section.hasClass( 'open' ) ) {
				section.toggleClass( 'open' );
				content.slideUp( api.Panel.prototype.defaultExpandedArguments.duration );
				$( this ).attr( 'aria-expanded', false );
			} else {
				content.slideDown( api.Panel.prototype.defaultExpandedArguments.duration );
				section.toggleClass( 'open' );
				$( this ).attr( 'aria-expanded', true );
			}
		});

		// Initialize Previewer
		api.previewer = new api.Previewer({
			container:   '#customize-preview',
			form:        '#customize-controls',
			previewUrl:  api.settings.url.preview,
			allowedUrls: api.settings.url.allowed
		}, {

			nonce: api.settings.nonce,

			/**
			 * Build the query to send along with the Preview request.
			 *
			 * @since 4.7.0 Added options param.
			 *
			 * @param {object}  [options] Options.
			 * @param {boolean} [options.excludeCustomizedSaved=false] Exclude saved settings in customized response (values pending writing to changeset).
			 * @return {object} Query vars.
			 */
			query: function( options ) {
				var queryVars = {
					wp_customize: 'on',
					customize_theme: api.settings.theme.stylesheet,
					nonce: this.nonce.preview,
					customize_changeset_uuid: api.settings.changeset.uuid
				};

				/*
				 * Exclude customized data if requested especially for calls to requestChangesetUpdate.
				 * Changeset updates are differential and so it is a performance waste to send all of
				 * the dirty settings with each update.
				 */
				queryVars.customized = JSON.stringify( api.dirtyValues( {
					unsaved: options && options.excludeCustomizedSaved
				} ) );

				return queryVars;
			},

			/**
			 * Save (and publish) the customizer changeset.
			 *
			 * Updates to the changeset are transactional. If any of the settings
			 * are invalid then none of them will be written into the changeset.
			 * A revision will be made for the changeset post if revisions support
			 * has been added to the post type.
			 *
			 * @param {object} [args] Args.
			 * @param {string} [args.status=publish] Status.
			 * @param {string} [args.date] Date, in local time in MySQL format.
			 * @param {string} [args.title] Title
			 *
			 * @returns {jQuery.promise}
			 */
			save: function( args ) {
				var previewer = this,
					deferred = $.Deferred(),
					changesetStatus = 'publish',
					processing = api.state( 'processing' ),
					submitWhenDoneProcessing,
					submit,
					modifiedWhileSaving = {},
					invalidSettings = [],
					invalidControls;

				if ( args && args.status ) {
					changesetStatus = args.status;
				}

				if ( api.state( 'saving' ).get() ) {
					deferred.reject( 'already_saving' );
					deferred.promise();
				}

				api.state( 'saving' ).set( true );

				function captureSettingModifiedDuringSave( setting ) {
					modifiedWhileSaving[ setting.id ] = true;
				}
				api.bind( 'change', captureSettingModifiedDuringSave );

				submit = function () {
					var request, query, settingInvalidities = {};

					/*
					 * Block saving if there are any settings that are marked as
					 * invalid from the client (not from the server). Focus on
					 * the control.
					 */
					api.each( function( setting ) {
						setting.notifications.each( function( notification ) {
							if ( 'error' === notification.type && ! notification.fromServer ) {
								invalidSettings.push( setting.id );
								if ( ! settingInvalidities[ setting.id ] ) {
									settingInvalidities[ setting.id ] = {};
								}
								settingInvalidities[ setting.id ][ notification.code ] = notification;
							}
						} );
					} );
					invalidControls = api.findControlsForSettings( invalidSettings );
					if ( ! _.isEmpty( invalidControls ) ) {
						_.values( invalidControls )[0][0].focus();
						api.unbind( 'change', captureSettingModifiedDuringSave );
						deferred.rejectWith( previewer, [
							{ setting_invalidities: settingInvalidities }
						] );
						api.state( 'saving' ).set( false );
						return deferred.promise();
					}

					/*
					 * Note that excludeCustomizedSaved is intentionally false so that the entire
					 * set of customized data will be included if bypassed changeset update.
					 */
					query = $.extend( previewer.query( { excludeCustomizedSaved: false } ), {
						nonce: previewer.nonce.save,
						customize_changeset_status: changesetStatus
					} );
					if ( args && args.date ) {
						query.customize_changeset_date = args.date;
					}
					if ( args && args.title ) {
						query.customize_changeset_title = args.title;
					}

					/*
					 * Note that the dirty customized values will have already been set in the
					 * changeset and so technically query.customized could be deleted. However,
					 * it is remaining here to make sure that any settings that got updated
					 * quietly which may have not triggered an update request will also get
					 * included in the values that get saved to the changeset. This will ensure
					 * that values that get injected via the saved event will be included in
					 * the changeset. This also ensures that setting values that were invalid
					 * will get re-validated, perhaps in the case of settings that are invalid
					 * due to dependencies on other settings.
					 */
					request = wp.ajax.post( 'customize_save', query );

					// Disable save button during the save request.
					saveBtn.prop( 'disabled', true );

					api.trigger( 'save', request );

					request.always( function () {
						api.state( 'saving' ).set( false );
						saveBtn.prop( 'disabled', false );
						api.unbind( 'change', captureSettingModifiedDuringSave );
					} );

					request.fail( function ( response ) {

						if ( '0' === response ) {
							response = 'not_logged_in';
						} else if ( '-1' === response ) {
							// Back-compat in case any other check_ajax_referer() call is dying
							response = 'invalid_nonce';
						}

						if ( 'invalid_nonce' === response ) {
							previewer.cheatin();
						} else if ( 'not_logged_in' === response ) {
							previewer.preview.iframe.hide();
							previewer.login().done( function() {
								previewer.save();
								previewer.preview.iframe.show();
							} );
						}

						if ( response.setting_validities ) {
							api._handleSettingValidities( {
								settingValidities: response.setting_validities,
								focusInvalidControl: true
							} );
						}

						deferred.rejectWith( previewer, [ response ] );
						api.trigger( 'error', response );
					} );

					request.done( function( response ) {

						previewer.send( 'saved', response );

						api.state( 'changesetStatus' ).set( response.changeset_status );
						if ( 'publish' === response.changeset_status ) {
							api.state( 'changesetStatus' ).set( '' );
							api.settings.changeset.uuid = response.next_changeset_uuid;
							parent.send( 'changeset-uuid', api.settings.changeset.uuid );
						}

						if ( response.setting_validities ) {
							api._handleSettingValidities( {
								settingValidities: response.setting_validities,
								focusInvalidControl: true
							} );
						}

						deferred.resolveWith( previewer, [ response ] );
						api.trigger( 'saved', response );

						// Restore the global dirty state if any settings were modified during save.
						if ( ! _.isEmpty( modifiedWhileSaving ) ) {
							api.state( 'saved' ).set( false );
						}
					} );
				};

				if ( 0 === processing() ) {
					submit();
				} else {
					submitWhenDoneProcessing = function () {
						if ( 0 === processing() ) {
							api.state.unbind( 'change', submitWhenDoneProcessing );
							submit();
						}
					};
					api.state.bind( 'change', submitWhenDoneProcessing );
				}

				return deferred.promise();
			}
		});

		// Refresh the nonces if the preview sends updated nonces over.
		api.previewer.bind( 'nonce', function( nonce ) {
			$.extend( this.nonce, nonce );
		});

		// Refresh the nonces if login sends updated nonces over.
		api.bind( 'nonce-refresh', function( nonce ) {
			$.extend( api.settings.nonce, nonce );
			$.extend( api.previewer.nonce, nonce );
			api.previewer.send( 'nonce-refresh', nonce );
		});

		// Create Settings
		$.each( api.settings.settings, function( id, data ) {
			var constructor = api.settingConstructor[ data.type ] || api.Setting,
				setting;

			setting = new constructor( id, data.value, {
				transport: data.transport,
				previewer: api.previewer,
				dirty: !! data.dirty
			} );
			api.add( id, setting );
		});

		// Create Panels
		$.each( api.settings.panels, function ( id, data ) {
			var constructor = api.panelConstructor[ data.type ] || api.Panel,
				panel;

			panel = new constructor( id, {
				params: data
			} );
			api.panel.add( id, panel );
		});

		// Create Sections
		$.each( api.settings.sections, function ( id, data ) {
			var constructor = api.sectionConstructor[ data.type ] || api.Section,
				section;

			section = new constructor( id, {
				params: data
			} );
			api.section.add( id, section );
		});

		// Create Controls
		$.each( api.settings.controls, function( id, data ) {
			var constructor = api.controlConstructor[ data.type ] || api.Control,
				control;

			control = new constructor( id, {
				params: data,
				previewer: api.previewer
			} );
			api.control.add( id, control );
		});

		// Focus the autofocused element
		_.each( [ 'panel', 'section', 'control' ], function( type ) {
			var id = api.settings.autofocus[ type ];
			if ( ! id ) {
				return;
			}

			/*
			 * Defer focus until:
			 * 1. The panel, section, or control exists (especially for dynamically-created ones).
			 * 2. The instance is embedded in the document (and so is focusable).
			 * 3. The preview has finished loading so that the active states have been set.
			 */
			api[ type ]( id, function( instance ) {
				instance.deferred.embedded.done( function() {
					api.previewer.deferred.active.done( function() {
						instance.focus();
					});
				});
			});
		});

		api.bind( 'ready', api.reflowPaneContents );
		$( [ api.panel, api.section, api.control ] ).each( function ( i, values ) {
			var debouncedReflowPaneContents = _.debounce( api.reflowPaneContents, api.settings.timeouts.reflowPaneContents );
			values.bind( 'add', debouncedReflowPaneContents );
			values.bind( 'change', debouncedReflowPaneContents );
			values.bind( 'remove', debouncedReflowPaneContents );
		} );

		// Save and activated states
		(function() {
			var state = new api.Values(),
				saved = state.create( 'saved' ),
				saving = state.create( 'saving' ),
				activated = state.create( 'activated' ),
				processing = state.create( 'processing' ),
				paneVisible = state.create( 'paneVisible' ),
				changesetStatus = state.create( 'changesetStatus' ),
				previewerAlive = state.create( 'previewerAlive' ),
				populateChangesetUuidParam;

			state.bind( 'change', function() {
				var canSave;

				if ( ! activated() ) {
					saveBtn.val( api.l10n.activate );
					closeBtn.find( '.screen-reader-text' ).text( api.l10n.cancel );

				} else if ( '' === changesetStatus.get() && saved() ) {
					saveBtn.val( api.l10n.saved );
					closeBtn.find( '.screen-reader-text' ).text( api.l10n.close );

				} else {
					saveBtn.val( api.l10n.save );
					closeBtn.find( '.screen-reader-text' ).text( api.l10n.cancel );
				}

				/*
				 * Save (publish) button should be enabled if saving is not currently happening,
				 * and if the theme is not active or the changeset exists but is not published.
				 */
				canSave = ! saving() && ( ! activated() || ! saved() || ( '' !== changesetStatus() && 'publish' !== changesetStatus() ) );

				saveBtn.prop( 'disabled', ! canSave );
			});

			// Set default states.
			saved( true );
			saving( false );
			activated( api.settings.theme.active );
			processing( 0 );
			paneVisible( true );
			previewerAlive( true );
			changesetStatus( api.settings.changeset.status );

			api.bind( 'change', function() {
				state('saved').set( false );
			});

			saving.bind( function( isSaving ) {
				body.toggleClass( 'saving', isSaving );
			} );

			api.bind( 'saved', function( response ) {
				state('saved').set( true );
				if ( 'publish' === response.changeset_status ) {
					state( 'activated' ).set( true );
				}
			});

			activated.bind( function( to ) {
				if ( to ) {
					api.trigger( 'activated' );
				}
			});

			populateChangesetUuidParam = function( isIncluded ) {
				var urlParser, queryParams;
				urlParser = document.createElement( 'a' );
				urlParser.href = location.href;
				queryParams = api.utils.parseQueryString( urlParser.search.substr( 1 ) );
				if ( isIncluded ) {
					if ( queryParams.changeset_uuid === api.settings.changeset.uuid ) {
						return;
					}
					queryParams.changeset_uuid = api.settings.changeset.uuid;
				} else {
					if ( ! queryParams.changeset_uuid ) {
						return;
					}
					delete queryParams.changeset_uuid;
				}
				urlParser.search = $.param( queryParams );
				history.replaceState( {}, document.title, urlParser.href );
			};

			if ( history.replaceState ) {
				saved.bind( function( isSaved ) {
					if ( ! isSaved ) {
						populateChangesetUuidParam( true );
					}
				} );
				changesetStatus.bind( function( newStatus ) {
					populateChangesetUuidParam( '' !== newStatus );
				} );
			}

			// Expose states to the API.
			api.state = state;
		}());

		// Check if preview url is valid and load the preview frame.
		if ( api.previewer.previewUrl() ) {
			api.previewer.refresh();
		} else {
			api.previewer.previewUrl( api.settings.url.home );
		}

		// Button bindings.
		saveBtn.click( function( event ) {
			api.previewer.save();
			event.preventDefault();
		}).keydown( function( event ) {
			if ( 9 === event.which ) // tab
				return;
			if ( 13 === event.which ) // enter
				api.previewer.save();
			event.preventDefault();
		});

		closeBtn.keydown( function( event ) {
			if ( 9 === event.which ) // tab
				return;
			if ( 13 === event.which ) // enter
				this.click();
			event.preventDefault();
		});

		$( '.collapse-sidebar' ).on( 'click', function() {
			api.state( 'paneVisible' ).set( ! api.state( 'paneVisible' ).get() );
		});

		api.state( 'paneVisible' ).bind( function( paneVisible ) {
			overlay.toggleClass( 'expanded', paneVisible );
			overlay.toggleClass( 'collapsed', ! paneVisible );

			if ( ! paneVisible ) {
				$( '.collapse-sidebar' ).attr({ 'aria-expanded': 'false', 'aria-label': api.l10n.expandSidebar });
			} else {
				$( '.collapse-sidebar' ).attr({ 'aria-expanded': 'true', 'aria-label': api.l10n.collapseSidebar });
			}
		});

		// Keyboard shortcuts - esc to exit section/panel.
		$( 'body' ).on( 'keydown', function( event ) {
			var collapsedObject, expandedControls = [], expandedSections = [], expandedPanels = [];

			if ( 27 !== event.which ) { // Esc.
				return;
			}

			// Check for expanded expandable controls (e.g. widgets and nav menus items), sections, and panels.
			api.control.each( function( control ) {
				if ( control.expanded && control.expanded() && _.isFunction( control.collapse ) ) {
					expandedControls.push( control );
				}
			});
			api.section.each( function( section ) {
				if ( section.expanded() ) {
					expandedSections.push( section );
				}
			});
			api.panel.each( function( panel ) {
				if ( panel.expanded() ) {
					expandedPanels.push( panel );
				}
			});

			// Skip collapsing expanded controls if there are no expanded sections.
			if ( expandedControls.length > 0 && 0 === expandedSections.length ) {
				expandedControls.length = 0;
			}

			// Collapse the most granular expanded object.
			collapsedObject = expandedControls[0] || expandedSections[0] || expandedPanels[0];
			if ( collapsedObject ) {
				if ( 'themes' === collapsedObject.params.type ) {
					// Themes panel or section.
					if ( $( 'body' ).hasClass( 'modal-open' ) ) {
						collapsedObject.closeDetails();
					} else {
						// If we're collapsing a section, collapse the panel also.
						wp.customize.panel( 'themes' ).collapse();
					}
					return;
				}
				collapsedObject.collapse();
				event.preventDefault();
			}
		});

		$( '.customize-controls-preview-toggle' ).on( 'click', function() {
			overlay.toggleClass( 'preview-only' );
		});

		// Previewed device bindings.
		api.previewedDevice = new api.Value();

		// Set the default device.
		api.bind( 'ready', function() {
			_.find( api.settings.previewableDevices, function( value, key ) {
				if ( true === value['default'] ) {
					api.previewedDevice.set( key );
					return true;
				}
			} );
		} );

		// Set the toggled device.
		footerActions.find( '.devices button' ).on( 'click', function( event ) {
			api.previewedDevice.set( $( event.currentTarget ).data( 'device' ) );
		});

		// Bind device changes.
		api.previewedDevice.bind( function( newDevice ) {
			var overlay = $( '.wp-full-overlay' ),
				devices = '';

			footerActions.find( '.devices button' )
				.removeClass( 'active' )
				.attr( 'aria-pressed', false );

			footerActions.find( '.devices .preview-' + newDevice )
				.addClass( 'active' )
				.attr( 'aria-pressed', true );

			$.each( api.settings.previewableDevices, function( device ) {
				devices += ' preview-' + device;
			} );

			overlay
				.removeClass( devices )
				.addClass( 'preview-' + newDevice );
		} );

		// Bind site title display to the corresponding field.
		if ( title.length ) {
			api( 'blogname', function( setting ) {
				var updateTitle = function() {
					title.text( $.trim( setting() ) || api.l10n.untitledBlogName );
				};
				setting.bind( updateTitle );
				updateTitle();
			} );
		}

		/*
		 * Create a postMessage connection with a parent frame,
		 * in case the Customizer frame was opened with the Customize loader.
		 *
		 * @see wp.customize.Loader
		 */
		parent = new api.Messenger({
			url: api.settings.url.parent,
			channel: 'loader'
		});

		/*
		 * If we receive a 'back' event, we're inside an iframe.
		 * Send any clicks to the 'Return' link to the parent page.
		 */
		parent.bind( 'back', function() {
			closeBtn.on( 'click.customize-controls-close', function( event ) {
				event.preventDefault();
				parent.send( 'close' );
			});
		});

		// Prompt user with AYS dialog if leaving the Customizer with unsaved changes
		$( window ).on( 'beforeunload.customize-confirm', function () {
			if ( ! api.state( 'saved' )() ) {
				setTimeout( function() {
					overlay.removeClass( 'customize-loading' );
				}, 1 );
				return api.l10n.saveAlert;
			}
		} );

		// Pass events through to the parent.
		$.each( [ 'saved', 'change' ], function ( i, event ) {
			api.bind( event, function() {
				parent.send( event );
			});
		} );

		// Pass titles to the parent
		api.bind( 'title', function( newTitle ) {
			parent.send( 'title', newTitle );
		});

		parent.send( 'changeset-uuid', api.settings.changeset.uuid );

		// Initialize the connection with the parent frame.
		parent.send( 'ready' );

		// Control visibility for default controls
		$.each({
			'background_image': {
				controls: [ 'background_repeat', 'background_position_x', 'background_attachment' ],
				callback: function( to ) { return !! to; }
			},
			'show_on_front': {
				controls: [ 'page_on_front', 'page_for_posts' ],
				callback: function( to ) { return 'page' === to; }
			},
			'header_textcolor': {
				controls: [ 'header_textcolor' ],
				callback: function( to ) { return 'blank' !== to; }
			}
		}, function( settingId, o ) {
			api( settingId, function( setting ) {
				$.each( o.controls, function( i, controlId ) {
					api.control( controlId, function( control ) {
						var visibility = function( to ) {
							control.container.toggle( o.callback( to ) );
						};

						visibility( setting.get() );
						setting.bind( visibility );
					});
				});
			});
		});

		// Juggle the two controls that use header_textcolor
		api.control( 'display_header_text', function( control ) {
			var last = '';

			control.elements[0].unsync( api( 'header_textcolor' ) );

			control.element = new api.Element( control.container.find('input') );
			control.element.set( 'blank' !== control.setting() );

			control.element.bind( function( to ) {
				if ( ! to )
					last = api( 'header_textcolor' ).get();

				control.setting.set( to ? last : 'blank' );
			});

			control.setting.bind( function( to ) {
				control.element.set( 'blank' !== to );
			});
		});

		// Change previewed URL to the homepage when changing the page_on_front.
		api( 'show_on_front', 'page_on_front', function( showOnFront, pageOnFront ) {
			var updatePreviewUrl = function() {
				if ( showOnFront() === 'page' && parseInt( pageOnFront(), 10 ) > 0 ) {
					api.previewer.previewUrl.set( api.settings.url.home );
				}
			};
			showOnFront.bind( updatePreviewUrl );
			pageOnFront.bind( updatePreviewUrl );
		});

		// Change the previewed URL to the selected page when changing the page_for_posts.
		api( 'page_for_posts', function( setting ) {
			setting.bind(function( pageId ) {
				pageId = parseInt( pageId, 10 );
				if ( pageId > 0 ) {
					api.previewer.previewUrl.set( api.settings.url.home + '?page_id=' + pageId );
				}
			});
		});

		// Update the setting validities.
		api.previewer.bind( 'selective-refresh-setting-validities', function handleSelectiveRefreshedSettingValidities( settingValidities ) {
			api._handleSettingValidities( {
				settingValidities: settingValidities,
				focusInvalidControl: false
			} );
		} );

		// Focus on the control that is associated with the given setting.
		api.previewer.bind( 'focus-control-for-setting', function( settingId ) {
			var matchedControl;
			api.control.each( function( control ) {
				var settingIds = _.pluck( control.settings, 'id' );
				if ( -1 !== _.indexOf( settingIds, settingId ) ) {
					matchedControl = control;
				}
			} );

			if ( matchedControl ) {
				matchedControl.focus();
			}
		} );

		// Refresh the preview when it requests.
		api.previewer.bind( 'refresh', function() {
			api.previewer.refresh();
		});

		// Autosave changeset.
		( function() {
			var timeoutId, updateChangesetWithReschedule, scheduleChangesetUpdate, updatePending = false;

			/**
			 * Request changeset update and then re-schedule the next changeset update time.
			 *
			 * @private
			 */
			updateChangesetWithReschedule = function() {
				if ( ! updatePending ) {
					updatePending = true;
					api.requestChangesetUpdate().always( function() {
						updatePending = false;
					} );
				}
				scheduleChangesetUpdate();
			};

			/**
			 * Schedule changeset update.
			 *
			 * @private
			 */
			scheduleChangesetUpdate = function() {
				clearTimeout( timeoutId );
				timeoutId = setTimeout( function() {
					updateChangesetWithReschedule();
				}, api.settings.timeouts.changesetAutoSave );
			};

			// Start auto-save interval for updating changeset.
			scheduleChangesetUpdate();

			// Save changeset when focus removed from window.
			$( window ).on( 'blur.wp-customize-changeset-update', function() {
				updateChangesetWithReschedule();
			} );

			// Save changeset before unloading window.
			$( window ).on( 'beforeunload.wp-customize-changeset-update', function() {
				updateChangesetWithReschedule();
			} );
		} ());

		api.trigger( 'ready' );
	});

})( wp, jQuery );
