//! "What you receive": for each project the caller can see, the rules that
//! will actually route to them, why, and on which channels (BAA-39).
//!
//! Nothing here decides anything. The rules come from `MEMBER_SUMMARY_SQL`,
//! built on the very `member_rules_sql!` the send path runs, and "your own
//! tickets" from `DEFAULT_ROUTING_EXCLUDED_SQL`, the participant default's own
//! test. A change to the routing therefore changes this screen with it.

use axum::{
    extract::{Extension, State},
    Json,
};
use serde::Serialize;
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use super::{
    effective_user_id, internal, telegram_routes, user_org_ids, ApiErr,
    DEFAULT_ROUTING_EXCLUDED_SQL, MEMBER_SUMMARY_SQL,
};
use crate::middleware::AuthUser;
use crate::models::ApiResponse;

#[derive(sqlx::FromRow)]
struct ProjectRow {
    project_id: Uuid,
    project_name: String,
    project_slug: String,
    org_id: String,
    org_name: String,
    statuses: Value,
}

#[derive(sqlx::FromRow)]
struct RulesRow {
    subscribed: bool,
    role_key: Option<String>,
    role_assigned_in: Option<String>,
    roles_defined_in: String,
    role_defined: bool,
    role_label: Option<String>,
    active: bool,
    statuses: Option<Value>,
    statuses_from: String,
    comments: Option<bool>,
    comments_from: String,
    issue_created: Option<bool>,
    issue_created_from: String,
    direct_channels: Vec<String>,
    email_fallback: bool,
    telegram_allowed: bool,
}

#[derive(Debug, Serialize)]
pub struct SummaryRole {
    pub key: String,
    pub label: String,
    /// `org`: given for the whole organization; `project`: on this project.
    pub assigned_in: String,
    /// Whose definitions apply: the org's, or this project's own.
    pub defined_in: String,
    /// False when the definitions in force no longer have this role: it grants nothing.
    pub defined: bool,
}

#[derive(Debug, Serialize)]
pub struct SummaryStatus {
    pub key: String,
    pub label: String,
}

/// One kind of event and who decided it. `source` is `personal` (the person's
/// own setting), `role`, or `project_default` (followed through a
/// subscription); `null` when the event is not received.
#[derive(Debug, Serialize)]
pub struct SummaryRule<T: Serialize> {
    pub value: T,
    pub source: Option<&'static str>,
}

#[derive(Debug, Serialize)]
pub struct ProjectSummary {
    pub project_id: Uuid,
    pub project_name: String,
    pub project_slug: String,
    pub org_id: String,
    pub org_name: String,
    /// `none`, `subscribed` or `unsubscribed` (which mutes roles and own tickets).
    pub subscription: &'static str,
    pub role: Option<SummaryRole>,
    /// Every status, including ones added later (`*`).
    pub all_statuses: bool,
    pub statuses: SummaryRule<Vec<SummaryStatus>>,
    pub comments: SummaryRule<bool>,
    pub issue_created: SummaryRule<bool>,
    /// Status changes and comments on tickets the person created, requested or
    /// is assigned to — for a member whom no role routes here.
    pub own_tickets: bool,
    /// Channels the rules above reach.
    pub channels: Vec<String>,
    /// Channels "your tickets" reach.
    pub own_tickets_channels: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct EmailSummary {
    /// Masked address the recap goes to, `null` when there is none.
    pub address: Option<String>,
    /// `channel`: an address set in these settings; `account`: the account's
    /// primary email, used for roles and own tickets when none is set.
    pub source: Option<&'static str>,
    /// An address is set but not confirmed: nothing is mailed to it.
    pub unverified: bool,
    pub recap_hours: [u32; 4],
    pub time_zone: &'static str,
}

#[derive(Debug, Serialize)]
pub struct NotificationSummary {
    pub email: EmailSummary,
    pub telegram_connected: bool,
    /// An @mention is mailed within minutes, outside the recap.
    pub mentions: &'static str,
    pub projects: Vec<ProjectSummary>,
}

fn source(from: &str) -> &'static str {
    match from {
        "own" => "personal",
        "role" => "role",
        _ => "project_default",
    }
}

