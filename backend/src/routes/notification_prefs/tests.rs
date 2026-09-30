use super::{Recipient, RECIPIENTS_SQL};
use sqlx::{Connection, PgConnection};
use uuid::Uuid;

#[test]
fn recipient_sql_has_no_literal_newline_escape() {
    assert!(!RECIPIENTS_SQL.contains(r"\n"));
}

async fn recipients(
    conn: &mut PgConnection,
    project: Uuid,
    event: &str,
    status: &str,
    actor: &str,
) -> Vec<(String, String)> {
    let rows = sqlx::query_as::<_, Recipient>(RECIPIENTS_SQL)
        .bind(project)
        .bind(event)
        .bind(status)
        .bind(actor)
        .fetch_all(conn)
        .await
        .expect("recipient SQL must execute on PostgreSQL");
    let mut rows: Vec<_> = rows.into_iter().map(|r| (r.user_id, r.channel)).collect();
    rows.sort();
    rows
}

#[tokio::test]
#[ignore = "requires DATABASE_URL_TEST pointing at a disposable PostgreSQL database"]
async fn recipient_sql_postgres_regression() {
    let url = std::env::var("DATABASE_URL_TEST").expect("set DATABASE_URL_TEST explicitly");
    let mut conn = PgConnection::connect(&url).await.unwrap();
    // Temporary tables shadow application names. No permanent writes and no
    // calls to Clerk, notifyd or external recipients occur during this test.
    sqlx::raw_sql(
        r#"
        CREATE TEMP TABLE projects (
            id uuid PRIMARY KEY, notify_statuses jsonb,
            notify_comments boolean, notify_issue_created boolean,
            notification_roles jsonb NOT NULL DEFAULT '[]'
        );
        CREATE TEMP TABLE project_member_roles (
            project_id uuid, user_id text, role text
        );
        CREATE TEMP TABLE project_notification_subscriptions (
            user_id text, project_id uuid, enabled boolean,
            notify_statuses jsonb, notify_comments boolean,
            notify_issue_created boolean, channels text[]
        );
        CREATE TEMP TABLE user_notification_channels (
            user_id text, channel text, address text, verified_at timestamptz
        );
        "#,
    )
    .execute(&mut conn)
    .await
    .unwrap();
    let project = Uuid::new_v4();
    let other_project = Uuid::new_v4();
    for id in [project, other_project] {
        sqlx::query("INSERT INTO projects VALUES ($1, '[\"backlog\",\"not_ok\"]', true, false)")
            .bind(id)
            .execute(&mut conn)
            .await
            .unwrap();
    }
    for (user, id, enabled) in [
        ("watcher", project, true),
        ("other", project, true),
        ("disabled", project, false),
        ("different-project", other_project, true),
    ] {
        sqlx::query("INSERT INTO project_notification_subscriptions VALUES ($1, $2, $3, NULL, NULL, NULL, '{}')")
            .bind(user).bind(id).bind(enabled).execute(&mut conn).await.unwrap();
    }
    sqlx::raw_sql(
        r#"
        INSERT INTO user_notification_channels VALUES
          ('watcher', 'email', 'verified@example.invalid', now()),
          ('other', 'email', 'unverified@example.invalid', NULL);
        "#,
    )
    .execute(&mut conn)
    .await
    .unwrap();
    let expected = vec![
        ("other".into(), "telegram".into()),
        ("watcher".into(), "email".into()),
        ("watcher".into(), "telegram".into()),
    ];
    for actor in ["watcher", "other", "agent", ""] {
        for status in ["backlog", "not_ok"] {
            assert_eq!(
                recipients(&mut conn, project, "status_changed", status, actor).await,
                expected
            );
        }
    }
    assert!(
        recipients(&mut conn, project, "status_changed", "in_review", "other")
            .await
            .is_empty()
    );
    assert!(recipients(&mut conn, project, "issue_created", "", "other")
        .await
        .is_empty());
    assert_eq!(
        recipients(&mut conn, project, "comment_added", "", "watcher").await,
        vec![("other".into(), "telegram".into())]
    );
    sqlx::query("UPDATE project_notification_subscriptions SET channels = '{telegram}' WHERE user_id = 'watcher'")
        .execute(&mut conn).await.unwrap();
    assert_eq!(
        recipients(&mut conn, project, "status_changed", "backlog", "watcher").await,
        vec![
            ("other".into(), "telegram".into()),
            ("watcher".into(), "telegram".into())
        ]
    );
    sqlx::query("UPDATE project_notification_subscriptions SET notify_statuses = '[]' WHERE user_id = 'watcher'")
        .execute(&mut conn).await.unwrap();
    assert_eq!(
        recipients(&mut conn, project, "status_changed", "backlog", "other").await,
        vec![("other".into(), "telegram".into())]
    );

    // ── Project roles ──
    // Fresh project so the subscribers above do not blur what a role adds.
    let roles_project = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO projects VALUES ($1, '["backlog","not_ok"]', true, false, '[
            {"key":"reviewer","label":"Reviewer","notify_statuses":["in_review"],"notify_comments":false,"notify_issue_created":false},
            {"key":"everything","label":"Everything","notify_statuses":["*"],"notify_comments":true,"notify_issue_created":true}
        ]')"#,
    )
    .bind(roles_project).execute(&mut conn).await.unwrap();
    for (user, role) in [
        ("reviewer", "reviewer"),     // role only, no subscription, no channel row
        ("overrides", "reviewer"),    // own subscription pins statuses
        ("muted", "everything"),      // unsubscribed from the project
        ("ghost", "deleted-role"),    // role no longer defined on the project
        ("follower", "everything"),
    ] {
        sqlx::query("INSERT INTO project_member_roles VALUES ($1, $2, $3)")
            .bind(roles_project).bind(user).bind(role).execute(&mut conn).await.unwrap();
    }
    sqlx::query(
        "INSERT INTO project_notification_subscriptions VALUES \
           ('overrides', $1, true, '[\"done\"]', NULL, NULL, '{}'), \
           ('muted', $1, false, NULL, NULL, NULL, '{}')",
    )
    .bind(roles_project).execute(&mut conn).await.unwrap();
    sqlx::raw_sql("INSERT INTO user_notification_channels VALUES ('follower', 'email', 'follower@example.invalid', now())")
        .execute(&mut conn).await.unwrap();

    // A role reaches its holder without any subscription; with no email row at
    // all the SQL yields an email row with an empty address, filled from the
    // account's primary email by `resolve_recipients`.
    assert_eq!(
        recipients(&mut conn, roles_project, "status_changed", "in_review", "").await,
        vec![
            ("follower".into(), "email".into()),
            ("follower".into(), "telegram".into()),
            ("reviewer".into(), "email".into()),
            ("reviewer".into(), "telegram".into()),
        ]
    );
    let reviewer_email: Vec<String> = sqlx::query_as::<_, Recipient>(RECIPIENTS_SQL)
        .bind(roles_project).bind("status_changed").bind("in_review").bind("")
        .fetch_all(&mut conn).await.unwrap()
        .into_iter()
        .filter(|r| r.user_id == "reviewer" && r.channel == "email")
        .map(|r| r.address)
        .collect();
    assert_eq!(reviewer_email, vec![String::new()]);
    // The role replaces the project default: a reviewer does not hear backlog,
    // and "*" covers statuses nobody listed.
    assert_eq!(
        recipients(&mut conn, roles_project, "status_changed", "backlog", "").await,
        vec![
            ("follower".into(), "email".into()),
            ("follower".into(), "telegram".into()),
        ]
    );
    // A member's own value beats their role.
    assert_eq!(
        recipients(&mut conn, roles_project, "status_changed", "done", "").await,
        vec![
            ("follower".into(), "email".into()),
            ("follower".into(), "telegram".into()),
            ("overrides".into(), "email".into()),
            ("overrides".into(), "telegram".into()),
        ]
    );
    // Comments follow the role flag, and the commenter is never told.
    assert_eq!(
        recipients(&mut conn, roles_project, "comment_added", "", "follower").await,
        Vec::<(String, String)>::new()
    );
    assert_eq!(
        recipients(&mut conn, roles_project, "issue_created", "", "").await,
        vec![
            ("follower".into(), "email".into()),
            ("follower".into(), "telegram".into()),
        ]
    );
    conn.close().await.unwrap();
}
