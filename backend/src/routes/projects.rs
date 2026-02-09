use axum::{extract::{Extension, Path, State}, Json};
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::{ApiResponse, CreateProject, Project};

/// List projects — filtered by the user's current org_id.
/// If no org_id in token (personal account), show projects with org_id = user_id.
pub async fn list(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
) -> Json<ApiResponse<Vec<Project>>> {
    let effective_org = auth.org_id.clone().unwrap_or_else(|| auth.user_id.clone());

    let projects = sqlx::query_as::<_, Project>(
        "SELECT * FROM projects WHERE org_id = $1 ORDER BY created_at DESC"
    )
    .bind(&effective_org)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    Json(ApiResponse::new(projects))
}

/// Create a project — assigns to the user's current org.
pub async fn create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Json(body): Json<CreateProject>,
) -> Json<ApiResponse<Project>> {
    let effective_org = auth.org_id.clone().unwrap_or_else(|| auth.user_id.clone());

    // Ensure the org exists in the organizations table
    let _ = sqlx::query("SELECT ensure_org_exists($1)")
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

/// Get one project — only if it belongs to the user's org.
pub async fn get_one(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<Project>>, axum::http::StatusCode> {
    let effective_org = auth.org_id.clone().unwrap_or_else(|| auth.user_id.clone());

    let project = sqlx::query_as::<_, Project>(
        "SELECT * FROM projects WHERE id = $1 AND org_id = $2"
    )
    .bind(id)
    .bind(&effective_org)
    .fetch_optional(&pool)
    .await
    .unwrap();

    match project {
        Some(p) => Ok(Json(ApiResponse::new(p))),
        None => Err(axum::http::StatusCode::NOT_FOUND),
    }
}

/// Update a project — only if it belongs to the user's org.
pub async fn update(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<ApiResponse<Project>>, axum::http::StatusCode> {
    let effective_org = auth.org_id.clone().unwrap_or_else(|| auth.user_id.clone());

    let project = sqlx::query_as::<_, Project>(
        r#"
        UPDATE projects SET
            name = COALESCE($3, name),
            description = COALESCE($4, description)
        WHERE id = $1 AND org_id = $2
        RETURNING *
        "#,
    )
    .bind(id)
    .bind(&effective_org)
    .bind(body.get("name").and_then(|v| v.as_str()))
    .bind(body.get("description").and_then(|v| v.as_str()))
    .fetch_optional(&pool)
    .await
    .unwrap();

    match project {
        Some(p) => Ok(Json(ApiResponse::new(p))),
        None => Err(axum::http::StatusCode::NOT_FOUND),
    }
}

/// Delete a project — only if it belongs to the user's org.
pub async fn remove(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiResponse<()>>, axum::http::StatusCode> {
    let effective_org = auth.org_id.clone().unwrap_or_else(|| auth.user_id.clone());

    let result = sqlx::query("DELETE FROM projects WHERE id = $1 AND org_id = $2")
        .bind(id)
        .bind(&effective_org)
        .execute(&pool)
        .await
        .unwrap();

    if result.rows_affected() > 0 {
        Ok(Json(ApiResponse::new(())))
    } else {
        Err(axum::http::StatusCode::NOT_FOUND)
    }
}
