pub(crate) fn run_in_env_child<F>(test_name: &str, configure: F) -> bool
where
    F: FnOnce(&mut std::process::Command),
{
    const CHILD_ENV: &str = "AIONUI_RUNTIME_ENV_TEST_CHILD";

    if std::env::var_os(CHILD_ENV).is_some() {
        return true;
    }

    let mut command = std::process::Command::new(std::env::current_exe().unwrap());
    command
        .arg("--exact")
        .arg(test_name)
        .arg("--nocapture")
        .env(CHILD_ENV, "1");
    configure(&mut command);
    let output = command.output().unwrap();
    assert!(
        output.status.success(),
        "child test failed\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    false
}

// Xuzhou modification (2026-10-16): native Node fixtures for Windows runtime validation.
#[cfg(windows)]
pub(crate) fn write_native_node(root: &std::path::Path, with_npm: bool) {
    std::fs::create_dir_all(root).unwrap();
    let source = std::env::var_os("AIONUI_TEST_NODE_EXECUTABLE")
        .map(std::path::PathBuf::from)
        .or_else(|| crate::resolve_command_path("node"))
        .expect("Windows runtime tests require real Node.js");
    std::fs::copy(source, root.join("node.exe")).expect("copy native Node fixture");
    if with_npm {
        let bin = root.join("node_modules/npm/bin");
        std::fs::create_dir_all(&bin).unwrap();
        for tool in ["npm", "npx"] {
            std::fs::write(bin.join(format!("{tool}-cli.js")), "console.log('24.11.0');\n").unwrap();
        }
    }
}
