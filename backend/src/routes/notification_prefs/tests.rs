use super::{Recipient, DEFAULT_ROUTING_EXCLUDED_SQL, RECIPIENTS_SQL};
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

    // ── Ticket participants (creator, reporter, assignees) ──
    // The opt-out default must leave alone anyone whose project preferences
    // already decide: an unsubscribed member, and a role holder, whose role
    // `RECIPIENTS_SQL` applies to every ticket, their own included. A role key
    // the project no longer defines grants nothing, so the default still applies.
    let excluded = |project: Uuid, participants: &'static [&'static str]| {
        let participants: Vec<String> = participants.iter().map(|p| p.to_string()).collect();
        sqlx::query_scalar::<_, String>(DEFAULT_ROUTING_EXCLUDED_SQL)
            .bind(project)
            .bind(participants)
    };
    let mut out = excluded(
        roles_project,
        &[
            "reviewer",
            "overrides",
            "muted",
            "ghost",
            "follower",
            "plain",
        ],
    )
    .fetch_all(&mut conn)
    .await
    .unwrap();
    out.sort();
    assert_eq!(out, vec!["follower", "muted", "overrides", "reviewer"]);
    let mut out = excluded(project, &["disabled", "watcher", "plain"])
        .fetch_all(&mut conn)
        .await
        .unwrap();
    out.sort();
    assert_eq!(out, vec!["disabled"]);
    // Roles are per project: the same user holds none elsewhere.
    assert!(excluded(other_project, &["reviewer"])
        .fetch_all(&mut conn)
        .await
        .unwrap()
        .is_empty());
    // ── A ticket's creator who holds a role (BAA-38) ──
    // Their role alone decides, their own tickets included: a Reviewer whose
    // role asks for In Review and comments hears exactly that. The participant
    // default must leave them alone, and email drops them when they act.
    let review_project = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO projects VALUES ($1, '["backlog","in_progress","in_review"]', true, true, '[
            {"key":"reviewer","label":"Reviewer","notify_statuses":["in_review"],"notify_comments":true,"notify_issue_created":false}
        ]')"#,
    )
    .bind(review_project).execute(&mut conn).await.unwrap();
    sqlx::query("INSERT INTO project_member_roles VALUES ($1, 'creator', 'reviewer'), ($1, 'pinned', 'reviewer')")
        .bind(review_project).execute(&mut conn).await.unwrap();
    sqlx::query("INSERT INTO project_notification_subscriptions VALUES ('pinned', $1, true, '[\"in_review\"]', NULL, NULL, '{}')")
        .bind(review_project).execute(&mut conn).await.unwrap();
    sqlx::raw_sql("INSERT INTO user_notification_channels VALUES ('creator', 'email', 'creator@example.invalid', now())")
        .execute(&mut conn).await.unwrap();
    let with_reason = |rows: Vec<Recipient>| {
        let mut rows: Vec<_> = rows
            .into_iter()
            .map(|r| (r.user_id, r.channel, r.reason))
            .collect();
        rows.sort();
        rows
    };
    let run = |event: &'static str, status: &'static str, actor: &'static str| {
        sqlx::query_as::<_, Recipient>(RECIPIENTS_SQL)
            .bind(review_project)
            .bind(event)
            .bind(status)
            .bind(actor)
    };
    // The project default would announce these; the role does not ask for them.
    for status in ["in_progress", "backlog"] {
        assert!(
            run("status_changed", status, "agent")
                .fetch_all(&mut conn)
                .await
                .unwrap()
                .is_empty(),
            "{status}"
        );
    }
    let r = |u: &str, c: &str, why: &str| (u.to_string(), c.to_string(), why.to_string());
    assert_eq!(
        with_reason(
            run("status_changed", "in_review", "agent")
                .fetch_all(&mut conn)
                .await
                .unwrap()
        ),
        vec![
            r("creator", "email", "role:Reviewer"),
            r("creator", "telegram", "role:Reviewer"),
            // Their own value for statuses decided, not the role.
            r("pinned", "email", "subscription"),
            r("pinned", "telegram", "subscription"),
        ]
    );
    assert_eq!(
        with_reason(
            run("comment_added", "", "agent")
                .fetch_all(&mut conn)
                .await
                .unwrap()
        ),
        vec![
            r("creator", "email", "role:Reviewer"),
            r("creator", "telegram", "role:Reviewer"),
            r("pinned", "email", "role:Reviewer"),
            r("pinned", "telegram", "role:Reviewer"),
        ]
    );
    assert!(run("issue_created", "", "agent")
        .fetch_all(&mut conn)
        .await
        .unwrap()
        .is_empty());
    let excluded: Vec<String> = sqlx::query_scalar(DEFAULT_ROUTING_EXCLUDED_SQL)
        .bind(review_project)
        .bind(vec!["creator".to_string()])
        .fetch_all(&mut conn)
        .await
        .unwrap();
    assert_eq!(
        excluded,
        vec!["creator"],
        "the participant default must not add what the role leaves out"
    );
    // The creator moves their own ticket to review: Telegram keeps them, email does not.
    let own = run("status_changed", "in_review", "creator")
        .fetch_all(&mut conn)
        .await
        .unwrap();
    let (email, other) = crate::email_digest::split_email(own, "creator");
    assert!(email.iter().all(|e| e.user_id != "creator"));
    assert!(other
        .iter()
        .any(|o| o.user_id == "creator" && o.channel == "telegram"));
    conn.close().await.unwrap();
}
