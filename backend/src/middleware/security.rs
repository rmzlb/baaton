use axum::{extract::Request, middleware::Next, response::Response};

/// Adds security headers to every response (similar to helmet.js).
pub async fn security_headers(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert("X-Frame-Options", "DENY".parse().unwrap());
    headers.insert("X-Content-Type-Options", "nosniff".parse().unwrap());
    headers.insert("X-XSS-Protection", "1; mode=block".parse().unwrap());
    headers.insert(
        "Referrer-Policy",
        "strict-origin-when-cross-origin".parse().unwrap(),
    );
    headers.insert(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=()".parse().unwrap(),
    );
    // HSTS — always set since the backend runs behind HTTPS in production.
    // Proxies / load balancers will strip it for plain HTTP clients anyway.
    headers.insert(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains".parse().unwrap(),
    );
    // Content-Security-Policy
    headers.insert(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' https://clerk.baaton.dev; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https://api.baaton.dev https://clerk.baaton.dev https://generativelanguage.googleapis.com; frame-src https://clerk.baaton.dev".parse().unwrap(),
    );
    response
}
