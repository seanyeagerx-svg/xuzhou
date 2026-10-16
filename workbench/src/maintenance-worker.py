"""Independent, detached OpenClaw maintenance. No arbitrary remote commands."""
import os, sys, json, time, subprocess, shutil, hashlib, glob, re, fcntl
from pathlib import Path

job = Path(sys.argv[1]).resolve()
cfg = json.loads((job / "request.json").read_text())
root = Path.home() / ".openclaw"
unit = "openclaw-gateway.service"
ctl = ["systemctl"] + ([] if cfg.get("scope") == "system" else ["--user"])
state = {"id": cfg["id"], "action": cfg["action"], "state": "running", "phase": "checking",
         "startedAt": time.time(), "backup": None}
def redact(value):
    value = str(value)
    value = re.sub(r'(?i)Bearer\s+[A-Za-z0-9._~+/=-]+|\bsk-[A-Za-z0-9_-]{12,}\b', '[REDACTED]', value)
    value = re.sub(r'(?i)((?:password|passwd|token|api[_-]?key|secret|authorization)["\x27]?\s*[:=]\s*)[^\s,;]+', r'\1[REDACTED]', value)
    return value
def save(**updates):
    state.update(updates)
    state["updatedAt"] = time.time()
    temp = job / "report.tmp"
    temp.write_text(json.dumps(state, ensure_ascii=True))
    os.chmod(temp, 0o600)
    os.replace(temp, job / "report.json")
def command(args, timeout=30, check=True):
    r = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if check and r.returncode:
        raise RuntimeError(redact(r.stderr or r.stdout or "Command failed")[-4000:])
    return r
def digest(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()
def service():
    r = command(ctl + ["show", unit, "-p", "LoadState", "-p", "ActiveState", "-p", "SubState", "-p", "MainPID", "-p", "NRestarts"], check=False)
    return dict(line.split("=", 1) for line in r.stdout.splitlines() if "=" in line)
def snapshot():
    db = root / "agents/main/agent/openclaw-agent.sqlite"
    if not db.is_file():
        return {}
    code = """const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1],{readOnly:true});const tables=new Set(d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));const c={};for(const n of ['session_nodes','session_windows','transcript_events','memory_index_chunks','memory_embedding_cache'])if(tables.has(n))c[n]=d.prepare('SELECT count(*) AS n FROM '+n).get().n;console.log(JSON.stringify(c));d.close();"""
    return json.loads(command(["node", "--no-warnings", "-e", code, str(db)], timeout=90).stdout)
def backup():
    dest = job / "backup"
    dest.mkdir(mode=0o700)
    paths = [root / "openclaw.json", root / "agents/main/agent/openclaw-agent.sqlite"]
    paths += list((root / "agents/main/agent").glob("openclaw-agent.sqlite-wal"))
    paths += list((root / "agents/main/agent").glob("openclaw-agent.sqlite-shm"))
    paths += list((root / "agents/main/agent").glob("openclaw-agent.sqlite-journal"))
    confdir = Path("/etc/systemd/system") if cfg.get("scope") == "system" else Path.home() / ".config/systemd/user"
    paths += [confdir / unit]
    paths += list((confdir / (unit + ".d")).glob("*.conf"))
    paths = [p for p in paths if p.exists()]
    total = sum(p.stat().st_size for p in paths)
    if shutil.disk_usage(job).free < total * 2 + 512 * 1024 * 1024:
        raise RuntimeError("空间不足以保留备份并完成数据库维护")
    manifest = []
    for p in paths:
        if p.is_symlink() or not p.is_file():
            raise RuntimeError("维护文件不是普通文件，已保留原状态")
        to = dest / hashlib.sha256(str(p).encode()).hexdigest()[:16] / p.name
        to.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        shutil.copy2(p, to)
        os.chmod(to, 0o600)
        sha = digest(p)
        if digest(to) != sha:
            raise RuntimeError("备份校验失败")
        manifest.append({"source": str(p), "backup": str(to), "sha256": sha, "bytes": p.stat().st_size})
    (dest / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=True, indent=2))
    return str(dest)
