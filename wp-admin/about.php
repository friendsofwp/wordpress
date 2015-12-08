<?php
/**
 * About This Version administration panel.
 *
 * @package WordPress
 * @subpackage Administration
 */

/** WordPress Administration Bootstrap */
require_once( dirname( __FILE__ ) . '/admin.php' );

wp_enqueue_style( 'wp-mediaelement' );
wp_enqueue_script( 'wp-mediaelement' );
wp_localize_script( 'mediaelement', '_wpmejsSettings', array(
	'pluginPath' => includes_url( 'js/mediaelement/', 'relative' ),
	'pauseOtherPlayers' => ''
) );

if ( current_user_can( 'install_plugins' ) ) {
	add_thickbox();
	wp_enqueue_script( 'plugin-install' );
}


wp_oembed_add_host_js();

$title = __( 'About' );

list( $display_version ) = explode( '-', $wp_version );

include( ABSPATH . 'wp-admin/admin-header.php' );
?>
	<div class="wrap about-wrap">
		<h1><?php printf( __( 'Welcome to WordPress&nbsp;%s' ), $display_version ); ?></h1>

		<div class="about-text"><?php printf( __( 'Thank you for updating! WordPress %s makes your site more connected and responsive.' ), $display_version ); ?></div>
		<div class="wp-badge"><?php printf( __( 'Version %s' ), $display_version ); ?></div>

		<h2 class="nav-tab-wrapper">
			<a href="about.php" class="nav-tab nav-tab-active"><?php _e( 'What&#8217;s New' ); ?></a>
			<a href="credits.php" class="nav-tab"><?php _e( 'Credits' ); ?></a>
			<a href="freedoms.php" class="nav-tab"><?php _e( 'Freedoms' ); ?></a>
		</h2>

		<div class="headline-feature feature-section one-col">
			<h2><?php _e( 'Twenty Sixteen' ); ?></h2>
			<div class="media-container">
				<img src="https://cldup.com/K6k4JfS2nW.png" alt="" srcset="https://cldup.com/F7tEqWxzrx-3000x3000.png 268w, https://cldup.com/zxAXtkbN40-3000x3000.png 536w, https://cldup.com/f2FyXrEthb-3000x3000.png 558w, https://cldup.com/xFofz-J2o0-3000x3000.png 840w, https://cldup.com/2fTSHlMGIt-3000x3000.png 1086w, https://cldup.com/RRCVETtgEs-3000x3000.png 1116w, https://cldup.com/SshVHkB_oX-3000x3000.png 1680w, https://cldup.com/ptbHQzcmog-3000x3000.png 2172w" sizes="(max-width: 500px) calc((100vw - 40px) * .8), (max-width: 782px) calc((100vw - 70px) * .8), (max-width: 960px) calc((100vw - 116px) * .8), (max-width: 1290px) calc((100vw - 240px) * .8), 840px" />
			</div>
			<div class="two-col">
				<div class="col">
					<h3><?php _e( 'Introducing Twenty Sixteen' ); ?></h3>
					<p><?php _e( 'Our newest default theme, Twenty Sixteen, is a modern take on a classic blog design.' ); ?></p>
					<p><?php _e( 'Twenty Sixteen was built to look great on any device. A fluid grid design, flexible header, fun color schemes, and more, will make your content shine.' ); ?></p>
					<div class="horizontal-image">
						<div class="content">
							<img class="feature-image horizontal-screen" src="https://cldup.com/J-zxmMqkXs.png" alt=""  srcset="https://cldup.com/GJ_OChqU-3-3000x3000.png 268w, https://cldup.com/opV2KAg7px-3000x3000.png 535w, https://cldup.com/H7TUss5F-L-3000x3000.png 558w, https://cldup.com/4Mgr3kchBL-3000x3000.png 783w, https://cldup.com/kW9lcVhn3v-3000x3000.png 1116w, https://cldup.com/M2gkxI9RnI-3000x3000.png 1566w" sizes="(max-width: 500px) calc((100vw - 40px) * .8), (max-width: 782px) calc((100vw - 70px) * .8), (max-width: 960px) calc((100vw - 116px) * .5216), (max-width: 1290px) calc((100vw - 240px) * .5216), 548px" />
						</div>
					</div>
				</div>
				<div class="col feature-image">
					<img class="vertical-screen" src="https://cldup.com/5mh4eg1O3o.png" alt="" srcset="https://cldup.com/x_sJ-I3UDl-3000x3000.png 107w, https://cldup.com/tlGp0BJTzE-3000x3000.png 214w, https://cldup.com/n613ekUCQg-3000x3000.png 252w, https://cldup.com/tjpHRtg6zh-3000x3000.png 410w, https://cldup.com/Db9pMyLNeJ-3000x3000.png 504w, https://cldup.com/P4PM_7sjQt-3000x3000.png 820w" sizes="(max-width: 500px) calc((100vw - 40px) * .32), (max-width: 782px) calc((100vw - 70px) * .32), (max-width: 960px) calc((100vw - 116px) * .24), (max-width: 1290px) calc((100vw - 240px) * .24), 252px" />
				</div>
			</div>
		</div>

		<hr />

		<div class="feature-section two-col">
			<div class="col">
				<div class="media-container">
					<img src="https://cldup.com/av6MH44-Au.png" alt="" srcset="https://cldup.com/KFesVSr1qr-3000x3000.png 335w, https://cldup.com/bX6aec9s9y-3000x3000.png 500w, https://cldup.com/sN3AlF6bSs-3000x3000.png 670w, https://cldup.com/2sAEKiKjQh-3000x3000.png 698w, https://cldup.com/TqUWsx6V2V-3000x3000.png 1000w, https://cldup.com/5gLqAd5tJL-3000x3000.png 1200w, https://cldup.com/m20tMOQZvT-3000x3000.png 1396w, https://cldup.com/d82AnAj-MF-3000x3000.png 2400w" sizes="(max-width: 500px) calc((100vw - 40px)), (max-width: 782px) calc((100vw - 70px), (max-width: 960px) calc((100vw - 116px) * .476), (max-width: 1290px) calc((100vw - 240px) * .476), 500px" />
				</div>
			</div>
			<div class="col">
				<h3><?php _e( 'Responsive images' ); ?></h3>
				<p><?php _e( 'WordPress now takes a smarter approach to displaying appropriate image sizes on any device, ensuring a perfect fit every time. You don&#8217;t need to do anything to your theme, it just works.' ); ?></p>
			</div>
		</div>

		<hr />

		<div class="feature-section two-col">
			<div class="col">
				<div class="embed-container">
					<?php
					$embed1 = get_site_transient( 'about-page-embed-1' );
					if ( false === $embed1 ) {
						$embed1 = wp_oembed_get( 'https://make.wordpress.org/core/2015/10/28/new-embeds-feature-in-wordpress-4-4/' );
						if ( ! $embed1 ) {
							$embed1 = '{{unknown}}';
						}
						set_site_transient( 'about-page-embed-1', $embed1 );
					}
					echo '{{unknown}}' !== $embed1 ? $embed1 : '';
					?>
				</div>
				<h3><?php _e( 'Embed your WordPress content' ); ?></h3>
				<p><?php _e( 'Now you can embed your posts on other sites, even other WordPress sites. Simply drop a post URL into the editor and see an instant embed preview, complete with the title, excerpt, and featured image if you&#8217;ve set one. We&#8217;ll even include your site icon and links for comments and sharing.' ); ?></p>
			</div>
			<div class="col">
				<div class="embed-container">
					<?php
					$embed2 = get_site_transient( 'about-page-embed-2' );
					if ( false === $embed2 ) {
						$embed2 = wp_oembed_get( 'https://cloudup.com/cD3duXiAI5k' );
						if ( ! $embed2 ) {
							$embed2 = '{{unknown}}';
						}
						set_site_transient( 'about-page-embed-2', $embed2 );
					}
					echo '{{unknown}}' !== $embed2 ? $embed2 : '';
					?>
				</div>
				<h3><?php _e( 'Even more embed providers' ); ?></h3>
				<p><?php _e( 'In addition to post embeds, WordPress 4.4 also adds support for five new oEmbed providers: Cloudup, Reddit&nbsp;Comments, ReverbNation, Speaker&nbsp;Deck, and VideoPress.' ); ?></p>
			</div>
		</div>

		<hr />

		<div class="changelog">
			<h3><?php _e( 'Under the Hood' ); ?></h3>

			<div class="feature-section under-the-hood one-col">
				<div class="col">
					<h4><?php _e( 'REST API infrastructure' ); ?></h4>
					<div class="two-col-text">
						<p><?php _e( 'Infrastructure for the REST API has been integrated into core, marking a new era in developing with WordPress. The REST API serves to provide developers with a path forward for building and extending RESTful APIs on top of WordPress.' ); ?></p>
						<p><?php
							if ( current_user_can( 'install_plugins' ) ) {
								$url_args = array(
									'tab'       => 'plugin-information',
									'plugin'    => 'rest-api',
									'TB_iframe' => true,
									'width'     => 600,
									'height'    => 550
								);

								$plugin_link = '<a href="' . esc_url( add_query_arg( $url_args, network_admin_url( 'plugin-install.php' ) ) ) . '" class="thickbox">WordPress REST API</a>';
							} else {
								$plugin_link = '<a href="https://wordpress.org/plugins/rest-api">WordPress REST API</a>';
							}

							/* translators: WordPress REST API plugin link */
							printf( __( 'Infrastructure is the first part of a multi-stage rollout for the REST API. Inclusion of core endpoints is targeted for an upcoming release. To get a sneak peek of the core endpoints, and for more information on extending the REST API, check out the official %s plugin.' ), $plugin_link );
						?></p>
					</div>
				</div>
			</div>

			<div class="feature-section under-the-hood three-col">
				<div class="col">
					<h4><?php _e( 'Term meta' ); ?></h4>
					<p><?php
						/* translators: 1: add_term_meta() docs link, 2: get_term_meta() docs link, 3: update_term_meta() docs link */
						printf( __( 'Terms now support metadata, just like posts. See %1$s, %2$s, and %3$s for more information.' ),
							'<a href="https://developer.wordpress.org/reference/functions/add_term_meta"><code>add_term_meta()</code></a>',
							'<a href="https://developer.wordpress.org/reference/functions/get_term_meta"><code>get_term_meta()</code></a>',
							'<a href="https://developer.wordpress.org/reference/functions/update_term_meta"><code>update_term_meta()</code></a>'
				         );
					?></p>
				</div>
				<div class="col">
					<h4><?php _e( 'Comment query improvements' ); ?></h4>
					<p><?php
						/* translators: WP_Comment_Query class name */
						printf( __( 'Comment queries now have cache handling to improve performance. New arguments in %s make crafting robust comment queries simpler.' ), '<code>WP_Comment_Query</code>' );
					?></p>
				</div>
				<div class="col">
					<h4><?php _e( 'Term, comment, and network objects' ); ?></h4>
					<p><?php
						/* translators: 1: WP_Term class name, WP_Comment class name, WP_Network class name */
						printf( __( 'New %1$s, %2$s, and %3$s objects make interacting with terms, comments, and networks more predictable and intuitive in code.' ),
							'<code>WP_Term</code>',
							'<code>WP_Comment</code>',
							'<code>WP_Network</code>'
						);
					?></p>
				</div>
			</div>

			<div class="return-to-dashboard">
				<?php if ( current_user_can( 'update_core' ) && isset( $_GET['updated'] ) ) : ?>
					<a href="<?php echo esc_url( self_admin_url( 'update-core.php' ) ); ?>">
						<?php is_multisite() ? _e( 'Return to Updates' ) : _e( 'Return to Dashboard &rarr; Updates' ); ?>
					</a> |
				<?php endif; ?>
				<a href="<?php echo esc_url( self_admin_url() ); ?>"><?php is_blog_admin() ? _e( 'Go to Dashboard &rarr; Home' ) : _e( 'Go to Dashboard' ); ?></a>
			</div>

		</div>
	</div>
