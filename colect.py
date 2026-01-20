import os
import shutil

# Diretório raiz do projeto (ajuste se necessário)
PROJECT_ROOT = os.path.abspath(".")

# Pasta de saída
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "ipc_audit_bundle")

FILES = [
    "src/infra/ipc/buffer.js",
    "src/shared/ipc/constants.js",
    "src/server/engine/server.js",
    "src/server/engine/lifecycle.js",
    "src/server/engine/app.js",
    "src/core/environment_resolver.js",
    "src/core/infra_failure_policy.js",
    "src/core/ConnectionOrchestrator.js",
    "src/infra/io.js",
    "src/infra/locks/lock_manager.js",
    "src/infra/queue/task_loader.js",
    "src/driver/DriverLifecycleManager.js",
    "src/driver/factory.js",
    "tests/integration/ipc_tester.js",
]

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    copied = []
    missing = []

    for rel_path in FILES:
        src = os.path.join(PROJECT_ROOT, rel_path)
        dst = os.path.join(OUTPUT_DIR, os.path.basename(rel_path))

        if os.path.exists(src):
            shutil.copy2(src, dst)
            copied.append(rel_path)
        else:
            missing.append(rel_path)

    print("\n📦 IPC Audit Bundle")
    print(f"Destino: {OUTPUT_DIR}\n")

    if copied:
        print("✅ Arquivos copiados:")
        for f in copied:
            print(f"  - {f}")

    if missing:
        print("\n⚠️ Arquivos não encontrados:")
        for f in missing:
            print(f"  - {f}")

if __name__ == "__main__":
    main()
