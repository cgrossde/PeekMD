// WorkerGuard must be stored for the duration of the process to flush log
// buffers on exit. The guard is a runtime value produced by non_blocking(),
// so OnceLock (not LazyLock) is correct here — there is no fixed initializer.
use std::sync::OnceLock;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::EnvFilter;

static LOG_GUARD: OnceLock<WorkerGuard> = OnceLock::new();

pub fn init() {
    #[cfg(debug_assertions)]
    let (log_dir, base) = (
        dirs::home_dir()
            .unwrap_or_default()
            .join("Library/Logs/PeekMD Dev"),
        "debug",
    );
    #[cfg(not(debug_assertions))]
    let (log_dir, base) = (
        dirs::home_dir()
            .unwrap_or_default()
            .join("Library/Logs/PeekMD"),
        "info",
    );

    std::fs::create_dir_all(&log_dir).ok();

    let appender = tracing_appender::rolling::RollingFileAppender::builder()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix("peekmd")
        .filename_suffix("log")
        .max_log_files(7)
        .build(&log_dir)
        .expect("log appender");

    let (nb, guard) = tracing_appender::non_blocking(appender);
    LOG_GUARD.set(guard).ok();

    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        EnvFilter::new(format!("{base},tauri_runtime_wry=warn,tao=warn"))
    });

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(nb)
        .with_ansi(false)
        .init();

    tracing::info!("PeekMD starting up v{}", env!("CARGO_PKG_VERSION"));
}