def heap_setting():
    import shlex
    value = cfg.get("heapMiB")
    if value is None: return
    mem = int(re.search(r"MemTotal:\s+(\d+)", Path("/proc/meminfo").read_text()).group(1)) // 1024
    if not isinstance(value, int) or value < 128 or value > int(mem * 0.8):
        raise RuntimeError("所选堆上限超过这台服务器的维护范围")
    raw = command(ctl + ["show", unit, "-p", "Environment", "--value"]).stdout
    opts = next((v.split("=", 1)[1] for v in shlex.split(raw) if v.startswith("NODE_OPTIONS=")), "")
    opts = re.sub(r"--max-old-space-size(?:=|\s+)\d+|--max-old-space-size-percentage(?:=|\s+)[\d.]+", "", opts).strip()
    opts = (opts + " --max-old-space-size=" + str(value)).strip()
    base = Path("/etc/systemd/system") if cfg.get("scope") == "system" else Path.home() / ".config/systemd/user"
    folder = base / (unit + ".d")
    folder.mkdir(parents=True, exist_ok=True)
    conf = folder / "zz-workbench-memory.conf"
    if conf.is_symlink() or (conf.exists() and not conf.is_file()):
        raise RuntimeError("已有内存配置不是普通文件，未修改")
    state["memoryConfigPreviouslyPresent"] = conf.exists()
    if conf.exists(): shutil.copy2(conf, job / "memory-config-before.conf")
    conf.write_text("[Service]\nEnvironment=" + json.dumps("NODE_OPTIONS=" + opts) + "\n")
    os.chmod(conf, 0o600)
    state["memoryConfig"] = str(conf)
    command(ctl + ["daemon-reload"])
    state["heapMiB"] = value
def rollback_database():
    # Restore a complete, verified file set only while the service is stopped.
    if service().get("ActiveState") not in ("inactive", "failed"):
        raise RuntimeError("服务仍在运行，未覆盖数据库")
    db = root / "agents/main/agent/openclaw-agent.sqlite"
    allowed = {str(db) + suffix for suffix in ("", "-wal", "-shm", "-journal")}
    manifest = json.loads((Path(state["backup"]) / "manifest.json").read_text())
    items = [item for item in manifest if item["source"] in allowed]
    if str(db) not in {item["source"] for item in items}:
        raise RuntimeError("备份缺少主数据库，未回滚")
    for item in items:
        if digest(Path(item["backup"])) != item["sha256"]:
            raise RuntimeError("回滚副本校验失败，未覆盖数据库")
    preserved = job / "failed-database"
    preserved.mkdir(mode=0o700, exist_ok=True)
    for name in allowed:
        p = Path(name)
        if p.exists():
            if p.is_symlink() or not p.is_file():
                raise RuntimeError("维护后的数据库文件不是普通文件，未覆盖")
            shutil.copy2(p, preserved / p.name)
    for name in allowed:
        p = Path(name)
        if p.exists(): p.unlink()
    for item in items:
        shutil.copy2(item["backup"], item["source"])
        if digest(Path(item["source"])) != item["sha256"]:
            raise RuntimeError("恢复后的数据库校验失败")
    state["databaseRolledBack"] = True
def rollback_memory():
    if not state.get("memoryConfig"): return
    conf = Path(state["memoryConfig"])
    if state["memoryConfigPreviouslyPresent"]:
        shutil.copy2(job / "memory-config-before.conf", conf)
    else:
        conf.unlink(missing_ok=True)
    command(ctl + ["daemon-reload"])
    state["memoryConfigRolledBack"] = True
def verify():
    deadline = time.time() + 300
    last = {}
    first_ready, previous_restarts = None, None
    while time.time() < deadline:
        last = service()
        if last.get("ActiveState") == "active" and last.get("SubState") == "running":
            r = command(["curl", "--noproxy", "*", "--max-time", "5", "--silent",
                         "http://127.0.0.1:" + str(cfg.get("httpPort", 18789)) + "/readyz"], timeout=8, check=False)
            try:
                data = json.loads(r.stdout)
                if data.get("ready") is True:
                    if first_ready is not None and last.get("NRestarts") == previous_restarts:
                        return {"service": last, "readiness": data, "observedSeconds": round(time.time() - first_ready)}
                    first_ready, previous_restarts = time.time(), last.get("NRestarts")
                else: first_ready = None
            except Exception: pass
        else: first_ready = None
        time.sleep(5)
    raise RuntimeError("服务启动后的就绪检查未通过：" + json.dumps(last))
