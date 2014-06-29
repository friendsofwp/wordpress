<?php
/**
 * WordPress Installer
 *
 * @package WordPress
 * @subpackage Administration
 */

// Sanity check.
if ( false ) {
?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
	<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
	<title>Error: PHP is not running</title>
</head>
<body class="wp-core-ui">
	<h1 id="logo"><a href="https://wordpress.org/">WordPress</a></h1>
	<h2>Error: PHP is not running</h2>
	<p>WordPress requires that your web server is running PHP. Your server does not have PHP installed, or PHP is turned off.</p>
</body>
</html>
<?php
}

/**
 * We are installing WordPress.
 *
 * @since 1.5.1
 * @var bool
 */
define( 'WP_INSTALLING', true );

/** Load WordPress Bootstrap */
require_once( dirname( dirname( __FILE__ ) ) . '/wp-load.php' );

/** Load WordPress Administration Upgrade API */
require_once( ABSPATH . 'wp-admin/includes/upgrade.php' );

/** Load wpdb */
require_once( ABSPATH . WPINC . '/wp-db.php' );

$step = isset( $_GET['step'] ) ? (int) $_GET['step'] : 0;

/**
 * @todo rename, move
 */
function wp_get_available_translations() {
	$url = 'http://api.wordpress.org/translations/core/1.0/';
	if ( wp_http_supports( array( 'ssl' ) ) ) {
		$url = set_url_scheme( $url, 'https' );
	}

	$options = array(
		'timeout' => 3,
		'body' => array( 'version' => $GLOBALS['wp_version'] ),
	);

	$response = wp_remote_post( $url, $options );
	$body = wp_remote_retrieve_body( $response );
	if ( $body && $body = json_decode( $body, true ) ) {
		return $body;
	}
	return false;
}

/**
 * Display install header.
 *
 * @since 2.5.0
 */
function display_header( $body_classes = '' ) {
	header( 'Content-Type: text/html; charset=utf-8' );
	if ( is_rtl() ) {
		$body_classes .= 'rtl';
	}
	if ( $body_classes ) {
		$body_classes = ' ' . $body_classes;
	}
?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" <?php language_attributes(); ?>>
<head>
	<meta name="viewport" content="width=device-width" />
	<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
	<title><?php _e( 'WordPress &rsaquo; Installation' ); ?></title>
	<?php
	wp_admin_css( 'install', true );
	?>
</head>
<body class="wp-core-ui<?php echo $body_classes ?>">
<h1 id="logo"><a href="<?php echo esc_url( __( 'https://wordpress.org/' ) ); ?>" tabindex="-1"><?php _e( 'WordPress' ); ?></a></h1>

<?php
} // end display_header()

/**
 * Display installer setup form.
 *
 * @since 2.8.0
 */
function display_setup_form( $error = null ) {
	global $wpdb;

	$sql = $wpdb->prepare( "SHOW TABLES LIKE %s", $wpdb->esc_like( $wpdb->users ) );
	$user_table = ( $wpdb->get_var( $sql ) != null );

	// Ensure that Blogs appear in search engines by default.
	$blog_public = 1;
	if ( isset( $_POST['weblog_title'] ) ) {
		$blog_public = isset( $_POST['blog_public'] );
	}

	$weblog_title = isset( $_POST['weblog_title'] ) ? trim( wp_unslash( $_POST['weblog_title'] ) ) : '';
	$user_name = isset($_POST['user_name']) ? trim( wp_unslash( $_POST['user_name'] ) ) : '';
	$admin_email  = isset( $_POST['admin_email']  ) ? trim( wp_unslash( $_POST['admin_email'] ) ) : '';

	if ( ! is_null( $error ) ) {
?>
<p class="message"><?php echo $error; ?></p>
<?php } ?>
<form id="setup" method="post" action="install.php?step=2">
	<table class="form-table">
		<tr>
			<th scope="row"><label for="weblog_title"><?php _e( 'Site Title' ); ?></label></th>
			<td><input name="weblog_title" type="text" id="weblog_title" size="25" value="<?php echo esc_attr( $weblog_title ); ?>" /></td>
		</tr>
		<tr>
			<th scope="row"><label for="user_login"><?php _e('Username'); ?></label></th>
			<td>
			<?php
			if ( $user_table ) {
				_e('User(s) already exists.');
				echo '<input name="user_name" type="hidden" value="admin" />';
			} else {
				?><input name="user_name" type="text" id="user_login" size="25" value="<?php echo esc_attr( sanitize_user( $user_name, true ) ); ?>" />
				<p><?php _e( 'Usernames can have only alphanumeric characters, spaces, underscores, hyphens, periods and the @ symbol.' ); ?></p>
			<?php
			} ?>
			</td>
		</tr>
		<?php if ( ! $user_table ) : ?>
		<tr>
			<th scope="row">
				<label for="pass1"><?php _e('Password, twice'); ?></label>
				<p><?php _e('A password will be automatically generated for you if you leave this blank.'); ?></p>
			</th>
			<td>
				<input name="admin_password" type="password" id="pass1" size="25" value="" />
				<p><input name="admin_password2" type="password" id="pass2" size="25" value="" /></p>
				<div id="pass-strength-result"><?php _e('Strength indicator'); ?></div>
				<p><?php _e('Hint: The password should be at least seven characters long. To make it stronger, use upper and lower case letters, numbers, and symbols like ! " ? $ % ^ &amp; ).'); ?></p>
			</td>
		</tr>
		<?php endif; ?>
		<tr>
			<th scope="row"><label for="admin_email"><?php _e( 'Your E-mail' ); ?></label></th>
			<td><input name="admin_email" type="text" id="admin_email" size="25" value="<?php echo esc_attr( $admin_email ); ?>" />
			<p><?php _e( 'Double-check your email address before continuing.' ); ?></p></td>
		</tr>
		<tr>
			<th scope="row"><label for="blog_public"><?php _e( 'Privacy' ); ?></label></th>
			<td colspan="2"><label><input type="checkbox" name="blog_public" id="blog_public" value="1" <?php checked( $blog_public ); ?> /> <?php _e( 'Allow search engines to index this site.' ); ?></label></td>
		</tr>
	</table>
	<p class="step"><input type="submit" name="Submit" value="<?php esc_attr_e( 'Install WordPress' ); ?>" class="button button-large" /></p>
	<input type="hidden" name="language" value="<?php echo isset( $_POST['language'] ) ? esc_attr( $_POST['language'] ) : ''; ?>" />
</form>
<?php
} // end display_setup_form()

