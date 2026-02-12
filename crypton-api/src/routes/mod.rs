mod chat;
mod contacts;
mod message;
mod notification;
mod thread;
mod user;

use axum::Router;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

use crate::AppState;

pub fn build_router(state: AppState) -> Router {
    let api = Router::new()
        .merge(user::routes())
        .merge(chat::routes())
        .merge(thread::routes())
        .merge(message::routes())
        .merge(message::thread_create_routes())
        .merge(contacts::routes())
        .merge(notification::routes());

    Router::new()
        .nest("/v1", api)
        .merge(notification::public_routes())
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
