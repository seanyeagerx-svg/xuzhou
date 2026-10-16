// Xuzhou modification (2026-10-16): native Windows test fixtures; production behavior unchanged.
use super::*;
use crate::canonical::{canonicalize, fs_path};

fn root() -> Canonical {
    canonicalize(if cfg!(windows) {
        "file:///c:/work/proj"
    } else {
        "file:///work/proj"
    })
    .unwrap()
}

#[test]
fn resolves_normal_child_path() {
    let r = resolve_relative(&root(), "src/main.rs", FileOp::Read).unwrap();
    assert_eq!(r.relative_path, "src/main.rs");
    assert_eq!(r.resource_uri, format!("{}/src/main.rs", root().as_str()));
    assert_eq!(r.absolute_path.unwrap(), fs_path(&root()).unwrap().join("src/main.rs"));
}

#[test]
fn empty_relative_is_root_itself() {
    let r = resolve_relative(&root(), "", FileOp::Browse).unwrap();
    assert_eq!(r.relative_path, "");
    assert_eq!(r.resource_uri, root().as_str());
}

#[test]
fn strips_single_dot_and_trailing_slash() {
    let r = resolve_relative(&root(), "./a/b/", FileOp::Read).unwrap();
    assert_eq!(r.relative_path, "a/b");
}

#[test]
fn interior_dot_dot_that_stays_inside_is_ok() {
    let r = resolve_relative(&root(), "a/../b", FileOp::Read).unwrap();
    assert_eq!(r.relative_path, "b");
}

#[test]
fn absolute_path_is_rejected() {
    let err = resolve_relative(&root(), "/etc/passwd", FileOp::Read).unwrap_err();
    assert_eq!(err.code(), "invalid_relative_path");
}

#[test]
fn dot_dot_escape_is_rejected() {
    assert_eq!(
        resolve_relative(&root(), "..", FileOp::Read).unwrap_err().code(),
        "invalid_relative_path"
    );
    assert_eq!(
        resolve_relative(&root(), "a/../../b", FileOp::Read).unwrap_err().code(),
        "invalid_relative_path"
    );
}
