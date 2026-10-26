//! The email recap switch (BAA-40).
//!
//! `/me/email-recap` is the person's own setting, like the rest of `/me`: no
//! user id in the path, and an API key acts for its owner. The public link
//! carried by every recap can only turn it off: a GET shows a page with one
//! button (a link scanner following it changes nothing), and the POST that
//! button or the mail client sends (RFC 8058 one-click) unsubscribes.

use axum::{
    body::Bytes,
    extract::{Extension, Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use super::{effective_user_id, internal, ApiErr};
use crate::email_digest::unsubscribe;
use crate::middleware::{rate_limit, AuthUser};
use crate::models::ApiResponse;

#[derive(Serialize)]
pub struct EmailRecapSetting {
    enabled: bool,
}

#[derive(Deserialize)]
pub struct UpdateEmailRecap {
    enabled: bool,
}

pub async fn get_email_recap(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Result<Json<ApiResponse<EmailRecapSetting>>, ApiErr> {
    let user_id = effective_user_id(&auth)?;
    let enabled = unsubscribe::recap_enabled(&pool, &user_id)
        .await
        .map_err(internal)?;
    Ok(Json(ApiResponse::new(EmailRecapSetting { enabled })))
}

pub async fn put_email_recap(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Json(body): Json<UpdateEmailRecap>,
) -> Result<Json<ApiResponse<EmailRecapSetting>>, ApiErr> {
    let user_id = effective_user_id(&auth)?;
    unsubscribe::set_recap_enabled(&pool, &user_id, body.enabled)
        .await
        .map_err(internal)?;
    Ok(Json(ApiResponse::new(EmailRecapSetting {
        enabled: body.enabled,
    })))
}

// ───────────────────────────── public link ─────────────────────────────

/// Who is calling, for the hourly limit of unauthenticated routes. Cloudflare
/// sets `CF-Connecting-IP`; the last `X-Forwarded-For` hop is the one our own
/// proxy appended.
fn client_key(headers: &HeaderMap) -> String {
    let header = |name: &str| {
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::trim)
            .filter(|v| !v.is_empty())
    };
    let ip = header("cf-connecting-ip")
        .or_else(|| header("x-forwarded-for").and_then(|v| v.rsplit(',').next().map(str::trim)))
        .unwrap_or("unknown");
    format!("public:email-unsubscribe:{ip}")
}

/// `false` once the caller is over the limit. A counter failure lets the
/// request through, like the authenticated limits.
async fn within_limit(pool: &PgPool, headers: &HeaderMap) -> bool {
    match rate_limit::check_hourly(
        pool,
        &client_key(headers),
        rate_limit::HOURLY_LIMIT_UNAUTHENTICATED,
    )
    .await
    {
        Ok(r) => r.allowed,
        Err(()) => true,
    }
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#x27;")
}

/// A minimal page: French first, one English line. Names nobody.
fn page(status: StatusCode, title: &str, body_html: &str) -> Response {
    let html = format!(
        r#"<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>{title} · Baaton</title></head>
<body style="margin:0;padding:48px 16px;background:#f6f5f3;color:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
<main style="max-width:440px;margin:0 auto;background:#ffffff;border:1px solid #e6e5e1;border-radius:10px;padding:24px;">
<p style="margin:0 0 16px;font-weight:900;font-size:13px;letter-spacing:0.1em;">BAATON</p>
<h1 style="margin:0 0 8px;font-size:18px;">{title}</h1>
{body_html}
</main></body></html>"#,
        title = escape(title),
    );
    (
        status,
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::CACHE_CONTROL, "no-store"),
            (header::HeaderName::from_static("x-robots-tag"), "noindex"),
        ],
        html,
    )
        .into_response()
}

const P: &str = r#"style="margin:0 0 12px;font-size:14px;line-height:1.5;""#;
const P_EN: &str =
    r#"lang="en" style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#5c5c57;""#;