fn labelled(keys: &[String], statuses: &Value) -> Vec<SummaryStatus> {
    keys.iter()
        .map(|key| {
            let label = statuses
                .as_array()
                .and_then(|a| {
                    a.iter()
                        .find(|s| s.get("key").and_then(Value::as_str) == Some(key))
                })
                .and_then(|s| s.get("label").and_then(Value::as_str))
                .unwrap_or(key);
            SummaryStatus {
                key: key.clone(),
                label: label.to_string(),
            }
        })
        .collect()
}

/// The person's own channels, as the participant default reaches them:
/// confirmed addresses, the account email when no email address is set, and
/// Telegram when a route exists.
struct PersonChannels {
    confirmed: Vec<(String, String)>,
    has_email_row: bool,
    account_email: Option<String>,
    telegram: bool,
}

impl PersonChannels {
    fn email_reachable(&self, direct: bool, fallback: bool) -> bool {
        direct || (fallback && self.account_email.is_some())
    }

    fn own_tickets(&self) -> Vec<String> {
        let mut out: Vec<String> = self.confirmed.iter().map(|(c, _)| c.clone()).collect();
        if !self.has_email_row && self.account_email.is_some() {
            out.push("email".into());
        }
        if self.telegram {
            out.push("telegram".into());
        }
        out.sort();
        out.dedup();
        out
    }
}

fn project_summary(
    project: ProjectRow,
    rules: Option<RulesRow>,
    own_tickets: bool,
    person: &PersonChannels,
) -> ProjectSummary {
    let subscription = match &rules {
        Some(r) if r.subscribed && r.active => "subscribed",
        Some(r) if r.subscribed => "unsubscribed",
        _ => "none",
    };
    let role = rules.as_ref().and_then(|r| {
        Some(SummaryRole {
            key: r.role_key.clone()?,
            label: r.role_label.clone().unwrap_or_default(),
            assigned_in: r.role_assigned_in.clone().unwrap_or_default(),
            defined_in: r.roles_defined_in.clone(),
            defined: r.role_defined,
        })
    });
    let active = rules.as_ref().filter(|r| r.active);

    let keys: Vec<String> = active
        .and_then(|r| r.statuses.as_ref())
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let all_statuses = keys.iter().any(|k| k == "*");
    let keys: Vec<String> = if all_statuses {
        crate::routes::notification_roles::status_keys(&project.statuses)
    } else {
        keys
    };
    let statuses = SummaryRule {
        source: active
            .filter(|_| !keys.is_empty())
            .map(|r| source(&r.statuses_from)),
        value: labelled(&keys, &project.statuses),
    };
    let comments_on = active.and_then(|r| r.comments).unwrap_or(false);
    let created_on = active.and_then(|r| r.issue_created).unwrap_or(false);
    let comments = SummaryRule {
        value: comments_on,
        source: active
            .filter(|_| comments_on)
            .map(|r| source(&r.comments_from)),
    };
    let issue_created = SummaryRule {
        value: created_on,
        source: active
            .filter(|_| created_on)
            .map(|r| source(&r.issue_created_from)),
    };

    let mut channels: Vec<String> = Vec::new();
    if let Some(r) = active {
        for c in &r.direct_channels {
            if c != "email" {
                channels.push(c.clone());
            }
        }
        if person.email_reachable(
            r.direct_channels.iter().any(|c| c == "email"),
            r.email_fallback,
        ) {
            channels.push("email".into());
        }
        if r.telegram_allowed && person.telegram {
            channels.push("telegram".into());
        }
        channels.sort();
        channels.dedup();
    }

    ProjectSummary {
        project_id: project.project_id,
        project_name: project.project_name,
        project_slug: project.project_slug,
        org_id: project.org_id,
        org_name: project.org_name,
        subscription,
        role,
        all_statuses,
        statuses,
        comments,
        issue_created,
        own_tickets,
        channels,
        own_tickets_channels: if own_tickets {
            person.own_tickets()
        } else {
            Vec::new()
        },
    }
}

