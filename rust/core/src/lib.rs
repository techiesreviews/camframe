//! CamFrame's rules without a window. Every rule here mirrors CamFrame 0.9.0 (`src/*.js`) and is
//! checked against the same contract fixtures, so the Rust app reads and writes the same
//! Preferences and Scene files.

pub mod framing;
pub mod geometry;
pub mod interaction;
pub mod js;
pub mod scenes;
pub mod settings;
pub mod store;
