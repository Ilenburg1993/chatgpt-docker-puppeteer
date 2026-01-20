#!/usr/bin/env bash
set -euo pipefail

# Helper script to show / attempt installation commands for dev utilities
# Run this script to see recommended install commands for the environment.

echo "Recommended developer utilities for repository hygiene and automation:"
echo "  - git-filter-repo (recommended to rewrite history)"
echo "  - gh (GitHub CLI)"
echo "  - bfg-repo-cleaner (alternative to remove large files; needs Java)"
echo "  - jq (JSON CLI helper)"
echo "  - pre-commit (runs linters/hooks locally)"

echo
echo "On Debian/Ubuntu (requires sudo):"
echo "  sudo apt update && sudo apt install -y python3-pip default-jre jq"
echo "  python3 -m pip install --user git-filter-repo pre-commit"
echo "  # GitHub CLI (official): https://cli.github.com/manual/installation"
echo "  # BFG requires Java (installed above):"
echo "  curl -L -o /tmp/bfg.jar https://repo1.maven.org/maven2/com/madgag/bfg/1.14.0/bfg-1.14.0.jar"

echo
echo "Notes:"
echo " - If you don't have sudo access, install python packages with 'python3 -m pip install --user ...'"
echo " - After installing, add ~/.local/bin to your PATH if not already present"

echo
echo "Done. If you want, run this script with sudo to attempt installs (not automatic by default)."
#!/usr/bin/env bash
set -euo pipefail

# Helper script to show / attempt installation commands for dev utilities
# Run this script to see recommended install commands for the environment.

echo "Recommended developer utilities for repository hygiene and automation:"
echo "  - git-filter-repo (recommended to rewrite history)"
echo "  - gh (GitHub CLI)"
echo "  - bfg-repo-cleaner (alternative to remove large files; needs Java)"
echo "  - jq (JSON CLI helper)"
echo "  - pre-commit (runs linters/hooks locally)"

echo
echo "On Debian/Ubuntu (requires sudo):"
echo "  sudo apt update && sudo apt install -y python3-pip default-jre jq"
echo "  python3 -m pip install --user git-filter-repo pre-commit"
echo "  # GitHub CLI (official): https://cli.github.com/manual/installation"
echo "  # BFG requires Java (installed above):\n  curl -L -o /tmp/bfg.jar https://repo1.maven.org/maven2/com/madgag/bfg/1.14.0/bfg-1.14.0.jar"

echo
echo "Notes:"
echo " - If you don\'t have sudo access, install python packages with 'python3 -m pip install --user ...'"
echo " - After installing, add ~/.local/bin to your PATH if not already present"

echo
echo "Done. If you want, run this script with sudo to attempt installs (not automatic by default)."
