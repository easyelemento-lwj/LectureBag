"""Reject likely credentials in staged additions without printing their values."""
import re
import subprocess
import sys

patterns = [re.compile(r'-----BEGIN (?:RSA |EC )?PRIVATE KEY-----'),
            re.compile(r'\bsk-[A-Za-z0-9_-]{32,}'),
            re.compile(r'\bAIza[0-9A-Za-z_-]{35}'),
            re.compile(r'\bgh[pousr]_[A-Za-z0-9]{30,}')]
patch = subprocess.check_output(['git', 'diff', '--cached', '--no-ext-diff', '--unified=0'], text=True)
path = ''
violations = set()
for line in patch.splitlines():
    if line.startswith('+++ b/'):
        path = line[6:]
    elif line.startswith('+') and not line.startswith('+++'):
        if any(pattern.search(line[1:]) for pattern in patterns):
            violations.add(path)
for path in sorted(violations):
    print(f'Possible credential in staged file: {path} (value withheld)', file=sys.stderr)
sys.exit(bool(violations))
