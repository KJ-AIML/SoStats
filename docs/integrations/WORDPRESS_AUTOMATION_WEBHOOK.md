# WordPress -> SoStats Signed Automation Webhook

This guide connects a WordPress publish event to a SoStats Automation.

The SoStats workflow should use:

```text
Trigger source: Signed webhook / WordPress
Payload source: WordPress post
Event name: wordpress.post.published
```

Publish the workflow first. SoStats will show:

- the webhook endpoint
- the signing secret

Copy the secret immediately or rotate it later from the Automation screen.

## Request contract

Send JSON with these headers:

```text
Content-Type: application/json
X-SoStats-Timestamp: 1790650800
X-SoStats-Event: wordpress.post.published
X-SoStats-Event-Id: wp:1:42:2026-09-29T03:00:00
X-SoStats-Signature: sha256=<hmac>
```

The signature input is exactly:

```text
timestamp + "." + event + "." + eventId + "." + rawJsonBody
```

Do not parse and re-serialize the body after calculating the signature. The
bytes sent over HTTP must be the same bytes used for the HMAC.

## Minimal WordPress sender

Store the endpoint and secret in `wp-config.php` or another secret-management
mechanism. Do not commit the signing secret into a public theme/plugin
repository.

Example `wp-config.php` values:

```php
define('SOSTATS_WEBHOOK_URL', 'https://api.example.com/v1/automation-hooks/REPLACE_ME');
define('SOSTATS_WEBHOOK_SECRET', 'REPLACE_ME');
```

Then install a small plugin or mu-plugin such as:

```php
<?php
/**
 * Plugin Name: SoStats Publish Webhook
 */

add_action(
    'transition_post_status',
    function ($new_status, $old_status, $post) {
        if (
            $new_status !== 'publish' ||
            $old_status === 'publish' ||
            $post->post_type !== 'post'
        ) {
            return;
        }

        if (
            !defined('SOSTATS_WEBHOOK_URL') ||
            !defined('SOSTATS_WEBHOOK_SECRET')
        ) {
            error_log('SoStats webhook is not configured.');
            return;
        }

        $event = 'wordpress.post.published';
        $timestamp = (string) time();

        // Stable across a retry of this publish event.
        $published_gmt = get_post_time('c', true, $post);
        $event_id = sprintf(
            'wp:%d:%d:%s',
            get_current_blog_id(),
            $post->ID,
            $published_gmt
        );

        $payload = [
            'post' => [
                'id' => $post->ID,
                'type' => $post->post_type,
                'status' => $post->post_status,
                'title' => [
                    'rendered' => get_the_title($post),
                ],
                'excerpt' => [
                    'rendered' => get_the_excerpt($post),
                ],
                'content' => [
                    'rendered' => apply_filters(
                        'the_content',
                        $post->post_content
                    ),
                ],
                'link' => get_permalink($post),
                'date_gmt' => $published_gmt,
            ],
        ];

        $body = wp_json_encode(
            $payload,
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
        );

        if ($body === false) {
            error_log('SoStats webhook JSON encoding failed.');
            return;
        }

        $signing_input =
            $timestamp . '.' .
            $event . '.' .
            $event_id . '.' .
            $body;

        $signature = hash_hmac(
            'sha256',
            $signing_input,
            SOSTATS_WEBHOOK_SECRET
        );

        $response = wp_remote_post(
            SOSTATS_WEBHOOK_URL,
            [
                'timeout' => 5,
                'headers' => [
                    'Content-Type' => 'application/json',
                    'X-SoStats-Timestamp' => $timestamp,
                    'X-SoStats-Event' => $event,
                    'X-SoStats-Event-Id' => $event_id,
                    'X-SoStats-Signature' => 'sha256=' . $signature,
                ],
                'body' => $body,
            ]
        );

        if (is_wp_error($response)) {
            error_log(
                'SoStats webhook failed: ' .
                $response->get_error_message()
            );
            return;
        }

        $status = wp_remote_retrieve_response_code($response);
        if ($status < 200 || $status >= 300) {
            error_log(
                'SoStats webhook returned HTTP ' . $status
            );
        }
    },
    10,
    3
);
```

For a high-volume production site, enqueue delivery through a background job
system rather than adding network latency directly to the publish request.

If that job retries, keep the same `X-SoStats-Event-Id` and send a new current
timestamp/signature. SoStats will accept the retry but deduplicate the already
observed event.

## Example payload

```json
{
  "post": {
    "id": 42,
    "type": "post",
    "status": "publish",
    "title": {
      "rendered": "How we launched SoStats"
    },
    "excerpt": {
      "rendered": "<p>A short launch story.</p>"
    },
    "content": {
      "rendered": "<p>Longer article body...</p>"
    },
    "link": "https://example.com/how-we-launched-sostats",
    "date_gmt": "2026-09-29T03:00:00+00:00"
  }
}
```

SoStats strips markup and bounds persisted text before passing source evidence
into the downstream AI Generate step.

## Response behavior

A new valid event returns HTTP 202 with a run id.

Conceptually:

```json
{
  "accepted": true,
  "duplicate": false,
  "eventName": "wordpress.post.published",
  "runId": 123
}
```

A legitimate retry of an event that already exists still returns HTTP 202:

```json
{
  "accepted": true,
  "duplicate": true,
  "eventName": "wordpress.post.published",
  "runId": null
}
```

Invalid signatures, stale timestamps, event-name mismatches, and inactive
endpoints are rejected before an automation run is created.

## Rotation

Use **Rotate secret** from the SoStats Automation screen.

The old secret becomes invalid immediately. Update WordPress before the next
publish delivery.

The endpoint URL remains stable during secret rotation.
