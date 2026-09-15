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
            notify_comments boolean, notify_issue_created boolean
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
    conn.close().await.unwrap();
}
