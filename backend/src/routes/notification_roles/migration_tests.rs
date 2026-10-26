//! Migration 084 changes no one's notifications.
//!
//! For every (project, member), the role key and the definition it resolves to
//! must be the same before (080 layout, read the 080 way) and after (084
//! layout, read by the send path's own `MEMBER_RULES_SQL`). Subscriptions are
//! untouched by the migration, so equal roles mean equal routing.
//!
//! Runs in a schema of its own on the disposable database named by
//! `DATABASE_URL_TEST`, dropped at the end.

use std::collections::BTreeSet;

use serde_json::{json, Value};
use sqlx::{Connection, PgConnection};
use uuid::Uuid;

use crate::routes::notification_prefs::MEMBER_RULES_SQL;

type Effective = BTreeSet<(Uuid, String, String, Option<String>)>;

fn role(key: &str, statuses: &[&str], comments: bool, created: bool) -> Value {
    let label = match key {
        "reviewer" => "Reviewer",
        "dev" => "Dev",
        "everything" => "Everything",
        other => other,
    };
    json!({"key": key, "label": label, "notify_statuses": statuses,
           "notify_comments": comments, "notify_issue_created": created})
}

/// The 080 defaults, which every project created before 084 started from.
fn defaults_080() -> Value {
    json!([
        role("reviewer", &["in_review"], false, false),
        role("dev", &["not_ok", "backlog"], false, false),
        role("everything", &["*"], true, true),
    ])
}

/// The 084 defaults: Reviewer also hears comments.
fn defaults_084() -> Value {
    json!([
        role("reviewer", &["in_review"], true, false),
        role("dev", &["not_ok", "backlog"], false, false),
        role("everything", &["*"], true, true),
    ])
}

async fn project(conn: &mut PgConnection, org: &str, roles: &Value) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO projects (id, org_id, notification_roles) VALUES ($1, $2, $3)")
        .bind(id)
        .bind(org)
        .bind(roles)
        .execute(&mut *conn)
        .await
        .unwrap();
    id
}

async fn assign(conn: &mut PgConnection, project: Uuid, user: &str, role: &str) {
    sqlx::query("INSERT INTO project_member_roles (project_id, user_id, role) VALUES ($1, $2, $3)")
        .bind(project)
        .bind(user)
        .bind(role)
        .execute(&mut *conn)
        .await
        .unwrap();
}

fn canonical(v: Option<Value>) -> Option<String> {
    v.map(|v| v.to_string())
}

/// What 080 routed by: the member's row on the project, resolved against the
/// project's own roles.
async fn effective_080(conn: &mut PgConnection) -> Effective {
    let rows: Vec<(Uuid, String, String, Option<Value>)> = sqlx::query_as(
        "SELECT mr.project_id, mr.user_id, mr.role, \
                (SELECT r FROM jsonb_array_elements(p.notification_roles) r \
                  WHERE r->>'key' = mr.role LIMIT 1) \
           FROM project_member_roles mr JOIN projects p ON p.id = mr.project_id",
    )
    .fetch_all(&mut *conn)
    .await
    .unwrap();
    rows.into_iter()
        .map(|(p, u, r, d)| (p, u, r, canonical(d)))
        .collect()
}

/// What the send path routes by after 084.
async fn effective_084(conn: &mut PgConnection, projects: &[Uuid]) -> Effective {
    let sql = format!(
        "SELECT user_id, role_key, role_def FROM ({MEMBER_RULES_SQL}) u WHERE role_key IS NOT NULL"
    );
    let mut out = Effective::new();
    for &p in projects {
        let rows: Vec<(String, String, Option<Value>)> = sqlx::query_as(&sql)
            .bind(p)
            .fetch_all(&mut *conn)
            .await
            .unwrap();
        out.extend(rows.into_iter().map(|(u, r, d)| (p, u, r, canonical(d))));
    }
    out
}

