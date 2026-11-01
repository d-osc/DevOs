"""Cross-client catalog and installed-state transactions against the real CLI."""
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile

repo = Path(__file__).resolve().parents[2]
d = os.environ.get("DEVLANG_BIN") or shutil.which("d") or str(Path.home() / ".local/bin/d")
pm = repo / "pm-cli/main.dev"
service = repo / "src/apps/org.devos.appstore/service.dev"

with tempfile.TemporaryDirectory(prefix="devos-shared-catalog-") as directory:
    root = Path(directory)
    database = root / "database"
    (database / "apps/store-app").mkdir(parents=True)
    for name in ("database.dev", "database-cli.dev"):
        shutil.copy2(repo / "app-db" / name, database / name)
    manifest = {"schema_version": 2, "id": "store-app", "name": "Shared Application", "aliases": ["shared-demo"], "status": "catalog", "summary": "One catalog", "categories": ["developer-tools"], "downloads": [{"platform": "linux", "arch": "arm64", "format": "dpk", "file_url": "https://example.org/latest"}]}
    app = database / "apps/store-app/app.json"
    app.write_text(json.dumps(manifest))
    (root / "home").mkdir()
    (root / "downloads").mkdir()
    curl = root / "curl"
    curl.write_text('''#!/bin/sh
while [ $# -gt 0 ]; do
  if [ "$1" = --output ]; then out=$2; shift; fi
  shift
done
cp "$FAKE_PACKAGE" "$out"
''')
    curl.chmod(0o755)
    launcher = root / "dev"
    launcher.write_text(f'#!/bin/sh\nexec "{d}" "{pm}" -- "$@"\n')
    launcher.chmod(0o755)
    env = os.environ | {"DEV_ROOT": str(root / "store"), "HOME": str(root / "home"), "XDG_DATA_HOME": str(root / "home/.local/share"), "DEV_BIN_DIR": str(root / "commands"), "DEVOS_APPSTORE_DATABASE": str(database), "DEVOS_APPSTORE_TEST": "1", "DEVOS_APPSTORE_CURL": str(curl), "DEVOS_APPSTORE_ARCH": "aarch64", "DEVOS_APPSTORE_TMP": str(root / "downloads"), "DEV_OS_PM": str(launcher)}

    def cli(*args, status=0, environment=None):
        done = subprocess.run([d, str(pm), "--", *args], env=environment or env, capture_output=True, text=True, timeout=60)
        assert done.returncode == status, (args, done.stdout, done.stderr)
        return done.stdout

    def gui(action, **fields):
        done = subprocess.run([d, str(service), "--", str(repo)], env=env, input=json.dumps({"action": action, **fields}) + "\n", capture_output=True, text=True, timeout=90)
        assert done.returncode == 0, done.stderr
        return [record.split("\t") for record in done.stdout.rstrip("\r\n").split("\x1e")]

    def archive(version, name="native-demo"):
        archive = root / f"{name}-{version}.dpk"
        with tarfile.open(archive, "w:gz") as target:
            for path, data, mode in [("package.json", json.dumps({"name": name, "version": version, "bin": {name: "bin/run"}}).encode(), 0o644), ("bin/run", b"#!/bin/sh\necho shared\n", 0o755)]:
                entry = tarfile.TarInfo(path); entry.mode = mode; entry.size = len(data)
                target.addfile(entry, io.BytesIO(data))
        return archive

    def catalog():
        return json.loads(cli("catalog", "--json"))

    def state():
        return json.loads((root / "store/registry.json").read_text())

    assert catalog()["apps"][0]["manifest"]["name"] == gui("catalog")[1][2] == "Shared Application"
    manifest["name"] = "Edited At Source"
    app.write_text(json.dumps(manifest))
    assert catalog()["apps"][0]["manifest"]["name"] == gui("catalog")[1][2] == "Edited At Source"
    assert json.loads(cli("search", "shared-demo", "--json"))[0]["manifest"]["id"] == "store-app"
    package = archive("1.0.0"); env["FAKE_PACKAGE"] = str(package)
    cli("install", "shared-demo")
    assert catalog()["apps"][0]["softwareType"] == "package"
    lock = root / "store/.dev-lock"
    lock.write_text(str(os.getpid()))
    cli("remove", "native-demo", status=1)
    assert "native-demo" in state()["packages"]
    lock.write_text("2147483647")
    cli("verify", "native-demo")
    # A writer reclaims the stale marker; verification itself is read-only.
    assert state()["packages"]["native-demo"]["catalog"]["id"] == "store-app"
    assert catalog()["bindings"] == {"store-app": "native-demo"}
    assert gui("catalog")[1][8] == "native-demo"
    assert gui("installed")[1][1:3] == ["native-demo", "1.0.0"]
    assert not list((root / "home").rglob("bindings-*.json"))
    cli("install", str(archive("2.0.0")), "--replace")
    assert not lock.exists()
    assert state()["packages"]["native-demo"]["catalog"]["id"] == "store-app"
    cli("rollback", "shared-demo")
    assert gui("catalog")[1][8] == "native-demo"
    assert gui("installed")[1][2] == "1.0.0"
    assert gui("remove", id="native-demo")[0][0] == "V"
    assert catalog()["bindings"] == {} and state()["packages"] == {}
    assert gui("installApp", id="store-app")[0][0] == "V"
    cli("verify", "shared-demo")
    assert "native-demo" in cli("info", "store-app")
    cli("remove", "shared-demo")
    assert gui("catalog")[1][8] == ""
    assert catalog()["apps"][0]["softwareType"] == "app"

    # One-time legacy migration writes the PM registry, retains an archive,
    # and never resurrects the old binding after a later uninstall/reinstall.
    cli("install", str(package))
    identity = hashlib.sha256(env["DEV_ROOT"].encode()).hexdigest()
    legacy = root / f"home/.local/share/dev-os/app-store/bindings-{identity}.json"
    legacy.parent.mkdir(parents=True)
    legacy.write_text(json.dumps({"store-app": "native-demo", "gone-app": "not-installed"}))
    assert gui("catalog")[1][8] == "native-demo"
    assert not legacy.exists() and legacy.with_name(legacy.name + ".migrated").exists()
    assert state()["packages"]["native-demo"]["catalog"]["id"] == "store-app"
    cli("remove", "native-demo")
    cli("install", str(package))
    assert gui("catalog")[1][8] == ""
    cli("remove", "native-demo")

    # A prepared release checks the digest and actual PM identity before commit.
    manifest["status"] = "installable"
    manifest["channels"] = {"stable": "1.0.0"}
    artifact = {"platform": "linux", "arch": "arm64", "format": "dpk", "backend": "devospm", "scope": "user", "url": "https://example.org/package.dpk", "sha256": "0" * 64, "package": {"name": "native-demo", "version": "1.0.0"}}
    manifest["releases"] = [{"version": "1.0.0", "artifacts": [artifact]}]
    app.write_text(json.dumps(manifest))
    before = (root / "store/registry.json").read_bytes()
    cli("install", "store-app", status=1)
    assert (root / "store/registry.json").read_bytes() == before
    assert not list((root / "downloads").iterdir())
    artifact["sha256"] = hashlib.sha256(package.read_bytes()).hexdigest()
    artifact["package"]["name"] = "wrong-name"
    app.write_text(json.dumps(manifest))
    cli("install", "store-app", status=1)
    assert (root / "store/registry.json").read_bytes() == before
    artifact["package"]["name"] = "native-demo"
    app.write_text(json.dumps(manifest))
    cli("install", "store-app")
    assert catalog()["bindings"] == {"store-app": "native-demo"}

    # Explicitly selected stores have independent installed state.
    other = env | {"DEV_ROOT": str(root / "other-store")}
    assert json.loads(cli("catalog", "--json", environment=other))["bindings"] == {}
    assert catalog()["bindings"] == {"store-app": "native-demo"}

    # Two clients cannot commit different packages for the same catalog ID.
    cli("remove", "native-demo")
    manifest["status"] = "catalog"; app.write_text(json.dumps(manifest))
    processes = [subprocess.Popen([d,str(pm),"--","install",str(archive("1.0.0",name)),"--catalog-id","store-app"],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE) for name in ("native-one","native-two")]
    outcomes = [process.communicate(timeout=60) for process in processes]
    assert sorted(process.returncode for process in processes) == [0,1], outcomes
    assert len(state()["packages"]) == 1 and len(catalog()["bindings"]) == 1

    # Packaged CLI + GUI use the very same embedded database away from the repo.
    staged = root / "portable"
    subprocess.run(["sh", str(repo / "pm-cli/stage.sh"), str(staged)], env=env | {"DEVOS_APPSTORE_SOURCE": str(database)}, check=True)
    pm = staged / "main.dev"
    portable_env = dict(env); portable_env.pop("DEVOS_APPSTORE_DATABASE")
    data = json.loads(cli("catalog", "--json", environment=portable_env))
    assert data["source"] == str(staged / "catalog-data")
    assert data["apps"][0]["manifest"]["name"] == "Edited At Source"
    launcher.write_text(f'#!/bin/sh\nexec "{d}" "{pm}" -- "$@"\n')
    env = portable_env
    assert gui("catalog")[1][2] == "Edited At Source"

print("Shared live catalog, aliases, CLI/GUI transactions, rollback, migration, integrity failures, isolated stores, and portable payload passed")
