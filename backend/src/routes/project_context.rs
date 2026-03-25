use axum::{extract::{Path, State}, http::StatusCode, Extension, Json};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::AuthUser;
use crate::models::{ApiResponse, AppendContextField, ProjectContext, UpdateProjectContext};

// ─── GET /projects/{id}/context ───────────────────────

pub async fn get_or_create(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<ApiResponse<ProjectContext>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Verify project belongs to org
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1 AND org_id = $2)"
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    if !exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"}))));
    }

    // Get or create empty context
    let ctx = sqlx::query_as::<_, ProjectContext>(
        r#"
        INSERT INTO project_contexts (project_id, org_id)
        VALUES ($1, $2)
        ON CONFLICT (project_id) DO UPDATE SET updated_at = project_contexts.updated_at
        RETURNING *
        "#,
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(ctx)))
}

// ─── PATCH /projects/{id}/context ─────────────────────

pub async fn update(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<UpdateProjectContext>,
) -> Result<Json<ApiResponse<ProjectContext>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    // Verify project belongs to org
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1 AND org_id = $2)"
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    if !exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"}))));
    }

    // Upsert context with partial update
    let ctx = sqlx::query_as::<_, ProjectContext>(
        r#"
        INSERT INTO project_contexts (project_id, org_id, stack, conventions, architecture, constraints, current_focus, learnings, custom_context)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, '{}'))
        ON CONFLICT (project_id) DO UPDATE SET
            stack = COALESCE($3, project_contexts.stack),
            conventions = COALESCE($4, project_contexts.conventions),
            architecture = COALESCE($5, project_contexts.architecture),
            constraints = COALESCE($6, project_contexts.constraints),
            current_focus = COALESCE($7, project_contexts.current_focus),
            learnings = COALESCE($8, project_contexts.learnings),
            custom_context = CASE WHEN $9 IS NOT NULL THEN $9 ELSE project_contexts.custom_context END,
            updated_at = now()
        RETURNING *
        "#,
    )
    .bind(project_id)
    .bind(org_id)
    .bind(&body.stack)
    .bind(&body.conventions)
    .bind(&body.architecture)
    .bind(&body.constraints)
    .bind(&body.current_focus)
    .bind(&body.learnings)
    .bind(body.custom_context.as_ref())
    .fetch_one(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(ctx)))
}

// ─── POST /projects/{id}/context/append ───────────────

pub async fn append(
    Extension(auth): Extension<AuthUser>,
    State(pool): State<PgPool>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<AppendContextField>,
) -> Result<Json<ApiResponse<ProjectContext>>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = auth.org_id.as_deref()
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(json!({"error": "Organization required"}))))?;

    const VALID_FIELDS: &[&str] = &["stack", "conventions", "architecture", "constraints", "current_focus", "learnings"];

    if !VALID_FIELDS.contains(&body.field_name.as_str()) {
        return Err((StatusCode::BAD_REQUEST, Json(json!({
            "error": format!("Invalid field_name '{}'. Accepted: {}", body.field_name, VALID_FIELDS.join(", ")),
            "accepted_values": VALID_FIELDS,
            "field": "field_name"
        }))));
    }

    // Verify project belongs to org
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1 AND org_id = $2)"
    )
    .bind(project_id)
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    if !exists {
        return Err((StatusCode::NOT_FOUND, Json(json!({"error": "Project not found"}))));
    }

    // Ensure context exists
    sqlx::query(
        "INSERT INTO project_contexts (project_id, org_id) VALUES ($1, $2) ON CONFLICT (project_id) DO NOTHING"
    )
    .bind(project_id)
    .bind(org_id)
    .execute(&pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    // Append to the field (separator: newline)
    let separator = "\n\n";
    let append_text = format!("{}{}", separator, body.content);

    // Dynamic column name — safe because we validated against VALID_FIELDS above
    let sql = format!(
        r#"
        UPDATE project_contexts
        SET {field} = CASE
            WHEN {field} IS NULL OR {field} = '' THEN $1
            ELSE {field} || $2
        END,
        updated_at = now()
        WHERE project_id = $3
        RETURNING *
        "#,
        field = body.field_name
    );

    let ctx = sqlx::query_as::<_, ProjectContext>(&sql)
        .bind(&body.content)
        .bind(&append_text)
        .bind(project_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e.to_string()}))))?;

    Ok(Json(ApiResponse::new(ctx)))
}

// ─── Public helper: append to learnings directly ──────

pub async fn append_to_learnings(pool: &PgPool, project_id: Uuid, org_id: &str, content: &str) {
    let _ = sqlx::query(
        r#"
        INSERT INTO project_contexts (project_id, org_id, learnings)
        VALUES ($1, $2, $3)
        ON CONFLICT (project_id) DO UPDATE SET
            learnings = CASE
                WHEN project_contexts.learnings IS NULL OR project_contexts.learnings = '' THEN $3
                ELSE project_contexts.learnings || E'\n\n' || $3
            END,
            updated_at = now()
        "#,
    )
    .bind(project_id)
    .bind(org_id)
    .bind(content)
    .execute(pool)
    .await;
}