save()
lock = (root / "workbench-maintenance" / "maintenance.lock").open("a")
try:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    save(state="failed", phase="locked", error="已有独立维护任务正在执行")
    sys.exit(1)
restart_needed = False
failure = None
try:
    before = service()
    if before.get("LoadState") != "loaded":
        raise RuntimeError("所选运行方式下没有已安装的龙虾服务")
    state["serviceBefore"] = before
    if cfg["action"] == "recover":
        # Restart responsibility is acquired before stopping the Gateway.
        restart_needed = True
        save(phase="stopping")
        command(ctl + ["stop", unit], timeout=180)
        if service().get("ActiveState") not in ("inactive", "failed"):
            raise RuntimeError("服务尚未停止，未修改数据库")
        save(phase="backing-up")
        state["backup"] = backup()
        state["countsBefore"] = snapshot()
        save(phase="configuring")
        heap_setting()
        if cfg.get("compactDatabase"):
            save(phase="compacting")
            db = root / "agents/main/agent/openclaw-agent.sqlite"
            if not db.is_file(): raise RuntimeError("当前安装没有可维护的主 SQLite 数据库")
            state["databaseTouched"] = True
            r = command(["openclaw", "doctor", "--session-sqlite", "compact",
                         "--session-sqlite-store", str(db), "--json"], timeout=900, check=False)
            (job / "doctor.log").write_text(redact(r.stdout + r.stderr))
            if r.returncode: raise RuntimeError(redact(r.stderr or r.stdout)[-4000:])
            match = r.stdout.find("{")
            result = json.loads(r.stdout[match:])
            targets = result.get("targets", [])
            if (result.get("mode") != "compact" or result.get("totals", {}).get("issues") != 0
                or len(targets) != 1 or targets[0].get("sqlitePath") != str(db)
                or targets[0].get("dbStats", {}).get("integrityCheck") != "ok"
                or targets[0].get("compact", {}).get("skipped") is not False):
                raise RuntimeError("未取得所选数据库压缩和完整性验证的成功报告")
            state["reclaimedBytes"] = result.get("totals", {}).get("reclaimedBytes", 0)
            state["databaseReport"] = result
        state["countsAfter"] = snapshot()
        if state["countsBefore"] != state["countsAfter"]:
            raise RuntimeError("维护前后记录数量不一致，需从备份核对")
    restart_needed = True
except Exception as e:
    failure = redact(e)
    if state.get("databaseTouched") and state.get("backup"):
        try:
            rollback_database()
        except Exception as rollback_error:
            failure += "; " + redact(rollback_error)
    try: rollback_memory()
    except Exception as rollback_error: failure += "; " + redact(rollback_error)
finally:
    if restart_needed:
        save(phase="starting", maintenanceError=failure)
        try:
            command(ctl + ["start", unit], timeout=180)
            save(phase="verifying")
            state["verification"] = verify()
        except Exception as e:
            failure = (failure + "; " if failure else "") + redact(e)
            if state.get("memoryConfig") and not state.get("memoryConfigRolledBack"):
                try:
                    save(phase="restoring-config")
                    command(ctl + ["stop", unit], timeout=180)
                    rollback_memory()
                except Exception as rollback_error:
                    failure += "; " + redact(rollback_error)
                finally:
                    try:
                        command(ctl + ["start", unit], timeout=180)
                        state["verification"] = verify()
                    except Exception as restart_error:
                        failure += "; " + redact(restart_error)
    if failure: save(state="failed", phase="finished", error=failure, finishedAt=time.time())
    else: save(state="completed", phase="finished", finishedAt=time.time())
    fcntl.flock(lock, fcntl.LOCK_UN)
    lock.close()
sys.exit(1 if failure else 0)