fn invalid_link() -> Response {
    page(
        StatusCode::NOT_FOUND,
        "Lien non valable",
        &format!(
            "<p {P}>Ce lien de d&#233;sabonnement n&#39;est pas valable ou a expir&#233;. Vous pouvez couper le r&#233;cap dans les r&#233;glages de Baaton.</p>\
             <p {P_EN}>This unsubscribe link is invalid or has expired. You can turn the recap off in Baaton settings.</p>"
        ),
    )
}

fn too_many() -> Response {
    page(
        StatusCode::TOO_MANY_REQUESTS,
        "Trop de demandes",
        &format!(
            "<p {P}>Trop de demandes depuis cette connexion. R&#233;essayez dans une heure.</p>\
             <p {P_EN}>Too many requests from this connection. Try again in an hour.</p>"
        ),
    )
}

fn unavailable(e: sqlx::Error) -> Response {
    tracing::error!(error = %e, "email_unsubscribe.storage_failed");
    page(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Service indisponible",
        &format!(
            "<p {P}>Le d&#233;sabonnement n&#39;a pas pu &#234;tre enregistr&#233;. R&#233;essayez dans quelques minutes.</p>\
             <p {P_EN}>The unsubscribe could not be saved. Try again in a few minutes.</p>"
        ),
    )
}

/// `GET`: the confirmation page. Never unsubscribes on its own.
pub async fn unsubscribe_page(
    State(pool): State<PgPool>,
    Path(token): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !within_limit(&pool, &headers).await {
        return too_many();
    }
    match unsubscribe::token_exists(&pool, &token).await {
        Ok(true) => {}
        Ok(false) => return invalid_link(),
        Err(e) => return unavailable(e),
    }
    page(
        StatusCode::OK,
        "Se d\u{e9}sabonner du r\u{e9}cap email",
        &format!(
            "<p {P}>Vous ne recevrez plus le r&#233;cap de 08:00, 12:00, 16:00 et 20:00. Les @mentions continueront d&#39;arriver.</p>\
             <p {P_EN}>Stop the Baaton email recap. @mentions will still arrive.</p>\
             <form method=\"post\"><input type=\"hidden\" name=\"List-Unsubscribe\" value=\"One-Click\">\
             <button type=\"submit\" style=\"padding:10px 20px;background:#f59e0b;color:#0a0a0a;font-weight:700;font-size:14px;border:0;border-radius:8px;cursor:pointer;\">Me d&#233;sabonner &#183; Unsubscribe</button></form>"
        ),
    )
}

/// `POST` with `List-Unsubscribe=One-Click`: unsubscribes at once. Idempotent.
pub async fn unsubscribe_one_click(
    State(pool): State<PgPool>,
    Path(token): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !within_limit(&pool, &headers).await {
        return too_many();
    }
    if !unsubscribe::is_one_click(&body) {
        return page(
            StatusCode::BAD_REQUEST,
            "Demande incompl\u{e8}te",
            &format!(
                "<p {P}>Utilisez le bouton de la page de d&#233;sabonnement.</p>\
                 <p {P_EN}>Use the button on the unsubscribe page.</p>"
            ),
        );
    }
    match unsubscribe::unsubscribe_with_token(&pool, &token).await {
        Ok(true) => {}
        Ok(false) => return invalid_link(),
        Err(e) => return unavailable(e),
    }
    let settings = std::env::var("NOTIFYD_PUBLIC_URL")
        .ok()
        .map(|u| u.trim().trim_end_matches('/').to_string())
        .filter(|u| u.starts_with("https://"))
        .map(|u| {
            format!(
                " <a href=\"{}/settings\" style=\"color:#0a0a0a;\">R&#233;glages</a>",
                escape(&u)
            )
        })
        .unwrap_or_default();
    page(
        StatusCode::OK,
        "C\u{2019}est fait",
        &format!(
            "<p {P}>Vous ne recevrez plus le r&#233;cap email. Les @mentions continuent d&#39;arriver. Pour le r&#233;activer : Baaton, r&#233;glages Email.{settings}</p>\
             <p {P_EN}>You will no longer receive the email recap. @mentions still arrive. Turn it back on in Baaton email settings.</p>"
        ),
    )
}