#[tokio::test]
#[ignore = "requires DATABASE_URL_TEST pointing at a disposable PostgreSQL database"]
async fn migration_084_keeps_every_member_role() {
    let url = std::env::var("DATABASE_URL_TEST").expect("set DATABASE_URL_TEST explicitly");
    let mut conn = PgConnection::connect(&url).await.unwrap();
    let schema = format!("baa39_{}", Uuid::new_v4().simple());
    sqlx::raw_sql(&format!(
        "CREATE SCHEMA {schema}; SET search_path TO {schema};"
    ))
    .execute(&mut conn)
    .await
    .unwrap();

    // The pre-080 tables 080 and 084 touch, reduced to the columns they read.
    sqlx::raw_sql(
        r#"
        CREATE TABLE organizations (id text PRIMARY KEY);
        CREATE TABLE projects (
            id uuid PRIMARY KEY, org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            notify_statuses jsonb NOT NULL DEFAULT '["done"]',
            notify_comments boolean NOT NULL DEFAULT false,
            notify_issue_created boolean NOT NULL DEFAULT false
        );
        CREATE TABLE project_notification_subscriptions (
            user_id text, project_id uuid, enabled boolean, notify_statuses jsonb,
            notify_comments boolean, notify_issue_created boolean, channels text[]
        );
        INSERT INTO organizations VALUES ('sqhelm'), ('mixed'), ('single'), ('empty'), ('untouched');
        "#,
    )
    .execute(&mut conn)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../migrations/080_project_notification_roles.sql"
    ))
    .execute(&mut conn)
    .await
    .unwrap();

    // The real case: SqareX and HelmAI agree, Yacine Reviewer and rmzlb Dev on both.
    let sqhelm_roles = json!([
        role("reviewer", &["in_review"], true, false),
        role("dev", &["not_ok", "backlog"], false, false),
        role("everything", &["*"], true, true),
    ]);
    let sqarex = project(&mut conn, "sqhelm", &sqhelm_roles).await;
    let helmai = project(&mut conn, "sqhelm", &sqhelm_roles).await;
    for p in [sqarex, helmai] {
        assign(&mut conn, p, "yacine", "reviewer").await;
        assign(&mut conn, p, "rmzlb", "dev").await;
    }

    // Projects that disagree: one on the 080 defaults, one with its own
    // Reviewer, one already equal to the 084 defaults.
    let reviewer_with_done = json!([role("reviewer", &["in_review", "done"], false, false)]);
    let m1 = project(&mut conn, "mixed", &defaults_080()).await;
    let m2 = project(&mut conn, "mixed", &reviewer_with_done).await;
    let m3 = project(&mut conn, "mixed", &defaults_084()).await;
    for p in [m1, m2, m3] {
        assign(&mut conn, p, "same-everywhere", "reviewer").await; // same key, three definitions
        assign(&mut conn, p, "ghost", "removed-role").await; // a key nobody defines
    }
    assign(&mut conn, m1, "varies", "reviewer").await;
    assign(&mut conn, m2, "varies", "reviewer").await;
    assign(&mut conn, m3, "varies", "dev").await;
    assign(&mut conn, m1, "partial", "dev").await;
    assign(&mut conn, m2, "partial", "dev").await;

    let single = project(&mut conn, "single", &defaults_080()).await;
    assign(&mut conn, single, "solo", "everything").await;
    let untouched = project(&mut conn, "untouched", &defaults_080()).await;

    let projects = [sqarex, helmai, m1, m2, m3, single, untouched];
    let before = effective_080(&mut conn).await;
    let legacy_before: Vec<(Uuid, Value)> =
        sqlx::query_as("SELECT id, notification_roles FROM projects ORDER BY id")
            .fetch_all(&mut conn)
            .await
            .unwrap();
    let legacy_rows_before: i64 = sqlx::query_scalar("SELECT count(*) FROM project_member_roles")
        .fetch_one(&mut conn)
        .await
        .unwrap();

    sqlx::raw_sql(include_str!(
        "../../../migrations/084_org_notification_roles.sql"
    ))
    .execute(&mut conn)
    .await
    .unwrap();

    // The rule itself: same role, same definition, for every (project, member).
    let after = effective_084(&mut conn, &projects).await;
    assert_eq!(before, after);
    assert_eq!(before.len(), 16);

    // The revision serving during the deploy still reads the 080 layout.
    let legacy_after: Vec<(Uuid, Value)> =
        sqlx::query_as("SELECT id, notification_roles FROM projects ORDER BY id")
            .fetch_all(&mut conn)
            .await
            .unwrap();
    assert_eq!(legacy_before, legacy_after);
    let legacy_rows_after: i64 = sqlx::query_scalar("SELECT count(*) FROM project_member_roles")
        .fetch_one(&mut conn)
        .await
        .unwrap();
    assert_eq!(legacy_rows_before, legacy_rows_after);

    // Shape of the result.
    let org_roles = |org: &'static str| {
        sqlx::query_scalar::<_, Value>("SELECT notification_roles FROM organizations WHERE id = $1")
            .bind(org)
    };
    let custom = |p: Uuid| {
        sqlx::query_scalar::<_, Option<Value>>(
            "SELECT custom_notification_roles FROM projects WHERE id = $1",
        )
        .bind(p)
    };
    let org_members = |org: &'static str| {
        sqlx::query_as::<_, (String, String)>(
            "SELECT user_id, role FROM org_member_roles WHERE org_id = $1 ORDER BY user_id",
        )
        .bind(org)
    };
    let overrides = |org: &'static str| {
        sqlx::query_as::<_, (Uuid, String, Option<String>)>(
            "SELECT o.project_id, o.user_id, o.role FROM project_member_role_overrides o \
               JOIN projects p ON p.id = o.project_id WHERE p.org_id = $1 ORDER BY o.user_id, o.role",
        )
        .bind(org)
    };
    let s = |v: &str| v.to_string();

    // sqhelm: the org holds the roles, both projects inherit, Yacine and rmzlb
    // hold their role for the org, and no project row remains.
    assert_eq!(
        org_roles("sqhelm").fetch_one(&mut conn).await.unwrap(),
        sqhelm_roles
    );
    for p in [sqarex, helmai] {
        assert_eq!(custom(p).fetch_one(&mut conn).await.unwrap(), None);
    }
    assert_eq!(
        org_members("sqhelm").fetch_all(&mut conn).await.unwrap(),
        vec![(s("rmzlb"), s("dev")), (s("yacine"), s("reviewer"))]
    );
    assert!(overrides("sqhelm")
        .fetch_all(&mut conn)
        .await
        .unwrap()
        .is_empty());

    // Disagreeing projects: the org gets the 084 defaults; the project already
    // equal to them inherits, the others keep their roles as their own.
    assert_eq!(
        org_roles("mixed").fetch_one(&mut conn).await.unwrap(),
        defaults_084()
    );
    assert_eq!(
        custom(m1).fetch_one(&mut conn).await.unwrap(),
        Some(defaults_080())
    );
    assert_eq!(
        custom(m2).fetch_one(&mut conn).await.unwrap(),
        Some(reviewer_with_done)
    );
    assert_eq!(custom(m3).fetch_one(&mut conn).await.unwrap(), None);
    assert_eq!(
        org_members("mixed").fetch_all(&mut conn).await.unwrap(),
        vec![
            (s("ghost"), s("removed-role")),
            (s("same-everywhere"), s("reviewer"))
        ]
    );
    let mut mixed_overrides = overrides("mixed").fetch_all(&mut conn).await.unwrap();
    mixed_overrides.sort();
    let mut expected = vec![
        (m1, s("partial"), Some(s("dev"))),
        (m2, s("partial"), Some(s("dev"))),
        (m1, s("varies"), Some(s("reviewer"))),
        (m2, s("varies"), Some(s("reviewer"))),
        (m3, s("varies"), Some(s("dev"))),
    ];
    expected.sort();
    assert_eq!(mixed_overrides, expected);

    // One project: its roles are the org's, its members' roles are the org's.
    assert_eq!(
        org_roles("single").fetch_one(&mut conn).await.unwrap(),
        defaults_080()
    );
    assert_eq!(
        org_members("single").fetch_all(&mut conn).await.unwrap(),
        vec![(s("solo"), s("everything"))]
    );
    // No project: the 084 defaults, ready for the first project.
    assert_eq!(
        org_roles("empty").fetch_one(&mut conn).await.unwrap(),
        defaults_084()
    );
    assert_eq!(custom(untouched).fetch_one(&mut conn).await.unwrap(), None);

    sqlx::raw_sql(&format!("DROP SCHEMA {schema} CASCADE"))
        .execute(&mut conn)
        .await
        .unwrap();
    conn.close().await.unwrap();
}
