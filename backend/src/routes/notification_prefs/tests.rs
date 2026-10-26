use super::{Recipient, DEFAULT_ROUTING_EXCLUDED_SQL, MEMBER_SUMMARY_SQL, RECIPIENTS_SQL};
use sqlx::{Connection, PgConnection};
use uuid::Uuid;

#[test]
fn recipient_sql_has_no_literal_newline_escape() {
    assert!(!RECIPIENTS_SQL.contains(r"\n"));
}

/// `active, statuses, comments, issue_created` of one summary row.
type SummaryFlags = (bool, Option<serde_json::Value>, Option<bool>, Option<bool>);

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
        CREATE TEMP TABLE organizations (
            id text PRIMARY KEY, notification_roles jsonb NOT NULL DEFAULT '[]'
        );
        INSERT INTO organizations (id) VALUES ('org-a'), ('org-b');
        -- `notification_roles` and `project_member_roles` are the 080 layout,
        -- kept for the revision still running during the deploy (084). They stay
        -- empty here: the routing must not read them any more.
        CREATE TEMP TABLE projects (
            id uuid PRIMARY KEY, notify_statuses jsonb,
            notify_comments boolean, notify_issue_created boolean,
            custom_notification_roles jsonb,
            org_id text NOT NULL DEFAULT 'org-a',
            notification_roles jsonb NOT NULL DEFAULT '[]'
        );
        CREATE TEMP TABLE project_member_roles (
            project_id uuid, user_id text, role text
        );
        CREATE TEMP TABLE project_member_role_overrides (
            project_id uuid, user_id text, role text
        );
        CREATE TEMP TABLE org_member_roles (
            org_id text, user_id text, role text
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
        sqlx::query("INSERT INTO project_member_role_overrides VALUES ($1, $2, $3)")
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
    sqlx::query("INSERT INTO project_member_role_overrides VALUES ($1, 'creator', 'reviewer'), ($1, 'pinned', 'reviewer')")
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

    // ── Roles defined once for the organization (BAA-39) ──
    // org-c defines Reviewer and Dev; members hold them org-wide, with no row on
    // any project. One project inherits, one has its own roles. org-d gives
    // Yacine another role, which must never leak into org-c's projects.
    sqlx::raw_sql(
        r#"
        INSERT INTO organizations VALUES
          ('org-c', '[
            {"key":"reviewer","label":"Reviewer","notify_statuses":["in_review"],"notify_comments":true,"notify_issue_created":false},
            {"key":"dev","label":"Dev","notify_statuses":["not_ok","backlog"],"notify_comments":false,"notify_issue_created":false}
          ]'),
          ('org-d', '[
            {"key":"everything","label":"Everything","notify_statuses":["*"],"notify_comments":true,"notify_issue_created":true}
          ]');
        INSERT INTO org_member_roles VALUES
          ('org-c', 'yacine', 'reviewer'),
          ('org-c', 'rmz', 'dev'),
          ('org-c', 'muted', 'reviewer'),     -- unsubscribed from the inheriting project
          ('org-c', 'pinned-none', 'reviewer'), -- "no role" on the inheriting project
          ('org-c', 'swapped', 'reviewer'),   -- Dev on the inheriting project
          ('org-c', 'orphan', 'gone'),        -- a role org-c no longer defines
          ('org-d', 'yacine', 'everything');
        "#,
    )
    .execute(&mut conn)
    .await
    .unwrap();
    let inherit_p = Uuid::new_v4();
    let custom_p = Uuid::new_v4();
    let org_d_p = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO projects (id, notify_statuses, notify_comments, notify_issue_created, custom_notification_roles, org_id) VALUES
            ($1, '["done"]', true, false, NULL, 'org-c'),
            ($2, '["done"]', true, false, '[
              {"key":"reviewer","label":"Reviewer","notify_statuses":["todo"],"notify_comments":false,"notify_issue_created":false}
            ]', 'org-c'),
            ($3, '["done"]', false, false, NULL, 'org-d')"#,
    )
    .bind(inherit_p)
    .bind(custom_p)
    .bind(org_d_p)
    .execute(&mut conn)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO project_member_role_overrides VALUES ($1, 'pinned-none', NULL), ($1, 'swapped', 'dev')",
    )
    .bind(inherit_p)
    .execute(&mut conn)
    .await
    .unwrap();
    sqlx::query("INSERT INTO project_notification_subscriptions VALUES ('muted', $1, false, NULL, NULL, NULL, '{}')")
        .bind(inherit_p)
        .execute(&mut conn)
        .await
        .unwrap();
    let users = |rows: Vec<(String, String)>| {
        let mut users: Vec<String> = rows.into_iter().map(|(u, _)| u).collect();
        users.dedup();
        users
    };
    let names = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();

    // An org role reaches its holder on a project that has no row for them.
    assert_eq!(
        users(recipients(&mut conn, inherit_p, "status_changed", "in_review", "").await),
        names(&["yacine"])
    );
    assert_eq!(
        users(recipients(&mut conn, inherit_p, "status_changed", "not_ok", "").await),
        names(&["rmz", "swapped"]),
        "the project override (Dev) replaces the org role (Reviewer)"
    );
    assert_eq!(
        users(recipients(&mut conn, inherit_p, "comment_added", "", "someone").await),
        names(&["yacine"])
    );
    assert!(
        recipients(&mut conn, inherit_p, "status_changed", "in_progress", "")
            .await
            .is_empty()
    );
    assert!(recipients(&mut conn, inherit_p, "issue_created", "", "")
        .await
        .is_empty());
    let org_reason: Vec<String> = sqlx::query_as::<_, Recipient>(RECIPIENTS_SQL)
        .bind(inherit_p)
        .bind("status_changed")
        .bind("in_review")
        .bind("")
        .fetch_all(&mut conn)
        .await
        .unwrap()
        .into_iter()
        .map(|r| r.reason)
        .collect();
    assert_eq!(org_reason, vec!["role:Reviewer", "role:Reviewer"]);

    // A project with its own roles uses its own definition, also for members
    // whose role comes from the org, and a role it does not define grants nothing.
    assert_eq!(
        users(recipients(&mut conn, custom_p, "status_changed", "todo", "").await),
        names(&["muted", "pinned-none", "swapped", "yacine"])
    );
    assert!(
        recipients(&mut conn, custom_p, "status_changed", "in_review", "")
            .await
            .is_empty()
    );
    assert!(
        recipients(&mut conn, custom_p, "status_changed", "not_ok", "")
            .await
            .is_empty()
    );

    // Roles are read at send time: editing the org's Reviewer changes every
    // project that inherits it, and none that has its own roles.
    sqlx::raw_sql(
        r#"UPDATE organizations SET notification_roles = jsonb_set(notification_roles, '{0,notify_statuses}', '["in_review","done"]') WHERE id = 'org-c'"#,
    )
    .execute(&mut conn)
    .await
    .unwrap();
    assert_eq!(
        users(recipients(&mut conn, inherit_p, "status_changed", "done", "").await),
        names(&["yacine"])
    );
    assert!(
        recipients(&mut conn, custom_p, "status_changed", "done", "")
            .await
            .is_empty()
    );

    // Isolation between orgs: org-d's role for Yacine applies to org-d only.
    assert_eq!(
        users(recipients(&mut conn, org_d_p, "status_changed", "not_ok", "").await),
        names(&["yacine"])
    );
    assert!(
        users(recipients(&mut conn, inherit_p, "status_changed", "backlog", "").await)
            .iter()
            .all(|u| u != "yacine")
    );
    assert!(
        recipients(&mut conn, org_d_p, "status_changed", "backlog", "")
            .await
            .iter()
            .all(|(u, _)| u == "yacine")
    );

    // The participant default leaves alone whoever an org role routes: Yacine
    // as creator hears In Review and comments, not In Progress. An explicit
    // "no role here" and an undefined role leave the default in place.
    let mut out: Vec<String> = sqlx::query_scalar(DEFAULT_ROUTING_EXCLUDED_SQL)
        .bind(inherit_p)
        .bind(names(&[
            "yacine",
            "rmz",
            "muted",
            "pinned-none",
            "swapped",
            "orphan",
            "plain",
        ]))
        .fetch_all(&mut conn)
        .await
        .unwrap();
    out.sort();
    assert_eq!(out, names(&["muted", "rmz", "swapped", "yacine"]));
    let mut out: Vec<String> = sqlx::query_scalar(DEFAULT_ROUTING_EXCLUDED_SQL)
        .bind(custom_p)
        .bind(names(&["yacine", "rmz"]))
        .fetch_all(&mut conn)
        .await
        .unwrap();
    out.sort();
    assert_eq!(
        out,
        names(&["yacine"]),
        "Dev is not defined on the customised project"
    );

    // "What you receive" reads the same rules as the send path: for every
    // member, project and event, the summary says "yes" exactly when
    // `RECIPIENTS_SQL` routes the event to them.
    for project in [inherit_p, custom_p, org_d_p] {
        for user in [
            "yacine",
            "rmz",
            "muted",
            "pinned-none",
            "swapped",
            "orphan",
            "plain",
        ] {
            let row: Option<SummaryFlags> = sqlx::query_as(&format!(
                "SELECT active, statuses, comments, issue_created FROM ({MEMBER_SUMMARY_SQL}) x"
            ))
            .bind(project)
            .bind(user)
            .fetch_optional(&mut conn)
            .await
            .unwrap();
            let (active, statuses, comments, created) = row.unwrap_or((false, None, None, None));
            let statuses = statuses.unwrap_or_default();
            let hears = |rows: Vec<(String, String)>| rows.iter().any(|(u, _)| u == user);
            for status in [
                "todo",
                "in_progress",
                "in_review",
                "not_ok",
                "backlog",
                "done",
            ] {
                let says = active
                    && (statuses
                        .as_array()
                        .is_some_and(|a| a.iter().any(|s| s == status || s == "*")));
                assert_eq!(
                    says,
                    hears(recipients(&mut conn, project, "status_changed", status, "").await),
                    "{user} / {status} on {project}"
                );
            }
            assert_eq!(
                active && comments.unwrap_or(false),
                hears(recipients(&mut conn, project, "comment_added", "", "someone").await),
                "{user} / comments on {project}"
            );
            assert_eq!(
                active && created.unwrap_or(false),
                hears(recipients(&mut conn, project, "issue_created", "", "").await),
                "{user} / new tickets on {project}"
            );
        }
    }
    conn.close().await.unwrap();
}
