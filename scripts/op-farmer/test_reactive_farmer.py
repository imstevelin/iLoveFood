import time
import unittest
from unittest import mock

import reactive_farmer as farmer


class TokenPoolTests(unittest.TestCase):
    def setUp(self):
        self.original_pool = farmer.pool
        self.original_api_key = farmer.FARMER_API_KEY
        farmer.FARMER_API_KEY = "test-secret"
        farmer.pool = farmer.TokenPool()

    def tearDown(self):
        farmer.pool = self.original_pool
        farmer.FARMER_API_KEY = self.original_api_key

    def test_expired_tokens_are_never_ready(self):
        now = time.monotonic()
        farmer.pool.tokens.append(
            farmer.TokenEntry("expired", now - farmer.TOKEN_TTL_SECONDS - 1)
        )

        with farmer.pool.condition:
            self.assertTrue(farmer.pool.needs_prefetch_locked(now))
            self.assertEqual(list(farmer.pool.tokens), [])

    def test_refresh_replaces_complete_cohort_in_one_app_session(self):
        now = time.monotonic()
        for index in range(farmer.TOKEN_POOL_CAPACITY):
            farmer.pool.tokens.append(
                farmer.TokenEntry(
                    f"old-{index}", now - farmer.TOKEN_REFRESH_SECONDS - 1
                )
            )
        farmer.pool.app_state = "active"
        farmer.pool.is_fetching = True
        captures = []
        hibernations = []

        def fake_capture():
            token = f"new-token-{len(captures)}"
            captures.append(token)
            farmer.record_fetch_success(token, 0.1)

        with (
            mock.patch.object(farmer, "capture_one_token", side_effect=fake_capture),
            mock.patch.object(
                farmer, "hibernate_app", side_effect=lambda: hibernations.append(True)
            ),
        ):
            farmer.fetch_token_job()

        self.assertEqual(len(captures), farmer.TOKEN_POOL_CAPACITY)
        self.assertEqual(
            [entry.value for entry in farmer.pool.tokens],
            captures,
        )
        self.assertEqual(hibernations, [True])
        self.assertFalse(farmer.pool.is_fetching)

    def test_health_is_degraded_while_fetching_without_inventory(self):
        farmer.pool.is_fetching = True
        with farmer.app.test_client() as client:
            response = client.get("/health")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["status"], "degraded")

    def test_health_requires_both_control_plane_heartbeats(self):
        now = time.monotonic()
        farmer.pool.tokens.append(farmer.TokenEntry("valid", now))
        farmer.pool.maintainer_heartbeat_at = now
        farmer.pool.watchdog_heartbeat_at = now
        with farmer.app.test_client() as client:
            healthy = client.get("/health")

        farmer.pool.watchdog_heartbeat_at = now - farmer.WATCHDOG_TIMEOUT_SECONDS - 1
        with farmer.app.test_client() as client:
            degraded = client.get("/health")

        self.assertEqual(healthy.status_code, 200)
        self.assertEqual(degraded.status_code, 503)

    def test_cleanup_never_calls_blocking_frida_teardown(self):
        original_script = farmer.frida_script
        original_session = farmer.frida_session
        script = mock.Mock()
        session = mock.Mock()
        farmer.frida_script = script
        farmer.frida_session = session
        try:
            farmer.cleanup_frida_client()
        finally:
            farmer.frida_script = original_script
            farmer.frida_session = original_session

        script.unload.assert_not_called()
        session.detach.assert_not_called()

    def test_hibernate_force_stops_before_dropping_frida_references(self):
        events = []

        def fake_adb_shell(args, **kwargs):
            events.append(("adb", tuple(args)))

        with (
            mock.patch.object(farmer, "adb_shell", side_effect=fake_adb_shell),
            mock.patch.object(
                farmer,
                "cleanup_frida_client",
                side_effect=lambda: events.append(("cleanup", None)),
            ),
        ):
            farmer.hibernate_app()

        self.assertEqual(
            events,
            [
                ("adb", ("am", "force-stop", farmer.PKG_NAME)),
                ("cleanup", None),
                ("adb", ("input", "keyevent", "3")),
            ],
        )
        self.assertEqual(farmer.pool.app_state, "hibernating")

    def test_hibernate_failure_requests_immediate_full_recovery(self):
        farmer.pool.tokens.append(farmer.TokenEntry("still-valid", time.monotonic()))
        farmer.pool.app_state = "active"
        farmer.pool.is_fetching = True

        with (
            mock.patch.object(
                farmer, "hibernate_app", side_effect=RuntimeError("force-stop failed")
            ),
            mock.patch.object(farmer, "request_full_recovery") as recover,
        ):
            farmer.fetch_token_job()

        recover.assert_called_once_with("App 無法安全休眠")
        self.assertEqual(farmer.pool.failed_fetches, 1)
        self.assertFalse(farmer.pool.is_fetching)

    def test_fetch_watchdog_recovers_a_stalled_native_call(self):
        now = time.monotonic()
        farmer.pool.is_fetching = True
        farmer.pool.fetch_started_at = now - farmer.FETCH_JOB_TIMEOUT_SECONDS - 1
        farmer.pool.fetch_stage = "hibernating"

        with mock.patch.object(farmer, "request_full_recovery") as recover:
            self.assertTrue(farmer.check_fetch_watchdog(now))

        recover.assert_called_once()
        self.assertIn("hibernating", recover.call_args.args[0])

    def test_initialization_is_covered_by_fetch_watchdog(self):
        now = time.monotonic()
        with mock.patch.object(farmer.time, "monotonic", return_value=now):
            farmer.begin_fetch_tracking("initializing_app")

        self.assertTrue(farmer.pool.is_fetching)
        self.assertEqual(farmer.pool.fetch_stage, "initializing_app")
        with mock.patch.object(farmer, "request_full_recovery") as recover:
            farmer.check_fetch_watchdog(now + farmer.FETCH_JOB_TIMEOUT_SECONDS + 1)
        recover.assert_called_once()

        farmer.end_fetch_tracking()
        self.assertFalse(farmer.pool.is_fetching)
        self.assertEqual(farmer.pool.fetch_stage, "idle")

    def test_maintainer_watchdog_recovers_a_stalled_maintainer(self):
        now = time.monotonic()
        farmer.pool.maintainer_heartbeat_at = (
            now - farmer.MAINTAINER_TIMEOUT_SECONDS - 1
        )

        with mock.patch.object(farmer, "request_full_recovery") as recover:
            self.assertTrue(farmer.check_maintainer_watchdog(now))

        recover.assert_called_once()
        self.assertIn("維護執行緒", recover.call_args.args[0])

    def test_maintainer_recovers_a_stalled_watchdog(self):
        now = time.monotonic()
        farmer.pool.watchdog_heartbeat_at = now - farmer.WATCHDOG_TIMEOUT_SECONDS - 1

        with mock.patch.object(farmer, "request_full_recovery") as recover:
            self.assertTrue(farmer.check_watchdog_heartbeat(now))

        recover.assert_called_once()
        self.assertIn("Watchdog", recover.call_args.args[0])

    def test_validation_accepts_only_redeemable_mid_v(self):
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.status = 200
        response.read.return_value = b'{"isSuccess": true, "element": "access"}'

        with mock.patch.object(farmer.urllib.request, "urlopen", return_value=response):
            farmer.validate_mid_v("captured-token")

        self.assertEqual(farmer.pool.validation_successes, 1)
        self.assertEqual(farmer.pool.validation_failures, 0)
        self.assertIsNone(farmer.pool.last_validation_error)

    def test_invalid_mid_v_is_never_published(self):
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.status = 200
        response.read.return_value = b'{"isSuccess": false, "element": null}'

        with (
            mock.patch.object(farmer, "current_capture_sequence", return_value=0),
            mock.patch.object(farmer, "read_new_capture", return_value="invalid-token"),
            mock.patch.object(farmer, "adb_shell"),
            mock.patch.object(farmer.time, "sleep"),
            mock.patch.object(
                farmer.urllib.request, "urlopen", return_value=response
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "Token 功能驗證失敗"):
                farmer.capture_one_token()

        self.assertEqual(list(farmer.pool.tokens), [])
        self.assertEqual(farmer.pool.validation_failures, 1)

    def test_api_reuses_cached_token_without_consuming_it(self):
        now = time.monotonic()
        farmer.pool.tokens.append(farmer.TokenEntry("reusable-token", now - 1))

        with mock.patch.object(farmer, "start_prefetch", return_value=False):
            with farmer.app.test_client() as client:
                headers = {"Authorization": "Bearer test-secret"}
                first = client.post("/get_token", json={}, headers=headers)
                second = client.post("/get_token", json={}, headers=headers)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.get_json()["mid_v"], "reusable-token")
        self.assertEqual(second.get_json()["mid_v"], "reusable-token")
        self.assertEqual(
            [entry.value for entry in farmer.pool.tokens], ["reusable-token"]
        )
        self.assertEqual(farmer.pool.served_requests, 2)

    def test_api_rejects_requests_without_bearer_key(self):
        with farmer.app.test_client() as client:
            response = client.post("/get_token", json={})

        self.assertEqual(response.status_code, 401)
        self.assertNotIn("mid_v", response.get_json())


if __name__ == "__main__":
    unittest.main()
