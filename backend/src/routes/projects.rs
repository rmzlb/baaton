use axum::{extract::{Extension, Path, State}, Json};
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::{ApiResponse, CreateProject, Project};

/// List projects — filtered by the user's current org_id if available.
/// If no org_id in token (no active org selected), return ALL projects accessible to user.
pub async fn list(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Json<ApiResponse<Vec<Project>>> {
    let projects = if let Some(ref org_id) = auth.org_id {
        // User has an active org selected → filter by org
        sqlx::query_as::<_, Project>(
            "SELECT * FROM projects WHERE org_id = $1 ORDER BY created_at DESC"
        )
        .bind(org_id)
        .fetch_all(&pool)
        .await
        .unwrap_or_default()
    } else {
        // No active org → return all projects (personal mode)
        // In production, filter by user's org memberships via Clerk API
        sqlx::query_as::<_, Project>(
            "SELECT * FROM projects ORDER BY created_at DESC"
        )
        .fetch_all(&pool)
        .await
        .unwrap_or_default()
    };

    Json(ApiResponse::new(projects))
}

/// Create a project — assigns to the user's current org.
pub async fn create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Json(body): Json<CreateProject>,
) -> Json<ApiResponse<Project>> {
    let effective_org = auth.org_id.clone().unwrap_or_else(|| auth.user_id.clone());

    // Ensure the org exists in the organizations table (upsert)
    let _ = sqlx::query(
        "INSERT INTO organizations (id, name, slug) VALUES ($1, $1, $1) ON CONFLICT (id) DO NOTHING"
    )
    .bind(&effective_org)
    .execute(&pool)
    .await;

    let project = sqlx::query_as::<_, Project>(
        r#"
        INSERT INTO projects (org_id, name, slug, description, prefix)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
        "#,
    )
    .bind(&effective_org)
    .bind(&body.name)
    .bind(&body.slug)
    .bind(&body.description)
    .bind(&body.prefix)
    .fetch_one(&pool)
    .await
    .unwrap();

    Json(ApiResponse::new(project))
}

/// Get one project — filtered by org if active, otherwise allow all.
pub async fn get_one(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<Project>>, axum::http::StatusCode> {
    let project = if let Some(ref org_id) = auth.org_id {
        sqlx::query_as::<_, Project>(
            "SELECT * FROM projects WHERE id = $1 AND org_id = $2"
        )
        .bind(id)
        .bind(org_id)
        .fetch_optional(&pool)
        .await
        .unwrap()
    } else {
        sqlx::query_as::<_, Project>(
            "SELECT * FROM projects WHERE id = $1"
        )
        .bind(id)
        .fetch_optional(&pool)
        .await
        .unwrap()
    };

    match project {
        Some(p) => Ok(Json(ApiResponse::new(p))),
        None => Err(axum::http::StatusCode::NOT_FOUND),
    }
}

/// Update a project — filtered by org if active.
pub async fn update(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<ApiResponse<Project>>, axum::http::StatusCode> {
    let project = if let Some(ref org_id) = auth.org_id {
        sqlx::query_as::<_, Project>(
            r#"UPDATE projects SET name = COALESCE($3, name), description = COALESCE($4, description)
               WHERE id = $1 AND org_id = $2 RETURNING *"#,
        )
        .bind(id).bind(org_id)
        .bind(body.get("name").and_then(|v| v.as_str()))
        .bind(body.get("description").and_then(|v| v.as_str()))
        .fetch_optional(&pool).await.unwrap()
    } else {
        sqlx::query_as::<_, Project>(
            r#"UPDATE projects SET name = COALESCE($2, name), description = COALESCE($3, description)
               WHERE id = $1 RETURNING *"#,
        )
        .bind(id)
        .bind(body.get("name").and_then(|v| v.as_str()))
        .bind(body.get("description").and_then(|v| v.as_str()))
        .fetch_optional(&pool).await.unwrap()
    };

    match project {
        Some(p) => Ok(Json(ApiResponse::new(p))),
        None => Err(axum::http::StatusCode::NOT_FOUND),
    }
}

/// Delete a project — filtered by org if active.
pub async fn remove(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<()>>, axum::http::StatusCode> {
    let result = if let Some(ref org_id) = auth.org_id {
        sqlx::query("DELETE FROM projects WHERE id = $1 AND org_id = $2")
            .bind(id).bind(org_id)
            .execute(&pool).await.unwrap()
    } else {
        sqlx::query("DELETE FROM projects WHERE id = $1")
            .bind(id)
            .execute(&pool).await.unwrap()
    };

    if result.rows_affected() > 0 {
        Ok(Json(ApiResponse::new(())))
    } else {
        Err(axum::http::StatusCode::NOT_FOUND)
    }
}