/// `GET /me/notification-summary`: what the caller (or the owner of the API
/// key) receives, project by project.
pub async fn notification_summary(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Extension(notifyd): Extension<Option<crate::notifyd::NotifydClient>>,
) -> Result<Json<ApiResponse<NotificationSummary>>, ApiErr> {
    let user_id = effective_user_id(&auth)?;
    let org_ids = user_org_ids(&auth, &user_id).await?;

    let projects = sqlx::query_as::<_, ProjectRow>(
        "SELECT p.id AS project_id, p.name AS project_name, p.slug AS project_slug, \
                p.org_id, o.name AS org_name, p.statuses \
           FROM projects p JOIN organizations o ON o.id = p.org_id \
          WHERE p.org_id = ANY($1) AND (cardinality($2::uuid[]) = 0 OR p.id = ANY($2)) \
          ORDER BY o.name, p.name",
    )
    .bind(&org_ids)
    .bind(&auth.scoped_project_ids)
    .fetch_all(&pool)
    .await
    .map_err(internal)?;

    let rows: Vec<(String, String, Option<chrono::DateTime<chrono::Utc>>)> = sqlx::query_as(
        "SELECT channel, address, verified_at FROM user_notification_channels \
          WHERE user_id = $1 AND channel <> 'telegram' ORDER BY channel",
    )
    .bind(&user_id)
    .fetch_all(&pool)
    .await
    .map_err(internal)?;
    let email_row = rows.iter().find(|(c, _, _)| c == "email");
    let account_email = if email_row.is_none() {
        crate::middleware::resolve_profile_cached(&user_id)
            .await
            .and_then(|(_, email)| email)
    } else {
        None
    };
    let telegram = match notifyd.as_ref() {
        Some(client) => telegram_routes(client, std::slice::from_ref(&user_id))
            .await
            .contains_key(&user_id),
        None => false,
    };
    let person = PersonChannels {
        confirmed: rows
            .iter()
            .filter(|(_, _, verified)| verified.is_some())
            .map(|(c, a, _)| (c.clone(), a.clone()))
            .collect(),
        has_email_row: email_row.is_some(),
        account_email,
        telegram,
    };

    let mut out = Vec::with_capacity(projects.len());
    for project in projects {
        let rules = sqlx::query_as::<_, RulesRow>(MEMBER_SUMMARY_SQL)
            .bind(project.project_id)
            .bind(&user_id)
            .fetch_optional(&pool)
            .await
            .map_err(internal)?;
        let excluded: Vec<String> = sqlx::query_scalar(DEFAULT_ROUTING_EXCLUDED_SQL)
            .bind(project.project_id)
            .bind(std::slice::from_ref(&user_id))
            .fetch_all(&pool)
            .await
            .map_err(internal)?;
        out.push(project_summary(
            project,
            rules,
            excluded.is_empty(),
            &person,
        ));
    }

    let email = match email_row {
        Some((_, address, verified)) => EmailSummary {
            address: verified.map(|_| crate::models::mask_address("email", address)),
            source: verified.map(|_| "channel"),
            unverified: verified.is_none(),
            recap_hours: crate::email_digest::SLOT_HOURS,
            time_zone: "Europe/Paris",
        },
        None => EmailSummary {
            address: person
                .account_email
                .as_deref()
                .map(|a| crate::models::mask_address("email", a)),
            source: person.account_email.as_ref().map(|_| "account"),
            unverified: false,
            recap_hours: crate::email_digest::SLOT_HOURS,
            time_zone: "Europe/Paris",
        },
    };

    Ok(Json(ApiResponse::new(NotificationSummary {
        email,
        telegram_connected: person.telegram,
        mentions: "immediate",
        projects: out,
    })))
}