// Let's check to make sure WP isn't already installed.
if ( is_blog_installed() ) {
	display_header();
	die( '<h1>' . __( 'Already Installed' ) . '</h1><p>' . __( 'You appear to have already installed WordPress. To reinstall please clear your old database tables first.' ) . '</p><p class="step"><a href="../wp-login.php" class="button button-large">' . __( 'Log In' ) . '</a></p></body></html>' );
}

$php_version    = phpversion();
$mysql_version  = $wpdb->db_version();
$php_compat     = version_compare( $php_version, $required_php_version, '>=' );
$mysql_compat   = version_compare( $mysql_version, $required_mysql_version, '>=' ) || file_exists( WP_CONTENT_DIR . '/db.php' );

if ( !$mysql_compat && !$php_compat )
	$compat = sprintf( __( 'You cannot install because <a href="http://codex.wordpress.org/Version_%1$s">WordPress %1$s</a> requires PHP version %2$s or higher and MySQL version %3$s or higher. You are running PHP version %4$s and MySQL version %5$s.' ), $wp_version, $required_php_version, $required_mysql_version, $php_version, $mysql_version );
elseif ( !$php_compat )
	$compat = sprintf( __( 'You cannot install because <a href="http://codex.wordpress.org/Version_%1$s">WordPress %1$s</a> requires PHP version %2$s or higher. You are running version %3$s.' ), $wp_version, $required_php_version, $php_version );
elseif ( !$mysql_compat )
	$compat = sprintf( __( 'You cannot install because <a href="http://codex.wordpress.org/Version_%1$s">WordPress %1$s</a> requires MySQL version %2$s or higher. You are running version %3$s.' ), $wp_version, $required_mysql_version, $mysql_version );

if ( !$mysql_compat || !$php_compat ) {
	display_header();
	die( '<h1>' . __( 'Insufficient Requirements' ) . '</h1><p>' . $compat . '</p></body></html>' );
}

if ( ! is_string( $wpdb->base_prefix ) || '' === $wpdb->base_prefix ) {
	display_header();
	die( '<h1>' . __( 'Configuration Error' ) . '</h1><p>' . __( 'Your <code>wp-config.php</code> file has an empty database table prefix, which is not supported.' ) . '</p></body></html>' );
}

