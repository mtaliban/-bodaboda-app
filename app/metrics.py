from math import inf
from prometheus_client import Counter, Histogram, Gauge

LOGIN_ATTEMPTS = Counter(
    "bodaboda_login_attempts_total",
    "Login attempts by outcome",
    ["status"],  # success | failed
)

REGISTER_ATTEMPTS = Counter(
    "bodaboda_register_attempts_total",
    "Registration attempts by outcome",
    ["status"],  # success | failed
)

DB_QUERY_DURATION = Histogram(
    "bodaboda_db_query_duration_seconds",
    "Database query execution time in seconds",
    ["operation"],  # SELECT | INSERT | UPDATE | DELETE
    buckets=[0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5],
)

FRONTEND_PAGE_LOADS = Counter(
    "bodaboda_frontend_page_loads_total",
    "Frontend page navigation events",
    ["page"],
)

FRONTEND_PAGE_LOAD_DURATION = Histogram(
    "bodaboda_frontend_page_load_duration_seconds",
    "Time for a page to become interactive (seconds)",
    ["page"],
    buckets=[0.1, 0.25, 0.5, 1.0, 2.0, 3.0, 5.0, 10.0],
)

FRONTEND_BUTTON_CLICKS = Counter(
    "bodaboda_frontend_button_clicks_total",
    "User button-click events",
    ["button"],
)

FRONTEND_API_DURATION = Histogram(
    "bodaboda_frontend_api_duration_seconds",
    "API round-trip time as seen by the browser (seconds)",
    ["method", "endpoint", "status"],
    buckets=[0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0],
)

FRONTEND_ERRORS = Counter(
    "bodaboda_frontend_errors_total",
    "Unhandled JavaScript errors",
    ["type"],
)

ACTIVE_USERS = Gauge(
    "bodaboda_active_users",
    "Frontend sessions that reported a heartbeat",
)

_BYTE_BUCKETS = [64, 256, 1_024, 4_096, 16_384, 65_536, 262_144, 1_048_576, inf]

HTTP_REQUEST_BYTES = Histogram(
    "http_request_size_bytes",
    "HTTP request body size in bytes",
    ["handler", "method"],
    buckets=_BYTE_BUCKETS,
)

HTTP_RESPONSE_BYTES = Histogram(
    "http_response_size_bytes",
    "HTTP response body size in bytes",
    ["handler", "method"],
    buckets=_BYTE_BUCKETS,
)
