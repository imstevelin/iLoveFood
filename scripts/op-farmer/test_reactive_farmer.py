import time
import unittest
from unittest import mock

import reactive_farmer as farmer


class TokenPoolTests(unittest.TestCase):
    def setUp(self):
        self.original_pool = farmer.pool
        farmer.pool = farmer.TokenPool()

    def tearDown(self):
        farmer.pool = self.original_pool

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

    def test_api_reuses_cached_token_without_consuming_it(self):
        now = time.monotonic()
        farmer.pool.tokens.append(farmer.TokenEntry("reusable-token", now - 1))

        with mock.patch.object(farmer, "start_prefetch", return_value=False):
            with farmer.app.test_client() as client:
                first = client.post("/get_token", json={})
                second = client.post("/get_token", json={})

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.get_json()["mid_v"], "reusable-token")
        self.assertEqual(second.get_json()["mid_v"], "reusable-token")
        self.assertEqual(
            [entry.value for entry in farmer.pool.tokens], ["reusable-token"]
        )
        self.assertEqual(farmer.pool.served_requests, 2)


if __name__ == "__main__":
    unittest.main()