<?php

include( ABSPATH . 'wp-admin/admin-footer.php' );

// These are strings we may use to describe maintenance/security releases, where we aim for no new strings.
return;

__( 'Maintenance Release' );
__( 'Maintenance Releases' );

__( 'Security Release' );
__( 'Security Releases' );

__( 'Maintenance and Security Release' );
__( 'Maintenance and Security Releases' );

/* translators: %s: WordPress version number */
__( '<strong>Version %s</strong> addressed one security issue.' );
/* translators: %s: WordPress version number */
__( '<strong>Version %s</strong> addressed some security issues.' );

/* translators: 1: WordPress version number, 2: plural number of bugs. */
_n_noop( '<strong>Version %1$s</strong> addressed %2$s bug.',
         '<strong>Version %1$s</strong> addressed %2$s bugs.' );

/* translators: 1: WordPress version number, 2: plural number of bugs. Singular security issue. */
_n_noop( '<strong>Version %1$s</strong> addressed a security issue and fixed %2$s bug.',
         '<strong>Version %1$s</strong> addressed a security issue and fixed %2$s bugs.' );

/* translators: 1: WordPress version number, 2: plural number of bugs. More than one security issue. */
_n_noop( '<strong>Version %1$s</strong> addressed some security issues and fixed %2$s bug.',
         '<strong>Version %1$s</strong> addressed some security issues and fixed %2$s bugs.' );

/* translators: %s: Codex URL */
__( 'For more information, see <a href="%s">the release notes</a>.' );