switch($step) {
	case 0: // Step 0
		if ( $body = wp_get_available_translations() ) {
			display_header( 'language-chooser' );

			echo '<form id="setup" method="post" action="install.php?step=1">';
			echo '<select name="language" id="language-chooser" size="15">';
			echo '<option selected="selected" value="">English (United States)</option>';
			foreach ( $body['languages'] as $language ) {
				echo '<option value="' . esc_attr( $language['language'] ) . '">' . esc_html( $language['native_name'] ) . "</option>\n";
			}
			echo "</select>\n";
			echo '<p class="step"><input type="submit" class="button button-primary button-hero" value="&raquo;" /></p>';
			echo '</form>';
			break;
		}
		// Deliberately fall through if we can't reach the translations API.

	case 1: // Step 1, direct link or from language chooser.
		if ( ! empty( $_POST['language'] ) ) {
			$body = wp_get_available_translations();
			foreach ( $body['languages'] as $language ) {
				if ( $language['language'] === $_POST['language'] ) {
					$loading_language = $_POST['language'];
					break;
				}
			}
			if ( ! empty( $loading_language ) ) {
				require ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
				$skin = new Automatic_Upgrader_Skin;
				$upgrader = new Language_Pack_Upgrader( $skin );
				$options = array( 'clear_update_cache' => false );
				$language['type'] = 'core';
				$language = (object) $language;
				/**
				 * @todo failures (such as non-direct FS)
				 */
				$upgrader->upgrade( $language, array( 'clear_update_cache' => false ) );
				load_textdomain( 'default', WP_LANG_DIR . "/{$loading_language}.mo" );
				load_textdomain( 'default', WP_LANG_DIR . "/admin-{$loading_language}.mo" );
			}
		}

		display_header();
?>
<h1><?php _ex( 'Welcome', 'Howdy' ); ?></h1>
<p><?php printf( __( 'Welcome to the famous five minute WordPress installation process! You may want to browse the <a href="%s">ReadMe documentation</a> at your leisure. Otherwise, just fill in the information below and you&#8217;ll be on your way to using the most extendable and powerful personal publishing platform in the world.' ), '../readme.html' ); ?></p>

<h1><?php _e( 'Information needed' ); ?></h1>
<p><?php _e( 'Please provide the following information. Don&#8217;t worry, you can always change these settings later.' ); ?></p>

<?php
		display_setup_form();
		break;
	case 2:
		$loading_language = '';
		if ( ! empty( $_POST['language'] ) ) {
			$available_languages = get_available_languages();
			if ( in_array( $_POST['language'], $available_languages ) ) {
				$loading_language = $_POST['language'];
				load_textdomain( 'default', WP_LANG_DIR . "/{$loading_language}.mo" );
				load_textdomain( 'default', WP_LANG_DIR . "/admin-{$loading_language}.mo" );
			}
		}

		if ( ! empty( $wpdb->error ) )
			wp_die( $wpdb->error->get_error_message() );

		display_header();
		// Fill in the data we gathered
		$weblog_title = isset( $_POST['weblog_title'] ) ? trim( wp_unslash( $_POST['weblog_title'] ) ) : '';
		$user_name = isset($_POST['user_name']) ? trim( wp_unslash( $_POST['user_name'] ) ) : '';
		$admin_password = isset($_POST['admin_password']) ? wp_unslash( $_POST['admin_password'] ) : '';
		$admin_password_check = isset($_POST['admin_password2']) ? wp_unslash( $_POST['admin_password2'] ) : '';
		$admin_email  = isset( $_POST['admin_email']  ) ?trim( wp_unslash( $_POST['admin_email'] ) ) : '';
		$public       = isset( $_POST['blog_public']  ) ? (int) $_POST['blog_public'] : 0;
		// check e-mail address
		$error = false;
		if ( empty( $user_name ) ) {
			// TODO: poka-yoke
			display_setup_form( __( 'Please provide a valid username.' ) );
			$error = true;
		} elseif ( $user_name != sanitize_user( $user_name, true ) ) {
			display_setup_form( __( 'The username you provided has invalid characters.' ) );
			$error = true;
		} elseif ( $admin_password != $admin_password_check ) {
			// TODO: poka-yoke
			display_setup_form( __( 'Your passwords do not match. Please try again.' ) );
			$error = true;
		} else if ( empty( $admin_email ) ) {
			// TODO: poka-yoke
			display_setup_form( __( 'You must provide an email address.' ) );
			$error = true;
		} elseif ( ! is_email( $admin_email ) ) {
			// TODO: poka-yoke
			display_setup_form( __( 'Sorry, that isn&#8217;t a valid email address. Email addresses look like <code>username@example.com</code>.' ) );
			$error = true;
		}

		if ( $error === false ) {
			$wpdb->show_errors();
			$result = wp_install( $weblog_title, $user_name, $admin_email, $public, '', wp_slash( $admin_password ), $loading_language );
?>

<h1><?php _e( 'Success!' ); ?></h1>

<p><?php _e( 'WordPress has been installed. Were you expecting more steps? Sorry to disappoint.' ); ?></p>

<table class="form-table install-success">
	<tr>
		<th><?php _e( 'Username' ); ?></th>
		<td><?php echo esc_html( sanitize_user( $user_name, true ) ); ?></td>
	</tr>
	<tr>
		<th><?php _e( 'Password' ); ?></th>
		<td><?php
		if ( ! empty( $result['password'] ) && empty( $admin_password_check ) ): ?>
			<code><?php echo esc_html( $result['password'] ) ?></code><br />
		<?php endif ?>
			<p><?php echo $result['password_message'] ?></p>
		</td>
	</tr>
</table>

<p class="step"><a href="../wp-login.php" class="button button-large"><?php _e( 'Log In' ); ?></a></p>

<?php
		}
		break;
}
if ( !wp_is_mobile() ) {
?>
<script type="text/javascript">var t = document.getElementById('weblog_title') || document.getElementById('language-chooser'); if (t){ t.focus(); }</script>
<?php } ?>
<?php wp_print_scripts( 'user-profile' ); ?>
</body>
</html>
