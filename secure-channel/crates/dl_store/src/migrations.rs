pub mod run {
    use crate::error::StoreError;
    use sqlx::SqlitePool;

    pub async fn run_migrations(pool: &SqlitePool) -> Result<(), StoreError> {
        sqlx::migrate!("./migrations")
            .run(pool)
            .await
            .map_err(|e| StoreError::Migration(e.to_string()))
    }
}
